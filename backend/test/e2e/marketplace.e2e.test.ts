import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextGenClient, NextGenError } from '../../../sdk/src/index';
import { API_URL, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
async function eventually<T>(fn: () => Promise<T>, done: (v: T) => boolean, ms = 20_000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (done(v) || Date.now() - start > ms) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
}

beforeAll(async () => {
  a = await signupWorkspace('apps-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.tee = await ok(await a.client.post('/masters/items', { code: 'TEE-M', name: 'Organic tee M', type: 'finished_good', baseUomId: uom.NOS, gstRate: 5, hsnCode: '61091000' }), 201);
  ctx.cap = await ok(await a.client.post('/masters/items', { code: 'CAP-1', name: 'Cotton cap', type: 'finished_good', baseUomId: uom.NOS, gstRate: 12, hsnCode: '65050090' }), 201);
  ctx.wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'MAIN').id;
  const e = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: ctx.wh, lines: [{ itemId: ctx.tee.id, qty: '500', rate: '180' }, { itemId: ctx.cap.id, qty: '200', rate: '90' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${e.id}/submit`, { version: e.version }));
  ctx.cust = await ok(await a.client.post('/masters/parties', { name: 'Hyderabad Retail', isCustomer: true, gstin: '36AABCD1234E1Z9', addresses: [{ type: 'both', line1: 'Ameerpet', city: 'Hyderabad', stateCode: '36', pincode: '500016', isDefault: true }] }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('connectors', () => {
  it('imports marketplace orders once, and verifies Shopify pushes', async () => {
    const cat = await ok(await a.client.get('/apps'));
    expect(cat.length).toBeGreaterThanOrEqual(10);
    expect((await a.client.post('/apps', { connector: 'shopify', config: {} })).status).toBe(400);
    expect((await a.client.post('/apps', { connector: 'shopify', mode: 'live', config: { shop: 'acme.myshopify.com' } })).status).toBe(400);
    const inst = await ok(await a.client.post('/apps', { connector: 'shopify', config: { shop: 'acme.myshopify.com' } }));
    expect(inst.webhookSecret).toMatch(/^[0-9a-f]{48}$/);
    ctx.shopify = inst;
    const r1 = await ok(await a.client.post(`/apps/${inst.id}/actions/import_orders`, {}));
    expect(r1).toMatchObject({ status: 'ok', stats: { received: 2, created: 2, skipped: 0, failed: 0 } });
    const r2 = await ok(await a.client.post(`/apps/${inst.id}/actions/import_orders`, {}));
    expect(r2.stats).toMatchObject({ created: 0, skipped: 2 });
    const records = await ok(await a.client.get('/apps/records/shopify'));
    expect(records).toHaveLength(2);
    const so = await ok(await a.client.get(`/sales/orders/${records[0].entityId}`));
    expect(so.status).toBe('draft');
    // A pushed order with the right HMAC is imported; a wrong one is refused.
    const raw = JSON.stringify({ id: 99001, name: '#1099', email: 'neha@example.in', customer: { first_name: 'Neha', last_name: 'Joshi' }, line_items: [{ sku: 'CAP-1', title: 'Cotton cap', quantity: 3, price: '299.00' }] });
    const sig = createHmac('sha256', inst.webhookSecret).update(raw).digest('base64');
    const post = (s: string) => fetch(`${API_URL}${inst.webhookPath.replace('/api/v1', '')}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': s }, body: raw });
    expect((await post('bad')).status).toBe(401);
    const pushed = await post(sig);
    expect(pushed.status).toBe(200);
    expect((await pushed.json()).stats).toMatchObject({ created: 1 });
    expect((await (await post(sig)).json()).stats).toMatchObject({ skipped: 1 });
    // Unknown SKUs are reported, not imported.
    const raw2 = JSON.stringify({ id: 99002, name: '#1100', line_items: [{ sku: 'NOPE', quantity: 1, price: '10' }] });
    const res2 = await fetch(`${API_URL}${inst.webhookPath.replace('/api/v1', '')}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': createHmac('sha256', inst.webhookSecret).update(raw2).digest('base64') }, body: raw2 });
    expect(await res2.json()).toMatchObject({ status: 'failed', log: ['#1100: unknown SKU NOPE'] });
    const runs = await ok(await a.client.get(`/apps/${inst.id}/runs`));
    expect(runs.map((r: any) => r.action)).toEqual(['webhook', 'webhook', 'webhook', 'import_orders', 'import_orders']);
  });

  it('exports Tally masters, imports leads, and refuses live calls without network', async () => {
    const tally = await ok(await a.client.post('/apps', { connector: 'tally', config: { company: 'Apps Test Pvt Ltd' } }));
    expect(tally.mode).toBe('live');
    const ex = await ok(await a.client.post(`/apps/${tally.id}/actions/export_masters`, {}));
    expect(ex).toMatchObject({ status: 'ok', hasOutput: true });
    const runs = await ok(await a.client.get(`/apps/${tally.id}/runs`));
    const xml = await (await fetch(`${API_URL}/apps/runs/${runs[0].id}/output`, { headers: { authorization: `Bearer ${a.client.accessToken}` } })).text();
    expect(xml).toContain('<LEDGER NAME="Hyderabad Retail" ACTION="Create">');
    expect(xml).toContain('<STOCKITEM NAME="Organic tee M" ACTION="Create">');
    const im = await ok(await a.client.post('/apps', { connector: 'indiamart', config: { mobile: '9876543210' } }));
    expect((await ok(await a.client.post(`/apps/${im.id}/actions/import_leads`, {}))).stats).toMatchObject({ created: 2 });
    expect((await ok(await a.client.get('/apps/records/indiamart'))).length).toBe(2);
    const live = await ok(await a.client.post('/apps', { connector: 'amazon_seller', mode: 'live', config: { sellerId: 'A1B2C3' }, secrets: { refreshToken: 'Atzr|test' } }));
    expect((await ok(await a.client.post(`/apps/${live.id}/actions/import_orders`, {}))).status).toBe('failed');
  });
});

describe('automation', () => {
  it('books a shipment and notifies when a delivery note is approved', async () => {
    const sr = await ok(await a.client.post('/apps', { connector: 'shiprocket', config: { email: 'api@acme.example' } }));
    const roles = (await a.client.get('/iam/roles')).body;
    const owner = roles.find((r: any) => r.name === 'Owner');
    const auto = await ok(
      await a.client.post('/automations', {
        name: 'Ship approved deliveries',
        event: 'document.approved',
        conditions: [{ field: 'docType', op: 'eq', value: 'delivery_note' }],
        actions: [
          { type: 'connector', connector: 'shiprocket', action: 'create_shipment' },
          { type: 'notify', roleIds: [owner.id], title: 'Shipment booked for {{number}}', body: 'Delivery {{number}} was handed to the courier.' },
        ],
      }),
      201,
    );
    const test = await ok(await a.client.post(`/automations/${auto.id}/test`, { payload: { docType: 'delivery_note', number: 'DN/1' } }));
    expect(test).toMatchObject({ matches: true, actions: [{ type: 'connector' }, { type: 'notify', title: 'Shipment booked for DN/1' }] });
    expect((await ok(await a.client.post(`/automations/${auto.id}/test`, { payload: { docType: 'sales_order' } }))).matches).toBe(false);
    const so = await ok(await a.client.post('/sales/orders', { customerId: ctx.cust.id, lines: [{ itemId: ctx.tee.id, qty: '20', rate: '450' }] }), 201);
    const sos = await ok(await a.client.post(`/sales/orders/${so.id}/submit`, { version: so.version }));
    const dlv = await ok(await a.client.post('/sales/deliveries', { orderId: so.id, warehouseId: ctx.wh, lines: [{ soLineId: sos.lines[0].id, qty: '20' }] }), 201);
    await ok(await a.client.post(`/sales/deliveries/${dlv.id}/submit`, { version: dlv.version }));
    const runs = await eventually(() => a.client.get(`/automations/${auto.id}/runs`).then((r) => r.body), (r: any[]) => r.some((x) => x.status !== 'queued'));
    const run = runs.find((x: any) => x.payload.docType === 'delivery_note');
    expect(run).toMatchObject({ status: 'ok', results: [{ action: 'connector', ok: true }, { action: 'notify', ok: true, detail: 'Notified 1 user(s)' }] });
    const d = await ok(await a.client.get(`/sales/deliveries/${dlv.id}`));
    expect(d.lrNo).toMatch(/^SR\d{10}$/);
    expect((await ok(await a.client.get(`/apps/${sr.id}/runs`)))[0]).toMatchObject({ action: 'create_shipment', status: 'ok' });
  });
});

describe('public SDK', () => {
  it('lists, paginates and creates through an API key', async () => {
    const co = await ok(await a.client.post('/billing/checkout', { planCode: 'growth', cycle: 'monthly' }));
    await ok(await a.client.post(`/billing/checkout/${co.checkoutId}/confirm-test`));
    const key = await ok(await a.client.post('/platform/api-keys', { name: 'SDK test', scopes: ['masters.items.read', 'sales.orders.read', 'sales.orders.manage'] }), 201);
    const erp = new NextGenClient({ apiKey: key.key, baseUrl: API_URL });
    const codes: string[] = [];
    for await (const i of erp.paginate(erp.items.list, { limit: 1 })) codes.push(i.code);
    expect(codes.sort()).toEqual(['CAP-1', 'TEE-M']);
    const created = await erp.salesOrders.create({ customerId: ctx.cust.id, customerPoNo: 'SDK-1', lines: [{ itemId: ctx.cap.id, qty: 5, rate: 250 }] });
    expect(created.status).toBe('draft');
    expect((await erp.salesOrders.get(created.id)).lines).toHaveLength(1);
    await expect(erp.parties.list()).rejects.toBeInstanceOf(NextGenError);
    await expect(erp.parties.list()).rejects.toMatchObject({ status: 403 });
  });
});
