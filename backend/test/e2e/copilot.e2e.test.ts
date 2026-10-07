import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

const OUR_GSTIN = '36AABCS1234E1ZU'; // made up, valid check digit
const VENDOR_GSTIN = '36AABCD1234E1Z9'; // made up

let a: Workspace;
let stores: Awaited<ReturnType<typeof addMember>>;
const emails: string[] = [];
const item: Record<string, any> = {};
const ctx: Record<string, any> = {};

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const ask = async (client: Workspace['client'], content: string, language = 'auto') => ok(await client.post('/copilot/chat', { messages: [{ role: 'user', content }], language }));

beforeAll(async () => {
  a = await signupWorkspace('cop-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  const wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.bolt = await ok(await a.client.post('/masters/items', { name: 'Hex bolt', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73181500', standardCost: '2.5' }), 201);
  item.nut = await ok(await a.client.post('/masters/items', { name: 'Hex nut', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73181600', standardCost: '1' }), 201);
  item.bracket = await ok(await a.client.post('/masters/items', { name: 'Mounting bracket', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73269099' }), 201);
  const e = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.bolt.id, qty: '400', rate: '2.5' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${e.id}/submit`, { version: e.version }));
  ctx.vendor = await ok(await a.client.post('/masters/parties', { name: 'Deccan Steels', isVendor: true, gstin: VENDOR_GSTIN, addresses: [{ type: 'both', line1: 'Road 3', city: 'Hyderabad', stateCode: '36', pincode: '500037', isDefault: true }] }), 201);
  const po = await ok(await a.client.post('/purchase/orders', { vendorId: ctx.vendor.id, lines: [{ itemId: item.nut.id, qty: '50', rate: '1' }] }), 201);
  ctx.po = await ok(await a.client.post(`/purchase/orders/${po.id}/submit`, { version: po.version }));
  const wc = await ok(await a.client.post('/manufacturing/work-centers', { code: 'ASSY', name: 'Assembly', labourRate: '60' }), 201);
  const bom = await ok(await a.client.post('/manufacturing/boms', { itemId: item.bracket.id, lines: [{ itemId: item.bolt.id, qty: '2' }, { itemId: item.nut.id, qty: '2' }], operations: [{ seq: 10, name: 'Fit', workCenterId: wc.id, runMinutes: '1' }] }), 201);
  await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: bom.version }));
  const wo = await ok(await a.client.post('/manufacturing/work-orders', { itemId: item.bracket.id, qty: '300', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN }), 201);
  ctx.wo = await ok(await a.client.post(`/manufacturing/work-orders/${wo.id}/submit`, { version: wo.version, force: true }));
  const role = await ok(await a.client.post('/iam/roles', { name: 'Storekeeper', permissions: ['inventory.stock.read', 'masters.items.read'] }), 201);
  stores = await addMember(a.client, 'cop-stores', [role.id]);
  emails.push(stores.email);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('copilot without an AI key', () => {
  it('reports its mode and offers help for questions it cannot route', async () => {
    expect(await ok(await a.client.get('/copilot/status'))).toEqual({ mode: 'basic' });
    const r = await ask(a.client, 'tell me a joke');
    expect(r).toMatchObject({ mode: 'basic', actions: [{ kind: 'navigate', href: '/reports' }] });
    expect(r.reply).toMatch(/sales this month/);
  });

  it('answers stock questions in English and Hindi', async () => {
    const en = await ask(a.client, 'stock of hex bolt');
    expect(en.reply).toBe('In stock at 1 place, worth ₹1,000.');
    expect(en.blocks[0]).toMatchObject({ kind: 'table', rows: [{ itemCode: item.bolt.code, qty: '400.0000' }] });
    const hi = await ask(a.client, 'hex bolt का स्टॉक कितना है?');
    expect(hi.reply).toBe('1 जगह स्टॉक है, कुल मूल्य ₹1,000।');
  });

  it('finds documents by number and explains why a work order is stuck', async () => {
    const open = await ask(a.client, `open ${ctx.po.number}`);
    expect(open.actions[0]).toMatchObject({ kind: 'navigate', href: `/purchase/orders/${ctx.po.id}` });
    const why = await ask(a.client, `why is ${ctx.wo.number} stuck?`);
    expect(why.blocks[0]).toMatchObject({ kind: 'facts', href: `/manufacturing/work-orders/${ctx.wo.id}` });
    expect(why.reply).toMatch(/Materials: Short of .*\d+ NOS/);
    expect(why.reply).toContain(item.nut.code);
  });

  it('prepares a draft the user creates with the normal endpoint', async () => {
    const r = await ask(a.client, 'draft purchase order from Deccan Steels: 100 hex bolt, 50 hex nut by 2026-12-01');
    const d = r.actions.find((x: any) => x.kind === 'draft');
    expect(d).toMatchObject({ docType: 'purchase_order', endpoint: '/purchase/orders', body: { vendorId: ctx.vendor.id, expectedDate: '2026-12-01' } });
    expect(d.summary).toEqual(['Vendor: Deccan Steels', `${item.bolt.code} Hex bolt × 100 NOS @ ₹2.5 (standard cost)`, `${item.nut.code} Hex nut × 50 NOS @ ₹1 (standard cost)`, 'Date: 2026-12-01']);
    expect(r.reply).toMatch(/Nothing is saved until you press the button/);
    // Nothing was created by the copilot itself.
    expect((await ok(await a.client.get('/purchase/orders'))).items).toHaveLength(1);
    const created = await ok(await a.client.post(d.endpoint, d.body), 201);
    expect(created).toMatchObject({ status: 'draft', lines: [{ qty: '100.0000' }, { qty: '50.0000' }] });
  });

  it('says what it could not match, and respects permissions', async () => {
    expect((await ask(a.client, 'create sales order for Nobody Ltd: 5 hex bolt')).reply).toMatch(/No customer matches "Nobody Ltd"/);
    expect((await ask(a.client, 'create work order: 5 unobtainium')).reply).toMatch(/No item matches "unobtainium"/);
    expect((await ask(stores.client, 'sales this month')).reply).toMatch(/do not have access/);
    expect((await ask(stores.client, 'draft purchase order from Deccan Steels: 1 hex bolt')).reply).toMatch(/do not have permission/);
    expect((await ask(stores.client, 'stock of hex bolt')).reply).toMatch(/worth ₹1,000/);
    expect((await ask(stores.client, `open ${ctx.po.number}`)).actions).toEqual([]);
  });
});
