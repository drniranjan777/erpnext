import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, API_URL, cleanupTenants, Client, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const tenants: string[] = [];
const ctx: Record<string, any> = {};

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

// ---- a tiny OpenID provider ----
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
let server: Server;
let issuer = '';
const codes = new Map<string, { claims: Record<string, unknown>; challenge: string }>();
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims: Record<string, unknown>) => {
  const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const p = b64(claims);
  return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), keys.privateKey).toString('base64url')}`;
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (o: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    if (url.pathname === '/.well-known/openid-configuration') return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    if (url.pathname === '/jwks') return json({ keys: [jwk] });
    if (url.pathname === '/token') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const f = new URLSearchParams(body);
        const c = codes.get(f.get('code') ?? '');
        if (!c) return json({ error: 'invalid_grant' }, 400);
        // PKCE: the verifier must hash to the challenge sent at the start.
        if (createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') !== c.challenge) return json({ error: 'invalid_grant', error_description: 'PKCE check failed' }, 400);
        json({ access_token: 'x', token_type: 'Bearer', id_token: idToken(c.claims) });
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  issuer = `http://127.0.0.1:${addr.port}`;
  a = await signupWorkspace('ent-a');
  emails.push(a.email);
  tenants.push(a.tenantId);
});

afterAll(async () => {
  server?.close();
  await cleanupTenants(tenants, emails);
});

/** Runs the browser part of the flow: start, "sign in" at the provider, callback. */
async function ssoSignIn(claims: (nonce: string) => Record<string, unknown>) {
  const start = await fetch(`${API_URL}/auth/sso/${a.slug}/start`, { redirect: 'manual' });
  expect(start.status).toBe(302);
  const loc = new URL(start.headers.get('location')!);
  const cookie = start.headers.getSetCookie().find((c) => c.startsWith('ngsso='))!.split(';')[0];
  const code = `code-${Math.random().toString(36).slice(2)}`;
  codes.set(code, { claims: claims(loc.searchParams.get('nonce')!), challenge: loc.searchParams.get('code_challenge')! });
  const cb = await fetch(`${API_URL}/auth/sso/callback?code=${code}&state=${loc.searchParams.get('state')}`, { redirect: 'manual', headers: { cookie } });
  return { status: cb.status, location: cb.headers.get('location') ?? '', setCookie: cb.headers.getSetCookie().find((c) => c.startsWith('ngerp_rt=')) ?? '', authorize: loc };
}

