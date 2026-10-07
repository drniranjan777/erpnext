import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const W = '/wms';

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const put = (path: string, b: unknown) => a.client.request('PUT', path, b);
async function entry(body: Record<string, unknown>) {
  const created = await ok(await a.client.post('/inventory/stock-entries', body), 201);
  return ok(await a.client.post(`/inventory/stock-entries/${created.id}/submit`, { version: created.version }));
}
async function binQty(code: string, itemId: string) {
  const b = await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/bins/${code}`));
  return b.contents.filter((c: any) => c.itemId === itemId).reduce((s: number, c: any) => s + Number(c.qty), 0);
}
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  a = await signupWorkspace('wmss-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.uom = uom;
  ctx.wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id])).MAIN;
  ctx.client = await ok(await a.client.post('/masters/parties', { name: 'Deccan Foods', isCustomer: true, gstin: '36AABCD1234E1Z9', addresses: [{ type: 'both', line1: 'Plot 4, IDA Uppal', city: 'Hyderabad', stateCode: '36', pincode: '500039', isDefault: true }] }), 201);
  ctx.svc = await ok(await a.client.post('/masters/items', { name: 'Warehousing services', type: 'service', baseUomId: uom.NOS, gstRate: 18, hsnCode: '996729' }), 201);
  ctx.juice = await ok(await a.client.post('/masters/items', { name: 'Mango juice carton (client stock)', type: 'trading', baseUomId: uom.NOS, gstRate: 12, hsnCode: '20098990', barcodes: [{ barcode: '8061414112345' }], standardCost: '0' }), 201);
  await ok(await a.client.post(`${W}/warehouses/${ctx.wh}/enable`));
  const zone = await ok(await a.client.post(`${W}/zones`, { warehouseId: ctx.wh, code: 'STOR', name: 'Storage', sequence: 10 }), 201);
  await ok(await a.client.post(`${W}/bins/generate`, { zoneId: zone.id, aisles: ['A'], racks: 2, shelves: 1 }), 201);
  ctx.bins = Object.fromEntries((await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/bins`))).map((b: any) => [b.code, b]));
  ctx.zone = zone.id;
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('3PL', () => {
  it('bills storage in pallet-days, handling and the monthly minimum, as a draft invoice', async () => {
    await ok(await put(`${W}/items/${ctx.juice.id}/profile`, { ownerPartyId: ctx.client.id, unitsPerPallet: 40 }));
    expect((await a.client.post(`${W}/3pl/clients`, { partyId: ctx.client.id, warehouseId: ctx.wh, storagePerPalletDay: 50, serviceItemId: ctx.juice.id })).status).toBe(400);
    const c = await ok(await a.client.post(`${W}/3pl/clients`, { partyId: ctx.client.id, warehouseId: ctx.wh, storagePerPalletDay: 50, inboundPerUnit: 2, outboundPerUnit: 3, minimumMonthly: 1000, serviceItemId: ctx.svc.id }), 201);
    await entry({ purpose: 'material_receipt', toWarehouseId: ctx.wh, lines: [{ itemId: ctx.juice.id, qty: '100', rate: '0' }] });
    await entry({ purpose: 'material_issue', fromWarehouseId: ctx.wh, lines: [{ itemId: ctx.juice.id, qty: '30' }] });
    const p = await ok(await a.client.get(`${W}/3pl/clients/${c.id}/preview?from=${today()}&to=${today()}`));
    // Closing 70 units on 40 per pallet: 2 pallets for 1 day = ₹100; in 100 × ₹2; out 30 × ₹3; minimum ₹1000.
    expect(p).toMatchObject({ palletDays: 2, unitsIn: 100, unitsOut: 30, storage: 100, handling: 290, topUp: 610, total: 1000 });
    const bill = await ok(await a.client.post(`${W}/3pl/clients/${c.id}/bills`, { from: today(), to: today() }), 201);
    expect(bill.total).toBe('1000.00');
    const inv = await ok(await a.client.get(`/sales/invoices/${bill.invoiceId}`));
    expect(inv.status).toBe('draft');
    expect(inv.lines.map((l: any) => l.description)).toEqual([`Storage ${today()} to ${today()}: 2 pallet-days @ ₹50`, 'Handling in: 100 units @ ₹2', 'Handling out: 30 units @ ₹3', 'Top-up to the monthly minimum']);
    expect((await a.client.post(`${W}/3pl/clients/${c.id}/bills`, { from: today(), to: today() })).status).toBe(409);
  });
});

