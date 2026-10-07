import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

const OUR_GSTIN = '36AABCS1234E1ZU'; // made up, valid check digit
const CUSTOMER_GSTIN = '36AABCD1234E1Z9'; // made up

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let wh: Record<string, string> = {};
const item: Record<string, any> = {};
const res: Record<string, any> = {};
const ctx: Record<string, any> = {};

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const shiftMonth = (period: string, n: number) => {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const NOW = today().slice(0, 7);
const NEXT = shiftMonth(NOW, 1);
const N1 = `${NEXT}-01`;
const later = (d: string) => (d < today() ? today() : d);

async function created(path: string, body: unknown) {
  const r = await a.client.post(path, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const P = '/planning';
async function planned(itemId: string, status = 'planned,firmed') {
  return (await ok(await a.client.get(`${P}/planned-orders?itemId=${itemId}&status=${status}`))).items;
}

beforeAll(async () => {
  a = await signupWorkspace('plan-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));

  item.bracket = await created('/masters/items', { name: 'Shelf bracket', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73269099', sellingRate: '150', leadTimeDays: 2 });
  item.steel = await created('/masters/items', { name: 'HR strip', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '72111490', standardCost: '60', leadTimeDays: 7, safetyStock: '10', minOrderQty: '50' });
  item.screw = await created('/masters/items', { name: 'Wood screw', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73181200', standardCost: '1' });
  item.paint = await created('/masters/items', { name: 'Primer grey', type: 'finished_good', baseUomId: uom.KG, gstRate: 18, hsnCode: '32089090' });
  item.resin = await created('/masters/items', { name: 'Epoxy resin', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39073010', standardCost: '300' });
  item.lamp = await created('/masters/items', { name: 'Desk lamp', type: 'trading', baseUomId: uom.NOS, gstRate: 18, hsnCode: '94052010', sellingRate: '900' });
  const open = await created('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.steel.id, qty: '30', rate: '60' }, { itemId: item.screw.id, qty: '100', rate: '1' }] });
  await ok(await a.client.post(`/inventory/stock-entries/${open.id}/submit`, { version: open.version }));

  res.customer = await created('/masters/parties', { name: 'Deccan Interiors', isCustomer: true, gstin: CUSTOMER_GSTIN, addresses: [{ type: 'both', line1: 'Main road', city: 'Hyderabad', stateCode: '36', pincode: '500001', isDefault: true }] });
  res.vendor = await created('/masters/parties', { name: 'Steel Traders', isVendor: true, gstRegistrationType: 'unregistered', addresses: [{ type: 'both', line1: 'Road 2', city: 'Hyderabad', stateCode: '36', pincode: '500037', isDefault: true }] });
  const bom = await created('/manufacturing/boms', { itemId: item.bracket.id, quantity: '1', lines: [{ itemId: item.steel.id, qty: '2' }, { itemId: item.screw.id, qty: '4' }] });
  await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: bom.version }));
  const f = await created('/process/formulas', { itemId: item.paint.id, batchSize: '100', batchMultiple: '50', yieldPct: '90', lines: [{ itemId: item.resin.id, basis: 'percent', qty: '100' }] });
  await ok(await a.client.post(`/process/formulas/${f.id}/submit`, { version: f.version }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('demand forecast', () => {
  it('learns from monthly order history and forecasts a trend', async () => {
    // Six months of lamp orders, growing by 10 a month.
    for (let i = 6; i >= 1; i--) {
      const date = `${shiftMonth(NOW, -i)}-10`;
      const so = await created('/sales/orders', { customerId: res.customer.id, docDate: date, lines: [{ itemId: item.lamp.id, qty: String(160 - i * 10), deliveryDate: date }] });
      await ok(await a.client.post(`/sales/orders/${so.id}/submit`, { version: so.version }));
    }
    const g = await ok(await a.client.post(`${P}/forecasts/generate`, { horizon: 3, historyMonths: 12, itemId: item.lamp.id }));
    expect(g).toMatchObject({ items: 1, rows: 3, months: [NOW, NEXT, shiftMonth(NOW, 2)] });
    const list = await ok(await a.client.get(`${P}/forecasts?q=${item.lamp.code}`));
    const lamp = list.items[0];
    expect(lamp.method).toBe('holt');
    expect(lamp.history.slice(-6).map(Number)).toEqual([100, 110, 120, 130, 140, 150]);
    expect(Number(lamp.forecast[0].qty)).toBeGreaterThan(150);
    expect(Number(lamp.forecast[2].qty)).toBeGreaterThan(Number(lamp.forecast[0].qty));
  });

  it('keeps a planner override when re-forecasting, and resets it on request', async () => {
    await ok(await a.client.request('PUT', `${P}/forecasts`, { itemId: item.lamp.id, period: NEXT, qty: '500' }));
    await ok(await a.client.post(`${P}/forecasts/generate`, { horizon: 3, historyMonths: 12, itemId: item.lamp.id }));
    let lamp = (await ok(await a.client.get(`${P}/forecasts?q=${item.lamp.code}`))).items[0];
    expect(lamp.forecast[1]).toMatchObject({ qty: '500.0000', override: true });
    expect(Number(lamp.forecast[1].statQty)).toBeLessThan(500);
    await ok(await a.client.request('PUT', `${P}/forecasts`, { itemId: item.lamp.id, period: NEXT, qty: null }));
    lamp = (await ok(await a.client.get(`${P}/forecasts?q=${item.lamp.code}`))).items[0];
    expect(lamp.forecast[1].override).toBe(false);
    expect(lamp.forecast[1].qty).toBe(lamp.forecast[1].statQty);
    const past = await a.client.request('PUT', `${P}/forecasts`, { itemId: item.lamp.id, period: shiftMonth(NOW, -1), qty: '5' });
    expect(past.status).toBe(400);
  });
});

describe('MRP', () => {
  it('validates planning parameters', async () => {
    const bad = await a.client.request('PUT', `${P}/items/${item.screw.id}/parameters`, { lotSizing: 'fixed' });
    expect(bad.status).toBe(400);
    expect(bad.body.detail).toMatch(/fixed lot/);
    await ok(await a.client.request('PUT', `${P}/items/${item.screw.id}/parameters`, { lotSizing: 'fixed', lotQty: '500' }));
    // The lamp is bought: leave it out of this plan.
    await ok(await a.client.request('PUT', `${P}/items/${item.lamp.id}/parameters`, { excluded: true }));
    const v = await ok(await a.client.get(`${P}/items/${item.screw.id}`));
    expect(v.parameters).toMatchObject({ lotSizing: 'fixed', lotQty: '500.0000' });
  });

  it('plans multi-level requirements with forecast consumption, MOQ, lot sizes and lead-time offsets', async () => {
    // Bracket: forecast 40 next month, of which an order for 15 consumes 15 → 25 on the 1st and 15 on the 10th.
    await ok(await a.client.request('PUT', `${P}/forecasts`, { itemId: item.bracket.id, period: NEXT, qty: '40' }));
    await ok(await a.client.request('PUT', `${P}/forecasts`, { itemId: item.paint.id, period: NEXT, qty: '45' }));
    const so = await created('/sales/orders', { customerId: res.customer.id, lines: [{ itemId: item.bracket.id, qty: '15', deliveryDate: addDays(N1, 9) }] });
    ctx.so = await ok(await a.client.post(`/sales/orders/${so.id}/submit`, { version: so.version }));
    const po = await created('/purchase/orders', { vendorId: res.vendor.id, lines: [{ itemId: item.steel.id, qty: '20', rate: '60', deliveryDate: addDays(today(), 3) }] });
    ctx.po = await ok(await a.client.post(`/purchase/orders/${po.id}/submit`, { version: po.version }));

    const run = await ok(await a.client.post(`${P}/mrp/runs`, { horizonDays: 120 }));
    expect(run.status).toBe('done');
    expect(run.stats.plannedOrders).toBeGreaterThanOrEqual(6);

    const br = await planned(item.bracket.id);
    expect(br.map((p: any) => [p.dueDate, p.qty, p.releaseDate])).toEqual([
      [N1, '25.0000', later(addDays(N1, -2))],
      [addDays(N1, 9), '15.0000', addDays(N1, 7)],
    ]);
    expect(br[0].pegs[0]).toMatchObject({ kind: 'forecast', number: NEXT, qty: 25 });
    expect(br[1].pegs[0]).toMatchObject({ kind: 'sales_order', id: ctx.so.id, qty: 15 });

    // Steel: 30 on hand + 20 on order − 50 for the first lot = 0 < safety 10 → 10, raised to the MOQ of 50.
    const st = await planned(item.steel.id);
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ qty: '50.0000', source: 'buy', level: 1, dueDate: later(addDays(N1, -2)), releaseDate: later(addDays(N1, -9)) });
    expect(st[0].pegs[0]).toMatchObject({ kind: 'planned_order', id: br[0].id, number: item.bracket.code });

    // Screws: 100 on hand covers the first 100; the next 60 take a fixed lot of 500.
    const sc = await planned(item.screw.id);
    expect(sc.map((p: any) => [p.qty, p.dueDate])).toEqual([['500.0000', later(addDays(N1, 7))]]);

    // Paint is a process batch: 45 kg out at 90 % yield needs 50 kg of resin.
    const pa = await planned(item.paint.id);
    expect(pa[0]).toMatchObject({ source: 'batch', qty: '45.0000' });
    const rs = await planned(item.resin.id);
    expect(rs[0]).toMatchObject({ source: 'buy', qty: '50.0000' });

    const plan = await ok(await a.client.get(`${P}/items/${item.steel.id}`));
    expect(plan.plan).toMatchObject({ onHand: '30.0000', safetyStock: '10.0000', level: 1 });
    expect(plan.plan.timeline.map((r: any) => r.kind)).toEqual(['on_hand', 'receipt', 'demand', 'planned', 'demand']);
    expect(Number(plan.plan.endBalance)).toBe(20);
  });

  it('lists exception messages', async () => {
    const ex = await ok(await a.client.get(`${P}/mrp/exceptions`));
    expect(ex.run).toBeTruthy();
    // The lamp is excluded, so its late history orders raise nothing.
    expect(ex.items.find((e: any) => e.item.id === item.lamp.id)).toBeUndefined();
    await ok(await a.client.request('PUT', `${P}/items/${item.lamp.id}/parameters`, { excluded: false }));
    await ok(await a.client.post(`${P}/mrp/runs`, { horizonDays: 120, useForecast: false }));
    const ex2 = await ok(await a.client.get(`${P}/mrp/exceptions?kind=late_demand`));
    expect(ex2.items.filter((e: any) => e.item.id === item.lamp.id)).toHaveLength(6);
    expect(ex2.counts.late_demand).toBe(6);
    await ok(await a.client.request('PUT', `${P}/items/${item.lamp.id}/parameters`, { excluded: true }));
  });

  it('keeps firmed orders across runs', async () => {
    await ok(await a.client.post(`${P}/mrp/runs`, { horizonDays: 120 }));
    const [sc] = await planned(item.screw.id);
    const edited = await ok(await a.client.request('PUT', `${P}/planned-orders/${sc.id}`, { qty: '600', dueDate: addDays(N1, 5) }));
    expect(edited).toMatchObject({ status: 'firmed', qty: '600.0000', releaseDate: addDays(N1, 5) });
    await ok(await a.client.post(`${P}/mrp/runs`, { horizonDays: 120 }));
    const after = await planned(item.screw.id);
    expect(after.map((p: any) => [p.id, p.status, p.qty])).toEqual([[sc.id, 'firmed', '600.0000']]);
    const runs = await ok(await a.client.get(`${P}/mrp/runs`));
    expect(runs.length).toBeGreaterThanOrEqual(4);
  });

  it('converts planned orders into a requisition, work orders and a batch, which the next run counts', async () => {
    await ok(await a.client.post(`${P}/mrp/runs`, { horizonDays: 120 }));
    const all = (await ok(await a.client.get(`${P}/planned-orders?limit=100`))).items;
    const ids = all.filter((p: any) => p.item.id !== item.lamp.id).map((p: any) => p.id);
    const r = await ok(await a.client.post(`${P}/planned-orders/convert`, { ids, warehouseId: wh.MAIN }));
    expect(r.errors).toEqual([]);
    expect(r.requisition).toBeTruthy();
    const pr = await ok(await a.client.get(`/purchase/requisitions/${r.requisition.id}`));
    expect(pr.lines.map((l: any) => [l.itemCode, l.quantity]).sort()).toEqual(
      [
        [item.resin.code, '50.0000'],
        [item.screw.code, '600.0000'],
        [item.steel.code, '50.0000'],
      ].sort(),
    );
    expect(r.workOrders.map((w: any) => [w.item, w.qty]).sort()).toEqual(
      [
        [item.bracket.code, '15.0000'],
        [item.bracket.code, '25.0000'],
        [item.paint.code, '50.0000'],
      ].sort(),
    );
    const batch = await ok(await a.client.get(`/manufacturing/work-orders/${r.workOrders.find((w: any) => w.item === item.paint.code).id}`));
    expect(batch).toMatchObject({ kind: 'batch', qty: '50.0000', plannedEnd: N1 });
    const conv = (await ok(await a.client.get(`${P}/planned-orders?status=converted&limit=100`))).items;
    expect(conv).toHaveLength(ids.length);
    expect(conv.every((p: any) => p.converted?.id)).toBe(true);

    // Converted again: nothing left to convert.
    expect((await a.client.post(`${P}/planned-orders/convert`, { ids })).status).toBe(400);

    // The draft documents now count as supply, so nothing new is planned.
    await ok(await a.client.post(`${P}/mrp/runs`, { horizonDays: 120 }));
    for (const it of [item.bracket, item.steel, item.screw, item.paint, item.resin]) expect(await planned(it.id)).toEqual([]);
  });
});
