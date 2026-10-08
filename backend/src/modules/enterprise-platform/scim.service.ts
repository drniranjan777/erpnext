import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { membershipRoles, memberships, roles, scimTokens, users, type Transaction } from '@nextgen/database';
import { hash } from '@node-rs/argon2';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const tokenSchema = z.object({ name: z.string().trim().min(2).max(80), defaultRoleId: z.uuid().nullable().optional() });

export interface ScimContext {
  tenantId: string;
  tokenId: string;
  defaultRoleId: string | null;
  base: string;
}

interface ScimUserInput {
  userName?: string;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  displayName?: string;
  emails?: { value: string; primary?: boolean }[];
  active?: boolean;
}

/** SCIM 2.0 (RFC 7643 / 7644) users and groups for identity providers; groups are workspace roles. */
@Injectable()
export class ScimService {
  constructor(private readonly database: DatabaseService) {}

  // ---- tokens (managed by workspace admins) ------------------------------------------------------

  tokens(auth: AuthContext) {
    return this.database.run(auth, (tx) => many(tx, sql`select s.id, s.name, s.prefix, s.created_at as "createdAt", s.last_used_at as "lastUsedAt", s.revoked_at as "revokedAt", r.name as "defaultRole" from scim_tokens s left join roles r on r.id = s.default_role_id order by s.created_at desc`));
  }

  /** The token is shown once; only its SHA-256 is kept. */
  createToken(auth: AuthContext, input: z.infer<typeof tokenSchema>) {
    const prefix = randomBytes(4).toString('hex');
    const token = `scim_${prefix}_${randomBytes(24).toString('base64url')}`;
    return this.database.run(auth, async (tx) => {
      const [r] = await tx
        .insert(scimTokens)
        .values({ tenantId: auth.tenantId, name: input.name, prefix, tokenHash: sha(token), defaultRoleId: input.defaultRoleId ?? null, createdBy: auth.userId })
        .returning({ id: scimTokens.id });
      return { id: r.id, token };
    });
  }

