import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, API_URL, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;
type Member = Awaited<ReturnType<typeof addMember>>;

let a: Workspace;
let rep: Member;
let mgr: Member;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const D = '/dms';

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const M = today().slice(0, 7);

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

beforeAll(async () => {
  a = await signupWorkspace('dms-a');
  emails.push(a.email);
  const repRole = await ok(await a.client.post('/iam/roles', { name: 'Field sales', permissions: ['dms.field.use', 'dms.network.read'] }), 201);
  const mgrRole = await ok(await a.client.post('/iam/roles', { name: 'Channel manager', permissions: ['dms.network.read', 'dms.claims.manage', 'dms.claims.settle'] }), 201);
  rep = await addMember(a.client, 'dms-rep', [repRole.id]);
  mgr = await addMember(a.client, 'dms-mgr', [mgrRole.id]);
  emails.push(rep.email, mgr.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  const wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  ctx.paint = await ok(await a.client.post('/masters/items', { name: 'Emulsion 4 L', type: 'trading', baseUomId: uom.NOS, gstRate: 18, hsnCode: '32091010', sellingRate: '400' }), 201);
  ctx.primer = await ok(await a.client.post('/masters/items', { name: 'Primer 1 L', type: 'trading', baseUomId: uom.NOS, gstRate: 18, hsnCode: '32091090', sellingRate: '150' }), 201);
  const entry = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: ctx.paint.id, qty: '500', rate: '300' }, { itemId: ctx.primer.id, qty: '200', rate: '100' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${entry.id}/submit`, { version: entry.version }));
  ctx.party = await ok(await a.client.post('/masters/parties', { name: 'Sai Paints Distributors', isCustomer: true, gstin: '36AABCS1234E1ZU', addresses: [{ type: 'both', line1: 'Shop 4, Kukatpally', city: 'Hyderabad', stateCode: '36', pincode: '500072', isDefault: true }] }), 201);
  ctx.vendor = await ok(await a.client.post('/masters/parties', { name: 'Not a customer', isVendor: true, gstRegistrationType: 'unregistered' }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('network and primary sales', () => {
  it('sets up a distributor, a beat and retailers', async () => {
    expect((await a.client.post(`${D}/distributors`, { partyId: ctx.vendor.id })).status).toBe(400);
    ctx.dist = await ok(await a.client.post(`${D}/distributors`, { partyId: ctx.party.id, salespersonId: rep.userId }), 201);
    expect((await a.client.post(`${D}/distributors`, { partyId: ctx.party.id })).status).toBe(409);
    ctx.beat = await ok(await a.client.post(`${D}/beats`, { code: 'kpy-1', name: 'Kukatpally Monday', distributorId: ctx.dist.id, salespersonId: rep.userId }), 201);
    ctx.r1 = await ok(await a.client.post(`${D}/retailers`, { code: 'R001', name: 'Lakshmi Hardware', distributorId: ctx.dist.id, beatId: ctx.beat.id, outletClass: 'A', latitude: 17.4948, longitude: 78.3996 }), 201);
    ctx.r2 = await ok(await a.client.post(`${D}/retailers`, { code: 'R002', name: 'Balaji Paints', distributorId: ctx.dist.id, beatId: ctx.beat.id }), 201);
    // Invoice 100 paint and 40 primer to the distributor (primary sales).
    const so = await ok(await a.client.post('/sales/orders', { customerId: ctx.party.id, lines: [{ itemId: ctx.paint.id, qty: '100' }, { itemId: ctx.primer.id, qty: '40' }] }), 201);
    const sos = await ok(await a.client.post(`/sales/orders/${so.id}/submit`, { version: so.version }));
    const inv = await ok(await a.client.post('/sales/invoices', { customerId: ctx.party.id, lines: sos.lines.map((l: any) => ({ soLineId: l.id, itemId: l.itemId, qty: l.qty })) }), 201);
    await ok(await a.client.post(`/sales/invoices/${inv.id}/submit`, { version: inv.version }));
  });
});

describe('schemes, secondary sales and stock', () => {
  it('prices secondary sales with schemes and earns loyalty', async () => {
    const from = `${M}-01`;
    const end = new Date(`${M}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    const to = end.toISOString().slice(0, 10);
    ctx.qty = await ok(await a.client.post(`${D}/schemes`, { code: 'qty10', name: '₹5 off from 10 tins', kind: 'qty_slab', itemIds: [ctx.paint.id], slabs: [{ min: 10, perUnit: 5 }], fromDate: from, toDate: to }), 201);
    await ok(await a.client.post(`${D}/schemes`, { code: 'FREE12', name: 'Buy 12 get 1', kind: 'free_goods', itemIds: [ctx.paint.id], slabs: [{ min: 12, freeQty: 1 }], fromDate: from, toDate: to }), 201);
    await ok(await a.client.post(`${D}/schemes`, { code: 'VAL10K', name: '2 % over ₹10,000', kind: 'value_slab', slabs: [{ min: 10_000, discountPct: 2 }], fromDate: from, toDate: to }), 201);
    ctx.primary = await ok(await a.client.post(`${D}/schemes`, { code: 'PRI100', name: '₹10 a tin on 100 tins a month', kind: 'qty_slab', level: 'primary', itemIds: [ctx.paint.id], slabs: [{ min: 100, perUnit: 10 }], fromDate: from, toDate: to }), 201);
    expect((await a.client.post(`${D}/schemes`, { code: 'BAD', name: 'No benefit', kind: 'free_goods', slabs: [{ min: 5 }], fromDate: from, toDate: to })).status).toBe(400);

    const sale = await ok(await a.client.post(`${D}/secondary-sales`, { retailerId: ctx.r1.id, lines: [{ itemId: ctx.paint.id, qty: 24 }, { itemId: ctx.primer.id, qty: 10 }] }), 201);
    // Paint 24 × 400 = 9,600 less ₹120; primer 1,500; value 10,980 → 2 % = 219.60.
    expect(sale).toMatchObject({ gross: '11100.00', discount: '339.60', net: '10760.40', source: 'manual' });
    expect(sale.schemes.map((s: any) => s.code).sort()).toEqual(['FREE12', 'QTY10', 'VAL10K']);
    ctx.sale1 = sale;
    const loyalty = await ok(await a.client.get(`${D}/retailers/${ctx.r1.id}/loyalty`));
    expect(loyalty.balance).toBe(107);
  });

  it('tracks distributor stock from primary in and secondary out', async () => {
    await ok(await a.client.post(`${D}/stock-adjustments`, { distributorId: ctx.dist.id, itemId: ctx.primer.id, kind: 'opening', qty: 5, remarks: 'Stock before go-live' }), 201);
    const stock = await ok(await a.client.get(`${D}/distributors/${ctx.dist.id}/stock`));
    // Paint: 100 in, 24 sold + 2 free out. Primer: 5 opening + 40 in − 10.
    expect(stock.find((s: any) => s.itemId === ctx.paint.id)).toMatchObject({ primaryIn: 100, secondaryOut: 26, onHand: 74 });
    expect(stock.find((s: any) => s.itemId === ctx.primer.id)).toMatchObject({ adjustments: 5, onHand: 35 });
  });
});

