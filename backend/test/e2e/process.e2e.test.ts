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
const mat = (b: any, code: string) => b.materials.find((m: any) => m.code === code);

beforeAll(async () => {
  a = await signupWorkspace('proc-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.paint = await created('/masters/items', { name: 'Enamel white base', type: 'finished_good', baseUomId: uom.KG, gstRate: 18, hsnCode: '32089090', trackBatch: true });
  item.resin = await created('/masters/items', { name: 'Alkyd resin', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39075000', standardCost: '120' });
  item.solvent = await created('/masters/items', { name: 'Mineral turpentine', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '27101290', standardCost: '80' });
  item.tio2 = await created('/masters/items', { name: 'Titanium dioxide', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '32061110', standardCost: '200' });
  item.drier = await created('/masters/items', { name: 'Cobalt drier (active)', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '38151200', standardCost: '1000', trackBatch: true });
  const open = await created('/inventory/stock-entries', {
    purpose: 'opening_stock',
    toWarehouseId: wh.MAIN,
    lines: [
      { itemId: item.resin.id, qty: '1000', rate: '120' },
      { itemId: item.solvent.id, qty: '1000', rate: '80' },
      { itemId: item.tio2.id, qty: '500', rate: '200' },
      { itemId: item.drier.id, qty: '100', rate: '1000', batchNo: 'CD-98' },
    ],
  });
  await ok(await a.client.post(`/inventory/stock-entries/${open.id}/submit`, { version: open.version }));
  res.mix = await created('/manufacturing/work-centers', { code: 'MIX', name: 'High-speed disperser', labourRate: '120', machineRate: '400', overheadRate: '80' });
  res.fill = await created('/manufacturing/work-centers', { code: 'FILL', name: 'Filling line', kind: 'line', labourRate: '120', machineRate: '200', overheadRate: '80' });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('formulas', () => {
  it('refuses a percent formula that does not add up, then approves a real one and costs it', async () => {
    const bad = await a.client.post('/process/formulas', { itemId: item.paint.id, batchSize: '1000', lines: [{ itemId: item.resin.id, basis: 'percent', qty: '60' }, { itemId: item.solvent.id, basis: 'percent', qty: '30' }] });
    expect(bad.body.errors[0].message).toMatch(/add up to 90%/);
    const f = await created('/process/formulas', {
      itemId: item.paint.id,
      batchSize: '1000',
      batchMultiple: '250',
      yieldPct: '98',
      declaration: 'Contains alkyd resin, titanium dioxide, mineral turpentine, cobalt drier.',
      lines: [
        { itemId: item.resin.id, basis: 'percent', qty: '40', tolerancePct: '1', stageSeq: 10 },
        { itemId: item.tio2.id, basis: 'percent', qty: '20', tolerancePct: '1', stageSeq: 10 },
        { itemId: item.solvent.id, basis: 'percent', qty: '35', tolerancePct: '1', stageSeq: 20 },
        { itemId: item.drier.id, basis: 'potency', qty: '50', stdPotency: '100', tolerancePct: '0.5', stageSeq: 20 },
      ],
      stages: [
        { seq: 10, name: 'Disperse', workCenterId: res.mix.id, minutes: '120', parameters: [{ name: 'Viscosity', unit: 'KU', min: '80', max: '95' }, { name: 'Temperature', unit: '°C', min: null, max: '45' }] },
        { seq: 20, name: 'Let down', workCenterId: res.mix.id, minutes: '60' },
        { seq: 30, name: 'Fill', workCenterId: res.fill.id, minutes: '90' },
      ],
    });
    ctx.f = await ok(await a.client.post(`/process/formulas/${f.id}/submit`, { version: f.version }));
    expect(ctx.f).toMatchObject({ status: 'approved', formulaVersion: 1, isDefault: true });
    // Material: 400 × 120 + 200 × 200 + 350 × 80 + 50 × 1000 = 166,000; conversion 180 min × ₹600 + 90 × ₹400 = 144,000 / 60.
    // Batch 166,000 + 2,400 = 168,400 over 980 kg.
    const c = await ok(await a.client.post(`/process/formulas/${f.id}/cost`, { apply: false }));
    expect(c).toMatchObject({ material: '166000.00', conversion: '2400.00', batchCost: '168400.00', unitCost: '171.8367' });
    const s = await ok(await a.client.get(`/process/formulas/${f.id}/scale?qty=500`));
    expect(s.lines.map((l: any) => [l.item.code, l.required])).toEqual([
      [item.resin.code, '200.0000'],
      [item.tio2.code, '100.0000'],
      [item.solvent.code, '175.0000'],
      [item.drier.code, '25.0000'],
    ]);
  });
});

describe('batches', () => {
  it('makes batches in the formula multiple, from the formula', async () => {
    const odd = await a.client.post('/manufacturing/work-orders', { kind: 'batch', itemId: item.paint.id, qty: '300', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN });
    expect(odd.body.errors[0].message).toMatch(/multiples of 250/);
    let b = await created('/manufacturing/work-orders', { kind: 'batch', itemId: item.paint.id, qty: '500', batchNo: 'EW-2610-01', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN });
    expect(b).toMatchObject({ kind: 'batch', bom: null, batchNo: 'EW-2610-01' });
    expect(b.operations.map((o: any) => [o.seq, o.plannedMinutes])).toEqual([[10, '60.00'], [20, '30.00'], [30, '45.00']]);
    b = await ok(await a.client.post(`/manufacturing/work-orders/${b.id}/submit`, { version: b.version }));
    expect(b).toMatchObject({ stage: 'released', stdUnitCost: '171.8367' });
    ctx.b = b;
  });

  it('dispenses within tolerance, adjusting potency for the lot assay', async () => {
    const view = await ok(await a.client.get(`/process/batches/${ctx.b.id}`));
    const id = (code: string) => mat(view, code).id;
    const out = await a.client.post(`/process/batches/${ctx.b.id}/dispense`, { lines: [{ materialId: id(item.solvent.code), qty: '180' }] });
    expect(out.body.errors[0].message).toMatch(/outside ±1% of the target 175/);
    const noAssay = await a.client.post(`/process/batches/${ctx.b.id}/dispense`, { lines: [{ materialId: id(item.drier.code), qty: '25', batchNo: 'CD-98' }] });
    expect(noAssay.body.errors[0].path).toBe('lines.0.assayPct');
    const r = await ok(
      await a.client.post(`/process/batches/${ctx.b.id}/dispense`, {
        lines: [
          { materialId: id(item.resin.code), qty: '200.5', checkedBy: 'QA: Meena' },
          { materialId: id(item.tio2.code), qty: '100' },
          { materialId: id(item.solvent.code), qty: '177.5', overrideReason: 'Viscosity correction on QA advice' },
          // 25 kg of pure drier from a 98 % lot: 25.5102 kg target.
          { materialId: id(item.drier.code), qty: '25.5', batchNo: 'CD-98', assayPct: '98' },
        ],
      }),
      201,
    );
    expect(r.entry.number).toMatch(/^PE\//);
    expect(r.dispensed.map((d: any) => [d.targetQty, d.withinTolerance])).toEqual([['200.0000', true], ['100.0000', true], ['175.0000', false], ['25.5102', true]]);
    const after = await ok(await a.client.get(`/process/batches/${ctx.b.id}`));
    expect(after.dispensings).toHaveLength(4);
    expect(after.dispensings.find((d: any) => d.code === item.solvent.code)).toMatchObject({ overrideReason: 'Viscosity correction on QA advice', withinTolerance: false });
    expect(mat(after, item.drier.code)).toMatchObject({ basis: 'potency', issuedQty: '25.5000' });
  });

  it('records stage parameters and flags readings out of range', async () => {
    const ops = ctx.b.operations;
    const missing = await a.client.post('/manufacturing/job-cards', { operationId: ops[0].id, goodQty: '500', minutes: '65' });
    expect(missing.body.detail ?? missing.body.message).toMatch(/Record Viscosity, Temperature/);
    await created('/manufacturing/job-cards', { operationId: ops[0].id, goodQty: '500', minutes: '65', readings: [{ name: 'viscosity', value: '99' }, { name: 'Temperature', value: '42' }] });
    await created('/manufacturing/job-cards', { operationId: ops[1].id, goodQty: '500', minutes: '30' });
    await created('/manufacturing/job-cards', { operationId: ops[2].id, goodQty: '500', minutes: '50' });
    const view = await ok(await a.client.get(`/process/batches/${ctx.b.id}`));
    expect(view.outOfRange).toEqual([{ stage: '10 Disperse', name: 'Viscosity', value: '99', ok: false }]);
  });

  it('receives the batch under its lot number and reports the yield', async () => {
    const r = await created(`/manufacturing/work-orders/${ctx.b.id}/receive`, { goodQty: '490' });
    expect(r.lines.find((l: any) => l.kind === 'output')).toMatchObject({ batchNo: 'EW-2610-01', qty: '490.0000' });
    const view = await ok(await a.client.get(`/process/batches/${ctx.b.id}`));
    // Input 200.5 + 100 + 177.5 + 25.5 = 503.5 kg; 98 % → 493.43 kg expected.
    expect(view.yield).toMatchObject({ input: '503.5000', output: '490.0000', theoretical: '493.4300', actualPct: '99.30', loss: '3.4300' });
    expect(view.formula).toMatchObject({ version: 1, yieldPct: '98.00' });
  });
});