  revokeToken(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      await tx.update(scimTokens).set({ revokedAt: new Date() }).where(eq(scimTokens.id, id));
      return { ok: true };
    });
  }

  async authenticate(header: string | undefined, base: string): Promise<ScimContext> {
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token?.startsWith('scim_')) throw new UnauthorizedException('A SCIM bearer token is required');
    const [t] = await this.database.run({}, (tx) => many<{ id: string; tenant_id: string; default_role_id: string | null }>(tx, sql`select * from scim_token_lookup(${sha(token)})`));
    if (!t) throw new UnauthorizedException('The SCIM token is not valid');
    await this.database.run({ tenantId: t.tenant_id }, (tx) => tx.update(scimTokens).set({ lastUsedAt: new Date() }).where(eq(scimTokens.id, t.id)));
    return { tenantId: t.tenant_id, tokenId: t.id, defaultRoleId: t.default_role_id, base };
  }

  // ---- users -------------------------------------------------------------------------------------

  private userResource(c: ScimContext, u: { userId: string; email: string; fullName: string; status: string; createdAt: Date | string; groups?: { value: string; display: string }[] }) {
    const [given, ...rest] = u.fullName.split(' ');
    return {
      schemas: [USER],
      id: u.userId,
      userName: u.email,
      name: { formatted: u.fullName, givenName: given, familyName: rest.join(' ') || undefined },
      displayName: u.fullName,
      emails: [{ value: u.email, primary: true, type: 'work' }],
      active: u.status === 'active',
      groups: u.groups ?? [],
      meta: { resourceType: 'User', created: new Date(u.createdAt).toISOString(), location: `${c.base}/Users/${u.userId}` },
    };
  }

  private async members(tx: Transaction, where: SQL) {
    return many<{ userId: string; email: string; fullName: string; status: string; createdAt: string; membershipId: string }>(
      tx,
      sql`select u.id as "userId", u.email, u.full_name as "fullName", m.status, m.created_at as "createdAt", m.id as "membershipId"
          from memberships m join users u on u.id = m.user_id where ${where} order by m.created_at`,
    );
  }

  private async groupsOf(tx: Transaction, membershipIds: string[]) {
    if (!membershipIds.length) return new Map<string, { value: string; display: string }[]>();
    const rows = await many<{ membershipId: string; id: string; name: string }>(tx, sql`select mr.membership_id as "membershipId", r.id, r.name from membership_roles mr join roles r on r.id = mr.role_id where mr.membership_id in ${membershipIds}`);
    const map = new Map<string, { value: string; display: string }[]>();
    for (const r of rows) map.set(r.membershipId, [...(map.get(r.membershipId) ?? []), { value: r.id, display: r.name }]);
    return map;
  }

  /** filter supports `userName eq "x"` and `emails.value eq "x"` (what Entra ID and Okta send). */
  listUsers(c: ScimContext, filter: string | undefined, startIndex = 1, count = 100) {
    return this.database.run({ tenantId: c.tenantId }, async (tx) => {
      const m = filter ? /^(userName|emails(?:\.value)?|externalId)\s+eq\s+"([^"]*)"$/i.exec(filter.trim()) : null;
      if (filter && !m) return { schemas: [LIST], totalResults: 0, startIndex, itemsPerPage: 0, Resources: [] };
      const all = await this.members(tx, m ? sql`lower(u.email) = lower(${m[2]})` : sql`true`);
      const page = all.slice(startIndex - 1, startIndex - 1 + count);
      const groups = await this.groupsOf(tx, page.map((p) => p.membershipId));
      return { schemas: [LIST], totalResults: all.length, startIndex, itemsPerPage: page.length, Resources: page.map((u) => this.userResource(c, { ...u, groups: groups.get(u.membershipId) })) };
    });
  }

  getUser(c: ScimContext, id: string) {
    return this.database.run({ tenantId: c.tenantId }, async (tx) => {
      const [u] = await this.members(tx, sql`u.id = ${id}`);
      if (!u) throw new NotFoundException(`User ${id} not found`);
      const groups = await this.groupsOf(tx, [u.membershipId]);
      return this.userResource(c, { ...u, groups: groups.get(u.membershipId) });
    });
  }

  private emailOf(input: ScimUserInput) {
    return (input.emails?.find((e) => e.primary)?.value ?? input.emails?.[0]?.value ?? input.userName ?? '').trim().toLowerCase();
  }

  private nameOf(input: ScimUserInput, email: string) {
    return (input.displayName || input.name?.formatted || [input.name?.givenName, input.name?.familyName].filter(Boolean).join(' ') || email.split('@')[0]).trim().slice(0, 100);
  }

  /** Creates the user (sign-in by SSO; no password is set) and an active membership with the token's default role. */
  async createUser(c: ScimContext, input: ScimUserInput) {
    const email = this.emailOf(input);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ConflictException('userName must be an email address');
    const name = this.nameOf(input, email);
    const [found] = await this.database.run({}, (tx) => many<{ id: string }>(tx, sql`select id from auth_find_user_by_email(${email})`));
    let userId = found?.id;
    if (!userId) {
      userId = (await this.database.run({}, (tx) => many<{ id: string }>(tx, sql`select uuidv7()::text as id`)))[0].id;
      const passwordHash = await hash(randomBytes(32).toString('hex'));
      await this.database.run({ userId }, (tx) => tx.insert(users).values({ id: userId!, email, fullName: name, passwordHash }));
    }
    await this.database.run({ tenantId: c.tenantId, userId }, async (tx) => {
      const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, userId!), eq(memberships.tenantId, c.tenantId)));
      if (m && m.status === 'active') throw new ConflictException('The user already exists in this workspace');
      if (m) await tx.update(memberships).set({ status: input.active === false ? 'disabled' : 'active' }).where(eq(memberships.id, m.id));
      else {
        const [created] = await tx.insert(memberships).values({ tenantId: c.tenantId, userId: userId!, status: input.active === false ? 'disabled' : 'active' }).returning({ id: memberships.id });
        if (c.defaultRoleId) await tx.insert(membershipRoles).values({ tenantId: c.tenantId, membershipId: created.id, roleId: c.defaultRoleId });
      }
    });
    return this.getUser(c, userId);
  }

  /** PUT: replace name and active. */
  async replaceUser(c: ScimContext, id: string, input: ScimUserInput) {
    await this.apply(c, id, { active: input.active, name: input.displayName || input.name ? this.nameOf(input, '') : undefined });
    return this.getUser(c, id);
  }

  /** PATCH with Operations: replace active / name (with or without a path). */
  async patchUser(c: ScimContext, id: string, body: { Operations?: { op: string; path?: string; value?: unknown }[] }) {
    const change: { active?: boolean; name?: string } = {};
    for (const o of body.Operations ?? []) {
      if (!['replace', 'add'].includes(o.op.toLowerCase())) continue;
      const v = o.value as Record<string, unknown> | boolean | string | undefined;
      const set = (path: string, value: unknown) => {
        if (path === 'active') change.active = value === true || value === 'true' || value === 'True';
        if (path === 'displayName' || path === 'name.formatted') change.name = String(value);
      };
      if (o.path) set(o.path, v);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) set(k, x);
    }
    await this.apply(c, id, change);
    return this.getUser(c, id);
  }

  private async apply(c: ScimContext, id: string, change: { active?: boolean; name?: string }) {
    await this.database.run({ tenantId: c.tenantId }, async (tx) => {
      const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, id), eq(memberships.tenantId, c.tenantId)));
      if (!m) throw new NotFoundException(`User ${id} not found`);
      if (m.isOwner && change.active === false) throw new ConflictException('The workspace owner cannot be deactivated by SCIM');
      if (change.active !== undefined) await tx.update(memberships).set({ status: change.active ? 'active' : 'disabled' }).where(eq(memberships.id, m.id));
      if (change.name) await tx.execute(sql`select scim_set_user_name(${id}::uuid, ${change.name})`);
    });
  }

  /** DELETE deactivates the membership (history stays). */
  async deleteUser(c: ScimContext, id: string) {
    await this.apply(c, id, { active: false });
  }

  // ---- groups (roles) ----------------------------------------------------------------------------

  private async groupResource(tx: Transaction, c: ScimContext, r: { id: string; name: string; createdAt: Date | string }) {
    const mem = await many<{ userId: string; email: string }>(tx, sql`select u.id as "userId", u.email from membership_roles mr join memberships m on m.id = mr.membership_id join users u on u.id = m.user_id where mr.role_id = ${r.id}`);
    return { schemas: [GROUP], id: r.id, displayName: r.name, members: mem.map((m) => ({ value: m.userId, display: m.email })), meta: { resourceType: 'Group', created: new Date(r.createdAt).toISOString(), location: `${c.base}/Groups/${r.id}` } };
  }

  listGroups(c: ScimContext, filter: string | undefined) {
    return this.database.run({ tenantId: c.tenantId }, async (tx) => {
      const m = filter ? /^displayName\s+eq\s+"([^"]*)"$/i.exec(filter.trim()) : null;
      const list = await tx.select({ id: roles.id, name: roles.name, createdAt: roles.createdAt }).from(roles);
      const pick = m ? list.filter((r) => r.name.toLowerCase() === m[1].toLowerCase()) : list;
      const out = [];
      for (const r of pick) out.push(await this.groupResource(tx, c, r));
      return { schemas: [LIST], totalResults: out.length, startIndex: 1, itemsPerPage: out.length, Resources: out };
    });
  }

  getGroup(c: ScimContext, id: string) {
    return this.database.run({ tenantId: c.tenantId }, async (tx) => {
      const [r] = await tx.select({ id: roles.id, name: roles.name, createdAt: roles.createdAt }).from(roles).where(eq(roles.id, id));
      if (!r) throw new NotFoundException(`Group ${id} not found`);
      return this.groupResource(tx, c, r);
    });
  }

  /** PATCH members: add [{value: userId}], remove path members[value eq "userId"] or value list. */
  patchGroup(c: ScimContext, id: string, body: { Operations?: { op: string; path?: string; value?: unknown }[] }) {
    return this.database.run({ tenantId: c.tenantId }, async (tx) => {
      const [r] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, id));
      if (!r) throw new NotFoundException(`Group ${id} not found`);
      const membershipOf = async (userIds: string[]) => (userIds.length ? await tx.select({ id: memberships.id, userId: memberships.userId }).from(memberships).where(and(inArray(memberships.userId, userIds), eq(memberships.tenantId, c.tenantId))) : []);
      for (const o of body.Operations ?? []) {
        const op = o.op.toLowerCase();
        const fromPath = o.path ? /members\[value eq "([^"]+)"\]/i.exec(o.path)?.[1] : undefined;
        const values = fromPath ? [fromPath] : Array.isArray(o.value) ? (o.value as { value: string }[]).map((v) => v.value) : [];
        const ms = await membershipOf(values);
        if (op === 'add') for (const m of ms) await tx.insert(membershipRoles).values({ tenantId: c.tenantId, membershipId: m.id, roleId: id }).onConflictDoNothing();
        if (op === 'remove' && ms.length) await tx.delete(membershipRoles).where(and(eq(membershipRoles.roleId, id), inArray(membershipRoles.membershipId, ms.map((m) => m.id))));
        if (op === 'remove' && !fromPath && !ms.length && o.path === 'members') await tx.delete(membershipRoles).where(eq(membershipRoles.roleId, id));
      }
      const [row] = await tx.select({ id: roles.id, name: roles.name, createdAt: roles.createdAt }).from(roles).where(eq(roles.id, id));
      return this.groupResource(tx, c, row);
    });
  }

  serviceProviderConfig(c: ScimContext) {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: `${c.base.replace(/\/scim\/v2$/, '')}/docs`,
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'A SCIM token created under Settings → Single sign-on', primary: true }],
    };
  }
}
