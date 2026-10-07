import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from '@node-rs/argon2';
import { companies, parties, portalSessions, portalUsers, type Transaction } from '@nextgen/database';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DUMMY_HASH = hash('timing-equaliser-not-a-real-password');
const SESSION_DAYS = 7;
const INVITE_DAYS = 7;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export const portalUserSchema = z.object({ partyId: z.uuid(), kind: z.enum(['customer', 'dealer']).default('customer'), name: z.string().trim().min(2).max(120), email: z.email().max(200) });
export const loginSchema = z.object({ workspace: z.string().trim().min(2).max(60), email: z.email().max(200), password: z.string().min(1).max(200) });
export const acceptSchema = z.object({ token: z.string().min(40).max(200), password: z.string().min(10, 'Use at least 10 characters').max(200) });

/** Who is signed in to the portal: one contact of one party. */
export interface PortalIdentity {
  tenantId: string;
  portalUserId: string;
  partyId: string;
  kind: 'customer' | 'dealer';
  name: string;
  sessionId: string;
}

/**
 * Portal logins for customer and dealer contacts. Separate from staff users and their JWTs: opaque
 * tokens that carry the workspace id (so they resolve under that workspace's RLS) and are stored hashed.
 */
@Injectable()
export class PortalAuthService {
  private readonly appUrl: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  private link(token: string) {
    return `${this.appUrl}/portal/accept?token=${encodeURIComponent(token)}`;
  }

  // ---- staff side -------------------------------------------------------------------------------

  users(auth: AuthContext, partyId?: string) {
    return this.database.run(auth, async (tx) =>
      (
        await tx.execute(
          sql`select u.id, u.party_id as "partyId", p.name as party, u.kind, u.name, u.email, u.status, u.last_login_at as "lastLoginAt", u.invite_expires_at as "inviteExpiresAt", u.created_at as "createdAt"
              from portal_users u join parties p on p.id = u.party_id where true ${partyId ? sql`and u.party_id = ${partyId}` : sql``} order by p.name, u.name`,
        )
      ).rows,
    );
  }