describe('floor', () => {
  it('applies a replayed offline move only once', async () => {
    const recv = (await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/bins/RECV`))).id;
    const move = { itemId: ctx.juice.id, fromBinId: recv, toBinId: ctx.bins['A-01-1'].id, qty: 20, clientRef: 'hh-7f3a-0001' };
    expect(await ok(await a.client.post(`${W}/moves`, move))).toEqual({ ok: true });
    expect(await ok(await a.client.post(`${W}/moves`, move))).toEqual({ ok: true, duplicate: true });
    expect(await binQty('A-01-1', ctx.juice.id)).toBe(20);
  });

  it('suggests pick-face levels from demand and reports productivity', async () => {
    const face = ctx.bins['A-02-1'];
    await ok(await put(`${W}/bins/${face.id}`, { zoneId: ctx.zone, code: 'A-02-1', pickSequence: face.pickSequence, fixedItemId: ctx.juice.id }));
    const [s] = await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/face-levels`));
    // 30 issued today over a 30-day window: 1 a day on average, 30 at the peak.
    expect(s).toMatchObject({ bin: 'A-02-1', avgDaily: 1, peakDaily: 30, suggestedMin: 16, suggestedMax: 19 });
    await ok(await a.client.post(`${W}/face-levels`, { levels: [{ binId: face.id, min: s.suggestedMin, max: s.suggestedMax }] }));
    const plan = await ok(await a.client.post(`${W}/warehouses/${ctx.wh}/putaway`));
    for (const t of plan.tasks) await ok(await a.client.post(`${W}/tasks/${t.id}/confirm`, { binId: t.toBinId ?? ctx.bins['A-01-1'].id, qty: Number(t.qty) }));
    const prod = await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/productivity?from=${today()}&to=${today()}`));
    expect(prod.totals.putaways).toBe(plan.tasks.length);
    expect(prod.people[0]).toMatchObject({ putaways: plan.tasks.length, picks: 0 });
  });
});

describe('RFID gate (pilot)', () => {
  it('decodes SGTIN reads, matches registered tags and checks a delivery', async () => {
    const tagged = await ok(await a.client.post('/masters/items', { name: 'Smart meter', type: 'finished_good', baseUomId: ctx.uom.NOS, gstRate: 18, hsnCode: '90283010', trackSerial: true, sellingRate: '1500' }), 201);
    await ok(await a.client.post(`${W}/rfid/tags`, { epc: 'E2003412DC0301181711AAAA', itemId: tagged.id, serialNo: 'SM-1' }), 201);
    await ok(await a.client.post(`${W}/rfid/tags`, { epc: 'E2003412DC0301181711BBBB', itemId: tagged.id, serialNo: 'SM-2' }), 201);
    expect((await a.client.post(`${W}/rfid/tags`, { epc: 'e2003412dc0301181711aaaa', itemId: tagged.id })).status).toBe(409);
    await entry({ purpose: 'material_receipt', toWarehouseId: ctx.wh, lines: [{ itemId: tagged.id, qty: '2', rate: '900', serialNos: ['SM-1', 'SM-2'] }] });
    const so = await ok(await a.client.post('/sales/orders', { customerId: ctx.client.id, lines: [{ itemId: tagged.id, qty: '2' }] }), 201);
    const sos = await ok(await a.client.post(`/sales/orders/${so.id}/submit`, { version: so.version }));
    const dn = await ok(await a.client.post('/sales/deliveries', { orderId: so.id, warehouseId: ctx.wh, lines: [{ soLineId: sos.lines[0].id, qty: '2', serialNos: ['SM-1', 'SM-2'] }] }), 201);
    const r = await ok(await a.client.post(`${W}/rfid/reads`, { gate: 'DOCK-1', deliveryId: dn.id, epcs: ['E2003412DC0301181711AAAA', 'e2003412dc0301181711aaaa', '3074257BF7194E4000001A85', 'DEADBEEF00'] }));
    // The SGTIN read decodes to GTIN 80614141123458, which is not the juice's barcode 8061414112345: unknown.
    expect(r).toMatchObject({ read: 3, matched: 1 });
    const gate = await ok(await a.client.get(`${W}/rfid/deliveries/${dn.id}`));
    expect(gate.ok).toBe(false);
    expect(gate.lines[0]).toMatchObject({ expected: 2, read: 1, missingSerials: ['SM-2'] });
    expect(gate.unexpected).toEqual(expect.arrayContaining(['3074257BF7194E4000001A85', 'DEADBEEF00']));
    await ok(await a.client.post(`${W}/rfid/reads`, { gate: 'DOCK-1', deliveryId: dn.id, epcs: ['E2003412DC0301181711BBBB'] }));
    expect((await ok(await a.client.get(`${W}/rfid/deliveries/${dn.id}`))).lines[0]).toMatchObject({ read: 2, missingSerials: [], ok: true });
  });
});
