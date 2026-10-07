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

async function created(path: string, body: unknown) {
  const r = await a.client.post(path, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const Q = '/quality';

beforeAll(async () => {
  a = await signupWorkspace('impr-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.shaft = await created('/masters/items', { name: 'Drive shaft', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '84831099' });
  item.bearing = await created('/masters/items', { name: 'Ball bearing 6204', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '84821011' });
  res.customer = await created('/masters/parties', { name: 'Deccan Motors', isCustomer: true, gstin: CUSTOMER_GSTIN, addresses: [{ type: 'both', line1: 'Main road', city: 'Hyderabad', stateCode: '36', pincode: '500001', isDefault: true }] });
  res.vendor = await created('/masters/parties', { name: 'Bearing House', isVendor: true, gstRegistrationType: 'unregistered', addresses: [{ type: 'both', line1: 'Road 2', city: 'Hyderabad', stateCode: '36', pincode: '500037', isDefault: true }] });
  res.plan = await created(`${Q}/plans`, {
    code: 'SH-FIN',
    name: 'Shaft final',
    itemId: item.shaft.id,
    stage: 'final',
    sampling: 'fixed',
    fixedSampleSize: 5,
    parameters: [
      { name: 'Diameter', kind: 'numeric', unit: 'mm', lowerLimit: '9.9', upperLimit: '10.1' },
      { name: 'Visual', kind: 'attribute' },
    ],
  });
  await created(`${Q}/plans`, { code: 'BRG-IN', name: 'Bearing incoming', itemId: item.bearing.id, stage: 'incoming', sampling: 'fixed', fixedSampleSize: 1, parameters: [{ name: 'Noise', kind: 'attribute' }] });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('SPC', () => {
  it('charts a measured characteristic with capability, and a pass/fail one', async () => {
    const lots = [
      [10.0, 10.02, 9.98, 10.01, 9.99],
      [10.01, 10.03, 9.99, 10.0, 10.02],
      [9.98, 10.0, 10.01, 9.97, 10.0],
      [10.02, 10.04, 10.0, 10.01, 10.03],
    ];
    for (const [i, vals] of lots.entries()) {
      const qi = await created(`${Q}/inspections`, { stage: 'final', itemId: item.shaft.id, lotQty: '100', warehouseId: wh.MAIN });
      const [dia, vis] = qi.parameters;
      await ok(await a.client.request('PUT', `${Q}/inspections/${qi.id}/readings`, { readings: [...vals.map((v, s) => ({ parameterId: dia.id, sampleNo: s + 1, value: String(v) })), ...vals.map((_, s) => ({ parameterId: vis.id, sampleNo: s + 1, passed: !(i === 2 && s < 2) }))] }));
    }
    const params = await ok(await a.client.get(`${Q}/spc/parameters?itemId=${item.shaft.id}`));
    expect(params.map((p: any) => [p.name, p.lots])).toEqual([['Diameter', 4], ['Visual', 4]]);
    const dia = await ok(await a.client.get(`${Q}/spc?parameterId=${params[0].id}`));
    expect(dia).toMatchObject({ type: 'X-bar R', subgroups: 4, subgroupSize: 5 });
    const [xbar, range] = dia.charts;
    expect(xbar.points).toHaveLength(4);
    expect(xbar.limits.center).toBeCloseTo(10.0055, 4);
    expect(range.limits.center).toBeCloseTo(0.04, 4);
    // σ = R̄ / d2 = 0.04 / 2.326; Cp = 0.2 / 6σ = 1.938.
    expect(dia.capability.cp).toBeCloseTo(1.938, 2);
    expect(dia.capability.cpk).toBeLessThan(dia.capability.cp);
    const vis = await ok(await a.client.get(`${Q}/spc?parameterId=${params[1].id}`));
    expect(vis.type).toBe('np');
    expect(vis.charts[0].points.map((p: any) => p.value)).toEqual([0, 0, 2, 0]);
    expect(vis.charts[0].limits.center).toBe(0.5);
  });
});

describe('CAPA', () => {
  it('needs a root cause and actions, then closes only when effective', async () => {
    let c = await created(`${Q}/capas`, { source: 'internal', problem: 'Diameter drifting high on lathe 3', method: '5why', whys: ['Tool wear', 'Insert changed late', 'No tool-life counter'], actions: [] });
    expect((await a.client.post(`${Q}/capas/${c.id}/submit`, { version: c.version })).status).toBe(400);
    c = await ok(await a.client.request('PUT', `${Q}/capas/${c.id}`, {
      version: c.version,
      source: 'internal',
      problem: 'Diameter drifting high on lathe 3',
      method: 'fishbone',
      fishbone: { machine: ['Insert wear'], method: ['No tool-life rule'] },
      rootCause: 'Inserts run past their life: no tool-life counter',
      actions: [
        { kind: 'corrective', action: 'Add a tool-life counter to the CNC', owner: 'Maintenance', dueDate: addDays(today(), 7) },
        { kind: 'preventive', action: 'Tool-life rule in the setup sheet', owner: 'Engineering' },
      ],
    }));
    expect(c.fishbone).toEqual({ machine: ['Insert wear'], method: ['No tool-life rule'] });
    c = await ok(await a.client.post(`${Q}/capas/${c.id}/submit`, { version: c.version }));
    expect(c).toMatchObject({ status: 'approved', stage: 'open', canAct: true, canVerify: false });
    c = await ok(await a.client.request('PUT', `${Q}/capas/${c.id}/actions/${c.actions[0].id}`, { done: true }));
    expect(c.stage).toBe('open');
    c = await ok(await a.client.request('PUT', `${Q}/capas/${c.id}/actions/${c.actions[1].id}`, { done: true, notes: 'Rev 3 of the setup sheet' }));
    expect(c).toMatchObject({ stage: 'verification', canVerify: true });
    c = await ok(await a.client.post(`${Q}/capas/${c.id}/verify`, { version: c.version, effective: false, notes: 'Drift seen again on 12 Oct' }));
    expect(c).toMatchObject({ stage: 'open', effectivenessResult: 'not_effective' });
    c = await ok(await a.client.post(`${Q}/capas/${c.id}/actions`, { kind: 'corrective', action: 'Change insert grade' }));
    c = await ok(await a.client.request('PUT', `${Q}/capas/${c.id}/actions/${c.actions[2].id}`, { done: true }));
    c = await ok(await a.client.post(`${Q}/capas/${c.id}/verify`, { version: c.version, effective: true, notes: 'Cpk 1.6 over four weeks' }));
    expect(c).toMatchObject({ stage: 'closed', effectivenessResult: 'effective', canAct: false });
    expect(c.closedAt).toBeTruthy();
  });

  it('sends a SCAR to a supplier', async () => {
    const s = await created(`${Q}/capas`, { source: 'supplier', isScar: true, partyId: res.vendor.id, responseDue: addDays(today(), 14), problem: 'Noisy bearings in lot B-17' });
    let c = await ok(await a.client.post(`${Q}/capas/${s.id}/submit`, { version: s.version }));
    expect(c).toMatchObject({ isScar: true, stage: 'verification', party: { id: res.vendor.id } });
    c = await ok(await a.client.post(`${Q}/capas/${s.id}/verify`, { version: c.version, effective: true, notes: '8D received and verified' }));
    expect(c.stage).toBe('closed');
    const scars = await ok(await a.client.get(`${Q}/capas?scar=true`));
    expect(scars.items.map((x: any) => x.id)).toEqual([s.id]);
  });
});

describe('customer complaints', () => {
  it('logs, investigates, responds and closes', async () => {
    let c = await created(`${Q}/complaints`, { customerId: res.customer.id, itemId: item.shaft.id, batchNo: 'sh-11', qty: '10', category: 'Wrong diameter', description: 'Ten shafts do not fit the coupling', isFieldFailure: true, warrantyCost: '4500', responseDays: 3 });
    expect(c).toMatchObject({ status: 'approved', stage: 'open', responseDue: addDays(today(), 3), batchNo: 'SH-11', overdue: false });
    const ncr = await created(`${Q}/complaints/${c.id}/ncr`, {});
    expect(ncr).toMatchObject({ source: 'customer', qtyAffected: '10.0000', party: { id: res.customer.id }, status: 'draft' });
    const capa = await created(`${Q}/complaints/${c.id}/capa`, {});
    expect(capa).toMatchObject({ method: '8d', source: 'complaint', eightD: { d2: 'Ten shafts do not fit the coupling' }, ncr: { id: ncr.id } });
    c = await ok(await a.client.get(`${Q}/complaints/${c.id}`));
    expect(c).toMatchObject({ stage: 'investigating', ncr: { id: ncr.id }, capa: { id: capa.id } });
    expect((await a.client.post(`${Q}/complaints/${c.id}/close`, {})).status).toBe(409);
    expect((await a.client.post(`${Q}/complaints/${c.id}/capa`, {})).status).toBe(409);
    c = await ok(await a.client.request('PUT', `${Q}/complaints/${c.id}/response`, { response: 'Replacement shafts dispatched; 8D to follow' }));
    expect(c.stage).toBe('responded');
    c = await ok(await a.client.post(`${Q}/complaints/${c.id}/close`, {}));
    expect(c.stage).toBe('closed');
    const an = await ok(await a.client.get(`${Q}/complaints/analysis`));
    expect(an.totals).toMatchObject({ count: 1, open: 0, fieldFailures: 1, warrantyCost: '4500.00' });
    expect(an.byCategory[0]).toMatchObject({ key: 'Wrong diameter', count: 1 });
  });
});

describe('supplier quality', () => {
  it('scores vendors from inspections, deliveries and audits', async () => {
    const po = await created('/purchase/orders', { vendorId: res.vendor.id, lines: [{ itemId: item.bearing.id, qty: '100', rate: '45' }] });
    const approved = await ok(await a.client.post(`/purchase/orders/${po.id}/submit`, { version: po.version }));
    const grn = await created('/purchase/receipts', { poId: approved.id, warehouseId: wh.MAIN, lines: [{ poLineId: approved.lines[0].id, receivedQty: '100' }] });
    await ok(await a.client.post(`/purchase/receipts/${grn.id}/submit`, { version: grn.version }));
    const [row] = (await ok(await a.client.get(`${Q}/inspections?itemId=${item.bearing.id}`))).items;
    const qi = await ok(await a.client.get(`${Q}/inspections/${row.id}`));
    const v = await ok(await a.client.request('PUT', `${Q}/inspections/${qi.id}/readings`, { readings: [{ parameterId: qi.parameters[0].id, sampleNo: 1, passed: true }] }));
    await ok(await a.client.post(`${Q}/inspections/${qi.id}/submit`, { version: v.version, acceptedQty: '100' }));

    expect((await a.client.post(`${Q}/suppliers/audits`, { partyId: res.customer.id, auditDate: today(), auditor: 'QA', result: 'approved' })).status).toBe(400);
    await created(`${Q}/suppliers/audits`, { partyId: res.vendor.id, auditDate: today(), kind: 'process', auditor: 'S. Rao', score: '80', result: 'approved', findings: 'Calibration records incomplete', nextDue: addDays(today(), 365) });
    await created(`${Q}/suppliers/aml`, { itemId: item.bearing.id, manufacturer: 'SKF', mpn: '6204-2Z', partyId: res.vendor.id });
    expect((await a.client.post(`${Q}/suppliers/aml`, { itemId: item.bearing.id, manufacturer: 'SKF', mpn: '6204-2Z' })).status).toBe(409);
    const aml = await ok(await a.client.get(`${Q}/suppliers/aml?itemId=${item.bearing.id}`));
    expect(aml[0]).toMatchObject({ manufacturer: 'SKF', supplier: 'Bearing House', status: 'approved' });

    const card = await ok(await a.client.get(`${Q}/suppliers/scorecard`));
    const bh = card.find((r: any) => r.vendor.id === res.vendor.id);
    // 50 % × 100 + 30 % × 100 + 20 % × 80 = 96.
    expect(bh).toMatchObject({ lots: 1, acceptancePct: 100, ppm: 0, deliveries: 1, onTimePct: 100, openScars: 0, score: 96, grade: 'A', lastAudit: { score: '80.0', result: 'approved' } });
  });
});