  /** Invites a contact; the link is emailed and also returned so it can be shared on WhatsApp. */
  invite(auth: AuthContext, input: z.infer<typeof portalUserSchema>) {
    return this.database.run(auth, async (tx) => {
      const [p] = await tx.select({ id: parties.id, name: parties.name, isCustomer: parties.isCustomer }).from(parties).where(and(eq(parties.id, input.partyId), isNull(parties.deletedAt)));
      if (!p) throw new NotFoundException('Party not found');
      if (!p.isCustomer) throw new BadRequestException('Portal logins are for customers and dealers');
      if (input.kind === 'dealer') {
        const [d] = (await tx.execute(sql`select id from dms_distributors where party_id = ${input.partyId} limit 1`)).rows;
        if (!d) throw new BadRequestException(`${p.name} is not set up as a distributor; add it under Distribution first`);
      }
      const [dup] = await tx.select({ id: portalUsers.id }).from(portalUsers).where(eq(portalUsers.email, input.email));
      if (dup) throw new ConflictException('This email already has a portal login in this workspace');
      const token = `${auth.tenantId}.${randomBytes(32).toString('base64url')}`;
      const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000);
      const [u] = await tx
        .insert(portalUsers)
        .values({ tenantId: auth.tenantId, partyId: input.partyId, kind: input.kind, name: input.name, email: input.email, inviteTokenHash: sha256(token), inviteExpiresAt: expires, createdBy: auth.userId })
        .returning({ id: portalUsers.id });
      await this.mailInvite(tx, auth.tenantId, input.email, input.name, p.name, token);
      return { id: u.id, inviteUrl: this.link(token), expiresAt: expires };
    });
  }

  /** New link (the old one stops working); also re-enables a disabled login. */
  reissue(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [u] = await tx.select().from(portalUsers).where(eq(portalUsers.id, id));
      if (!u) throw new NotFoundException('Portal login not found');
      const token = `${auth.tenantId}.${randomBytes(32).toString('base64url')}`;
      const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000);
      await tx.update(portalUsers).set({ inviteTokenHash: sha256(token), inviteExpiresAt: expires, status: u.passwordHash ? 'active' : 'invited', failedLogins: 0, lockedUntil: null }).where(eq(portalUsers.id, id));
      const [p] = await tx.select({ name: parties.name }).from(parties).where(eq(parties.id, u.partyId));
      await this.mailInvite(tx, auth.tenantId, String(u.email), u.name, p?.name ?? '', token);
      return { id, inviteUrl: this.link(token), expiresAt: expires };
    });
  }

  disable(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [u] = await tx.update(portalUsers).set({ status: 'disabled', inviteTokenHash: null }).where(eq(portalUsers.id, id)).returning({ id: portalUsers.id });
      if (!u) throw new NotFoundException('Portal login not found');
      await tx.update(portalSessions).set({ revokedAt: new Date() }).where(and(eq(portalSessions.portalUserId, id), isNull(portalSessions.revokedAt)));
      return { ok: true };
    });
  }

  private async mailInvite(tx: Transaction, tenantId: string, email: string, name: string, party: string, token: string) {
    const [co] = await tx.select({ name: companies.name }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
    const [t] = (await tx.execute<{ slug: string }>(sql`select slug from tenants where id = ${tenantId}`)).rows;
    await this.notifications.notify(tx, tenantId, 'portal.invite', [{ email, name }], { companyName: co?.name ?? '', name, party, url: this.link(token), workspace: t?.slug ?? '' });
  }

  // ---- portal side --------------------------------------------------------------------------------

  private tenantOf(token: string) {
    const tenantId = token.replace(/^ngp_/, '').split('.')[0];
    return UUID.test(tenantId) ? tenantId : null;
  }

  private ctx(tenantId: string) {
    return { tenantId, userId: null as unknown as string };
  }

  /** What the accept page shows before a password is set. */
  async preview(token: string) {
    const tenantId = this.tenantOf(token);
    if (!tenantId) throw new NotFoundException('This link is invalid');
    return this.database.run(this.ctx(tenantId), async (tx) => {
      const [u] = await tx
        .select({ name: portalUsers.name, email: portalUsers.email, kind: portalUsers.kind, party: parties.name, expires: portalUsers.inviteExpiresAt, status: portalUsers.status })
        .from(portalUsers)
        .innerJoin(parties, eq(parties.id, portalUsers.partyId))
        .where(eq(portalUsers.inviteTokenHash, sha256(token)));
      if (!u || u.status === 'disabled') throw new NotFoundException('This link is invalid or has been replaced');
      if (u.expires && u.expires < new Date()) throw new NotFoundException('This link has expired; ask for a new one');
      const [co] = await tx.select({ name: companies.name }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
      const [t] = (await tx.execute<{ slug: string }>(sql`select slug from tenants where id = ${tenantId}`)).rows;
      return { name: u.name, email: u.email, kind: u.kind, party: u.party, company: co?.name ?? '', workspace: t?.slug ?? '' };
    });
  }

  /** Sets the password from an invite link and signs in. */
  async accept(input: z.infer<typeof acceptSchema>, meta: { ip?: string | null; userAgent?: string | null }) {
    const tenantId = this.tenantOf(input.token);
    if (!tenantId) throw new NotFoundException('This link is invalid');
    const passwordHash = await hash(input.password);
    return this.database.run(this.ctx(tenantId), async (tx) => {
      const [u] = await tx.select().from(portalUsers).where(eq(portalUsers.inviteTokenHash, sha256(input.token))).for('update');
      if (!u || u.status === 'disabled') throw new NotFoundException('This link is invalid or has been replaced');
      if (u.inviteExpiresAt && u.inviteExpiresAt < new Date()) throw new NotFoundException('This link has expired; ask for a new one');
      await tx.update(portalUsers).set({ passwordHash, status: 'active', inviteTokenHash: null, inviteExpiresAt: null, failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(portalUsers.id, u.id));
      await tx.update(portalSessions).set({ revokedAt: new Date() }).where(and(eq(portalSessions.portalUserId, u.id), isNull(portalSessions.revokedAt)));
      return this.startSession(tx, tenantId, u.id, meta);
    });
  }

  async login(input: z.infer<typeof loginSchema>, meta: { ip?: string | null; userAgent?: string | null }) {
    const denied = () => new UnauthorizedException('Wrong workspace, email or password');
    const [row] = (await this.database.pool.query<{ id: string | null }>('select tenant_id_by_slug($1) as id', [input.workspace])).rows;
    const tenantId = row?.id;
    if (!tenantId) {
      await verify(await DUMMY_HASH, input.password).catch(() => false);
      throw denied();
    }
    const u = await this.database.run(this.ctx(tenantId), async (tx) => (await tx.select().from(portalUsers).where(eq(portalUsers.email, input.email)))[0]);
    if (!u || !u.passwordHash || u.status !== 'active') {
      await verify(await DUMMY_HASH, input.password).catch(() => false);
      throw u?.status === 'disabled' ? new UnauthorizedException('This portal login has been disabled') : denied();
    }
    if (u.lockedUntil && u.lockedUntil > new Date()) throw new UnauthorizedException(`Too many wrong passwords; try again after ${LOCK_MINUTES} minutes`);
    const ok = await verify(u.passwordHash, input.password).catch(() => false);
    return this.database.run(this.ctx(tenantId), async (tx) => {
      if (!ok) {
        const failures = u.failedLogins + 1;
        await tx.update(portalUsers).set({ failedLogins: failures, lockedUntil: failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null }).where(eq(portalUsers.id, u.id));
        return null;
      }
      await tx.update(portalUsers).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(portalUsers.id, u.id));
      return this.startSession(tx, tenantId, u.id, meta);
    }).then((r) => {
      if (!r) throw denied();
      return r;
    });
  }

  private async startSession(tx: Transaction, tenantId: string, portalUserId: string, meta: { ip?: string | null; userAgent?: string | null }) {
    const token = `ngp_${tenantId}.${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await tx.insert(portalSessions).values({ tenantId, portalUserId, tokenHash: sha256(token), expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 500) ?? null });
    return { token, expiresAt };
  }

  /** Resolves a bearer token to the portal identity, or null. */
  async identify(token: string): Promise<PortalIdentity | null> {
    if (!token.startsWith('ngp_')) return null;
    const tenantId = this.tenantOf(token);
    if (!tenantId) return null;
    return this.database.run(this.ctx(tenantId), async (tx) => {
      const [s] = await tx
        .select({ id: portalSessions.id, lastSeenAt: portalSessions.lastSeenAt, userId: portalUsers.id, partyId: portalUsers.partyId, kind: portalUsers.kind, name: portalUsers.name })
        .from(portalSessions)
        .innerJoin(portalUsers, eq(portalUsers.id, portalSessions.portalUserId))
        .where(and(eq(portalSessions.tokenHash, sha256(token)), isNull(portalSessions.revokedAt), gt(portalSessions.expiresAt, new Date()), eq(portalUsers.status, 'active')));
      if (!s) return null;
      if (Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) await tx.update(portalSessions).set({ lastSeenAt: new Date() }).where(eq(portalSessions.id, s.id));
      return { tenantId, portalUserId: s.userId, partyId: s.partyId, kind: s.kind as 'customer' | 'dealer', name: s.name, sessionId: s.id };
    });
  }

  logout(p: PortalIdentity) {
    return this.database.run(this.ctx(p.tenantId), (tx) => tx.update(portalSessions).set({ revokedAt: new Date() }).where(eq(portalSessions.id, p.sessionId))).then(() => ({ ok: true }));
  }

  async changePassword(p: PortalIdentity, current: string, next: string) {
    const [u] = await this.database.run(this.ctx(p.tenantId), (tx) => tx.select({ hash: portalUsers.passwordHash }).from(portalUsers).where(eq(portalUsers.id, p.portalUserId)));
    if (!u?.hash || !(await verify(u.hash, current).catch(() => false))) throw new BadRequestException('The current password is wrong');
    const passwordHash = await hash(next);
    await this.database.run(this.ctx(p.tenantId), async (tx) => {
      await tx.update(portalUsers).set({ passwordHash }).where(eq(portalUsers.id, p.portalUserId));
      await tx.update(portalSessions).set({ revokedAt: new Date() }).where(and(eq(portalSessions.portalUserId, p.portalUserId), isNull(portalSessions.revokedAt), sql`${portalSessions.id} <> ${p.sessionId}`));
    });
    return { ok: true };
  }
}
