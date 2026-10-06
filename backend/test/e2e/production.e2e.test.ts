import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

const OUR_GSTIN = '36AABCS1234E1ZU'; // Telangana (made up, valid check digit)
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

async function created(path: string, body: unknown) {
  const r = await a.client.post(path, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const W = '/manufacturing/work-orders';
const wo = async (id: string) => ok(await a.client.get(`${W}/${id}`));
const mat = (w: any, code: string) => w.materials.find((m: any) => m.code === code);
const op = (w: any, seq: number) => w.operations.find((o: any) => o.seq === seq);
async function stockAt(itemId: string, warehouseId: string) {
  const d = (await a.client.get(`/inventory/stock/${itemId}`)).body;
  return d.byWarehouse.find((w: any) => w.warehouseId === warehouseId) ?? { qty: '0.0000', value: '0.00' };
}
async function closing(key: string) {
  const r = await ok(await a.client.get(`/accounting/trial-balance?to=${addDays(today(), 30)}`));
  return Number(r.rows.find((x: any) => x.systemKey === key)?.closing ?? 0);
}

beforeAll(async () => {
  a = await signupWorkspace('prod-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  wh.REJ = (await created('/inventory/warehouses', { code: 'REJ', name: 'Rejected goods', type: 'rejected', isNettable: false })).id;

  item.bracket = await created('/masters/items', { name: 'Mounting bracket', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73269099', sellingRate: '120' });
  item.steel = await created('/masters/items', { name: 'CRCA sheet', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '72091790', standardCost: '50' });
  item.bolt = await created('/masters/items', { name: 'M8 bolt', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73181500', standardCost: '2' });
  item.scrap = await created('/masters/items', { name: 'Steel scrap', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '72044900' });
  const open = await created('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.steel.id, qty: '100', rate: '50' }, { itemId: item.bolt.id, qty: '500', rate: '2' }] });
  await ok(await a.client.post(`/inventory/stock-entries/${open.id}/submit`, { version: open.version }));

  res.plater = await created('/masters/parties', { name: 'Bright Platers', isVendor: true, gstRegistrationType: 'unregistered', addresses: [{ type: 'both', line1: 'Road 2', city: 'Hyderabad', stateCode: '36', pincode: '500037', isDefault: true }] });
  res.customer = await created('/masters/parties', { name: 'Deccan Racks', isCustomer: true, gstin: CUSTOMER_GSTIN, addresses: [{ type: 'both', line1: 'Main road', city: 'Hyderabad', stateCode: '36', pincode: '500001', isDefault: true }] });
  res.press = await created('/manufacturing/work-centers', { code: 'PRESS', name: 'Power press', labourRate: '120', machineRate: '240', overheadRate: '60' });
  res.assy = await created('/manufacturing/work-centers', { code: 'ASSY', name: 'Assembly', kind: 'manual', labourRate: '60' });
  res.plating = await created('/manufacturing/work-centers', { code: 'PLATE', name: 'Plating (outside)', kind: 'subcontract' });
  res.machine = await created('/manufacturing/machines', { code: 'PP-01', name: '60T press', workCenterId: res.press.id });
  res.die = await created('/manufacturing/tools', { code: 'DIE-BR', name: 'Bracket die', kind: 'die', cavities: 2, lifeShots: 100000 });
  const bom = await created('/manufacturing/boms', {
    itemId: item.bracket.id,
    quantity: '10',
    lines: [
      { itemId: item.steel.id, qty: '5' },
      { itemId: item.bolt.id, qty: '20', operationSeq: 20 },
      { kind: 'scrap', itemId: item.scrap.id, qty: '0.5', recoveryRate: '20' },
    ],
    operations: [
      { seq: 10, name: 'Blank and form', workCenterId: res.press.id, toolId: res.die.id, setupMinutes: '30', runMinutes: '1' },
      { seq: 20, name: 'Fit bolts', workCenterId: res.assy.id, runMinutes: '0.5' },
      { seq: 30, name: 'Zinc plating', workCenterId: res.plating.id, isSubcontract: true, vendorId: res.plater.id, subcontractRate: '5' },
    ],
  });
  ctx.bom = await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: bom.version }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('work orders', () => {
  it('builds materials and routing from the default BOM', async () => {
    // Per unit: material 0.5 kg × 50 + 2 × 2 = 29; press (30/10 + 1) min × ₹7/min = 28, assembly 0.5 min × ₹1 = 0.5;
    // plating 5; less scrap 0.05 kg × 20 = 1 → 61.5.
    expect(ctx.bom.unitCost).toBe('61.5000');
    const w = await created(W, { itemId: item.bracket.id, qty: '20', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN, plannedStart: today() });
    expect(w).toMatchObject({ status: 'draft', stage: 'planned', kind: 'mts', bom: { id: ctx.bom.id } });
    expect(mat(w, item.steel.code)).toMatchObject({ requiredQty: '10.0000', kind: 'component' });
    expect(mat(w, item.bolt.code)).toMatchObject({ requiredQty: '40.0000', operationSeq: 20 });
    expect(mat(w, item.scrap.code)).toMatchObject({ requiredQty: '1.0000', kind: 'scrap' });
    expect(w.operations.map((o: any) => [o.seq, o.plannedMinutes])).toEqual([[10, '50.00'], [20, '10.00'], [30, '0.00']]);
    ctx.w1 = w;
  });

  it('checks availability against stock less other released orders, and refuses shortages unless forced', async () => {
    const big = await created(W, { itemId: item.bracket.id, qty: '500', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN });
    const avail = await ok(await a.client.get(`${W}/${big.id}/availability`));
    expect(avail.lines.find((l: any) => l.itemId === item.steel.id)).toMatchObject({ required: '250.0000', available: '100.0000', short: '150.0000' });
    const refused = await a.client.post(`${W}/${big.id}/submit`, { version: big.version });
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toMatch(/Short of/);

    ctx.w1 = await ok(await a.client.post(`${W}/${ctx.w1.id}/submit`, { version: ctx.w1.version }));
    expect(ctx.w1).toMatchObject({ status: 'approved', stage: 'released', stdUnitCost: '61.5000', stdMaterial: '29.0000' });
    expect(ctx.w1.number).toMatch(/^WO\//);
    // The released order now reserves 10 kg of steel.
    const after = await ok(await a.client.get(`${W}/${big.id}/availability`));
    expect(after.lines.find((l: any) => l.itemId === item.steel.id)).toMatchObject({ reserved: '10.0000', available: '90.0000' });

    const forced = await ok(await a.client.post(`${W}/${big.id}/submit`, { version: big.version, force: true }));
    expect(forced.releaseCheck[0]).toMatchObject({ code: item.steel.code, short: '160.0000' });
    expect((await ok(await a.client.post(`${W}/${big.id}/cancel`, { version: forced.version, reason: 'Planned in error' }))).stage).toBe('cancelled');
  });

  it('makes to order from a sales order, once', async () => {
    const so = await created('/sales/orders', { customerId: res.customer.id, lines: [{ itemId: item.bracket.id, qty: '30' }] });
    await ok(await a.client.post(`/sales/orders/${so.id}/submit`, { version: so.version }));
    const r = await created(`${W}/from-sales-order/${so.id}`, {});
    expect(r.created).toHaveLength(1);
    const mto = await wo(r.created[0].id);
    expect(mto).toMatchObject({ kind: 'mto', qty: '30.0000', salesOrder: { id: so.id } });
    const again = await created(`${W}/from-sales-order/${so.id}`, {});
    expect(again).toMatchObject({ created: [], skipped: [{ lineNo: 1, reason: 'already planned' }] });
  });
});

describe('shop floor and production', () => {
  it('issues materials into WIP', async () => {
    const e = await created(`${W}/${ctx.w1.id}/issue`, { all: true });
    expect(e).toMatchObject({ status: 'approved', kind: 'issue', materialValue: '580.00' });
    expect(e.number).toMatch(/^PE\//);
    const w = await wo(ctx.w1.id);
    expect(w).toMatchObject({ stage: 'in_progress', materialCost: '580.00', wip: '580.00' });
    expect(mat(w, item.steel.code)).toMatchObject({ issuedQty: '10.0000', outstanding: '0.0000' });
    expect((await stockAt(item.steel.id, wh.MAIN)).qty).toBe('90.0000');
    expect(await closing('wip')).toBe(580);
    expect((await a.client.post(`${W}/${ctx.w1.id}/cancel`, { version: w.version, reason: 'Not needed any more' })).status).toBe(409);
  });

  it('runs job cards: time at work-centre rates, tool shots, flow between operations', async () => {
    const w = await wo(ctx.w1.id);
    const card = await created('/manufacturing/job-cards/start', { operationId: op(w, 10).id, machineId: res.machine.id, operatorName: 'Ravi' });
    expect(card).toMatchObject({ status: 'running', toolId: res.die.id });
    const board = await ok(await a.client.get('/manufacturing/shop-floor'));
    expect(board.operations.find((o: any) => o.id === op(w, 10).id).running).toHaveLength(1);
    const done = await ok(await a.client.post(`/manufacturing/job-cards/${card.id}/stop`, { goodQty: '20', minutes: '50' }));
    // 50 min × (120 + 240 + 60) / 60.
    expect(done).toMatchObject({ status: 'done', shots: 10, labourCost: '100.00', machineCost: '200.00', overheadCost: '50.00' });
    expect((await a.client.get('/manufacturing/tools')).body.find((t: any) => t.code === 'DIE-BR').shotsUsed).toBe(10);

    const tooMany = await a.client.post('/manufacturing/job-cards', { operationId: op(w, 20).id, goodQty: '21', minutes: '12' });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.detail).toMatch(/Only 20 have come through Blank and form/);
    expect((await a.client.post('/manufacturing/job-cards', { operationId: op(w, 20).id, goodQty: '19', rejectQty: '1', minutes: '12' })).body.detail).toMatch(/why/);
    await created('/manufacturing/job-cards', { operationId: op(w, 20).id, goodQty: '19', rejectQty: '1', rejectReason: 'Thread stripped', minutes: '12' });
    const plating = await created('/manufacturing/job-cards', { operationId: op(w, 30).id, goodQty: '19' });
    expect(plating).toMatchObject({ minutes: '0.00', subcontractCost: '95.00' });
    const after = await wo(ctx.w1.id);
    expect(op(after, 10)).toMatchObject({ status: 'done', goodQty: '20.0000', actualMinutes: '50.00' });
    expect(op(after, 20)).toMatchObject({ status: 'done', goodQty: '19.0000', rejectQty: '1.0000' });
  });

  it('receives output at standard cost, absorbs time and job work, stocks the scrap', async () => {
    expect((await a.client.post(`${W}/${ctx.w1.id}/receive`, { goodQty: '20' })).body.detail).toMatch(/Only 19 have passed the last operation/);
    const scrapLine = mat(await wo(ctx.w1.id), item.scrap.code);
    const e = await created(`${W}/${ctx.w1.id}/receive`, { goodQty: '19', byproducts: [{ materialId: scrapLine.id, qty: '1' }] });
    // Output 19 × 61.5 + scrap 1 × 20; conversion 350 + 12 absorbed; plating 95 accrued.
    expect(e).toMatchObject({ kind: 'receipt', outputValue: '1188.50', conversionValue: '362.00', subcontractValue: '95.00' });
    expect(await stockAt(item.bracket.id, wh.MAIN)).toMatchObject({ qty: '19.0000', value: '1168.50' });
    expect(await stockAt(item.scrap.id, wh.MAIN)).toMatchObject({ qty: '1.0000', value: '20.00' });
    const w = await wo(ctx.w1.id);
    // 580 + 362 + 95 − 20 − 1168.5
    expect(w).toMatchObject({ producedQty: '19.0000', stage: 'in_progress', wip: '-151.50' });
    expect(await closing('production_absorbed')).toBe(-362);
    expect(await closing('jobwork_accrued')).toBe(-95);
  });

  it('returns unused materials and reports variances against standard', async () => {
    const bolt = mat(await wo(ctx.w1.id), item.bolt.code);
    expect((await a.client.post(`${W}/${ctx.w1.id}/return`, { lines: [{ materialId: bolt.id, qty: '41' }] })).body.detail).toMatch(/only 40/);
    const back = await created(`${W}/${ctx.w1.id}/return`, { lines: [{ materialId: bolt.id, qty: '2' }] });
    expect(back.materialValue).toBe('-4.00');
    const c = await ok(await a.client.get(`${W}/${ctx.w1.id}/costing`));
    // Actual 576 + 362 + 95 − 20 = 1013 against standard 19 × 61.5 = 1168.5.
    expect(c.variances).toMatchObject({ actualTotal: '1013.00', materialUsage: '25.00', materialPrice: '0.00', conversion: '-179.50', subcontract: '0.00', byproduct: '-1.00', other: '0.00', total: '-155.50' });
    expect(c.materials.find((m: any) => m.code === item.steel.code)).toMatchObject({ stdQtyForOutput: '9.5000', issuedQty: '10.0000', usageVariance: '25.00' });
    expect(c.wip).toBe('-155.50');
  });

  it('closes: WIP is cleared to the production variance', async () => {
    const e = await ok(await a.client.post(`${W}/${ctx.w1.id}/close`, {}));
    expect(e).toMatchObject({ kind: 'close', varianceValue: '-155.50' });
    const w = await wo(ctx.w1.id);
    expect(w).toMatchObject({ stage: 'closed', status: 'completed', wip: '0.00', varianceValue: '-155.50', canProduce: false });
    expect(await closing('wip')).toBe(0);
    expect(await closing('production_variance')).toBe(-155.5);
    expect((await a.client.post(`${W}/${ctx.w1.id}/issue`, { all: true })).status).toBe(409);
  });
});

describe('backflush, rejects and rework', () => {
  it('backflushes standard quantities at receipt and stocks rejects for rework', async () => {
    let w = await created(W, { itemId: item.bracket.id, qty: '10', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN, backflush: true });
    w = await ok(await a.client.post(`${W}/${w.id}/submit`, { version: w.version }));
    for (const seq of [10, 20, 30]) await created('/manufacturing/job-cards', { operationId: op(w, seq).id, goodQty: '10', minutes: seq === 10 ? '20' : seq === 20 ? '5' : null });
    const e = await created(`${W}/${w.id}/receive`, { goodQty: '9', rejectQty: '1', rejectWarehouseId: wh.REJ });
    const bf = e.lines.filter((l: any) => l.backflushed);
    expect(bf.map((l: any) => [l.code, l.qty])).toEqual([[item.steel.code, '5.0000'], [item.bolt.code, '20.0000']]);
    expect((await stockAt(item.bracket.id, wh.REJ))).toMatchObject({ qty: '1.0000', value: '61.50' });
    w = await wo(w.id);
    expect(w).toMatchObject({ producedQty: '9.0000', rejectedQty: '1.0000', materialCost: '290.00' });
    expect((await a.client.get('/manufacturing/tools')).body.find((t: any) => t.code === 'DIE-BR').shotsUsed).toBe(15);
    ctx.w2 = w;
  });

  it('reworks the rejects at actual cost', async () => {
    let r = await created(W, { kind: 'rework', itemId: item.bracket.id, qty: '1', parentWorkOrderId: ctx.w2.id, sourceWarehouseId: wh.REJ, targetWarehouseId: wh.MAIN });
    expect(r.materials).toHaveLength(1);
    expect(r.bom).toBeNull();
    r = await ok(await a.client.post(`${W}/${r.id}/submit`, { version: r.version }));
    expect(r.stdUnitCost).toBe('0.0000');
    await created(`${W}/${r.id}/issue`, { all: true });
    const e = await created(`${W}/${r.id}/receive`, { goodQty: '1' });
    expect(e.outputValue).toBe('61.50');
    expect(await stockAt(item.bracket.id, wh.REJ)).toMatchObject({ qty: '0.0000' });
    expect((await wo(ctx.w2.id)).reworks).toHaveLength(1);
    const closed = await ok(await a.client.post(`${W}/${r.id}/close`, {}));
    expect(closed.varianceValue).toBe('0.00');
  });

  it('validates inputs', async () => {
    const bad = await a.client.post(W, { kind: 'mto', itemId: item.steel.id, qty: '0', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN });
    expect(bad.status).toBe(400);
    const noBom = await a.client.post(W, { itemId: item.steel.id, qty: '5', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN });
    expect(noBom.body.errors.map((x: any) => x.path)).toEqual(['bomId']);
    const mto = await a.client.post(W, { kind: 'mto', itemId: item.bracket.id, qty: '5', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN });
    expect(mto.body.errors[0].path).toBe('salesOrderLineId');
  });
});

describe('kiosk sync, scanning and scrap insights', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  it('applies kiosk events once, with the tablet times', async () => {
    let w = await created(W, { itemId: item.bracket.id, qty: '10', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN });
    w = await ok(await a.client.post(`${W}/${w.id}/submit`, { version: w.version }));
    const opId = op(w, 10).id;
    const start = { type: 'start', clientRef: 'kiosk-0001-a', operationId: opId, operatorName: 'Lakshmi', at: ago(30) };
    const stop = { type: 'stop', clientRef: 'kiosk-0001-a', goodQty: '10', at: ago(10) };
    const first = await ok(await a.client.post('/manufacturing/job-cards/sync', { events: [start, stop] }));
    expect(first.results.map((r: any) => [r.type, r.ok, r.already])).toEqual([['start', true, false], ['stop', true, false]]);
    // Replayed after a dropped response: nothing happens twice.
    const again = await ok(await a.client.post('/manufacturing/job-cards/sync', { events: [start, stop] }));
    expect(again.results.map((r: any) => [r.ok, r.already])).toEqual([[true, true], [true, true]]);
    const cards = await ok(await a.client.get(`${W}/${w.id}/job-cards`));
    expect(cards).toHaveLength(1);
    // 20 minutes between the tablet's start and stop × ₹7 a minute.
    expect(cards[0]).toMatchObject({ minutes: '20.00', operatorName: 'Lakshmi', goodQty: '10.0000', labourCost: '40.00', machineCost: '80.00', overheadCost: '20.00' });
    const bad = await ok(await a.client.post('/manufacturing/job-cards/sync', {
      events: [
        { type: 'stop', clientRef: 'kiosk-unknown', goodQty: '1', at: ago(1) },
        { type: 'start', clientRef: 'kiosk-0002-old', operationId: op(w, 20).id, at: new Date(Date.now() - 8 * 86_400_000).toISOString() },
        { type: 'start', clientRef: 'kiosk-0003-new', operationId: op(w, 20).id, at: new Date(Date.now() + 3_600_000).toISOString() },
      ],
    }));
    expect(bad.results.map((r: any) => r.ok)).toEqual([false, false, false]);
    expect(bad.results[1].error).toMatch(/more than a week old/);
    expect(bad.results[2].error).toMatch(/future/);
    ctx.w3 = w;
  });

  it('resolves scanned traveller codes and work order numbers', async () => {
    const opId = op(ctx.w3, 20).id;
    expect(await ok(await a.client.get(`/manufacturing/scan?code=JC:${opId}`))).toMatchObject({ kind: 'operation', id: opId, workOrderId: ctx.w3.id, seq: 20 });
    expect(await ok(await a.client.get(`/manufacturing/scan?code=${encodeURIComponent(ctx.w3.number.toLowerCase())}`))).toMatchObject({ kind: 'work_order', id: ctx.w3.id });
    expect((await a.client.get('/manufacturing/scan?code=NOPE-1')).status).toBe(404);
  });

  it('reports scrap by reason, work centre and week', async () => {
    const r = await ok(await a.client.get('/manufacturing/insights/scrap'));
    expect(r.totals.rejected).toBeGreaterThanOrEqual(1);
    expect(r.byReason.find((x: any) => x.reason === 'Thread stripped')).toMatchObject({ qty: 1 });
    expect(r.byWorkCenter.find((x: any) => x.key === 'ASSY')).toMatchObject({ rejected: 1 });
    expect(r.weekly.length).toBeGreaterThanOrEqual(1);
  });
});
