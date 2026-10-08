import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

beforeAll(async () => {
  a = await signupWorkspace('pos-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.chair = await ok(await a.client.post('/masters/items', { code: 'CHR-OAK', name: 'Oak dining chair', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '94016100', mrp: '4720' }), 201);
  ctx.cushion = await ok(await a.client.post('/masters/items', { code: 'CSH-01', name: 'Seat cushion', type: 'finished_good', baseUomId: uom.NOS, gstRate: 12, hsnCode: '94049000', mrp: '560' }), 201);
  ctx.wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'MAIN');
  const e = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: ctx.wh.id, lines: [{ itemId: ctx.chair.id, qty: '20', rate: '2500' }, { itemId: ctx.cushion.id, qty: '50', rate: '200' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${e.id}/submit`, { version: e.version }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('point of sale', () => {
  it('sells with split tenders, once per sale, and posts a sales invoice', async () => {
    ctx.till = await ok(await a.client.post('/pos/terminals', { code: 'T1', name: 'Showroom till 1', warehouseId: ctx.wh.id, receiptFooter: 'Thank you for shopping with us' }), 201);
    expect((await a.client.post('/pos/terminals', { code: 't1', name: 'Again', warehouseId: ctx.wh.id })).status).toBe(409);
    ctx.shift = await ok(await a.client.post('/pos/sessions', { terminalId: ctx.till.id, openingCash: 2000 }), 201);
    expect((await a.client.post('/pos/sessions', { terminalId: ctx.till.id })).status).toBe(409);
    const found = await ok(await a.client.get(`/pos/terminals/${ctx.till.id}/items?q=CHR`));
    expect(found[0]).toMatchObject({ code: 'CHR-OAK', price: 4720, gstRate: 18, stock: 20 });
    const sale = { clientRef: `pos-${Date.now()}-1`, buyerName: 'Meena Iyer', buyerMobile: '9840012345', lines: [{ itemId: ctx.chair.id, qty: 2 }, { itemId: ctx.cushion.id, qty: 2, discountPct: 10 }] };
    expect((await a.client.post(`/pos/sessions/${ctx.shift.id}/sales`, { ...sale, tenders: [{ mode: 'cash', amount: 5000 }] })).status).toBe(400);
    const s = await ok(await a.client.post(`/pos/sessions/${ctx.shift.id}/sales`, { ...sale, tenders: [{ mode: 'card', amount: 8000, ref: 'XX1234' }, { mode: 'cash', amount: 2500 }] }), 201);
    // 2 × 4720 + 2 × 560 less 10 % = 9440 + 1008 = 10448
    expect(s).toMatchObject({ kind: 'sale', total: 10448, change: 52 });
    expect(s.tax).toBeCloseTo(1440 + 108, 0);
    ctx.sale = s;
    const again = await ok(await a.client.post(`/pos/sessions/${ctx.shift.id}/sales`, { ...sale, tenders: [{ mode: 'card', amount: 8000 }, { mode: 'cash', amount: 2448 }] }), 201);
    expect(again).toMatchObject({ id: s.id, replayed: true });
    const inv = await ok(await a.client.get(`/sales/invoices/${s.documentId}`));
    expect(inv.status).not.toBe('draft');
    expect(Math.abs(Number(inv.grandTotal) - 10448)).toBeLessThanOrEqual(1);
    const stock = await ok(await a.client.get(`/pos/terminals/${ctx.till.id}/items?q=CHR`));
    expect(stock[0].stock).toBe(18);
    const r = await ok(await a.client.get(`/pos/sales/${s.id}/receipt`));
    expect(r).toMatchObject({ number: s.number, terminal: { code: 'T1', receiptFooter: 'Thank you for shopping with us' } });
    // The same sale sent twice at the same moment (a retry after a network drop) posts one invoice.
    const before = (await ok(await a.client.get('/sales/invoices?limit=100'))).items.length;
    const twin = { clientRef: `pos-${Date.now()}-twin`, lines: [{ itemId: ctx.cushion.id, qty: 1 }], tenders: [{ mode: 'cash', amount: 560 }] };
    const [x, y] = await Promise.all([a.client.post(`/pos/sessions/${ctx.shift.id}/sales`, twin), a.client.post(`/pos/sessions/${ctx.shift.id}/sales`, twin)]);
    expect([x.status, y.status]).toEqual([201, 201]);
    expect(x.body.id).toBe(y.body.id);
    expect((await ok(await a.client.get('/sales/invoices?limit=100'))).items.length).toBe(before + 1);
    // A cash sale with change.
    await ok(await a.client.post(`/pos/sessions/${ctx.shift.id}/sales`, { clientRef: `pos-${Date.now()}-2`, lines: [{ itemId: ctx.cushion.id, qty: 1 }], tenders: [{ mode: 'cash', amount: 600 }] }), 201);
  });

  it('takes returns as credit notes and closes the day with a Z report', async () => {
    expect((await a.client.post(`/pos/sessions/${ctx.shift.id}/sales/${ctx.sale.id}/return`, { clientRef: `ret-${Date.now()}-x`, lines: [{ itemId: ctx.chair.id, qty: 3 }], reason: 'Too many' })).status).toBe(400);
    const ret = await ok(await a.client.post(`/pos/sessions/${ctx.shift.id}/sales/${ctx.sale.id}/return`, { clientRef: `ret-${Date.now()}-1`, lines: [{ itemId: ctx.chair.id, qty: 1 }], refund: 'cash', reason: 'Scratch on the leg' }), 201);
    expect(ret).toMatchObject({ kind: 'return', total: 4720, returnOfId: ctx.sale.id });
    const cn = await ok(await a.client.get(`/sales/credit-notes/${ret.documentId}`));
    expect(cn.status).not.toBe('draft');
    expect((await a.client.post(`/pos/sessions/${ctx.shift.id}/sales/${ctx.sale.id}/return`, { clientRef: `ret-${Date.now()}-2`, lines: [{ itemId: ctx.chair.id, qty: 2 }], reason: 'Again' })).status).toBe(400);
    const live = await ok(await a.client.get(`/pos/sessions/${ctx.shift.id}`));
    expect(live.sales).toHaveLength(4);
    // Opening 2000 + cash in (2500 + 560 + 600) − change (52 + 40) − refund 4720 = 848.
    const closed = await ok(await a.client.post(`/pos/sessions/${ctx.shift.id}/close`, { countedCash: 850 }));
    expect(closed.zReport).toMatchObject({ sales: 3, salesAmount: 10448 + 560 + 560, returns: 1, returnsAmount: 4720, expectedCash: 848, countedCash: 850, difference: 2 });
    expect(closed.zReport.byTender.card).toEqual({ in: 8000, out: 0 });
    expect((await a.client.post(`/pos/sessions/${ctx.shift.id}/sales`, { clientRef: `pos-${Date.now()}-3`, lines: [{ itemId: ctx.cushion.id, qty: 1 }], tenders: [{ mode: 'cash', amount: 560 }] })).status).toBe(409);
    const list = await ok(await a.client.get('/pos/sessions'));
    expect(list[0]).toMatchObject({ status: 'closed', sales: 3 });
  });

  it("gives the owner's phone its summary", async () => {
    const m = await ok(await a.client.get('/mobile/summary'));
    expect(m.today).toBeGreaterThan(0);
    expect(m.posToday).toBe(10448 + 560 + 560 - 4720);
    expect(m).toHaveProperty('approvalsPending');
  });
});
