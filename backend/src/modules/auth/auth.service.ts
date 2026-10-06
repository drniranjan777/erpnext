import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { memberships, provisionTenant, tenants, users } from '@nextgen/database';
import { and, eq, sql } from 'drizzle-orm';
import { loadPermissions } from '../../common/guards';
import type { AuthContext } from '../../common/auth-context';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { AuditService } from '../audit/audit.service';
import type { LoginInput, SignupInput } from './auth.schemas';
import { MfaService } from './mfa.service';
import { TokensService, type ClientMeta, type IssuedTokens } from './tokens.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
/** Verified against when the email is unknown, so response time doesn't reveal which emails exist. */
const DUMMY_HASH = hash('timing-equaliser-not-a-real-password');

interface UserLookup {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  status: 'active' | 'locked' | 'disabled';
  failed_login_count: number;
  locked_until: Date | null;
  mfa_enabled: boolean;
}

interface MfaClaims {
  sub: string;
  tid: string;
  mid: string;
  typ: 'mfa';
}

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  membershipId: string;
}

export type LoginResult =
  | { kind: 'session'; tokens: IssuedTokens; user: { id: string; fullName: string; email: string }; tenant: TenantSummary }
  | { kind: 'select-tenant'; tenants: Omit<TenantSummary, 'membershipId'>[] }
  | { kind: 'mfa-required'; mfaToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly mfa: MfaService,
    private readonly entitlements: EntitlementsService,
    config: ConfigService<Env, true>,
  ) {
    this.platformAdmins = config.get('PLATFORM_ADMIN_EMAILS', { infer: true });
  }

  private readonly platformAdmins: string[];

  async isSlugAvailable(slug: string): Promise<boolean> {
    const res = await this.database.run({}, (tx) =>
      tx.execute<{ exists: boolean }>(sql`select tenant_slug_exists(${slug}) as exists`),
    );
    return !res.rows[0].exists;
  }

  async signup(input: SignupInput, meta: ClientMeta & { requestId?: string }): Promise<LoginResult> {
    if (await this.findUser(input.email)) {
      throw new ConflictException('An account with this email already exists. Sign in instead.');
    }
    if (!(await this.isSlugAvailable(input.slug))) {
      throw new ConflictException('This workspace URL is already taken');
    }

    const passwordHash = await hash(input.password);
    const result = await this.database.run({}, (tx) =>
      provisionTenant(tx, {
        tenant: { slug: input.slug, name: input.workspaceName, industry: input.industry ?? null },
        company: { name: input.companyName, gstin: input.gstin ?? null },
        owner: { email: input.email, fullName: input.fullName, mobile: input.mobile ?? null, passwordHash },
      }),
    );

    const identity = { userId: result.userId, tenantId: result.tenantId, membershipId: result.membershipId };
    const tokens = await this.tokens.issue(identity, meta);
    return {
      kind: 'session',
      tokens,
      user: { id: result.userId, fullName: input.fullName, email: input.email },
      tenant: { id: result.tenantId, slug: input.slug, name: input.workspaceName, status: 'trial', membershipId: result.membershipId },
    };
  }

  async login(input: LoginInput, meta: ClientMeta & { requestId?: string }): Promise<LoginResult> {
    const user = await this.findUser(input.email);
    if (!user) {
      await verify(await DUMMY_HASH, input.password).catch(() => false);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status === 'disabled') throw new UnauthorizedException('This account has been disabled');
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new UnauthorizedException(`Too many failed attempts. Try again after ${LOCK_MINUTES} minutes.`);
    }

    const ok = await verify(user.password_hash, input.password).catch(() => false);
    const ctx = { userId: user.id };
    if (!ok) {
      const failed = user.failed_login_count + 1;
      await this.database.run(ctx, (tx) =>
        tx
          .update(users)
          .set({
            failedLoginCount: failed,
            lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
          })
          .where(eq(users.id, user.id)),
      );
      throw new UnauthorizedException('Invalid email or password');
    }

    const available = await this.listTenants(user.id);
    let tenant: TenantSummary | undefined;
    if (input.tenantSlug) {
      tenant = available.find((t) => t.slug === input.tenantSlug);
      if (!tenant) throw new ForbiddenException('You do not have access to this workspace');
    } else if (available.length === 1) {
      tenant = available[0];
    } else if (available.length === 0) {
      throw new ForbiddenException('Your account is not linked to any active workspace');
    } else {
      return { kind: 'select-tenant', tenants: available.map(({ membershipId: _m, ...t }) => t) };
    }
    if (tenant.status === 'suspended' || tenant.status === 'archived') {
      throw new ForbiddenException('This workspace is not active. Contact your administrator.');
    }

    if (user.mfa_enabled) {
      // Password is right; the session is only issued after the second factor.
      const claims: MfaClaims = { sub: user.id, tid: tenant.id, mid: tenant.membershipId, typ: 'mfa' };
      return { kind: 'mfa-required', mfaToken: await this.jwt.signAsync(claims, { expiresIn: 300, audience: 'mfa' }) };
    }
    return this.finishLogin(user, tenant, meta, null);
  }

  /** Second step of sign-in: a TOTP or recovery code for the short-lived MFA token. */
  async verifyMfa(mfaToken: string, code: string, meta: ClientMeta & { requestId?: string }): Promise<LoginResult> {
    let claims: MfaClaims;
    try {
      claims = await this.jwt.verifyAsync<MfaClaims>(mfaToken, { audience: 'mfa' });
    } catch {
      throw new UnauthorizedException('Sign-in timed out. Enter your email and password again.');
    }
    if (claims.typ !== 'mfa') throw new UnauthorizedException();
    const [user] = await this.database.run({ userId: claims.sub }, (tx) =>
      tx
        .select({ id: users.id, email: users.email, full_name: users.fullName, failed_login_count: users.failedLoginCount, locked_until: users.lockedUntil, status: users.status })
        .from(users)
        .where(eq(users.id, claims.sub)),
    );
    if (!user || user.status === 'disabled') throw new UnauthorizedException('This account has been disabled');
    if (user.locked_until && user.locked_until > new Date()) {
      throw new UnauthorizedException(`Too many failed attempts. Try again after ${LOCK_MINUTES} minutes.`);
    }
    const method = await this.mfa.verifyChallenge(user.id, code);
    if (!method) {
      const failed = user.failed_login_count + 1;
      await this.database.run({ userId: user.id }, (tx) =>
        tx
          .update(users)
          .set({ failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
          .where(eq(users.id, user.id)),
      );
      throw new UnauthorizedException('That code is not valid');
    }
    const tenant = (await this.listTenants(user.id)).find((t) => t.id === claims.tid && t.membershipId === claims.mid);
    if (!tenant) throw new ForbiddenException('You no longer have access to this workspace');
    return this.finishLogin({ ...user, password_hash: '', mfa_enabled: true }, tenant, meta, method);
  }

  private async finishLogin(user: Omit<UserLookup, 'status'>, tenant: TenantSummary, meta: ClientMeta & { requestId?: string }, mfa: 'totp' | 'recovery' | null): Promise<LoginResult> {
    await this.database.run({ tenantId: tenant.id, userId: user.id }, async (tx) => {
      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
        .where(eq(users.id, user.id));
      await this.audit.log(tx, {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        metadata: mfa ? { mfa } : undefined,
        ip: meta.ip,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
    });

    const tokens = await this.tokens.issue({ userId: user.id, tenantId: tenant.id, membershipId: tenant.membershipId }, meta);
    return { kind: 'session', tokens, user: { id: user.id, fullName: user.full_name, email: user.email }, tenant };
  }

  async me(auth: AuthContext) {
    const ctx = { tenantId: auth.tenantId, userId: auth.userId };
    const { user, tenant } = await this.database.run(ctx, async (tx) => {
      const [user] = await tx
        .select({ id: users.id, email: users.email, fullName: users.fullName, mobile: users.mobile, locale: users.locale, mfaEnabled: users.mfaEnabled })
        .from(users)
        .where(eq(users.id, auth.userId));
      const [tenant] = await tx
        .select({ id: tenants.id, slug: tenants.slug, name: tenants.name, status: tenants.status, industry: tenants.industry, trialEndsAt: tenants.trialEndsAt })
        .from(tenants)
        .where(eq(tenants.id, auth.tenantId));
      return { user, tenant };
    });
    if (!user || !tenant) throw new UnauthorizedException();
    const permissions = await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId);
    const e = await this.entitlements.get(auth.tenantId);
    return {
      user,
      tenant,
      permissions: [...permissions].sort(),
      plan: { code: e.planCode, name: e.planName, state: e.state, readOnly: e.readOnly, trialEndsAt: e.trialEndsAt, periodEnd: e.periodEnd, features: e.features },
      isPlatformAdmin: this.platformAdmins.includes(user.email.toLowerCase()),
    };
  }

  private async findUser(email: string): Promise<UserLookup | undefined> {
    const res = await this.database.run({}, (tx) =>
      tx.execute<UserLookup & Record<string, unknown>>(sql`select * from auth_find_user_by_email(${email})`),
    );
    return res.rows[0];
  }

  private async listTenants(userId: string): Promise<TenantSummary[]> {
    return this.database.run({ userId }, (tx) =>
      tx
        .select({ id: tenants.id, slug: tenants.slug, name: tenants.name, status: tenants.status, membershipId: memberships.id })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
        .orderBy(tenants.name),
    );
  }
}
