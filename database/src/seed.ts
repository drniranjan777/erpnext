/**
 * Seeds reference data and a demo workspace. Idempotent.
 * Runs as the owner role (DATABASE_OWNER_URL).
 */
import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { and, eq, sql } from 'drizzle-orm';
import { createDb, createPool } from './client';
import { permissionRows, SYSTEM_ROLES } from './permissions';
import { provisionTenant, seedMasterDefaults } from './provisioning';
import { branches, companies, permissions, rolePermissions, roles, tenants, uoms } from './schema';

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is not set (see database/.env.example)');
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@demo.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('SEED_ADMIN_PASSWORD is not set (see database/.env.example)');

  const pool = createPool(url, { max: 1 });
  const db = createDb(pool);
  try {
    // 1. Permission catalog (upsert + prune codes removed from code)
    const rows = permissionRows();
    await db.transaction(async (tx) => {
      for (const row of rows) {
        await tx
          .insert(permissions)
          .values(row)
          .onConflictDoUpdate({
            target: permissions.code,
            set: { module: row.module, resource: row.resource, action: row.action, description: row.description },
          });
      }
      await tx.execute(
        sql`delete from permissions where code not in (${sql.join(
          rows.map((r) => sql`${r.code}`),
          sql`, `,
        )})`,
      );
    });
    console.log(`Permissions synced: ${rows.length}`);

    // System roles in every existing tenant get exactly the permissions defined
    // in code (they are read-only in the UI; tenants customise by copying them).
    let synced = 0;
    await db.transaction(async (tx) => {
      for (const def of SYSTEM_ROLES) {
        const systemRoles = await tx
          .select({ id: roles.id, tenantId: roles.tenantId })
          .from(roles)
          .where(and(eq(roles.isSystem, true), eq(roles.name, def.name)));
        for (const role of systemRoles) {
          await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
          if (def.permissions.length) {
            await tx
              .insert(rolePermissions)
              .values(def.permissions.map((permissionCode) => ({ tenantId: role.tenantId, roleId: role.id, permissionCode })));
          }
          synced++;
        }
      }
    });
    console.log(`System roles synced: ${synced}`);

    // Workspaces created before billing existed get a trial subscription row.
    const backfilled = await db.execute(sql`
      insert into subscriptions (tenant_id, plan_code, status, provider, current_period_start, current_period_end)
      select t.id, t.plan_code, 'trialing', 'none', t.created_at, coalesce(t.trial_ends_at, now() + interval '30 days')
      from tenants t
      where not exists (select 1 from subscriptions s where s.tenant_id = t.id)`);
    console.log(`Subscriptions backfilled: ${backfilled.rowCount ?? 0}`);

    // Workspaces created before Phase 2 get default units, item groups and stores.
    const needDefaults = await db
      .select({ tenantId: tenants.id })
      .from(tenants)
      .where(sql`not exists (select 1 from ${uoms} u where u.tenant_id = ${tenants.id})`);
    for (const { tenantId } of needDefaults) {
      await db.transaction(async (tx) => {
        const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.tenantId, tenantId)).orderBy(companies.createdAt).limit(1);
        if (!company) return;
        const [branch] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.companyId, company.id)).orderBy(branches.createdAt).limit(1);
        await seedMasterDefaults(tx, tenantId, company.id, branch?.id ?? null, null);
      });
    }
    console.log(`Master defaults backfilled: ${needDefaults.length}`);

    // 2. Demo workspace
    const existing = await db.select({ id: tenants.id }).from(tenants).where(sql`${tenants.slug} = 'demo'`);
    if (existing.length) {
      console.log('Demo workspace already exists (slug: demo).');
    } else {
      const passwordHash = await hash(adminPassword);
      const result = await db.transaction((tx) =>
        provisionTenant(tx, {
          tenant: { slug: 'demo', name: 'Demo Manufacturing Pvt Ltd', industry: 'engineering', trialDays: 365 },
          company: { name: 'Demo Manufacturing Pvt Ltd', gstin: '36AABCD1234E1Z9', stateCode: '36' },
          owner: { email: adminEmail, fullName: 'Demo Admin', passwordHash },
        }),
      );
      console.log(`Demo workspace created (slug: demo, tenant: ${result.tenantId}).`);
      console.log(`Login: ${adminEmail} / password from SEED_ADMIN_PASSWORD in database/.env`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
