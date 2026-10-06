import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { timeStep, totpAt } from '../../src/common/totp';
import { addMember, Client, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace; // will buy Growth
let b: Workspace; // trial → expired / suspended by platform admin
const admin = new Client(); // platform super-admin (demo admin, see PLATFORM_ADMIN_EMAILS)
const emails: string[] = [];
const PR = '/purchase/requisitions';
const line = { description: 'Bearing 6205', uom: 'NOS', quantity: '10', estimatedRate: '145' };

// ---- local webhook receiver ----
let server: Server;
let receiverUrl = '';
const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
let failNext = false;

async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() - start > ms) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      if (failNext) {
        failNext = false;
        res.writeHead(500).end('boom');
      } else res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  receiverUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/hooks`;

  a = await signupWorkspace('saas-a');
  b = await signupWorkspace('saas-b');
  emails.push(a.email, b.email);

  const env = readFileSync(join(__dirname, '..', '..', '..', 'database', '.env'), 'utf8');
  const pw = process.env.SEED_ADMIN_PASSWORD ?? env.match(/^SEED_ADMIN_PASSWORD=(.*)$/m)?.[1];
  await admin.post('/auth/login', { email: 'admin@demo.local', password: pw, tenantSlug: 'demo' });
});

afterAll(async () => {
  server?.close();
  await admin.post('/auth/logout'); // don't leave test sessions on the demo admin
  await cleanupTenants([a?.tenantId, b?.tenantId].filter(Boolean), emails);
});

describe('plans & billing', () => {
  it('lists purchasable plans with GST-inclusive prices', async () => {
    const plans = (await a.client.get('/billing/plans')).body;
    expect(plans.map((p: any) => p.code)).toEqual(['starter', 'growth', 'enterprise']);
    const growth = plans.find((p: any) => p.code === 'growth');
    expect(growth).toMatchObject({ priceMonthly: 4999, priceMonthlyWithGst: '5898.82', gstRatePercent: 18 });
  });

  it('starts on a trial with every feature', async () => {
    const s = (await a.client.get('/billing/summary')).body;
    expect(s.entitlements).toMatchObject({ planCode: 'trial', state: 'trialing', readOnly: false });
    expect(s.entitlements.features).toContain('api_access');
    expect(s.usage.users).toBe(1);
    expect(s.provider).toBe('mock');
  });

  it('upgrades through the test checkout and issues a GST invoice', async () => {
    const co = await a.client.post('/billing/checkout', { planCode: 'growth', cycle: 'monthly' });
    expect(co.status).toBe(200);
    expect(co.body.checkoutId).toMatch(/^mock_/);
    const done = await a.client.post(`/billing/checkout/${co.body.checkoutId}/confirm-test`);
    expect(done.body.status).toBe('active');
    expect(done.body.invoiceNumber).toMatch(/^NGE\/\d{2}-\d{2}\/\d{6}$/);

    const me = (await a.client.get('/auth/me')).body;
    expect(me.plan).toMatchObject({ code: 'growth', state: 'active', readOnly: false });

    const invoices = (await a.client.get('/billing/invoices')).body;
    expect(invoices[0]).toMatchObject({ number: done.body.invoiceNumber, total: '5898.82' });
    const printed = (await a.client.get(`/billing/invoices/${invoices[0].id}/print`)).body.html as string;
    expect(printed).toContain('IGST @ 18%'); // buyer has no state code → inter-state
    expect(printed).toContain('₹899.82');
    expect(printed).toContain('998314');
    // Confirming the same checkout twice is impossible
    expect((await a.client.post(`/billing/checkout/${co.body.checkoutId}/confirm-test`)).status).toBe(404);
  });

  it('cancels at period end and can resume', async () => {
    const c = await a.client.post('/billing/cancel');
    expect(c.body.status).toBe('cancelled');
    expect((await a.client.get('/auth/me')).body.plan).toMatchObject({ state: 'cancelled', readOnly: false });
    expect((await a.client.post('/billing/resume')).body.status).toBe('active');
  });

  it('refuses downgrades that would exceed the target plan', async () => {
    await a.client.post('/platform/api-keys', { name: 'ERP sync', scopes: ['purchase.requisitions.read'] });
    const res = await a.client.post('/billing/checkout', { planCode: 'starter', cycle: 'monthly' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toContain('apiKeys');
  });

  it('only billing managers see billing', async () => {
    const roles = (await a.client.get('/iam/roles')).body;
    const adminRole = roles.find((r: any) => r.name === 'Administrator');
    const m = await addMember(a.client, 'saas-administrator', [adminRole.id]);
    emails.push(m.email);
    expect((await m.client.get('/billing/summary')).status).toBe(403);
  });
});

describe('platform admin console', () => {
  it('is restricted to platform administrators', async () => {
    expect((await a.client.get('/admin/tenants')).status).toBe(403);
    const res = await admin.get('/admin/tenants');
    expect(res.status).toBe(200);
    expect(res.body.tenants.map((t: any) => t.slug)).toEqual(expect.arrayContaining([a.slug, b.slug]));
    expect(res.body.stats.paying).toBeGreaterThanOrEqual(1);
  });

  it('requires a reason and records changes in the workspace audit trail', async () => {
    expect((await admin.patch(`/admin/tenants/${b.tenantId}`, { planCode: 'starter' })).status).toBe(400);
    const ok = await admin.patch(`/admin/tenants/${b.tenantId}`, { planCode: 'starter', reason: 'Sales-assisted downgrade' });
    expect(ok.status).toBe(200);
    const audit = (await b.client.get('/platform/audit-logs?entityType=tenant')).body.items;
    expect(audit[0]).toMatchObject({ action: 'platform_admin.tenant.updated' });
  });

  it('plan features are enforced (Starter has no custom fields or API keys)', async () => {
    const cf = await b.client.post('/platform/custom-fields', { entity: 'purchase_requisition', label: 'Cost centre', type: 'text' });
    expect(cf.status).toBe(402);
    expect(cf.body.detail).toContain('Custom fields');
    expect((await b.client.post('/platform/api-keys', { name: 'Starter key', scopes: ['purchase.requisitions.read'] })).status).toBe(402);
    const twoLevels = await b.client.post('/platform/approval-rules', {
      docType: 'purchase_requisition',
      name: 'Two levels',
      steps: [
        { name: 'L1', approverRoleId: (await b.client.get('/iam/roles')).body[0].id },
        { name: 'L2', approverRoleId: (await b.client.get('/iam/roles')).body[1].id },
      ],
    });
    expect(twoLevels.status, JSON.stringify(twoLevels.body)).toBe(402);
  });

  it('an expired trial makes the workspace read-only but billing still works', async () => {
    await admin.patch(`/admin/tenants/${b.tenantId}`, { planCode: 'trial', trialEndsAt: new Date(Date.now() - 86_400_000).toISOString(), reason: 'Simulate trial expiry' });
    expect((await b.client.get('/auth/me')).body.plan).toMatchObject({ state: 'expired', readOnly: true });
    const write = await b.client.post(PR, { lines: [line] });
    expect(write.status).toBe(402);
    expect((await b.client.get(PR)).status).toBe(200);
    expect((await b.client.post('/billing/checkout', { planCode: 'starter', cycle: 'monthly' })).status).toBe(200);
    expect((await b.client.post('/notifications/read-all')).status).toBe(200);
  });

  it('suspending a workspace blocks writes with a clear message', async () => {
    await admin.patch(`/admin/tenants/${b.tenantId}`, { status: 'suspended', reason: 'Payment dispute' });
    const res = await b.client.post(PR, { lines: [line] });
    expect(res.status).toBe(402);
    expect(res.body.detail).toContain('suspended');
    await admin.patch(`/admin/tenants/${b.tenantId}`, { status: 'trial', trialEndsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), reason: 'Restored' });
    expect((await b.client.post(PR, { lines: [line] })).status).toBe(201);
  });
});

describe('two-step verification (TOTP)', () => {
  let secret = '';
  let recovery: string[] = [];

  it('enrols with an authenticator code and returns recovery codes once', async () => {
    const setup = await a.client.post('/account/mfa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');
    secret = setup.body.secret.replace(/\s/g, '');
    expect((await a.client.post('/account/mfa/enable', { code: '000000' })).status).toBe(400);
    const en = await a.client.post('/account/mfa/enable', { code: totpAt(secret, timeStep()) });
    expect(en.status).toBe(200);
    recovery = en.body.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await a.client.get('/account/mfa')).body).toEqual({ enabled: true, recoveryCodesRemaining: 10 });
  });

  it('asks for a code at sign-in and accepts a fresh TOTP', async () => {
    const c = new Client();
    const step1 = await c.post('/auth/login', { email: a.email, password: a.password });
    expect(step1.status).toBe(200);
    expect(step1.body.mfaRequired).toBe(true);
    expect(c.accessToken).toBeNull();
    expect((await c.post('/auth/mfa/verify', { mfaToken: step1.body.mfaToken, code: '123456' })).status).toBe(401);
    // Next time-step: the enrolment code (current step) can't be replayed.
    const code = totpAt(secret, timeStep() + 1);
    const ok = await c.post('/auth/mfa/verify', { mfaToken: step1.body.mfaToken, code });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    const replay = await new Client().post('/auth/mfa/verify', { mfaToken: step1.body.mfaToken, code });
    expect(replay.status).toBe(401);
  });

  it('accepts a recovery code exactly once', async () => {
    const step1 = (await new Client().post('/auth/login', { email: a.email, password: a.password })).body;
    const ok = await new Client().post('/auth/mfa/verify', { mfaToken: step1.mfaToken, code: recovery[0] });
    expect(ok.status).toBe(200);
    const again = (await new Client().post('/auth/login', { email: a.email, password: a.password })).body;
    expect((await new Client().post('/auth/mfa/verify', { mfaToken: again.mfaToken, code: recovery[0] })).status).toBe(401);
    expect((await a.client.get('/account/mfa')).body.recoveryCodesRemaining).toBe(9);
  });

  it('turning it off requires the password', async () => {
    expect((await a.client.post('/account/mfa/disable', { password: 'wrong-password' })).status).toBe(400);
    expect((await a.client.post('/account/mfa/disable', { password: a.password })).body.enabled).toBe(false);
  });
});

describe('API keys', () => {
  let key = '';
  let keyId = '';

  it('shows the key once and stores only a prefix', async () => {
    const res = await a.client.post('/platform/api-keys', { name: 'Tally connector', scopes: ['purchase.requisitions.read'] });
    expect(res.status).toBe(201);
    key = res.body.key;
    keyId = res.body.id;
    expect(key).toMatch(/^ngk_[0-9a-f]{12}_[A-Za-z0-9_-]{32}$/);
    const list = (await a.client.get('/platform/api-keys')).body;
    expect(JSON.stringify(list)).not.toContain(key.split('_')[2]);
  });

  it('works for its scopes only, and never for account endpoints', async () => {
    const call = (path: string, method = 'GET', body?: unknown) =>
      fetch(`http://localhost:4000/api/v1${path}`, { method, headers: { 'x-api-key': key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    expect((await call(PR)).status).toBe(200);
    expect((await call(PR, 'POST', { lines: [line] })).status).toBe(403);
    expect((await call('/account/sessions')).status).toBe(403);
    expect((await call('/auth/me')).status).toBe(403);
    const bearer = await fetch(`http://localhost:4000/api/v1${PR}`, { headers: { authorization: `Bearer ${key}` } });
    expect(bearer.status).toBe(200);
    expect((await fetch(`http://localhost:4000/api/v1${PR}`, { headers: { 'x-api-key': `${key.slice(0, -1)}x` } })).status).toBe(401);
  });

  it('stops working immediately when revoked', async () => {
    expect((await a.client.delete(`/platform/api-keys/${keyId}`)).status).toBe(204);
    expect((await fetch(`http://localhost:4000/api/v1${PR}`, { headers: { 'x-api-key': key } })).status).toBe(401);
  });
});

