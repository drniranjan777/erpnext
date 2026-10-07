import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_URL, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const M = today().slice(0, 7);
const lastDay = (() => {
  const d = new Date(`${M}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
})();

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const addr = (stateCode: string, city: string, pincode: string) => [{ type: 'both', line1: 'Plot 4, Industrial Area', city, stateCode, pincode, isDefault: true }];

const BOX = { length: 300, width: 200, height: 150, ply: 3, linerGsm: [150, 120], fluteGsm: [120], flutes: ['B'], paperRate: 40, conversionRate: 10, printColours: 1, printRatePerColour: 0.5, wastagePct: 5, marginPct: 20, qty: 1000 };

beforeAll(async () => {
  a = await signupWorkspace('cpq-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  const wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  ctx.box = await ok(await a.client.post('/masters/items', { name: 'Corrugated box (made to order)', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '48191010' }), 201);
  ctx.pump = await ok(await a.client.post('/masters/items', { name: 'Monoblock pump', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '84137010', sellingRate: '25000' }), 201);
  ctx.bracket = await ok(await a.client.post('/masters/items', { name: 'Seat bracket', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '87089900', sellingRate: '120' }), 201);
  ctx.cust = await ok(await a.client.post('/masters/parties', { name: 'Deccan Motors', isCustomer: true, gstin: '36AABCD1234E1Z9', addresses: addr('36', 'Hyderabad', '500032') }), 201);
  const entry = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: ctx.bracket.id, qty: '500', rate: '80' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${entry.id}/submit`, { version: entry.version }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('estimates', () => {
  it('previews and saves a box estimate, then quotes it with the default template', async () => {
    const preview = await ok(await a.client.post('/cpq/calculate/box', BOX));
    expect(preview.facts).toMatchObject({ blank: '1035 × 356 mm', boardGsm: 432 });
    expect((await a.client.post('/cpq/calculate/box', { ...BOX, ply: 5 })).status).toBe(400);
    await ok(await a.client.post('/cpq/templates', { name: 'Standard', terms: 'Prices ex-works Hyderabad. GST extra. Payment 30 days.', validityDays: 15, isDefault: true }), 201);
    const est = await ok(await a.client.post('/cpq/estimates', { kind: 'box', title: 'RSC box 300×200×150, 3-ply', partyId: ctx.cust.id, inputs: BOX }), 201);
    expect(est).toMatchObject({ number: 'EST00001', unitPrice: preview.unitPrice.toFixed(2), status: 'draft' });
    expect((await a.client.post(`/cpq/estimates/${est.id}/quote`, {})).status).toBe(400);
    const r = await ok(await a.client.post(`/cpq/estimates/${est.id}/quote`, { itemId: ctx.box.id }));
    const q = await ok(await a.client.get(`/sales/quotations/${r.quotationId}`));
    expect(q).toMatchObject({ customerEnquiryRef: 'EST00001', validUntil: addDays(today(), 15), terms: 'Prices ex-works Hyderabad. GST extra. Payment 30 days.' });
    expect(q.lines[0]).toMatchObject({ qty: '1000.0000' });
    expect(Number(q.lines[0].rate)).toBe(preview.unitPrice);
    expect(q.lines[0].description).toContain('RSC box 300×200×150');
    expect((await a.client.post(`/cpq/estimates/${est.id}/quote`, { itemId: ctx.box.id })).status).toBe(409);
  });
});

describe('configurator', () => {
  it('applies option rules and quotes a valid configuration', async () => {
    await ok(await a.client.post(`/cpq/items/${ctx.pump.id}/options`, { code: 'mot', name: 'motor', required: true, sequence: 1, options: [{ code: '1HP', label: '1 HP', priceDelta: 0 }, { code: '2HP', label: '2 HP', priceDelta: 4500, requires: ['PNL.STAR'] }] }));
    await ok(await a.client.post(`/cpq/items/${ctx.pump.id}/options`, { code: 'PNL', name: 'panel', sequence: 2, options: [{ code: 'DOL', label: 'DOL starter', priceDelta: 1200, excludes: ['PNL.STAR'] }, { code: 'STAR', label: 'Star-delta starter', priceDelta: 3800 }] }));
    const bad = await ok(await a.client.post('/cpq/configure', { itemId: ctx.pump.id, chosen: ['MOT.2HP'] }));
    expect(bad).toMatchObject({ ok: false, errors: ['2 HP needs Star-delta starter'] });
    const good = await ok(await a.client.post('/cpq/configure', { itemId: ctx.pump.id, chosen: ['MOT.2HP', 'PNL.STAR'], qty: 2 }));
    expect(good).toMatchObject({ ok: true, unitPrice: 33300, total: 66600 });
    expect((await a.client.post('/cpq/configure/quote', { itemId: ctx.pump.id, chosen: ['PNL.DOL'], partyId: ctx.cust.id })).status).toBe(400);
    const r = await ok(await a.client.post('/cpq/configure/quote', { itemId: ctx.pump.id, chosen: ['MOT.2HP', 'PNL.STAR'], qty: 2, partyId: ctx.cust.id }));
    const q = await ok(await a.client.get(`/sales/quotations/${r.quotationId}`));
    expect(q.lines[0]).toMatchObject({ rate: '33300.0000' });
    expect(q.lines[0].description).toBe('Monoblock pump: motor: 2 HP; panel: Star-delta starter');
  });
});

describe('customer schedules', () => {
  it('keeps revisions and imports schedule files', async () => {
    const s0 = await ok(await a.client.post('/sales/schedules', { customerId: ctx.cust.id, itemId: ctx.bracket.id, customerPartNo: 'DM-SB-101', month: M, lines: [{ date: `${M}-01`, qty: 50 }] }), 201);
    expect(s0.revision).toBe(0);
    expect((await a.client.post('/sales/schedules', { customerId: ctx.cust.id, itemId: ctx.bracket.id, month: M, lines: [{ date: addDays(lastDay, 1), qty: 5 }] })).status).toBe(400);
    // Revision 1: 10 on the 1st, 10 today, 30 on the last day.
    const s1 = await ok(await a.client.post('/sales/schedules', { customerId: ctx.cust.id, itemId: ctx.bracket.id, month: M, lines: [{ date: `${M}-01`, qty: 10 }, { date: today(), qty: 10 }, { date: lastDay, qty: 30 }] }), 201);
    expect(s1).toMatchObject({ number: s0.number, revision: 1, customerPartNo: 'DM-SB-101' });
    const list = await ok(await a.client.get(`/sales/schedules?month=${M}`));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ revision: 1, qty: 50 });
    const detail = await ok(await a.client.get(`/sales/schedules/${s1.id}`));
    expect(detail.revisions.map((r: any) => r.revision)).toEqual([1, 0]);

    const next = addDays(lastDay, 3);
    const csv = `customer,item_code,date,qty\n36AABCD1234E1Z9,${ctx.bracket.code},${next},40\n36AABCD1234E1Z9,${ctx.bracket.code},${addDays(next, 1)},60\nNOBODY,${ctx.bracket.code},${next},1\n`;
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'schedule.csv');
    const res = await fetch(`${API_URL}/sales/schedules/import`, { method: 'POST', headers: { authorization: `Bearer ${a.client.accessToken}` }, body: form });
    expect(res.status).toBe(200);
    const imp = await res.json();
    expect(imp.schedules).toBe(1);
    expect(imp.errors).toEqual([{ row: 4, error: 'Customer NOBODY not found' }]);
    expect((await ok(await a.client.get(`/sales/schedules?month=${next.slice(0, 7)}`)))[0]).toMatchObject({ qty: 100 });
  });

  it('measures adherence against posted deliveries and sends an ASN', async () => {
    const so = await ok(await a.client.post('/sales/orders', { customerId: ctx.cust.id, lines: [{ itemId: ctx.bracket.id, qty: '15' }] }), 201);
    const sos = await ok(await a.client.post(`/sales/orders/${so.id}/submit`, { version: so.version }));
    const dlv = await ok(await a.client.post('/sales/deliveries', { orderId: so.id, vehicleNo: 'TS08UB4455', transporter: 'VRL Logistics', lrNo: 'LR-7781', packages: 3, lines: [{ soLineId: sos.lines[0].id, qty: '15' }] }), 201);
    expect((await a.client.post(`/sales/deliveries/${dlv.id}/asn`, {})).status).toBe(400);
    await ok(await a.client.post(`/sales/deliveries/${dlv.id}/submit`, { version: dlv.version }));

    const adh = await ok(await a.client.get(`/sales/schedules/adherence?month=${M}`));
    const due = 10 + 10 + (lastDay <= today() ? 30 : 0);
    expect(adh[0]).toMatchObject({ scheduled: 50, dueToDate: due, delivered: 15, deliveredToDate: 15, adherencePct: Math.round(Math.min(1, 15 / due) * 1000) / 10, shortfall: due - 15, onTimeDays: 0 });

    const asn = await ok(await a.client.post(`/sales/deliveries/${dlv.id}/asn`, { expectedAt: `${addDays(today(), 1)}T10:00:00+05:30` }), 201);
    expect(asn).toMatchObject({ number: 'ASN000001', vehicleNo: 'TS08UB4455', lrNo: 'LR-7781', packages: 3, status: 'sent' });
    expect(asn.lines).toEqual([{ itemCode: ctx.bracket.code, itemName: 'Seat bracket', customerPartNo: 'DM-SB-101', qty: '15.0000', uom: 'NOS', batchNo: null }]);
    expect((await a.client.post(`/sales/deliveries/${dlv.id}/asn`, {})).status).toBe(409);
    await ok(await a.client.post(`/sales/asns/${asn.id}/received`));
    expect((await ok(await a.client.get('/sales/asns')))[0]).toMatchObject({ status: 'received', deliveryNumber: expect.any(String) });
  });
});
