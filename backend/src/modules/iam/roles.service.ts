import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { membershipRoles, PERMISSIONS, rolePermissions, roles, type PermissionCode, type Transaction } from '@nextgen/database';
import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import { AccessCacheService } from '../../common/access-cache.service';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import type { CreateRoleInput, UpdateRoleInput } from './iam.schemas';

/** Display names for permission modules (catalog codes are `module.resource.action`). */
const MODULE_LABELS: Record<string, string> = {
  iam: 'Users & roles',
  platform: 'Platform',
  org: 'Organisation',
};

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
}

@Injectable()
export class RolesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly cache: AccessCacheService,
  ) {}

  /** Permission catalog grouped for the role editor. */
  catalog() {
    const groups = new Map<string, { module: string; label: string; permissions: { code: string; resource: string; action: string; description: string }[] }>();
    for (const [code, description] of Object.entries(PERMISSIONS)) {
      const [module, resource, action] = code.split('.');
      const group = groups.get(module) ?? { module, label: MODULE_LABELS[module] ?? module, permissions: [] };
      group.permissions.push({ code, resource, action, description });
      groups.set(module, group);
    }
    return [...groups.values()];
  }

  list(auth: AuthContext): Promise<RoleView[]> {
    return this.database.run(auth, (tx) => this.load(tx));
  }

  async create(auth: AuthContext, input: CreateRoleInput, meta: RequestMeta): Promise<RoleView> {
    return this.database.run(auth, async (tx) => {
      await this.assertNameFree(tx, input.name);
      const [role] = await tx
        .insert(roles)
        .values({ tenantId: auth.tenantId, name: input.name, description: input.description ?? null, isSystem: false })
        .returning({ id: roles.id });
      await this.setPermissions(tx, auth.tenantId, role.id, input.permissions);
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'iam.role.created',
        entityType: 'role',
        entityId: role.id,
        changes: { name: { from: null, to: input.name }, permissions: { from: [], to: input.permissions } },
        ...meta,
      });
      return (await this.load(tx, [role.id]))[0];
    });
  }

  async update(auth: AuthContext, id: string, input: UpdateRoleInput, meta: RequestMeta): Promise<RoleView> {
    this.cache.invalidateTenant(auth.tenantId);
    return this.database.run(auth, async (tx) => {
      const [before] = await this.load(tx, [id]);
      if (!before) throw new NotFoundException('Role not found');
      if (before.isSystem) throw new ForbiddenException('System roles are read-only. Duplicate the role to customise it.');

      if (input.name !== undefined && input.name.toLowerCase() !== before.name.toLowerCase()) {
        await this.assertNameFree(tx, input.name);
      }
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (input.name !== undefined || input.description !== undefined) {
        await tx
          .update(roles)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description ?? null } : {}),
          })
          .where(eq(roles.id, id));
        if (input.name !== undefined && input.name !== before.name) changes.name = { from: before.name, to: input.name };
        if (input.description !== undefined && (input.description ?? null) !== before.description) {
          changes.description = { from: before.description, to: input.description ?? null };
        }
      }
      if (input.permissions) {
        await this.setPermissions(tx, auth.tenantId, id, input.permissions);
        const added = input.permissions.filter((p) => !before.permissions.includes(p));
        const removed = before.permissions.filter((p) => !(input.permissions as string[]).includes(p));
        if (added.length || removed.length) changes.permissions = { from: removed, to: added };
      }
      if (Object.keys(changes).length) {
        await this.audit.log(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'iam.role.updated',
          entityType: 'role',
          entityId: id,
          changes,
          ...meta,
        });
      }
      return (await this.load(tx, [id]))[0];
    });
  }

  async remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    this.cache.invalidateTenant(auth.tenantId);
    await this.database.run(auth, async (tx) => {
      const [role] = await this.load(tx, [id]);
      if (!role) throw new NotFoundException('Role not found');
      if (role.isSystem) throw new ForbiddenException('System roles cannot be deleted');
      if (role.memberCount > 0) {
        throw new ConflictException(`This role is assigned to ${role.memberCount} user(s). Reassign them first.`);
      }
      await tx.delete(roles).where(eq(roles.id, id));
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'iam.role.deleted',
        entityType: 'role',
        entityId: id,
        metadata: { name: role.name, permissions: role.permissions },
        ...meta,
      });
    });
  }

  private async assertNameFree(tx: Transaction, name: string) {
    const [clash] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(sql`lower(${roles.name}) = lower(${name})`);
    if (clash) throw new ConflictException(`A role named "${name}" already exists`);
  }

  private async setPermissions(tx: Transaction, tenantId: string, roleId: string, codes: PermissionCode[]) {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (codes.length) {
      await tx.insert(rolePermissions).values(codes.map((permissionCode) => ({ tenantId, roleId, permissionCode })));
    }
  }

  private async load(tx: Transaction, ids?: string[]): Promise<RoleView[]> {
    const base = tx
      .select({ id: roles.id, name: roles.name, description: roles.description, isSystem: roles.isSystem })
      .from(roles)
      .orderBy(asc(roles.isSystem), asc(roles.name))
      .$dynamic();
    const rows = await (ids ? base.where(inArray(roles.id, ids)) : base);
    if (!rows.length) return [];
    const roleIds = rows.map((r) => r.id);

    const perms = await tx
      .select({ roleId: rolePermissions.roleId, code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, roleIds));
    const counts = await tx
      .select({ roleId: membershipRoles.roleId, n: count() })
      .from(membershipRoles)
      .where(inArray(membershipRoles.roleId, roleIds))
      .groupBy(membershipRoles.roleId);

    const permMap = new Map<string, string[]>();
    for (const p of perms) permMap.set(p.roleId, [...(permMap.get(p.roleId) ?? []), p.code]);
    const countMap = new Map(counts.map((c) => [c.roleId, Number(c.n)]));

    // System roles first (Owner, Administrator, Viewer), then custom roles A–Z.
    const systemOrder = ['Owner', 'Administrator', 'Viewer'];
    return rows
      .map((r) => ({ ...r, permissions: (permMap.get(r.id) ?? []).sort(), memberCount: countMap.get(r.id) ?? 0 }))
      .sort((a, b) =>
        a.isSystem !== b.isSystem
          ? a.isSystem
            ? -1
            : 1
          : a.isSystem
            ? systemOrder.indexOf(a.name) - systemOrder.indexOf(b.name)
            : a.name.localeCompare(b.name),
      );
  }
}