describe('webhooks', () => {
  let secret = '';
  let endpointId = '';

  it('creates a signed endpoint and delivers document events', async () => {
    const res = await a.client.post('/platform/webhooks', { url: receiverUrl, events: ['document.submitted', 'document.approved'] });
    expect(res.status).toBe(201);
    secret = res.body.secret;
    endpointId = res.body.id;
    expect(secret).toMatch(/^whsec_/);

    const d = (await a.client.post(PR, { purpose: 'Webhook test', lines: [line] })).body;
    const sub = (await a.client.post(`${PR}/${d.id}/submit`, { version: d.version })).body;
    const got = await eventually(async () => received, (r) => r.filter((x) => x.headers['x-nextgen-event']?.toString().startsWith('document.')).length >= 2);
    const submitted = got.find((x) => x.headers['x-nextgen-event'] === 'document.submitted')!;
    const payload = JSON.parse(submitted.body);
    expect(payload.data).toMatchObject({ id: sub.id, number: sub.number, docType: 'purchase_requisition' });
    expect(payload.workspace).toBe(a.slug);

    // Verify the signature exactly as a receiver would.
    const [t, v1] = String(submitted.headers['x-nextgen-signature']).split(',').map((p) => p.split('=')[1]);
    expect(createHmac('sha256', secret).update(`${t}.${submitted.body}`).digest('hex')).toBe(v1);
  });

  it('logs failures (and retries them via the job queue)', async () => {
    failNext = true;
    await a.client.post(`/platform/webhooks/${endpointId}/test`);
    const log = await eventually(
      () => a.client.get(`/platform/webhooks/${endpointId}/deliveries`),
      (r) => r.body.some((x: any) => x.event === 'ping' && x.status === 'failed'),
    );
    const failed = log.body.find((x: any) => x.event === 'ping' && x.status === 'failed');
    expect(failed).toMatchObject({ responseStatus: 500, error: 'Endpoint responded 500' });
    await a.client.post(`/platform/webhooks/deliveries/${failed.id}/redeliver`);
    const after = await eventually(
      () => a.client.get(`/platform/webhooks/${endpointId}/deliveries`),
      (r) => r.body.find((x: any) => x.id === failed.id)?.status === 'succeeded',
    );
    expect(after.body.find((x: any) => x.id === failed.id).status).toBe('succeeded');
  });

  it('rejects non-URLs and unknown events', async () => {
    expect((await a.client.post('/platform/webhooks', { url: 'not a url', events: ['*'] })).status).toBe(400);
    expect((await a.client.post('/platform/webhooks', { url: receiverUrl, events: ['secret.stolen'] })).status).toBe(400);
  });
});

