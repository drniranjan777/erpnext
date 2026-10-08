import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, Client, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace; // partner user's own workspace
let b: Workspace; // a customer who names the partner
const admin = new Client();
const emails: string[] = [];
const tenants: string[] = [];
const ctx: Record<string, any> = {};
const env = readFileSync(join(__dirname, '..', '..', '..', 'database', '.env'), 'utf8');
const ownerUrl = process.env.DATABASE_OWNER_URL ?? env.match(/^DATABASE_OWNER_URL=(.*)$/m)?.[1];
const code = `E2E-${Date.now().toString(36).toUpperCase()}`;

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

beforeAll(async () => {
  a = await signupWorkspace('wl-a');
  b = await signupWorkspace('wl-b');
  emails.push(a.email, b.email);
  tenants.push(a.tenantId, b.tenantId);
  const pw = env.match(/^SEED_ADMIN_PASSWORD=(.*)$/m)?.[1]?.trim();
  await admin.post('/auth/login', { email: 'admin@demo.local', password: pw, tenantSlug: 'demo' });
});

afterAll(async () => {
  await admin.post('/auth/logout');
  if (ownerUrl) {
    const pool = new Pool({ connectionString: ownerUrl, max: 1 });
    await pool.query('delete from partner_commissions where partner_id in (select id from partners where code = $1)', [code]);
    await pool.query('update tenants set partner_id = null where partner_id in (select id from partners where code = $1)', [code]);
    await pool.query('delete from partners where code = $1', [code]);
    await pool.end();
  }
  await cleanupTenants(tenants, emails);
});

describe('branding', () => {
  it('checks colours, logos and domains, and proves the domain by DNS', async () => {
    const first = await ok(await a.client.get('/branding'));
    expect(first.domainToken).toMatch(/^[0-9a-f]{32}$/);
    expect((await a.client.request('PUT', '/branding', { primaryColor: '#ffd400' })).body.detail).toContain('contrast');
    const evil = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}`;
    expect((await a.client.request('PUT', '/branding', { logo: evil })).status).toBe(400);
    expect((await a.client.request('PUT', '/branding', { customDomain: 'erp.localhost' })).status).toBe(400);
    expect((await a.client.request('PUT', '/branding', { smsSenderId: 'ACME' })).status).toBe(400);
    const logo = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#0f766e"/></svg>').toString('base64')}`;
    const host = `erp.${code.toLowerCase()}.example`;
    const saved = await ok(await a.client.request('PUT', '/branding', { productName: 'Acme Works', logo, primaryColor: '#0F766E', customDomain: host, emailFromName: 'Acme Works', emailFromAddress: 'erp@acme.example', smsSenderId: 'ACMEWK' }));
    expect(saved).toMatchObject({ productName: 'Acme Works', primaryColor: '#0f766e', customDomain: host, domainVerifiedAt: null, emailSenderActive: false });
    expect(saved.dns.domain).toMatchObject({ host: `_nextgen-verify.${host}`, type: 'TXT', value: `nextgen-verify=${saved.domainToken}` });
    expect(saved.dns.email.host).toBe('_nextgen-verify.acme.example');
    // No TXT record exists for this made-up domain, so verification fails.
    const v = await a.client.post('/branding/verify/domain');
    expect(v.status).toBe(409);
    expect(v.body.detail).toContain(`nextgen-verify=${saved.domainToken}`);
    expect((await ok(await a.client.get(`/public/branding?host=${host}`))) ?? null).toBeNull();
    // Once the domain is verified, the login page of the domain shows the brand.
    if (ownerUrl) {
      const pool = new Pool({ connectionString: ownerUrl, max: 1 });
      await pool.query('update tenant_branding set domain_verified_at = now() where tenant_id = $1', [a.tenantId]);
      await pool.end();
      expect(await ok(await new Client().get(`/public/branding?host=${host}`))).toMatchObject({ tenant_slug: a.slug, product_name: 'Acme Works', primary_color: '#0f766e' });
    }
    // Changing the domain needs a fresh proof.
    const moved = await ok(await a.client.request('PUT', '/branding', { productName: 'Acme Works', customDomain: `app.${code.toLowerCase()}.example` }));
    expect(moved.domainVerifiedAt).toBeNull();
    expect(moved.domainToken).not.toBe(saved.domainToken);
  });
});

