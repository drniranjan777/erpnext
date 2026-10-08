import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { membershipRoles, memberships, ssoSettings, users, type Transaction } from '@nextgen/database';
import { hash } from '@node-rs/argon2';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { CryptoService } from '../../common/crypto.service';
import type { RequestMeta } from '../../common/request-meta';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { TokensService } from '../auth/tokens.service';
import { allowedEmail, authorizeUrl, pkce, samlSpMetadata, verifyIdToken, type Discovery } from './oidc';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;

export const ssoSchema = z.object({
  protocol: z.enum(['oidc', 'saml']).default('oidc'),
  enabled: z.boolean().default(false),
  issuer: z.url().nullable().optional(),
  clientId: z.string().trim().max(200).nullable().optional(),
  clientSecret: z.string().max(2000).nullable().optional(),
  idpEntityId: z.string().trim().max(500).nullable().optional(),
  idpSsoUrl: z.url().nullable().optional(),
  idpCertificate: z.string().max(10_000).nullable().optional(),
  allowedDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(20).default([]),
  autoProvision: z.boolean().default(false),
  defaultRoleId: z.uuid().nullable().optional(),
  requireSso: z.boolean().default(false),
});

/** What the browser keeps (encrypted, http-only) between the redirect to the provider and the callback. */
interface Pending {
  slug: string;
  tenantId: string;
  state: string;
  nonce: string;
  verifier: string;
  exp: number;
}

export const SSO_COOKIE = 'ngsso';

/**
 * Single sign-on with OpenID Connect (authorization code + PKCE): Microsoft Entra ID, Google
 * Workspace, Okta and others. The ID token is checked against the provider's keys, issuer, audience,
 * expiry and nonce; the email must be verified and in an allowed domain. Users can be created on
 * first sign-in with a default role, and a workspace can require SSO for everyone but its owners.
 * SAML: the service provider metadata is published from the settings; sign-in uses OIDC.
 */
@Injectable()
export class SsoService {
  private readonly appUrl: string;
  private readonly discoveryCache = new Map<string, { at: number; d: Discovery; keys: unknown[] }>();

  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly tokens: TokensService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  get redirectUri() {
    return `${this.appUrl}/api/v1/auth/sso/callback`;
  }

  // ---- settings ----------------------------------------------------------------------------------