describe('single sign-on (OIDC)', () => {
  it('signs a user in through the identity provider and creates them on first sign-in', async () => {
    const roles = await ok(await a.client.get('/iam/roles'));
    ctx.viewer = roles.find((r: any) => r.name !== 'Owner');
    expect((await a.client.request('PUT', '/platform/sso', { enabled: true, issuer, clientId: 'erp-client', autoProvision: true })).status).toBe(400);
    await ok(await a.client.request('PUT', '/platform/sso', { enabled: true, issuer, clientId: 'erp-client', clientSecret: 'shh', allowedDomains: ['sso-acme.example'], autoProvision: true, defaultRoleId: ctx.viewer.id }));
    const cfg = await ok(await a.client.get('/platform/sso'));
    expect(cfg.settings).toMatchObject({ enabled: true, hasClientSecret: true, autoProvision: true });
    expect(cfg.settings.clientSecretEncrypted).toBeUndefined();
    const email = `sso-${Date.now()}@sso-acme.example`;
    emails.push(email);
    const iat = Math.floor(Date.now() / 1000);
    const r = await ssoSignIn((nonce) => ({ iss: issuer, aud: 'erp-client', sub: 'abc', iat, exp: iat + 300, nonce, email, email_verified: true, name: 'Kavya Reddy' }));
    expect(r.authorize.origin).toBe(issuer);
    expect(r.authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(r.status).toBe(302);
    expect(r.location).toMatch(/\/dashboard$/);
    expect(r.setCookie).toContain('ngerp_rt=');
    // The browser now has a session: refresh gives an access token for the new user.
    const refresh = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { cookie: r.setCookie.split(';')[0] } });
    const { accessToken } = (await refresh.json()) as { accessToken: string };
    const me = await (await fetch(`${API_URL}/auth/me`, { headers: { authorization: `Bearer ${accessToken}` } })).json();
    expect(me).toMatchObject({ user: { email, fullName: 'Kavya Reddy' }, tenant: { slug: a.slug } });
  });

  it('refuses other domains, wrong nonces and requires SSO when set', async () => {
    const iat = Math.floor(Date.now() / 1000);
    const wrong = await ssoSignIn((nonce) => ({ iss: issuer, aud: 'erp-client', sub: 'x', iat, exp: iat + 300, nonce, email: 'x@gmail.com' }));
    expect(decodeURIComponent(wrong.location)).toContain('gmail.com is not allowed');
    const replay = await ssoSignIn(() => ({ iss: issuer, aud: 'erp-client', sub: 'x', iat, exp: iat + 300, nonce: 'stolen', email: 'y@sso-acme.example' }));
    expect(decodeURIComponent(replay.location)).toContain('nonce does not match');
    const member = await addMember(a.client, 'ent-member', [ctx.viewer.id]);
    emails.push(member.email);
    await ok(await a.client.request('PUT', '/platform/sso', { enabled: true, issuer, clientId: 'erp-client', allowedDomains: ['sso-acme.example'], autoProvision: true, defaultRoleId: ctx.viewer.id, requireSso: true }));
    const m = await new Client().post('/auth/login', { email: member.email, password: member.password, tenantSlug: a.slug });
    expect(m.status).toBe(403);
    expect(m.body.detail).toContain('Sign in with SSO');
    expect((await new Client().post('/auth/login', { email: a.email, password: a.password, tenantSlug: a.slug })).status).toBe(200);
    const meta = await fetch(`${API_URL}/auth/sso/${a.slug}/saml/metadata`);
    expect(await meta.text()).toContain('AssertionConsumerService');
    await ok(await a.client.request('PUT', '/platform/sso', { enabled: false }));
  });
});

