import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { authSessions, users } from '@nextgen/database';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { AccessCacheService } from '../../common/access-cache.service';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ChangePasswordInput, UpdateProfileInput } from './account.schemas';

@Injectable()
export class AccountService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly cache: AccessCacheService,
  ) {}

  async updateProfile(auth: AuthContext, input: UpdateProfileInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [before] = await tx.select({ fullName: users.fullName, mobile: users.mobile }).from(users).where(eq(users.id, auth.userId));
      const next = {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.mobile !== undefined ? { mobile: input.mobile ?? null } : {}),
      };
      const [row] = await tx
        .update(users)
        .set(next)
        .where(eq(users.id, auth.userId))
        .returning({ id: users.id, email: users.email, fullName: users.fullName, mobile: users.mobile });
      const changes = this.audit.diff(before ?? {}, next);
      if (Object.keys(changes).length) {
        await this.audit.log(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'account.profile.updated',
          entityType: 'user',
          entityId: auth.userId,
          changes,
          ...meta,
        });
      }
      return row;
    });
  }

  /** Active sessions of the caller in this workspace. */
  listSessions(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          id: authSessions.id,
          userAgent: authSessions.userAgent,
          ip: authSessions.ip,
          createdAt: authSessions.createdAt,
          lastUsedAt: authSessions.lastUsedAt,
          expiresAt: authSessions.expiresAt,
        })
        .from(authSessions)
        .where(and(eq(authSessions.userId, auth.userId), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date())))
        .orderBy(desc(authSessions.lastUsedAt));
      return rows.map((r) => ({ ...r, current: r.id === auth.sessionId }));
    });
  }

  async revokeSession(auth: AuthContext, sessionId: string, meta: RequestMeta) {
    this.cache.invalidateSession(sessionId);
    await this.database.run(auth, async (tx) => {
      const [row] = await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, auth.userId), isNull(authSessions.revokedAt)))
        .returning({ id: authSessions.id });
      if (!row) throw new NotFoundException('Session not found');
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'account.session.revoked',
        entityType: 'session',
        entityId: sessionId,
        ...meta,
      });
    });
  }

  /** Signs the caller out everywhere (all workspaces) except this session. */
  async revokeOtherSessions(auth: AuthContext, meta: RequestMeta) {
    this.cache.invalidateTenant(auth.tenantId);
    return this.database.run(auth, async (tx) => {
      const res = await tx.execute<{ n: number }>(sql`select revoke_my_sessions(${auth.sessionId}::uuid) as n`);
      const revoked = Number(res.rows[0]?.n ?? 0);
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'account.sessions.revoked_others',
        entityType: 'user',
        entityId: auth.userId,
        metadata: { revoked },
        ...meta,
      });
      return { revoked };
    });
  }

  async changePassword(auth: AuthContext, input: ChangePasswordInput, meta: RequestMeta) {
    this.cache.invalidateTenant(auth.tenantId);
    return this.database.run(auth, async (tx) => {
      const [user] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, auth.userId));
      if (!user) throw new UnauthorizedException();
      const ok = await verify(user.passwordHash, input.currentPassword).catch(() => false);
      if (!ok) {
        throw new BadRequestException({
          message: 'Current password is incorrect',
          errors: [{ path: 'currentPassword', message: 'Current password is incorrect' }],
        });
      }
      await tx.update(users).set({ passwordHash: await hash(input.newPassword) }).where(eq(users.id, auth.userId));
      // A password change should kick out anyone else holding a session.
      const res = await tx.execute<{ n: number }>(sql`select revoke_my_sessions(${auth.sessionId}::uuid) as n`);
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'account.password.changed',
        entityType: 'user',
        entityId: auth.userId,
        metadata: { otherSessionsRevoked: Number(res.rows[0]?.n ?? 0) },
        ...meta,
      });
      await this.notifications.notify(tx, auth.tenantId, 'account.password_changed', [{ userId: auth.userId }], {
        when: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
        ip: meta.ip ?? 'unknown',
      });
      return { otherSessionsRevoked: Number(res.rows[0]?.n ?? 0) };
    });
  }
}