  async get(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select().from(ssoSettings);
      const [t] = await many<{ slug: string }>(tx, sql`select slug from tenants where id = ${auth.tenantId}`);
      const { clientSecretEncrypted, ...rest } = s ?? ({} as typeof ssoSettings.$inferSelect);
      return {
        settings: s ? { ...rest, hasClientSecret: !!clientSecretEncrypted } : null,
        redirectUri: this.redirectUri,
        startUrl: `${this.appUrl}/api/v1/auth/sso/${t.slug}/start`,
        samlMetadataUrl: `${this.appUrl}/api/v1/auth/sso/${t.slug}/saml/metadata`,
      };
    });
  }

  save(auth: AuthContext, input: z.infer<typeof ssoSchema>) {
    if (input.enabled && input.protocol === 'oidc' && (!input.issuer || !input.clientId)) throw new BadRequestException('OIDC needs the issuer and the client ID');
    if (input.requireSso && !input.enabled) throw new BadRequestException('Turn single sign-on on before requiring it');
    if (input.autoProvision && !input.allowedDomains.length) throw new BadRequestException('Creating users on first sign-in needs the allowed email domains');
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select().from(ssoSettings);
      const { clientSecret, ...values } = input;
      const secret = clientSecret ? this.crypto.encrypt(clientSecret) : (s?.clientSecretEncrypted ?? null);
      if (s) await tx.update(ssoSettings).set({ ...values, clientSecretEncrypted: secret, updatedAt: new Date() }).where(eq(ssoSettings.id, s.id));
      else await tx.insert(ssoSettings).values({ tenantId: auth.tenantId, ...values, clientSecretEncrypted: secret });
      this.discoveryCache.clear();
      return { ok: true };
    });
  }

  // ---- sign-in flow ------------------------------------------------------------------------------

  private async discover(issuer: string) {
    const hit = this.discoveryCache.get(issuer);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
    const d = (await (await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) })).json()) as Discovery;
    if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri) throw new BadRequestException('The identity provider discovery document is incomplete');
    const jwks = (await (await fetch(d.jwks_uri, { signal: AbortSignal.timeout(8000) })).json()) as { keys: unknown[] };
    const v = { at: Date.now(), d, keys: jwks.keys ?? [] };
    this.discoveryCache.set(issuer, v);
    return v;
  }

  private async settingsBySlug(slug: string) {
    const [s] = await this.database.run({}, (tx) =>
      many<{ tenant_id: string; protocol: string; enabled: boolean; issuer: string | null; client_id: string | null; client_secret_encrypted: string | null; allowed_domains: string[]; auto_provision: boolean; default_role_id: string | null; idp_entity_id: string | null }>(tx, sql`select * from sso_settings_by_slug(${slug})`),
    );
    if (!s || !s.enabled) throw new NotFoundException('Single sign-on is not set up for this workspace');
    return s;
  }

  /** Redirect to the identity provider; the pending state goes in an encrypted cookie. */
  async start(slug: string, loginHint: string | null) {
    const s = await this.settingsBySlug(slug);
    if (s.protocol !== 'oidc' || !s.issuer || !s.client_id) throw new BadRequestException('This workspace signs in with SAML, which is not available yet; use OIDC');
    const { d } = await this.discover(s.issuer);
    const p = pkce();
    const pending: Pending = { slug, tenantId: s.tenant_id, state: randomBytes(16).toString('base64url'), nonce: randomBytes(16).toString('base64url'), verifier: p.verifier, exp: Date.now() + 10 * 60_000 };
    return { url: authorizeUrl(d, { clientId: s.client_id, redirectUri: this.redirectUri, state: pending.state, nonce: pending.nonce, challenge: p.challenge, loginHint }), cookie: this.crypto.encrypt(JSON.stringify(pending)) };
  }

  /** The provider sends the browser back with a code: exchange it, check the ID token, sign the user in. */
  async callback(q: { code?: string; state?: string; error?: string; error_description?: string }, cookie: string | undefined, meta: RequestMeta) {
    if (q.error) throw new ForbiddenException(`The identity provider refused: ${q.error_description ?? q.error}`);
    if (!cookie || !q.code || !q.state) throw new BadRequestException('Sign-in expired. Start again from the sign-in page.');
    let pending: Pending;
    try {
      pending = JSON.parse(this.crypto.decrypt(cookie)) as Pending;
    } catch {
      throw new BadRequestException('Sign-in expired. Start again from the sign-in page.');
    }
    if (pending.state !== q.state || pending.exp < Date.now()) throw new BadRequestException('Sign-in expired. Start again from the sign-in page.');
    const s = await this.settingsBySlug(pending.slug);
    const { d, keys } = await this.discover(s.issuer!);
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: q.code, redirect_uri: this.redirectUri, client_id: s.client_id!, code_verifier: pending.verifier });
    if (s.client_secret_encrypted) body.set('client_secret', this.crypto.decrypt(s.client_secret_encrypted));
    const res = await fetch(d.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
    const tok = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
    if (!res.ok || !tok.id_token) throw new ForbiddenException(`The identity provider did not sign you in: ${tok.error_description ?? tok.error ?? res.status}`);
    let claims;
    try {
      claims = verifyIdToken(tok.id_token, keys as never, { issuer: d.issuer, clientId: s.client_id!, nonce: pending.nonce });
    } catch (err) {
      throw new ForbiddenException((err as Error).message);
    }
    const { email, problem } = allowedEmail(claims, s.allowed_domains);
    if (!email) throw new ForbiddenException(problem);
    const identity = await this.member(s, email, claims.name ?? email.split('@')[0]);
    const tokens = await this.tokens.issue(identity, meta);
    await this.database.run({ tenantId: identity.tenantId, userId: identity.userId }, (tx) => tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, identity.userId)));
    return { tokens, slug: pending.slug };
  }

  /** The user's membership of the workspace, created on first sign-in when allowed. */
  private async member(s: { tenant_id: string; auto_provision: boolean; default_role_id: string | null }, email: string, name: string) {
    const [found] = await this.database.run({}, (tx) => many<{ id: string; status: string }>(tx, sql`select id, status from auth_find_user_by_email(${email})`));
    if (found?.status === 'disabled') throw new ForbiddenException('This account has been disabled');
    let userId = found?.id ?? null;
    if (!userId) {
      if (!s.auto_provision) throw new ForbiddenException('You do not have access to this workspace yet. Ask its administrator to invite you.');
      userId = (await this.database.run({}, (tx) => many<{ id: string }>(tx, sql`select uuidv7()::text as id`)))[0].id;
      const passwordHash = await hash(randomBytes(32).toString('hex'));
      await this.database.run({ userId }, (tx) => tx.insert(users).values({ id: userId!, email, fullName: name, passwordHash }));
    }
    return this.database.run({ tenantId: s.tenant_id, userId }, async (tx) => {
      const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, userId!), eq(memberships.tenantId, s.tenant_id)));
      if (m) {
        if (m.status !== 'active') throw new ForbiddenException('Your access to this workspace is not active');
        return { userId: userId!, tenantId: s.tenant_id, membershipId: m.id };
      }
      if (!s.auto_provision) throw new ForbiddenException('You do not have access to this workspace yet. Ask its administrator to invite you.');
      const [created] = await tx.insert(memberships).values({ tenantId: s.tenant_id, userId: userId!, status: 'active' }).returning({ id: memberships.id });
      if (s.default_role_id) await tx.insert(membershipRoles).values({ tenantId: s.tenant_id, membershipId: created.id, roleId: s.default_role_id });
      return { userId: userId!, tenantId: s.tenant_id, membershipId: created.id };
    });
  }

  async samlMetadata(slug: string) {
    const s = await this.settingsBySlug(slug);
    return samlSpMetadata(`${this.appUrl}/sso/${slug}`, `${this.appUrl}/api/v1/auth/sso/${slug}/saml/acs`) + (s.idp_entity_id ? `<!-- IdP: ${s.idp_entity_id.replace(/--/g, '')} -->\n` : '');
  }
}
