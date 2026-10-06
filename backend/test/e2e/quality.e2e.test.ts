import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

const OUR_GSTIN = '36AABCS1234E1ZU'; // Telangana (made up, valid check digit)
const VENDOR_GSTIN = '36AABCD1234E1Z9'; // made up

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let wh: Record<string, string> = {};
const item: Record<string, any> = {};
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
const Q = '/quality/inspections';
const inspections = async (query: string) => (await ok(await a.client.get(`${Q}?${query}`))).items;
const qi = async (id: string) => ok(await a.client.get(`${Q}/${id}`));
async function batchAt(itemId: string, warehouseId: string, batchNo: string) {
  const d = (await a.client.get(`/inventory/stock/${itemId}`)).body;
  return d.byBatch.find((b: any) => b.warehouseId === warehouseId && b.batchNo === batchNo)?.qty ?? '0.0000';
}

beforeAll(async () => {
  a = await signupWorkspace('qc-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  wh.QUAR = (await created('/inventory/warehouses', { code: 'QUAR', name: 'Quarantine', type: 'quarantine', isNettable: false })).id;
  wh.REJ = (await created('/inventory/warehouses', { code: 'REJ', name: 'Rejected', type: 'rejected', isNettable: false })).id;
  item.pin = await created('/masters/items', { name: 'Hinge pin', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73182990', trackBatch: true });
  item.rod = await created('/masters/items', { name: 'EN8 rod blank', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '72142090', trackBatch: true, standardCost: '40' });
  item.washer = await created('/masters/items', { name: 'Plain washer', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73182200', standardCost: '1' });
  const open = await created('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.washer.id, qty: '500', rate: '1' }] });
  await ok(await a.client.post(`/inventory/stock-entries/${open.id}/submit`, { version: open.version }));
  ctx.vendor = await created('/masters/parties', { name: 'Deccan Steels', isVendor: true, gstin: VENDOR_GSTIN, addresses: [{ type: 'both', line1: 'Road 3', city: 'Hyderabad', stateCode: '36', pincode: '500037', isDefault: true }] });
  const lathe = await created('/manufacturing/work-centers', { code: 'LATHE', name: 'CNC lathe', labourRate: '120', machineRate: '180' });
  const pack = await created('/manufacturing/work-centers', { code: 'PACK', name: 'Packing', kind: 'manual', labourRate: '60' });
  const bom = await created('/manufacturing/boms', {
    itemId: item.pin.id,
    lines: [{ itemId: item.rod.id, qty: '1' }, { itemId: item.washer.id, qty: '2' }],
    operations: [
      { seq: 10, name: 'Turn', workCenterId: lathe.id, runMinutes: '2', inspection: true },
      { seq: 20, name: 'Pack', workCenterId: pack.id, runMinutes: '0.2' },
    ],
  });
  await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: bom.version }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('sampling and plans', () => {
  it('follows ISO 2859-1 normal single sampling', async () => {
    expect(await ok(await a.client.get('/quality/sampling?lot=500&aql=1.0'))).toMatchObject({ letter: 'H', sampleSize: 50, accept: 1, reject: 2 });
    expect(await ok(await a.client.get('/quality/sampling?lot=1000&aql=2.5'))).toMatchObject({ letter: 'J', sampleSize: 80, accept: 5, reject: 6 });
    // Lot 200 is letter G (32), but AQL 1.0 points down to H.
    expect(await ok(await a.client.get('/quality/sampling?lot=200&aql=1.0'))).toMatchObject({ letter: 'H', sampleSize: 50, accept: 1, reject: 2 });
    expect(await ok(await a.client.get('/quality/sampling?lot=10&aql=0.65'))).toMatchObject({ sampleSize: 10, full: true, accept: 0 });
  });

  it('keeps plans with their characteristics', async () => {
    const bad = await a.client.post('/quality/plans', { code: 'IN-ROD', name: 'Rod incoming', itemId: item.rod.id, stage: 'incoming', parameters: [{ name: 'Diameter', kind: 'numeric' }] });
    expect(bad.status).toBe(400);
    ctx.inPlan = await created('/quality/plans', {
      code: 'IN-ROD',
      name: 'Rod blank incoming',
      itemId: item.rod.id,
      stage: 'incoming',
      aql: '1.0',
      parameters: [
        { name: 'Diameter', kind: 'numeric', unit: 'mm', nominal: '10', lowerLimit: '9.9', upperLimit: '10.1', method: 'Micrometer' },
        { name: 'Cracks', kind: 'attribute', isCritical: true, method: 'Visual' },
      ],
    });
    await created('/quality/plans', { code: 'FIN-PIN', name: 'Pin final', itemId: item.pin.id, stage: 'final', sampling: 'fixed', fixedSampleSize: 5, parameters: [{ name: 'Length', unit: 'mm', lowerLimit: '49.8', upperLimit: '50.2' }] });
    expect((await a.client.post('/quality/plans', { code: 'in-rod', name: 'Again', itemId: item.rod.id, stage: 'incoming', parameters: [{ name: 'X', kind: 'attribute' }] })).status).toBe(409);
    const plans = await ok(await a.client.get(`/quality/plans?itemId=${item.rod.id}`));
    expect(plans[0].parameters.map((p: any) => p.name)).toEqual(['Diameter', 'Cracks']);
  });
});

describe('incoming inspection', () => {
  it('raises an inspection when goods arrive, sized by the plan', async () => {
    const po = await created('/purchase/orders', { vendorId: ctx.vendor.id, lines: [{ itemId: item.rod.id, qty: '200', rate: '40' }] });
    const approved = await ok(await a.client.post(`/purchase/orders/${po.id}/submit`, { version: po.version }));
    const grn = await created('/purchase/receipts', { poId: approved.id, warehouseId: wh.QUAR, lines: [{ poLineId: approved.lines[0].id, receivedQty: '200', batchNo: 'R-001' }] });
    ctx.grn = await ok(await a.client.post(`/purchase/receipts/${grn.id}/submit`, { version: grn.version }));
    const [row] = await inspections('stage=incoming');
    expect(row).toMatchObject({ stage: 'incoming', result: 'pending', lotQty: '200.0000', sampleSize: 50, batchNo: 'R-001', source: ctx.grn.number });
    ctx.in = await qi(row.id);
    expect(ctx.in).toMatchObject({ status: 'draft', acceptNo: 1, rejectNo: 2, codeLetter: 'H', vendor: 'Deccan Steels', warehouse: { code: 'QUAR' } });
  });

  it('judges readings against limits and the accept number; a critical failure rejects', async () => {
    const [dia, crack] = ctx.in.parameters;
    let r = await ok(await a.client.request('PUT', `${Q}/${ctx.in.id}/readings`, { readings: [{ parameterId: dia.id, sampleNo: 1, value: '10.05' }, { parameterId: dia.id, sampleNo: 2, value: '10.2' }] }));
    expect(r).toMatchObject({ defectives: 1, suggestion: 'accept' });
    r = await ok(await a.client.request('PUT', `${Q}/${ctx.in.id}/readings`, { readings: [{ parameterId: dia.id, sampleNo: 1, value: '10.05' }, { parameterId: dia.id, sampleNo: 2, value: '10.2' }, { parameterId: crack.id, sampleNo: 3, passed: false }] }));
    expect(r).toMatchObject({ defectives: 2, suggestion: 'reject' });
    expect(r.readings).toHaveLength(3);
    expect((await a.client.request('PUT', `${Q}/${ctx.in.id}/readings`, { readings: [{ parameterId: dia.id, sampleNo: 51, value: '10' }] })).status).toBe(400);
    ctx.in = r;
  });

  it('moves accepted stock out of quarantine and rejects to the rejected store', async () => {
    const short = await a.client.post(`${Q}/${ctx.in.id}/submit`, { version: ctx.in.version, acceptedQty: '190', rejectedQty: '5' });
    expect(short.body.errors[0].message).toMatch(/add up to the lot of 200/);
    const nowhere = await a.client.post(`${Q}/${ctx.in.id}/submit`, { version: ctx.in.version, acceptedQty: '190', rejectedQty: '10' });
    expect(nowhere.body.errors[0].path).toBe('rejectWarehouseId');
    const done = await ok(await a.client.post(`${Q}/${ctx.in.id}/submit`, { version: ctx.in.version, acceptedQty: '190', rejectedQty: '10', releaseWarehouseId: wh.MAIN, rejectWarehouseId: wh.REJ, remarks: '100% screened after sample failure' }));
    expect(done).toMatchObject({ status: 'approved', result: 'partial', acceptedQty: '190.0000', rejectedQty: '10.0000' });
    expect(await batchAt(item.rod.id, wh.MAIN, 'R-001')).toBe('190.0000');
    expect(await batchAt(item.rod.id, wh.REJ, 'R-001')).toBe('10.0000');
    expect(await batchAt(item.rod.id, wh.QUAR, 'R-001')).toBe('0.0000');
  });
});

describe('in-process and final inspection', () => {
  it('raises in-process lots at flagged operations and takes rejects out of the flow', async () => {
    let w = await created('/manufacturing/work-orders', { itemId: item.pin.id, qty: '20', sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN });
    w = await ok(await a.client.post(`/manufacturing/work-orders/${w.id}/submit`, { version: w.version }));
    const issue = await created(`/manufacturing/work-orders/${w.id}/issue`, { all: true });
    expect(issue.lines.find((l: any) => l.code === item.rod.code)).toMatchObject({ batchNo: 'R-001', qty: '20.0000' });
    await created('/manufacturing/job-cards', { operationId: w.operations[0].id, goodQty: '20', minutes: '40' });
    const [row] = await inspections('stage=in_process');
    const ip = await qi(row.id);
    // No plan: the whole lot is inspected.
    expect(ip).toMatchObject({ lotQty: '20.0000', sampleSize: 20, plan: null, operation: { seq: 10, name: 'Turn' }, workOrder: { id: w.id } });
    await ok(await a.client.post(`${Q}/${ip.id}/submit`, { version: ip.version, acceptedQty: '18', rejectedQty: '2' }));
    const after = await ok(await a.client.get(`/manufacturing/work-orders/${w.id}`));
    expect(after.operations[0]).toMatchObject({ goodQty: '18.0000', rejectQty: '2.0000' });
    expect((await a.client.post('/manufacturing/job-cards', { operationId: w.operations[1].id, goodQty: '19', minutes: '4' })).status).toBe(400);
    await created('/manufacturing/job-cards', { operationId: w.operations[1].id, goodQty: '18', minutes: '4' });
    ctx.wo = w;
  });

  it('raises a final inspection on receipt; rework goes to the rejected store with a rework order', async () => {
    await created(`/manufacturing/work-orders/${ctx.wo.id}/receive`, { goodQty: '18', batchNo: 'P-001' });
    const [row] = await inspections('stage=final');
    const fin = await qi(row.id);
    expect(fin).toMatchObject({ lotQty: '18.0000', sampleSize: 5, batchNo: 'P-001', plan: { code: 'FIN-PIN' } });
    const done = await ok(await a.client.post(`${Q}/${fin.id}/submit`, { version: fin.version, acceptedQty: '16', reworkQty: '2', rejectWarehouseId: wh.REJ }));
    expect(done).toMatchObject({ result: 'partial', reworkOrder: { id: expect.any(String) } });
    expect(await batchAt(item.pin.id, wh.MAIN, 'P-001')).toBe('16.0000');
    expect(await batchAt(item.pin.id, wh.REJ, 'P-001')).toBe('2.0000');
    const rw = await ok(await a.client.get(`/manufacturing/work-orders/${done.reworkOrder.id}`));
    expect(rw).toMatchObject({ kind: 'rework', qty: '2.0000', status: 'draft', parent: { id: ctx.wo.id }, source: { code: 'REJ' } });
  });

  it('needs a location for a manual lot', async () => {
    const r = await a.client.post(Q, { stage: 'final', itemId: item.pin.id, lotQty: '5' });
    expect(r.body.errors[0].path).toBe('warehouseId');
    const m = await created(Q, { stage: 'final', itemId: item.pin.id, lotQty: '5', warehouseId: wh.MAIN, batchNo: 'P-001' });
    expect(m).toMatchObject({ sampleSize: 5, plan: { code: 'FIN-PIN' } });
  });
});

describe('traceability', () => {
  it('records the as-built lots of a work order', async () => {
    const ab = await ok(await a.client.get(`/quality/as-built/${ctx.wo.id}`));
    expect(ab.consumed.map((n: any) => [n.item.code, n.batchNo, n.qty])).toEqual(
      [
        [item.rod.code, 'R-001', '20.0000'],
        [item.washer.code, null, '40.0000'],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    expect(ab.made.map((n: any) => [n.batchNo, n.qty])).toEqual([['P-001', '18.0000']]);
  });

  it('traces a finished lot back to the vendor lot', async () => {
    const t = await ok(await a.client.get(`/quality/trace/backward?itemId=${item.pin.id}&batchNo=P-001`));
    expect(t).toMatchObject({ batchNo: 'P-001', qty: '18.0000' });
    expect(t.links).toHaveLength(1);
    expect(t.links[0]).toMatchObject({ docType: 'production_entry', workOrder: { id: ctx.wo.id } });
    const rod = t.links[0].lots.find((n: any) => n.item.id === item.rod.id);
    expect(rod).toMatchObject({ batchNo: 'R-001', qty: '20.0000' });
    expect(rod.links[0]).toMatchObject({ docType: 'goods_receipt', number: ctx.grn.number, party: 'Deccan Steels', qty: '200.0000' });
  });

  it('traces a vendor lot forward to what it went into and where that is now', async () => {
    const t = await ok(await a.client.get(`/quality/trace/forward?itemId=${item.rod.id}&batchNo=R-001`));
    expect(t.onHand.map((x: any) => [x.warehouse, x.qty]).sort()).toEqual([['MAIN', '170.0000'], ['REJ', '10.0000']]);
    expect(t.links).toHaveLength(1);
    const pin = t.links[0].lots[0];
    expect(pin).toMatchObject({ batchNo: 'P-001', qty: '18.0000' });
    expect(pin.onHand.map((x: any) => [x.warehouse, x.qty]).sort()).toEqual([['MAIN', '16.0000'], ['REJ', '2.0000']]);
    expect((await a.client.get(`/quality/trace/backward?itemId=${item.washer.id}`)).status).toBe(400);
  });
});