describe('field force', () => {
  it('checks in on the beat, books an order and checks out', async () => {
    const day = await ok(await rep.client.get(`${D}/field/day`));
    expect(day.outlets.map((o: any) => o.code).sort()).toEqual(['R001', 'R002']);
    // About 1 km from the outlet.
    const form = new FormData();
    form.append('retailerId', ctx.r1.id);
    form.append('latitude', '17.5038');
    form.append('longitude', '78.3996');
    form.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'shelf.jpg');
    const res = await fetch(`${API_URL}${D}/field/visits`, { method: 'POST', headers: { authorization: `Bearer ${rep.client.accessToken}` }, body: form });
    expect(res.status).toBe(201);
    const visit = await res.json();
    expect(visit.farFromOutlet).toBe(true);
    expect(visit.photoId).toBeTruthy();
    expect((await rep.client.post(`${D}/field/visits`, { retailerId: ctx.r2.id, latitude: 17.49, longitude: 78.39 })).status).toBe(409);
    expect((await rep.client.post(`${D}/field/visits/${visit.id}/check-out`, { outcome: 'order' })).status).toBe(400);
    const order = await ok(await rep.client.post(`${D}/field/visits/${visit.id}/order`, { lines: [{ itemId: ctx.paint.id, qty: 12 }] }), 201);
    expect(order).toMatchObject({ source: 'field', discount: '60.00', net: '4740.00' });
    await ok(await rep.client.post(`${D}/field/visits/${visit.id}/check-out`, { outcome: 'no_order' }));
    // The second outlet has no location yet: the first check-in records it.
    const v2 = await ok(await rep.client.post(`${D}/field/visits`, { retailerId: ctx.r2.id, latitude: 17.4901, longitude: 78.3911 }), 201);
    expect(v2.distanceMetres).toBeNull();
    await ok(await rep.client.post(`${D}/field/visits/${v2.id}/check-out`, { outcome: 'closed' }));
    const r2 = (await ok(await a.client.get(`${D}/retailers?q=R002`)))[0];
    expect(Number(r2.latitude)).toBeCloseTo(17.4901, 4);
    const report = await ok(await a.client.get(`${D}/visits/report`));
    expect(report[0]).toMatchObject({ calls: 2, productive: 1, farCheckIns: 1, orderValue: 4740 });
  });
});