describe('DPDP: data export and requests', () => {
  it('exports the caller’s personal data', async () => {
    const res = await a.client.get('/account/data-export');
    expect(res.status).toBe(200);
    expect(res.body.profile.email).toBe(a.email);
    expect(res.body.workspaces.map((w: any) => w.slug)).toContain(a.slug);
    expect(res.body.activity.length).toBeGreaterThan(0);
  });

  it('tracks an erasure request to resolution and informs the requester', async () => {
    const roles = (await a.client.get('/iam/roles')).body;
    const m = await addMember(a.client, 'saas-dpdp', [roles.find((r: any) => r.name === 'Viewer').id]);
    emails.push(m.email);
    const req = await m.client.post('/account/data-requests', { type: 'erasure', details: 'Please delete my personal details after I leave.' });
    expect(req.status).toBe(201);
    expect((await m.client.get('/platform/data-requests')).status).toBe(403);
    const open = (await a.client.get('/platform/data-requests')).body;
    expect(open[0].request).toMatchObject({ type: 'erasure', status: 'open' });
    const done = await a.client.patch(`/platform/data-requests/${req.body.id}`, { status: 'completed', resolution: 'Profile anonymised on exit.' });
    expect(done.body.status).toBe('completed');
    const n = (await m.client.get('/notifications')).body.items;
    expect(n.some((x: any) => x.event === 'privacy.request_resolved')).toBe(true);
  });
});
