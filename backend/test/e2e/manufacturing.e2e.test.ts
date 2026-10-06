import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
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
async function submit(doc: any) {
  return ok(await a.client.post(`/manufacturing/boms/${doc.id}/submit`, { version: doc.version }));
}

beforeAll(async () => {
  a = await signupWorkspace('mfg-a');
  emails.push(a.email);
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  item.crate = await created('/masters/items', { name: 'Moulded crate', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39231090' });
  item.kit = await created('/masters/items', { name: 'Handle kit', type: 'semi_finished', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39269099' });
  item.resin = await created('/masters/items', { name: 'HDPE resin', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39012000', standardCost: '100' });
  item.screw = await created('/masters/items', { name: 'Screw', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73181500', standardCost: '1.5' });
  item.grip = await created('/masters/items', { name: 'Grip', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39269099', standardCost: '4' });
  item.mbA = await created('/masters/items', { name: 'Masterbatch blue A', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '32041700', standardCost: '300' });
  item.mbB = await created('/masters/items', { name: 'Masterbatch blue B', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '32041700', standardCost: '280' });
  item.regrind = await created('/masters/items', { name: 'Regrind', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39151000' });
  res.printer = await created('/masters/parties', { name: 'Sri Screen Printers', isVendor: true, gstRegistrationType: 'unregistered', addresses: [{ type: 'both', line1: 'Road 1', city: 'Hyderabad', stateCode: '36', pincode: '500037', isDefault: true }] });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('resources', () => {
  it('work centres with hourly rates, machines and moulds', async () => {
    res.imm = await created('/manufacturing/work-centers', { code: 'IMM', name: 'Injection moulding', kind: 'machine', units: 3, labourRate: '120', machineRate: '300', overheadRate: '60' });
    res.assy = await created('/manufacturing/work-centers', { code: 'ASSY', name: 'Assembly', kind: 'manual', labourRate: '180' });
    expect(res.imm).toMatchObject({ hoursPerDay: '8.00', efficiencyPct: '100.00' });
    expect((await a.client.post('/manufacturing/work-centers', { code: 'IMM', name: 'Again' })).status).toBe(409);
    res.m1 = await created('/manufacturing/machines', { code: 'IMM-01', name: '250T injection moulder', workCenterId: res.imm.id, make: 'Ferromatik', capacity: '250 T' });
    res.mould = await created('/manufacturing/tools', { code: 'MLD-600', name: 'Crate 600x400 mould', kind: 'mould', cavities: 1, lifeShots: 500000, maintenanceEvery: 50000, machineId: res.m1.id });
    const tools = (await a.client.get('/manufacturing/tools')).body;
    expect(tools[0]).toMatchObject({ code: 'MLD-600', lifeUsedPct: 0, maintenanceDue: false });
  });
});

describe('BOMs', () => {
  it('needs an approved BOM for a phantom, then builds a multi-level BOM', async () => {
    const bad = await a.client.post('/manufacturing/boms', { itemId: item.crate.id, lines: [{ itemId: item.kit.id, qty: '1', isPhantom: true }] });
    expect(bad.body.errors[0].message).toMatch(/phantom needs an approved BOM/);
    ctx.kit = await submit(await created('/manufacturing/boms', { itemId: item.kit.id, lines: [{ itemId: item.screw.id, qty: '2' }, { itemId: item.grip.id, qty: '1' }], operations: [{ seq: 10, name: 'Assemble', workCenterId: res.assy.id, runMinutes: '0.5' }] }));
    expect(ctx.kit).toMatchObject({ status: 'approved', bomVersion: 1, isDefault: true, unitCost: '8.5000' });
    const bom = await created('/manufacturing/boms', {
      itemId: item.crate.id,
      quantity: '10',
      drawingNo: 'DRG-600',
      lines: [
        { itemId: item.resin.id, qty: '12', scrapPct: '2' },
        { itemId: item.kit.id, qty: '10', isPhantom: true, operationSeq: 20 },
        { itemId: item.mbA.id, qty: '0.2', alternateGroup: 'MB', priority: 1 },
        { itemId: item.mbB.id, qty: '0.2', alternateGroup: 'MB', priority: 2 },
        { kind: 'byproduct', itemId: item.regrind.id, qty: '0.5', recoveryRate: '40' },
      ],
      operations: [
        { seq: 10, name: 'Mould', workCenterId: res.imm.id, toolId: res.mould.id, setupMinutes: '60', runMinutes: '1.5' },
        { seq: 20, name: 'Fit handles', workCenterId: res.assy.id, runMinutes: '0.5', inspection: true },
        { seq: 30, name: 'Screen print', workCenterId: res.assy.id, isSubcontract: true, vendorId: res.printer.id, subcontractRate: '3' },
      ],
    });
    expect(bom.number).toBeNull();
    ctx.crate = await submit(bom);
    expect(ctx.crate.number).toMatch(/^BOM\//);
    expect(ctx.crate.lines).toHaveLength(5);
    expect(ctx.crate.operations.map((o: any) => o.workCenter)).toEqual(['IMM', 'ASSY', 'ASSY']);
  });

  it('explodes requirements: phantoms in place, alternates by priority, with scrap', async () => {
    const r = await ok(await a.client.get(`/manufacturing/boms/${ctx.crate.id}/explode?qty=100`));
    const req = Object.fromEntries(r.requirements.map((x: any) => [x.item.code ? x.item.name : x.itemId, x.qty]));
    expect(req).toEqual({ 'HDPE resin': '122.400000', Screw: '200.000000', Grip: '100.000000', 'Masterbatch blue A': '2.000000' });
  });

  it('rolls up the standard cost and can set it on the item', async () => {
    const c = await ok(await a.client.post(`/manufacturing/boms/${ctx.crate.id}/cost`, { apply: true }));
    // Material: resin 122.4 + kit 8.5 (7 of parts + 1.5 assembly) + masterbatch 6.
    expect(c).toMatchObject({ material: '136.9000', subcontract: '3.0000', byproductCredit: '2.0000', applied: true });
    // Mould 7.5 min × ₹480/h = 60; fitting 0.5 min × ₹180/h = 1.5.
    expect(c.operation).toBe('61.5000');
    expect(c.unitCost).toBe('199.4000');
    expect((await a.client.get(`/masters/items/${item.crate.id}`)).body.standardCost).toBe('199.4000');
  });

  it('new versions replace the default on approval; approved BOMs are frozen', async () => {
    expect((await a.client.request('PUT', `/manufacturing/boms/${ctx.crate.id}`, { itemId: item.crate.id, version: ctx.crate.version, lines: [{ itemId: item.resin.id, qty: '1' }] })).status).toBe(409);
    const v2 = await ok(await a.client.post(`/manufacturing/boms/${ctx.crate.id}/new-version`), 201);
    expect(v2).toMatchObject({ bomVersion: 2, status: 'draft', previousVersionId: ctx.crate.id });
    await submit(v2);
    const v1 = (await a.client.get(`/manufacturing/boms/${ctx.crate.id}`)).body;
    expect(v1.isDefault).toBe(false);
    expect(v1.effectiveTo).toBeTruthy();
    expect(v1.versions.map((v: any) => [v.version, v.isDefault])).toEqual([
      [2, true],
      [1, false],
    ]);
    const used = (await a.client.get(`/manufacturing/boms/where-used/${item.kit.id}`)).body;
    expect(used).toHaveLength(2);
  });

  it('refuses an item in its own BOM', async () => {
    const r = await a.client.post('/manufacturing/boms', { itemId: item.kit.id, lines: [{ itemId: item.kit.id, qty: '1' }] });
    expect(r.body.errors[0].message).toMatch(/own component/);
  });
});
