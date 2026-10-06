import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from '@node-rs/argon2';
import { invitations, membershipRoles, memberships, roles, tenants, type Transaction, users } from '@nextgen/database';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import type { LoginResult } from '../auth/auth.service';
import { TokensService } from '../auth/tokens.service';
import { passwordSchema, type AcceptInvitationInput, type CreateInvitationInput } from './iam.schemas';
import { MfaService } from '../auth/mfa.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { WebhooksService } from '../integrations/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from './users.service';

const INVITE_TTL_DAYS = 7;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

interface InvitationRow {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string | null;
  role_ids: string[];
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: string;
  inviter_name: string;
}

@Injectable()
export class InvitationsService {
  private readonly appUrl: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly tokens: TokensService,
    private readonly usersService: UsersService,
    private readonly notifications: NotificationsService,
    private readonly mfa: MfaService,
    private readonly entitlements: EntitlementsService,
    private readonly webhooks: WebhooksService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  // ---- Admin side ----------------------------------------------------------

  list(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          id: invitations.id,
          email: invitations.email,
          fullName: invitations.fullName,
          roleIds: invitations.roleIds,
          expiresAt: invitations.expiresAt,
          createdAt: invitations.createdAt,
          invitedBy: users.fullName,
        })
        .from(invitations)
        .leftJoin(users, eq(users.id, invitations.invitedBy))
        .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .orderBy(desc(invitations.createdAt));
      const roleNames = await this.roleNames(tx, rows.flatMap((r) => r.roleIds));
      return rows.map(({ roleIds, ...r }) => ({
        ...r,
        roles: roleIds.map((id) => ({ id, name: roleNames.get(id) ?? 'Deleted role' })),
        expired: r.expiresAt < new Date(),
      }));
    });
  }

  async create(auth: AuthContext, input: CreateInvitationInput, meta: RequestMeta) {
    const token = randomBytes(32).toString('base64url');
    const id = await this.database.run(auth, async (tx) => {
      await this.assertRolesAssignable(tx, auth, input.roleIds);
      await this.entitlements.assertLimit(tx, auth.tenantId, 'users');

      const [existingMember] = await tx
        .select({ status: memberships.status })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(users.email, input.email));
      if (existingMember?.status === 'active') throw new ConflictException(`${input.email} is already a member of this workspace`);

      const [pending] = await tx
        .select({ id: invitations.id })
        .from(invitations)
        .where(and(eq(invitations.email, input.email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
      if (pending) throw new ConflictException(`${input.email} already has a pending invitation. Resend it instead.`);

      const [row] = await tx
        .insert(invitations)
        .values({
          tenantId: auth.tenantId,
          email: input.email,
          fullName: input.fullName ?? null,
          roleIds: input.roleIds,
          tokenHash: sha256(token),
          invitedBy: auth.userId,
          expiresAt: this.expiry(),
        })
        .returning({ id: invitations.id });
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'iam.invitation.created',
        entityType: 'invitation',
        entityId: row.id,
        metadata: { email: input.email, roleIds: input.roleIds },
        ...meta,
      });
      await this.sendInvite(tx, auth, input.email, input.fullName ?? null, token);
      return row.id;
    });
    // Email delivery arrives with the notification engine (Sprint 1.3); until
    // then the admin shares the link (email/WhatsApp) themselves.
    return { id, email: input.email, inviteUrl: this.link(token), expiresAt: this.expiry() };
  }

  /** Issues a fresh link (old one stops working) and extends the expiry. */
  async resend(auth: AuthContext, id: string, meta: RequestMeta) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.expiry();
    const email = await this.database.run(auth, async (tx) => {
      const [row] = await tx
        .update(invitations)
        .set({ tokenHash: sha256(token), expiresAt })
        .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .returning({ email: invitations.email, fullName: invitations.fullName });
      if (!row) throw new NotFoundException('Invitation not found or no longer pending');
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'iam.invitation.resent',
        entityType: 'invitation',
        entityId: id,
        ...meta,
      });
      await this.sendInvite(tx, auth, row.email, row.fullName, token);
      return row.email;
    });
    return { id, email, inviteUrl: this.link(token), expiresAt };
  }

  async revoke(auth: AuthContext, id: string, meta: RequestMeta) {
    await this.database.run(auth, async (tx) => {
      const [row] = await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .returning({ email: invitations.email });
      if (!row) throw new NotFoundException('Invitation not found or no longer pending');
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'iam.invitation.revoked',
        entityType: 'invitation',
        entityId: id,
        metadata: { email: row.email },
        ...meta,
      });
    });
  }

  // ---- Invitee side (public) -------------------------------------------------

  async preview(token: string) {
    const inv = await this.findValid(token);
    const existing = await this.findUserByEmail(inv.email);
    return {
      email: inv.email,
      fullName: inv.full_name,
      workspace: { name: inv.tenant_name, slug: inv.tenant_slug },
      invitedBy: inv.inviter_name,
      expiresAt: inv.expires_at,
      existingAccount: !!existing,
      mfaRequired: !!existing?.mfa_enabled,
    };
  }

  async accept(token: string, input: AcceptInvitationInput, meta: RequestMeta): Promise<LoginResult> {
    const inv = await this.findValid(token);
    const existing = await this.findUserByEmail(inv.email);

    let userId: string;
    let fullName: string;
    let newUser: { id: string; passwordHash: string; fullName: string } | null = null;
    if (existing) {
      const ok = await verify(existing.password_hash, input.password).catch(() => false);
      if (!ok) throw new UnauthorizedException('Incorrect password for your existing NextGen ERP account');
      if (existing.status === 'disabled') throw new ForbiddenException('This account has been disabled');
      if (existing.mfa_enabled) {
        if (!input.mfaCode) throw new BadRequestException({ message: 'Enter the code from your authenticator app', errors: [{ path: 'mfaCode', message: 'Code required' }] });
        if (!(await this.mfa.verifyChallenge(existing.id, input.mfaCode))) throw new UnauthorizedException('That two-step verification code is not valid');
      }
      userId = existing.id;
      fullName = existing.full_name;
    } else {
      const pw = passwordSchema.safeParse(input.password);
      if (!pw.success) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: pw.error.issues.map((i) => ({ path: 'password', message: i.message, code: i.code })),
        });
      }
      if (!input.fullName) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: [{ path: 'fullName', message: 'Enter your name', code: 'too_small' }],
        });
      }
      const idRes = await this.database.run({}, (tx) => tx.execute<{ id: string }>(sql`select uuidv7()::text as id`));
      userId = idRes.rows[0].id;
      fullName = input.fullName;
      newUser = { id: userId, passwordHash: await hash(input.password), fullName };
    }

    const membershipId = await this.database.run({ tenantId: inv.tenant_id, userId }, async (tx) => {
      if (newUser) {
        await tx.insert(users).values({ id: newUser.id, email: inv.email, fullName: newUser.fullName, passwordHash: newUser.passwordHash });
      }
      // Re-joining after being disabled re-activates the same membership.
      const [membership] = await tx
        .insert(memberships)
        .values({ tenantId: inv.tenant_id, userId, status: 'active' })
        .onConflictDoUpdate({ target: [memberships.tenantId, memberships.userId], set: { status: 'active', updatedAt: new Date() } })
        .returning({ id: memberships.id });

      let roleIds = inv.role_ids.length
        ? (await tx.select({ id: roles.id }).from(roles).where(inArray(roles.id, inv.role_ids))).map((r) => r.id)
        : [];
      if (!roleIds.length) {
        // Roles deleted since the invite was sent: fall back to read-only.
        const [viewer] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.isSystem, true), eq(roles.name, 'Viewer')));
        roleIds = viewer ? [viewer.id] : [];
      }
      await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, membership.id));
      if (roleIds.length) {
        await tx.insert(membershipRoles).values(roleIds.map((roleId) => ({ tenantId: inv.tenant_id, membershipId: membership.id, roleId })));
      }

      const [claimed] = await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .returning({ id: invitations.id });
      if (!claimed) throw new GoneException('This invitation has already been used');

      await tx.update(users).set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
      await this.audit.log(tx, {
        tenantId: inv.tenant_id,
        actorUserId: userId,
        action: 'iam.invitation.accepted',
        entityType: 'membership',
        entityId: membership.id,
        metadata: { invitationId: inv.id, newAccount: !!newUser },
        ...meta,
      });
      await this.webhooks.emit(tx, inv.tenant_id, 'member.joined', { userId, email: inv.email, name: fullName, membershipId: membership.id });
      return membership.id;
    });

    const tokens = await this.tokens.issue({ userId, tenantId: inv.tenant_id, membershipId }, meta);
    return {
      kind: 'session',
      tokens,
      user: { id: userId, fullName, email: inv.email },
      tenant: { id: inv.tenant_id, slug: inv.tenant_slug, name: inv.tenant_name, status: inv.tenant_status, membershipId },
    };
  }

  // ---- helpers ---------------------------------------------------------------

  private async findValid(token: string): Promise<InvitationRow> {
    const res = await this.database.run({}, (tx) =>
      tx.execute<InvitationRow & Record<string, unknown>>(sql`select * from invitation_by_token_hash(${sha256(token)})`),
    );
    const inv = res.rows[0];
    if (!inv || inv.revoked_at) throw new NotFoundException('This invitation link is invalid or has been withdrawn');
    if (inv.accepted_at) throw new GoneException('This invitation has already been used. Sign in instead.');
    if (new Date(inv.expires_at) < new Date()) throw new GoneException('This invitation has expired. Ask your admin to resend it.');
    if (inv.tenant_status === 'suspended' || inv.tenant_status === 'archived') {
      throw new ForbiddenException('This workspace is not active');
    }
    return inv;
  }

  private async findUserByEmail(email: string) {
    const res = await this.database.run({}, (tx) =>
      tx.execute<{ id: string; full_name: string; password_hash: string; status: string; mfa_enabled: boolean }>(
        sql`select id, full_name, password_hash, status, mfa_enabled from auth_find_user_by_email(${email})`,
      ),
    );
    return res.rows[0];
  }

  private async assertRolesAssignable(tx: Transaction, auth: AuthContext, roleIds: string[]) {
    const found = await tx.select({ id: roles.id, name: roles.name, isSystem: roles.isSystem }).from(roles).where(inArray(roles.id, roleIds));
    if (found.length !== roleIds.length) throw new NotFoundException('One or more roles do not exist');
    if (found.some((r) => r.isSystem && r.name === 'Owner')) await this.usersService.assertCallerIsOwner(tx, auth);
  }

  private async roleNames(tx: Transaction, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, string>();
    const rows = await tx.select({ id: roles.id, name: roles.name }).from(roles).where(inArray(roles.id, unique));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async sendInvite(tx: Transaction, auth: AuthContext, email: string, name: string | null, token: string) {
    const [inviter] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, auth.userId));
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, auth.tenantId));
    await this.notifications.notify(tx, auth.tenantId, 'iam.invitation', [{ email, name }], {
      workspace: tenant?.name ?? 'NextGen ERP',
      inviter: inviter?.name ?? 'Your administrator',
      link: this.link(token),
      expires: this.expiry().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }),
    });
  }

  private link(token: string) {
    return `${this.appUrl}/invite/${token}`;
  }

  private expiry() {
    return new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  }
}