describe('partners', () => {
  it('lets the platform keep partners and members', async () => {
    expect((await a.client.get('/admin/partners')).status).toBe(403);
    ctx.partner = await ok(await admin.post('/admin/partners', { code, name: 'Deccan ERP Consultants', kind: 'both', email: 'partners@deccan-erp.example', commissionPct: 20, certified: true }), 201);
    expect((await admin.post('/admin/partners', { code, name: 'Duplicate', kind: 'reseller', email: 'x@y.example', commissionPct: 10 })).status).toBe(409);
    expect((await admin.post(`/admin/partners/${ctx.partner.id}/members`, { email: 'nobody@nowhere.example' })).status).toBe(404);
    await ok(await admin.post(`/admin/partners/${ctx.partner.id}/members`, { email: a.email, role: 'admin' }), 201);
    expect((await b.client.get('/partner-portal')).status).toBe(403);
  });

  it('creates client workspaces from the partner portal and earns commission', async () => {
    const p = await ok(await a.client.get('/partner-portal'));
    expect(p.partners).toEqual([expect.objectContaining({ code, role: 'admin', commission_pct: 20 })]);
    const slug = `e2e-wl-client-${Date.now().toString(36)}`;
    const client = await ok(await a.client.post('/partner-portal/clients', { partnerId: ctx.partner.id, slug, workspaceName: 'Bhavani Polymers', companyName: 'Bhavani Polymers Pvt Ltd', gstin: '36AABCD1234E1Z9' }), 201);
    tenants.push(client.tenantId);
    expect((await a.client.post('/partner-portal/clients', { partnerId: ctx.partner.id, slug, workspaceName: 'Again', companyName: 'Again Ltd' })).status).toBe(409);
    expect((await b.client.post('/partner-portal/clients', { partnerId: ctx.partner.id, slug: `${slug}-x`, workspaceName: 'No', companyName: 'No Ltd' })).status).toBe(403);
    // The partner user owns the client workspace and buys a plan there.
    const c = new Client();
    await ok(await c.post('/auth/login', { email: a.email, password: a.password, tenantSlug: slug }));
    const co = await ok(await c.post('/billing/checkout', { planCode: 'growth', cycle: 'monthly' }));
    await ok(await c.post(`/billing/checkout/${co.checkoutId}/confirm-test`));
    await c.post('/auth/logout');
    expect((await ok(await a.client.get('/partner-portal'))).clients).toEqual([expect.objectContaining({ slug, name: 'Bhavani Polymers', plan_code: 'growth' })]);
    // Commission on the paid invoice, once.
    expect((await ok(await admin.post('/admin/partners/commissions/accrue'))).accrued).toBeGreaterThanOrEqual(1);
    expect((await ok(await admin.post('/admin/partners/commissions/accrue'))).accrued).toBe(0);
    let portal = await ok(await a.client.get('/partner-portal'));
    expect(portal.commissions).toEqual([expect.objectContaining({ client: 'Bhavani Polymers', rate_pct: 20, amount: 999.8, status: 'accrued' })]);
    expect(portal.totals.accrued).toBe(999.8);
    expect(await ok(await admin.post(`/admin/partners/${ctx.partner.id}/payout`, { reference: 'NEFT-2026-10-001' }))).toEqual({ paid: 1 });
    portal = await ok(await a.client.get('/partner-portal'));
    expect(portal.commissions[0]).toMatchObject({ status: 'paid', payout_ref: 'NEFT-2026-10-001' });
    const list = await ok(await admin.get('/admin/partners'));
    expect(list.find((x: any) => x.code === code)).toMatchObject({ clients: 1, members: 1, accrued: 0, paid: 999.8 });
  });

  it('lets a workspace owner name the partner by code', async () => {
    expect((await b.client.request('PUT', '/branding/partner', { code: 'NO-SUCH-CODE' })).status).toBe(404);
    expect(await ok(await b.client.request('PUT', '/branding/partner', { code }))).toMatchObject({ name: 'Deccan ERP Consultants', certified: true });
    expect(await ok(await b.client.get('/branding/partner'))).toMatchObject({ code });
    expect((await ok(await a.client.get('/partner-portal'))).clients.map((x: any) => x.slug)).toContain(b.slug);
    expect(await ok(await b.client.request('PUT', '/branding/partner', { code: null }))).toBeNull();
  });
});
