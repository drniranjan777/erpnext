import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
let wh: Record<string, string> = {};
const item: Record<string, any> = {};
const res: Record<string, any> = {};
const ctx: Record<string, any> = {};

async function created(path: string, body: unknown) {
  const r = await a.client.post(path, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
async function approve(path: string, doc: any) {
  return ok(await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version }));
}
async function stockOf(itemId: string, batchNo: string) {
  const d = (await a.client.get(`/inventory/stock/${itemId}`)).body;
  return d.byBatch.filter((b: any) => b.batchNo === batchNo).reduce((s: number, b: any) => s + Number(b.qty), 0);
}

beforeAll(async () => {
  a = await signupWorkspace('proc-b');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  const mk = (name: string, type: string, extra: Record<string, unknown> = {}) => created('/masters/items', { name, type, baseUomId: uom.KG, gstRate: 18, hsnCode: '32089090', ...extra });
  item.primer = await mk('Red oxide primer', 'finished_good', { trackBatch: true });
  item.thinner = await mk('Recovered thinner', 'semi_finished');
  item.resin = await mk('Alkyd resin', 'raw_material', { standardCost: '120' });
  item.solvent = await mk('Mineral turpentine', 'raw_material', { standardCost: '80' });
  item.tint = await mk('Red oxide tinter', 'raw_material', { standardCost: '300' });
  item.can = await created('/masters/items', { name: '1 L tin', type: 'packing_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73101010', standardCost: '15' });
  item.pack = await created('/masters/items', { name: 'Red oxide primer 1 L', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '32089090' });
  const open = await created('/inventory/stock-entries', {
    purpose: 'opening_stock',
    toWarehouseId: wh.MAIN,
    lines: [
      { itemId: item.resin.id, qty: '1000', rate: '120' },
      { itemId: item.solvent.id, qty: '1000', rate: '80' },
      { itemId: item.tint.id, qty: '50', rate: '300' },
      { itemId: item.can.id, qty: '500', rate: '15' },
      { itemId: item.primer.id, qty: '30', rate: '100', batchNo: 'RO-OLD-1' },
      { itemId: item.primer.id, qty: '20', rate: '110', batchNo: 'RO-OLD-2' },
    ],
  });
  await ok(await a.client.post(`/inventory/stock-entries/${open.id}/submit`, { version: open.version }));
  res.mix = await created('/manufacturing/work-centers', { code: 'MIX', name: 'Mixer', labourRate: '0', machineRate: '0', overheadRate: '0' });
  res.m1 = await created('/manufacturing/machines', { code: 'MX-1', name: 'Mixer 1', workCenterId: res.mix.id, requiresCleaning: true });
  ctx.f = await approve('/process/formulas', await created('/process/formulas', {
    itemId: item.primer.id,
    batchSize: '100',
    yieldPct: '90',
    lines: [
      { itemId: item.resin.id, basis: 'fixed', qty: '60', tolerancePct: '1' },
      { itemId: item.solvent.id, basis: 'fixed', qty: '40', tolerancePct: '1' },
      { kind: 'coproduct', itemId: item.thinner.id, basis: 'fixed', qty: '10', costSharePct: '10' },
    ],
    stages: [{ seq: 10, name: 'Mix', workCenterId: res.mix.id, minutes: '30' }],
  }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('co-products', () => {
  it('gives the co-product its share of the batch and clears WIP', async () => {
    // 60 × 120 + 40 × 80 = 10,400 per 100 kg batch; thinner takes 10 %; 9,360 over 90 kg of primer.
    expect(ctx.f.unitCost).toBe('104.0000');
    let b = await created('/manufacturing/work-orders', { kind: 'batch', itemId: item.primer.id, qty: '100', batchNo: 'RO-2610', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN });
    b = await approve('/manufacturing/work-orders', b);
    const view = await ok(await a.client.get(`/process/batches/${b.id}`));
    const id = (code: string) => view.materials.find((m: any) => m.code === code).id;
    await created(`/process/batches/${b.id}/dispense`, { lines: [{ materialId: id(item.resin.code), qty: '60' }, { materialId: id(item.solvent.code), qty: '40' }] });
    await created('/manufacturing/job-cards', { operationId: b.operations[0].id, goodQty: '100', minutes: '30', machineId: res.m1.id });
    const thinner = view.materials.find((m: any) => m.code === item.thinner.code);
    expect(thinner.kind).toBe('coproduct');
    const r = await created(`/manufacturing/work-orders/${b.id}/receive`, { goodQty: '90', byproducts: [{ materialId: thinner.id, qty: '10' }] });
    expect(r.lines.find((l: any) => l.kind === 'output')).toMatchObject({ amount: '9360.00', batchNo: 'RO-2610' });
    expect(r.lines.find((l: any) => l.kind === 'coproduct')).toMatchObject({ amount: '1040.00', rate: '104.0000' });
    const closed = await ok(await a.client.post(`/manufacturing/work-orders/${b.id}/close`, {}));
    expect(closed.varianceValue).toBe('0.00');
    ctx.b1 = b;
  });
});

describe('equipment cleaning', () => {
  it('blocks a dirty mixer until it is cleaned, and asks for a product-change clean', async () => {
    const eq = await ok(await a.client.get('/process/equipment'));
    expect(eq[0]).toMatchObject({ code: 'MX-1', cleanStatus: 'dirty', lastItem: item.primer.code });
    let b = await created('/manufacturing/work-orders', { kind: 'batch', itemId: item.primer.id, qty: '100', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN });
    b = await approve('/manufacturing/work-orders', b);
    const dirty = await a.client.post('/manufacturing/job-cards/start', { operationId: b.operations[0].id, machineId: res.m1.id });
    expect(dirty.status).toBe(409);
    expect(dirty.body.detail).toMatch(/MX-1 is not cleaned/);
    await created(`/process/equipment/${res.m1.id}/clean`, { kind: 'minor', cleanedBy: 'Ravi', verifiedBy: 'QA: Meena' });
    const card = await created('/manufacturing/job-cards/start', { operationId: b.operations[0].id, machineId: res.m1.id });
    expect((await a.client.post(`/process/equipment/${res.m1.id}/clean`, { cleanedBy: 'Ravi' })).status).toBe(409);
    await ok(await a.client.post(`/manufacturing/job-cards/${card.id}/stop`, { goodQty: '100', minutes: '30' }));
    // A different product needs a product-change clean.
    const fPack = await approve('/process/formulas', await created('/process/formulas', { itemId: item.pack.id, kind: 'packing', batchSize: '1', lines: [{ itemId: item.primer.id, basis: 'fixed', qty: '1.2', tolerancePct: '2' }, { itemId: item.can.id, basis: 'fixed', qty: '1' }], stages: [{ seq: 10, name: 'Fill', workCenterId: res.mix.id, minutes: '1' }] }));
    let p = await created('/manufacturing/work-orders', { kind: 'batch', itemId: item.pack.id, formulaId: fPack.id, qty: '10', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN });
    p = await ok(await a.client.post(`/manufacturing/work-orders/${p.id}/submit`, { version: p.version, force: true }));
    await created(`/process/equipment/${res.m1.id}/clean`, { kind: 'minor', cleanedBy: 'Ravi' });
    const change = await a.client.post('/manufacturing/job-cards/start', { operationId: p.operations[0].id, machineId: res.m1.id });
    expect(change.body.detail).toMatch(/needs a product-change cleaning/);
    await created(`/process/equipment/${res.m1.id}/clean`, { kind: 'product_change', cleanedBy: 'Ravi', verifiedBy: 'QA: Meena', result: 'Rinse clear' });
    await created('/manufacturing/job-cards/start', { operationId: p.operations[0].id, machineId: res.m1.id });
    ctx.fPack = fPack;
  });
});

describe('packing, blending and corrections', () => {
  it('splits bulk into packing orders, checking the bulk is there', async () => {
    const options = await ok(await a.client.get(`/process/packing/options?bulkItemId=${item.primer.id}`));
    expect(options).toEqual([expect.objectContaining({ formulaId: ctx.fPack.id, bulkPerPack: '1.2000', packItem: expect.objectContaining({ code: item.pack.code }) })]);
    const tooMuch = await a.client.post('/process/packing', { bulkItemId: item.primer.id, sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN, lines: [{ formulaId: ctx.fPack.id, packs: '500' }] });
    expect(tooMuch.status).toBe(409);
    const r = await created('/process/packing', { bulkItemId: item.primer.id, batchNo: 'RO-2610', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN, lines: [{ formulaId: ctx.fPack.id, packs: '50' }] });
    expect(r).toMatchObject({ bulkNeeded: '60.0000', orders: [{ packs: '50' }] });
    const wo = await ok(await a.client.get(`/manufacturing/work-orders/${r.orders[0].id}`));
    expect(wo).toMatchObject({ kind: 'batch', status: 'draft', batchNo: 'RO-2610', qty: '50.0000' });
  });

  it('blends lots into a new lot at their cost, and traces it back', async () => {
    const bad = await a.client.post('/process/blends', { itemId: item.primer.id, warehouseId: wh.MAIN, newBatchNo: 'RO-OLD-1', lots: [{ batchNo: 'RO-OLD-1', qty: '10' }, { batchNo: 'RO-OLD-2', qty: '10' }] });
    expect(bad.body.errors[0].path).toBe('newBatchNo');
    const b = await created('/process/blends', { itemId: item.primer.id, warehouseId: wh.MAIN, newBatchNo: 'ro-bl-1', lots: [{ batchNo: 'RO-OLD-1', qty: '30' }, { batchNo: 'RO-OLD-2', qty: '20' }] });
    // 30 × 100 + 20 × 110 = 5,200 for 50 kg.
    expect(b).toMatchObject({ status: 'approved', newBatchNo: 'RO-BL-1', totalQty: '50.0000', value: '5200.00' });
    expect(await stockOf(item.primer.id, 'RO-BL-1')).toBe(50);
    expect(await stockOf(item.primer.id, 'RO-OLD-1')).toBe(0);
    const t = await ok(await a.client.get(`/quality/trace/backward?itemId=${item.primer.id}&batchNo=RO-BL-1`));
    expect(t.links[0]).toMatchObject({ docType: 'blend' });
    expect(t.links[0].lots.map((n: any) => [n.batchNo, n.qty]).sort()).toEqual([['RO-OLD-1', '30.0000'], ['RO-OLD-2', '20.0000']]);
    const f = await ok(await a.client.get(`/quality/trace/forward?itemId=${item.primer.id}&batchNo=RO-OLD-2`));
    expect(f.links[0].lots[0]).toMatchObject({ batchNo: 'RO-BL-1' });
  });

  it('adds a shade correction to a batch in process', async () => {
    let b = await created('/manufacturing/work-orders', { kind: 'batch', itemId: item.primer.id, qty: '100', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN });
    b = await approve('/manufacturing/work-orders', b);
    expect((await a.client.post(`/process/batches/${b.id}/correction`, { itemId: item.tint.id, qty: '2', reason: 'x' })).status).toBe(400);
    const r = await created(`/process/batches/${b.id}/correction`, { itemId: item.tint.id, qty: '2', reason: 'Shade too light against standard', checkedBy: 'QA: Meena' });
    expect(r.entry.number).toMatch(/^PE\//);
    const view = await ok(await a.client.get(`/process/batches/${b.id}`));
    expect(view.materials.find((m: any) => m.code === item.tint.code)).toMatchObject({ requiredQty: '2.0000', issuedQty: '2.0000' });
    expect(view.dispensings[0]).toMatchObject({ overrideReason: 'Correction: Shade too light against standard', qty: '2.0000' });
  });
});