describe('SCIM 2.0', () => {
  it('provisions, updates, groups and deactivates users', async () => {
    const t = await ok(await a.client.post('/platform/scim/tokens', { name: 'Entra ID', defaultRoleId: ctx.viewer.id }), 201);
    expect(t.token).toMatch(/^scim_[0-9a-f]{8}_/);
    const scim = (method: string, path: string, body?: unknown, token = t.token) => fetch(`${API_URL}/scim/v2${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' }, body: body ? JSON.stringify(body) : undefined });
    const bad = await scim('GET', '/Users', undefined, 'scim_bad_token');
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '401' });
    const email = `scim-${Date.now()}@sso-acme.example`;
    emails.push(email);
    const created = await scim('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: email, name: { givenName: 'Rohit', familyName: 'Menon' }, emails: [{ value: email, primary: true }], active: true });
    expect(created.status).toBe(201);
    const u = await created.json();
    expect(u).toMatchObject({ userName: email, active: true, displayName: 'Rohit Menon', groups: [{ value: ctx.viewer.id }] });
    expect((await scim('POST', '/Users', { userName: email })).status).toBe(409);
    const found = await (await scim('GET', `/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`)).json();
    expect(found).toMatchObject({ totalResults: 1, Resources: [{ id: u.id }] });
    const patched = await (await scim('PATCH', `/Users/${u.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', value: { active: false, displayName: 'Rohit K Menon' } }] })).json();
    expect(patched).toMatchObject({ active: false, displayName: 'Rohit K Menon' });
    await scim('PATCH', `/Users/${u.id}`, { Operations: [{ op: 'replace', path: 'active', value: true }] });
    const groups = await (await scim('GET', '/Groups')).json();
    const owner = groups.Resources.find((g: any) => g.displayName === 'Owner');
    const g = await (await scim('PATCH', `/Groups/${owner.id}`, { Operations: [{ op: 'add', path: 'members', value: [{ value: u.id }] }] })).json();
    expect(g.members.map((m: any) => m.value)).toContain(u.id);
    await scim('PATCH', `/Groups/${owner.id}`, { Operations: [{ op: 'remove', path: `members[value eq "${u.id}"]` }] });
    expect((await (await scim('GET', `/Groups/${owner.id}`)).json()).members.map((m: any) => m.value)).not.toContain(u.id);
    expect((await scim('DELETE', `/Users/${u.id}`)).status).toBe(204);
    expect((await (await scim('GET', `/Users/${u.id}`)).json()).active).toBe(false);
    const me = (await a.client.get('/auth/me')).body;
    expect((await scim('DELETE', `/Users/${me.user.id}`)).status).toBe(409);
    await ok(await a.client.delete(`/platform/scim/tokens/${t.id}`));
    expect((await scim('GET', '/Users')).status).toBe(401);
  });
});

describe('workspace data', () => {
  it('copies the workspace to a sandbox and round-trips an export', async () => {
    const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
    const item = await ok(await a.client.post('/masters/items', { code: 'ENT-1', name: 'Copy check item', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '84799090' }), 201);
    const cust = await ok(await a.client.post('/masters/parties', { name: 'Copy Check Customer', isCustomer: true, gstin: '36AABCD1234E1Z9', addresses: [{ type: 'both', line1: 'Begumpet', city: 'Hyderabad', stateCode: '36', pincode: '500016', isDefault: true }] }), 201);
    const so = await ok(await a.client.post('/sales/orders', { customerId: cust.id, lines: [{ itemId: item.id, qty: '4', rate: '1000' }] }), 201);
    const res = await ok(await a.client.get('/platform/data/residency'));
    expect(res.region).toBeTruthy();
    const slug = `e2e-sbx-${Date.now().toString(36)}`;
    const sbx = await ok(await a.client.post('/platform/data/sandbox', { slug }), 201);
    tenants.push(sbx.tenantId);
    expect(sbx.rows).toBeGreaterThan(50);
    const c = new Client();
    await ok(await c.post('/auth/login', { email: a.email, password: a.password, tenantSlug: slug }));
    const items = (await c.get('/masters/items?q=ENT-1')).body.items;
    expect(items).toHaveLength(1);
    expect(items[0].id).not.toBe(item.id);
    const orders = (await c.get('/sales/orders')).body.items;
    expect(orders).toHaveLength(1);
    const copied = await ok(await c.get(`/sales/orders/${orders[0].id}`));
    expect(copied.lines[0].itemId).toBe(items[0].id);
    expect(copied.customerId).not.toBe(cust.id);
    expect((await ok(await c.get('/platform/data/residency'))).sandboxOf).toBe(a.slug);
    expect((await c.get(`/sales/orders/${so.id}`)).status).toBe(404);
    await c.post('/auth/logout');
    // Export file → import as another workspace.
    const file = await a.client.download('/platform/data/export');
    expect(file.type).toBe('application/gzip');
    const parsed = JSON.parse(gunzipSync(Buffer.from(file.bytes)).toString('utf8'));
    expect(parsed).toMatchObject({ format: 'nextgen-tenant-export', version: 1, tenant: { slug: a.slug } });
    expect(parsed.tables.items.some((i: any) => i.code === 'ENT-1')).toBe(true);
    expect(parsed.tables.api_keys).toBeUndefined();
    const slug2 = `e2e-imp-${Date.now().toString(36)}`;
    const imp = await ok(await a.client.upload(`/platform/data/import?slug=${slug2}&name=Imported%20copy`, 'export.json.gz', file.bytes, 'application/gzip'), 201);
    tenants.push(imp.tenantId);
    expect(imp.slug).toBe(slug2);
    expect((await a.client.upload(`/platform/data/import?slug=${slug2}`, 'export.json.gz', file.bytes, 'application/gzip')).status).toBe(409);
  });
});
