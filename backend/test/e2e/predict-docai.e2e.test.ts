import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const VENDOR_GSTIN = '36AABCD1234E1Z9';

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
async function submit(path: string, doc: any) {
  return ok(await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version }));
}
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const lastMonth = () => {
  const t = today();
  return new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 2, 10)).toISOString().slice(0, 10);
};

beforeAll(async () => {
  a = await signupWorkspace('pred-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id])).MAIN;
  ctx.granules = await ok(await a.client.post('/masters/items', { name: 'HDPE Granules Natural', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '390120' }), 201);
  ctx.fan = await ok(await a.client.post('/masters/items', { name: 'Ceiling fan', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '84145120', sellingRate: '2500' }), 201);
  const addr = [{ type: 'both', line1: 'IDA Jeedimetla', city: 'Hyderabad', stateCode: '36', pincode: '500055', isDefault: true }];
  ctx.vendor = await ok(await a.client.post('/masters/parties', { name: 'Sharma Polymers', isVendor: true, gstin: VENDOR_GSTIN, addresses: addr }), 201);
  ctx.cust = await ok(await a.client.post('/masters/parties', { name: 'Deccan Traders', isCustomer: true, gstin: '27AAACN0000A1ZL', addresses: [{ ...addr[0], stateCode: '27', city: 'Pune', pincode: '411001' }] }), 201);
  const e = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', docDate: `${lastMonth().slice(0, 8)}01`, toWarehouseId: ctx.wh, lines: [{ itemId: ctx.fan.id, qty: '100', rate: '1500' }] }), 201);
  await submit('/inventory/stock-entries', e);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('why-analysis and predictions', () => {
  it('explains a margin drop from a price cut', async () => {
    await submit('/sales/invoices', await ok(await a.client.post('/sales/invoices', { customerId: ctx.cust.id, warehouseId: ctx.wh, docDate: lastMonth(), lines: [{ itemId: ctx.fan.id, qty: '10', rate: '2500' }] }), 201));
    await submit('/sales/invoices', await ok(await a.client.post('/sales/invoices', { customerId: ctx.cust.id, warehouseId: ctx.wh, creditDays: 30, lines: [{ itemId: ctx.fan.id, qty: '10', rate: '2000' }] }), 201));
    const r = await ok(await a.client.post('/insights/why', { question: 'why did margin drop this month?' }));
    expect(r.metric).toBe('margin');
    expect(r.bridge).toMatchObject({ previousPct: 40, currentPct: 25, changePts: -15, effects: { price: -15, cost: 0, mix: 0 } });
    expect(r.answer).toMatch(/^Gross margin fell from 40 % in .+ to 25 % in .+ \(-15 pts\)\. Drivers: selling prices -15 pts \(mostly .+ sold -20 %\)\.$/);
    const s = await ok(await a.client.post('/insights/why', { question: 'why are sales down this month' }));
    expect(s.sales).toMatchObject({ before: 25000, now: 20000, price: -5000, volume: 0 });
  });

  it('forecasts collections by week', async () => {
    const c = await ok(await a.client.get('/insights/collections?weeks=8'));
    expect(c.total).toBe(53100);
    expect(c.buckets).toHaveLength(8);
    expect(c.rows.map((r: any) => r.basis)).toEqual(['overall', 'overall']);
  });

  it('forecasts purchase prices from order history', async () => {
    await submit('/purchase/orders', await ok(await a.client.post('/purchase/orders', { vendorId: ctx.vendor.id, docDate: lastMonth(), lines: [{ itemId: ctx.granules.id, qty: '500', rate: '120' }] }), 201));
    await submit('/purchase/orders', await ok(await a.client.post('/purchase/orders', { vendorId: ctx.vendor.id, lines: [{ itemId: ctx.granules.id, qty: '500', rate: '132' }] }), 201));
    const [p] = await ok(await a.client.get(`/insights/prices?itemId=${ctx.granules.id}`));
    expect(p).toMatchObject({ code: ctx.granules.code, lastRate: 132 });
    expect(p.history).toHaveLength(2);
    expect(p.forecast).toHaveLength(3);
  });
});

describe('document AI', () => {
  it('reads a vendor quotation, matches vendor and item, and updates the vendor price', async () => {
    const text = `SHARMA POLYMERS PVT LTD
GSTIN: ${VENDOR_GSTIN}
QUOTATION
Quotation No: Q-77   Date: 03-Oct-2026   Validity: 30 days
Sr Description HSN Qty Unit Rate Amount
1 HDPE Granules Natural 390120 1000 KGS 118.50 1,18,500.00
Delivery within 7 days. Payment: 30 days from invoice`;
    const c = await ok(await a.client.post('/docai/read-text', { text }), 201);
    expect(c).toMatchObject({ kind: 'quotation', source: 'text', status: 'review' });
    expect(c.fields).toMatchObject({ quoteNo: 'Q-77', vendorGstin: VENDOR_GSTIN, validDays: 30, deliveryDays: 7 });
    expect(c.matches.vendorParty).toMatchObject({ id: ctx.vendor.id });
    expect(c.matches.items[0]).toMatchObject({ id: ctx.granules.id });
    const applied = await ok(await a.client.post(`/docai/captures/${c.id}/apply`));
    expect(applied.updated).toEqual([{ item: ctx.granules.code, rate: 118.5 }]);
    expect((await a.client.post(`/docai/captures/${c.id}/apply`)).status).toBe(409);
  });

  it('checks an e-way bill against the invoice it names', async () => {
    const inv = (await ok(await a.client.get('/sales/invoices?limit=5'))).items[0];
    const text = `e-Way Bill
E-Way Bill No: 3412 5678 9012
Generated Date: ${today().split('-').reverse().join('/')}  Valid Upto: ${today().split('-').reverse().join('/')}
GSTIN of Supplier ${VENDOR_GSTIN}  GSTIN of Recipient 27AAACN0000A1ZL
Document No. ${inv.number}  Document Date ${today().split('-').reverse().join('/')}
Vehicle No: TS 08 UB 4455
Total Invoice Value: 99,999.00`;
    const c = await ok(await a.client.post('/docai/read-text', { text }), 201);
    expect(c.kind).toBe('eway_bill');
    expect(c.matches.documentDocument).toMatchObject({ id: inv.id });
    expect(c.warnings.join(' ')).toMatch(/Value differs from the invoice total/);
    expect((await a.client.post(`/docai/captures/${c.id}/apply`)).status).toBe(400);
    await ok(await a.client.post(`/docai/captures/${c.id}/discard`));
    expect((await ok(await a.client.get('/docai/captures?status=discarded'))).map((x: any) => x.id)).toContain(c.id);
  });

  it('asks for AI on a scan when no key is set', async () => {
    const r = await a.client.upload('/docai/read-file', 'challan.png', new Uint8Array([137, 80, 78, 71]), 'image/png');
    expect(r.status).toBe(422);
  });
});