describe('claims', () => {
  it('computes, approves and settles a secondary scheme claim', async () => {
    const claim = await ok(await a.client.post(`${D}/claims`, { distributorId: ctx.dist.id, kind: 'scheme', schemeId: ctx.qty.id, fromDate: `${M}-01`, toDate: today(), claimedAmount: 200 }), 201);
    // ₹120 on the first sale and ₹60 on the field order.
    expect(claim).toMatchObject({ number: 'CLM00001', computedAmount: '180.00', status: 'submitted' });
    expect((await a.client.post(`${D}/claims`, { distributorId: ctx.dist.id, kind: 'scheme', schemeId: ctx.qty.id, fromDate: `${M}-01`, toDate: today(), claimedAmount: 10 })).status).toBe(409);
    expect((await a.client.post(`${D}/claims/${claim.id}/decide`, { approve: true })).status).toBe(403);
    expect(await ok(await mgr.client.post(`${D}/claims/${claim.id}/decide`, { approve: true }))).toMatchObject({ approvedAmount: '180.00' });
    const settled = await ok(await mgr.client.post(`${D}/claims/${claim.id}/settle`));
    expect(settled.journalId).toBeTruthy();
    // A sale inside an approved scheme claim can no longer be cancelled.
    expect((await a.client.post(`${D}/secondary-sales/${ctx.sale1.id}/cancel`)).status).toBe(409);
  });

  it('computes a primary scheme claim from invoices', async () => {
    const claim = await ok(await a.client.post(`${D}/claims`, { distributorId: ctx.dist.id, kind: 'scheme', schemeId: ctx.primary.id, fromDate: `${M}-01`, toDate: today(), claimedAmount: 1000 }), 201);
    expect(claim.computedAmount).toBe('1000.00');
  });
});

describe('loyalty and import', () => {
  it('redeems points within the balance', async () => {
    expect((await a.client.post(`${D}/retailers/${ctx.r1.id}/redeem`, { points: 10_000, remarks: 'Too many' })).status).toBe(400);
    await ok(await a.client.post(`${D}/retailers/${ctx.r1.id}/redeem`, { points: 50, remarks: 'Wall clock' }), 201);
    expect((await ok(await a.client.get(`${D}/retailers/${ctx.r1.id}/loyalty`))).balance).toBe(107 + 47 - 50);
  });

  it('imports a distributor sales file', async () => {
    const csv = `retailer_code,item_code,qty,date,invoice_no\nR002,${ctx.primer.code},5,${today()},B-1\nR002,${ctx.paint.code},2,${today()},B-1\nR999,${ctx.paint.code},1,${today()},B-2\n`;
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'sales.csv');
    const res = await fetch(`${API_URL}${D}/secondary-sales/import`, { method: 'POST', headers: { authorization: `Bearer ${a.client.accessToken}` }, body: form });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sales: 1, errors: [{ row: 4, error: 'Retailer R999 not found' }] });
    const list = await ok(await a.client.get(`${D}/secondary-sales?retailerId=${ctx.r2.id}`));
    expect(list[0]).toMatchObject({ source: 'import', gross: '1550.00' });
  });
});
