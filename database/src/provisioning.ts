import { sql } from 'drizzle-orm';
import type { Transaction } from './client';
import { DEFAULT_UOMS } from './india';
import { SYSTEM_ROLES } from './permissions';
import {
  auditLogs,
  branches,
  companies,
  itemGroups,
  membershipRoles,
  memberships,
  rolePermissions,
  roles,
  subscriptions,
  tenants,
  uoms,
  users,
  warehouses,
} from './schema';

export interface ProvisionTenantInput {
  tenant: { slug: string; name: string; industry?: string | null; trialDays?: number; partnerId?: string | null };
  company: { name: string; legalName?: string | null; gstin?: string | null; stateCode?: string | null };
  /** A new user, or an existing user (a partner creating a client workspace) by id. */
  owner: { email: string; fullName: string; passwordHash: string; mobile?: string | null } | { userId: string };
}

export interface ProvisionTenantResult {
  tenantId: string;
  userId: string;
  membershipId: string;
  companyId: string;
  branchId: string;
}

/**
 * Creates a complete, ready-to-use workspace in one transaction:
 * tenant → company → head-office branch → system roles → owner user + membership.
 *
 * Works for both the RLS-bound app role (sign-up) and the owner role (seeds):
 * it sets app.tenant_id / app.user_id itself before inserting.
 */
export async function provisionTenant(tx: Transaction, input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
  const ids = await tx.execute<{ tenant_id: string; user_id: string }>(
    sql`select uuidv7()::text as tenant_id, uuidv7()::text as user_id`,
  );
  const tenantId = ids.rows[0].tenant_id;
  const userId = 'userId' in input.owner ? input.owner.userId : ids.rows[0].user_id;
  await tx.execute(
    sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${userId}, true)`,
  );

  const trialDays = input.tenant.trialDays ?? 30;
  const trialEndsAt = new Date(Date.now() + trialDays * 86_400_000);
  await tx.insert(tenants).values({
    id: tenantId,
    slug: input.tenant.slug,
    name: input.tenant.name,
    industry: input.tenant.industry ?? null,
    status: 'trial',
    planCode: 'trial',
    trialEndsAt,
    partnerId: input.tenant.partnerId ?? null,
  });
  await tx.insert(subscriptions).values({
    tenantId,
    planCode: 'trial',
    status: 'trialing',
    provider: 'none',
    currentPeriodStart: new Date(),
    currentPeriodEnd: trialEndsAt,
  });

  if (!('userId' in input.owner))
    await tx.insert(users).values({
      id: userId,
      email: input.owner.email,
      fullName: input.owner.fullName,
      mobile: input.owner.mobile ?? null,
      passwordHash: input.owner.passwordHash,
    });

  const [membership] = await tx
    .insert(memberships)
    .values({ tenantId, userId, isOwner: true, status: 'active' })
    .returning({ id: memberships.id });

  const gstin = input.company.gstin?.toUpperCase() || null;
  const stateCode = input.company.stateCode ?? (gstin ? gstin.slice(0, 2) : null);
  const [company] = await tx
    .insert(companies)
    .values({
      tenantId,
      name: input.company.name,
      legalName: input.company.legalName ?? input.company.name,
      gstin,
      pan: gstin ? gstin.slice(2, 12) : null,
      stateCode,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning({ id: companies.id });

  const [branch] = await tx
    .insert(branches)
    .values({
      tenantId,
      companyId: company.id,
      code: 'HO',
      name: 'Head Office',
      gstin,
      stateCode,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning({ id: branches.id });

  let ownerRoleId = '';
  for (const def of SYSTEM_ROLES) {
    const [role] = await tx
      .insert(roles)
      .values({ tenantId, name: def.name, description: def.description, isSystem: true })
      .returning({ id: roles.id });
    if (def.name === 'Owner') ownerRoleId = role.id;
    await tx
      .insert(rolePermissions)
      .values(def.permissions.map((permissionCode) => ({ tenantId, roleId: role.id, permissionCode })));
  }
  await tx.insert(membershipRoles).values({ tenantId, membershipId: membership.id, roleId: ownerRoleId });
  await seedMasterDefaults(tx, tenantId, company.id, branch.id, userId);

  await tx.insert(auditLogs).values({
    tenantId,
    actorUserId: userId,
    action: 'tenant.provisioned',
    entityType: 'tenant',
    entityId: tenantId,
    metadata: { slug: input.tenant.slug, companyId: company.id },
  });

  return { tenantId, userId, membershipId: membership.id, companyId: company.id, branchId: branch.id };
}

/** Default item groups for a new workspace. */
export const DEFAULT_ITEM_GROUPS: [string, string][] = [
  ['RM', 'Raw materials'],
  ['PM', 'Packing materials'],
  ['CON', 'Consumables'],
  ['SPR', 'Spares & tools'],
  ['SFG', 'Semi-finished goods'],
  ['FG', 'Finished goods'],
  ['SRV', 'Services'],
];

/**
 * Standard units, item groups and a main store so a new workspace can create
 * items immediately. Idempotent (used by provisioning and the seed backfill).
 */
export async function seedMasterDefaults(tx: Transaction, tenantId: string, companyId: string, branchId: string | null, userId: string | null) {
  await tx
    .insert(uoms)
    .values(DEFAULT_UOMS.map(([code, name, decimals, uqc]) => ({ tenantId, code, name, decimals, uqc, createdBy: userId, updatedBy: userId })))
    .onConflictDoNothing();
  await tx
    .insert(itemGroups)
    .values(DEFAULT_ITEM_GROUPS.map(([code, name]) => ({ tenantId, code, name, createdBy: userId, updatedBy: userId })))
    .onConflictDoNothing();
  await tx
    .insert(warehouses)
    .values([
      { tenantId, companyId, branchId, code: 'MAIN', name: 'Main store', type: 'store' as const, createdBy: userId, updatedBy: userId },
      { tenantId, companyId, branchId, code: 'QC', name: 'Quality hold', type: 'quarantine' as const, isNettable: false, createdBy: userId, updatedBy: userId },
    ])
    .onConflictDoNothing();
}
