import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { authSessions, membershipRoles, memberships, roles, type Transaction, users } from '@nextgen/database';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { AccessCacheService } from '../../common/access-cache.service';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../billing/entitlements.service';
import type { UpdateMemberInput } from './iam.schemas';

export interface MemberRole {
  id: string;
  name: string;
}

export interface Member {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  mobile: string | null;
  status: 'invited' | 'active' | 'disabled';
  isOwner: boolean;
  joinedAt: Date;
  lastLoginAt: Date | null;
  mfaEnabled: boolean;
  roles: MemberRole[];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly cache: AccessCacheService,
    private readonly entitlements: EntitlementsService,
  ) {}

  list(auth: AuthContext): Promise<Member[]> {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          membershipId: memberships.id,
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
          mobile: users.mobile,
          status: memberships.status,
          isOwner: memberships.isOwner,
          joinedAt: memberships.createdAt,
          lastLoginAt: users.lastLoginAt,
          mfaEnabled: users.mfaEnabled,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.tenantId, auth.tenantId))
        .orderBy(asc(users.fullName));
      const roleMap = await this.rolesByMembership(tx, rows.map((r) => r.membershipId));
      return rows.map((r) => ({ ...r, roles: roleMap.get(r.membershipId) ?? [] }));
    });
  }

  async update(auth: AuthContext, membershipId: string, input: UpdateMemberInput, meta: RequestMeta): Promise<Member> {
    await this.database.run(auth, async (tx) => {
      const [target] = await tx
        .select({ id: memberships.id, userId: memberships.userId, status: memberships.status, isOwner: memberships.isOwner })
        .from(memberships)
        .where(eq(memberships.id, membershipId));
      if (!target) throw new NotFoundException('User not found in this workspace');
      if (target.id === auth.membershipId) throw new ForbiddenException("You can't change your own access");
      if (target.isOwner) throw new ForbiddenException("The workspace owner's access can't be changed");

      const changes: Record<string, { from: unknown; to: unknown }> = {};

      if (input.roleIds) {
        const found = await tx
          .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
          .from(roles)
          .where(inArray(roles.id, input.roleIds));
        if (found.length !== input.roleIds.length) throw new NotFoundException('One or more roles do not exist');
        if (found.some((r) => r.isSystem && r.name === 'Owner')) {
          await this.assertCallerIsOwner(tx, auth);
        }
        const before = (await this.rolesByMembership(tx, [membershipId])).get(membershipId) ?? [];
        await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, membershipId));
        await tx
          .insert(membershipRoles)
          .values(input.roleIds.map((roleId) => ({ tenantId: auth.tenantId, membershipId, roleId })));
        changes.roles = { from: before.map((r) => r.name).sort(), to: found.map((r) => r.name).sort() };
      }

      if (input.status === 'active' && target.status !== 'active') await this.entitlements.assertLimit(tx, auth.tenantId, 'users');
      if (input.status && input.status !== target.status) {
        await tx.update(memberships).set({ status: input.status }).where(eq(memberships.id, membershipId));
        changes.status = { from: target.status, to: input.status };
        if (input.status === 'disabled') {
          // Sign them out of this workspace everywhere.
          await tx
            .update(authSessions)
            .set({ revokedAt: new Date() })
            .where(and(eq(authSessions.userId, target.userId), isNull(authSessions.revokedAt)));
        }
      }

      if (Object.keys(changes).length) {
        await this.audit.log(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'iam.member.updated',
          entityType: 'membership',
          entityId: membershipId,
          changes,
          ...meta,
        });
      }
    });
    this.cache.invalidateTenant(auth.tenantId);
    const member = (await this.list(auth)).find((m) => m.membershipId === membershipId);
    if (!member) throw new NotFoundException();
    return member;
  }

  async rolesByMembership(tx: Transaction, membershipIds: string[]): Promise<Map<string, MemberRole[]>> {
    const map = new Map<string, MemberRole[]>();
    if (!membershipIds.length) return map;
    const rows = await tx
      .select({ membershipId: membershipRoles.membershipId, id: roles.id, name: roles.name })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(inArray(membershipRoles.membershipId, membershipIds))
      .orderBy(asc(roles.name));
    for (const r of rows) {
      const list = map.get(r.membershipId) ?? [];
      list.push({ id: r.id, name: r.name });
      map.set(r.membershipId, list);
    }
    return map;
  }

  /** Only the workspace owner can grant the Owner role. */
  async assertCallerIsOwner(tx: Transaction, auth: AuthContext) {
    const [me] = await tx.select({ isOwner: memberships.isOwner }).from(memberships).where(eq(memberships.id, auth.membershipId));
    if (!me?.isOwner) throw new ForbiddenException('Only the workspace owner can assign the Owner role');
  }
}
