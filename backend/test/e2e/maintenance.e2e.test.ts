import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

const OUR_GSTIN = '36AABCS1234E1ZU'; // made up, valid check digit

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let wh: Record<string, string> = {};
const item: Record<string, any> = {};
const res: Record<string, any> = {};
const ctx: Record<string, any> = {};

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

async function created(path: string, body: unknown) {
  const r = await a.client.post(path, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const MT = '/maintenance';

beforeAll(async () => {
  a = await signupWorkspace('maint-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.belt = await created('/masters/items', { name: 'V-belt B-52', type: 'spare', baseUomId: uom.NOS, gstRate: 18, hsnCode: '40103999' });
  const open = await created('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.belt.id, qty: '10', rate: '500' }] });
  await ok(await a.client.post(`/inventory/stock-entries/${open.id}/submit`, { version: open.version }));
  res.wc = await created('/manufacturing/work-centers', { code: 'PRESS', name: 'Press shop', hoursPerDay: '24', shiftStart: 0, daysPerWeek: 7 });
  res.machine = await created('/manufacturing/machines', { code: 'PP-01', name: '100 T press', workCenterId: res.wc.id });
  res.vendor = await created('/masters/parties', { name: 'Hydraulics Services', isVendor: true, gstRegistrationType: 'unregistered', addresses: [{ type: 'both', line1: 'Road 2', city: 'Hyderabad', stateCode: '36', pincode: '500037', isDefault: true }] });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('assets', () => {
  it('builds the hierarchy without loops', async () => {
    res.plant = await created(`${MT}/assets`, { code: 'PLANT', name: 'Uppal plant', level: 'plant' });
    res.line = await created(`${MT}/assets`, { code: 'LINE-1', name: 'Press line', level: 'line', parentId: res.plant.id });
    res.press = await created(`${MT}/assets`, { code: 'PRS-01', name: '100 T press', level: 'machine', parentId: res.line.id, machineId: res.machine.id, criticality: 'A', meterUnit: 'hours', warrantyUntil: addDays(today(), 100) });
    expect((await a.client.request('PUT', `${MT}/assets/${res.plant.id}`, { code: 'PLANT', name: 'Uppal plant', level: 'plant', parentId: res.press.id })).status).toBe(400);
    expect((await a.client.post(`${MT}/assets`, { code: 'prs-01', name: 'Copy' })).status).toBe(409);
    const list = await ok(await a.client.get(`${MT}/assets`));
    expect(list.find((x: any) => x.id === res.press.id)).toMatchObject({ parentId: res.line.id, machineCode: 'PP-01', inWarranty: true, status: 'running' });
    const line = await ok(await a.client.get(`${MT}/assets/${res.line.id}`));
    expect(line.children.map((c: any) => c.code)).toEqual(['PRS-01']);
    await created(`${MT}/assets/${res.press.id}/spares`, { itemId: item.belt.id, isCritical: true, minQty: '10' });
  });
});

describe('breakdown maintenance', () => {
  it('takes the machine down, issues spares at sign-off and books the cost', async () => {
    let o = await created(`${MT}/orders`, { kind: 'breakdown', assetId: res.press.id, problem: 'Ram not returning', requestedBy: 'Shift supervisor', reportedAt: hoursAgo(3) });
    expect(o).toMatchObject({ kind: 'breakdown', priority: 'high', machineDown: true, stage: 'open', canStart: true });
    expect((await ok(await a.client.get(`${MT}/assets/${res.press.id}`))).status).toBe('down');
    expect((await a.client.post(`${MT}/orders/${o.id}/submit`, { version: o.version })).status).toBe(409);
    o = await ok(await a.client.post(`${MT}/orders/${o.id}/start`, { version: o.version, assignedTo: 'Ravi (fitter)', startedAt: hoursAgo(2) }));
    const finished = new Date(Date.parse(o.reportedAt) + 180 * 60_000).toISOString();
    o = await ok(await a.client.post(`${MT}/orders/${o.id}/complete`, { version: o.version, finishedAt: finished, failureCode: 'Hydraulic: seal leak', actionTaken: 'Replaced return-line seal and belt', labour: [{ person: 'Ravi', hours: '1.5', rate: '400' }], spares: [{ itemId: item.belt.id, warehouseId: wh.MAIN, qty: '2' }], otherCost: '250' }));
    expect(o).toMatchObject({ stage: 'done', downtimeMinutes: 180, labourCost: '600.00', canSignOff: true });
    o = await ok(await a.client.post(`${MT}/orders/${o.id}/submit`, { version: o.version }));
    expect(o).toMatchObject({ status: 'approved', sparesCost: '1000.00', totalCost: '1850.00' });
    expect(o.spares[0]).toMatchObject({ code: item.belt.code, value: '1000.00' });
    expect((await ok(await a.client.get(`${MT}/assets/${res.press.id}`))).status).toBe('running');
    const stock = (await ok(await a.client.get(`/inventory/stock/${item.belt.id}`))).byWarehouse.find((w: any) => w.warehouseId === wh.MAIN);
    expect(Number(stock.qty)).toBe(8);
    const tb = await ok(await a.client.get(`/accounting/trial-balance?to=${addDays(today(), 1)}`));
    expect(Number(tb.rows.find((r: any) => r.systemKey === 'maintenance_consumed')?.closing)).toBe(1000);
    // Below its minimum of 10.
    const crit = await ok(await a.client.get(`${MT}/assets/critical-spares`));
    expect(crit).toEqual([expect.objectContaining({ code: item.belt.code, stock: '8.0000', assets: 'PRS-01' })]);
  });
});

describe('preventive maintenance', () => {
  it('opens due PM orders once, and rolls the schedule forward on sign-off', async () => {
    const s = await created(`${MT}/pm`, { assetId: res.press.id, title: 'Monthly lubrication', trigger: 'time', intervalDays: 30, firstDue: today(), checklist: ['Grease slides', 'Check oil level'], estimatedMinutes: 45 });
    expect(s.nextDue).toBe(today());
    const g = await ok(await a.client.post(`${MT}/pm/generate`, {}));
    expect(g.created).toHaveLength(1);
    expect((await ok(await a.client.post(`${MT}/pm/generate`, {}))).created).toHaveLength(0);
    let o = await ok(await a.client.get(`${MT}/orders/${g.created[0].id}`));
    expect(o).toMatchObject({ kind: 'preventive', machineDown: false, schedule: { id: s.id }, checklist: [{ item: 'Grease slides', ok: null }, { item: 'Check oil level', ok: null }] });
    o = await ok(await a.client.post(`${MT}/orders/${o.id}/start`, { version: o.version }));
    expect((await a.client.post(`${MT}/orders/${o.id}/complete`, { version: o.version, actionTaken: 'Done', checklist: [{ item: 'Grease slides', ok: true }] })).status).toBe(400);
    o = await ok(await a.client.post(`${MT}/orders/${o.id}/complete`, { version: o.version, actionTaken: 'Lubricated', checklist: [{ item: 'Grease slides', ok: true }, { item: 'Check oil level', ok: true }], meterReading: '120' }));
    expect(o.downtimeMinutes).toBe(0);
    await ok(await a.client.post(`${MT}/orders/${o.id}/submit`, { version: o.version }));
    const pm = (await ok(await a.client.get(`${MT}/pm`))).find((x: any) => x.id === s.id);
    expect(pm).toMatchObject({ lastDoneOn: today(), nextDue: addDays(today(), 30), state: 'ok', openOrder: null });
    expect((await ok(await a.client.get(`${MT}/assets/${res.press.id}`))).meterReading).toBe('120.0000');
    expect(await ok(await a.client.get(`${MT}/pm/compliance`))).toMatchObject({ done: 1, onTime: 1 });
  });

  it('triggers meter-based PM from readings', async () => {
    const s = await created(`${MT}/pm`, { assetId: res.press.id, title: 'Hydraulic oil change', trigger: 'meter', intervalMeter: '250' });
    expect(s.nextMeter).toBe('370.0000');
    expect((await a.client.post(`${MT}/assets/${res.press.id}/meter`, { reading: '100' })).status).toBe(400);
    await ok(await a.client.post(`${MT}/assets/${res.press.id}/meter`, { reading: '300' }));
    expect((await ok(await a.client.post(`${MT}/pm/generate`, {}))).created).toHaveLength(0);
    await ok(await a.client.post(`${MT}/assets/${res.press.id}/meter`, { reading: '371' }));
    const g = await ok(await a.client.post(`${MT}/pm/generate`, {}));
    expect(g.created.map((c: any) => c.title)).toEqual(['Hydraulic oil change']);
  });
});

describe('reliability, OEE and AMC', () => {
  it('computes MTTR / MTBF and availability', async () => {
    const rel = await ok(await a.client.get(`${MT}/reliability`));
    const p = rel.find((r: any) => r.asset.code === 'PRS-01');
    expect(p).toMatchObject({ failures: 1, downtimeHours: 3, mttrHours: 3, breakdownCost: '1850.00', plannedCost: '0.00' });
    // 90 days round the clock less 3 hours down.
    expect(p.mtbfHours).toBe(2160 - 3);
    const oee = await ok(await a.client.get(`${MT}/oee`));
    const m = oee.find((r: any) => r.machine.code === 'PP-01');
    expect(m).toMatchObject({ plannedMinutes: 129600, downtimeMinutes: 180, performancePct: null, oeePct: null });
    expect(m.availabilityPct).toBeCloseTo(99.9, 1);
  });

  it('tracks AMC visits against the response time', async () => {
    const c = await created(`${MT}/amc`, { vendorId: res.vendor.id, title: 'Press hydraulics AMC', assetIds: [res.press.id], startDate: addDays(today(), -30), endDate: addDays(today(), 335), value: '60000', visitsPerYear: 4, responseHours: 4 });
    expect((await a.client.post(`${MT}/amc`, { vendorId: res.vendor.id, title: 'Bad', startDate: today(), endDate: today() })).status).toBe(400);
    await created(`${MT}/amc/${c.id}/visits`, { kind: 'breakdown', calledAt: hoursAgo(6), attendedAt: hoursAgo(1), engineer: 'S. Kumar' });
    await created(`${MT}/amc/${c.id}/visits`, { kind: 'preventive', attendedAt: hoursAgo(1) });
    expect((await a.client.post(`${MT}/amc/${c.id}/visits`, { kind: 'breakdown', attendedAt: hoursAgo(1) })).status).toBe(400);
    expect((await a.client.post(`${MT}/amc/${c.id}/visits`, { kind: 'preventive', attendedAt: new Date(Date.now() - 60 * 86_400_000).toISOString() })).status).toBe(409);
    const list = await ok(await a.client.get(`${MT}/amc`));
    expect(list[0]).toMatchObject({ preventiveVisits: 1, breakdownVisits: 1, slaMissed: 1, state: 'active', assets: [{ code: 'PRS-01', name: '100 T press' }] });
    const visits = await ok(await a.client.get(`${MT}/amc/${c.id}/visits`));
    expect(visits.find((v: any) => v.kind === 'breakdown')).toMatchObject({ withinSla: false, responseHours: '5.0' });
  });
});

describe('TPM', () => {
  it('records autonomous checks, kaizen and 5S', async () => {
    const cl = await created(`${MT}/am-checklists`, { assetId: res.press.id, title: 'Daily press check', frequency: 'daily', items: ['Oil level in window', 'No leaks', 'Guards in place'] });
    expect((await a.client.post(`${MT}/am-checklists/${cl.id}/checks`, { doneBy: 'Operator 7', results: [{ ok: true }] })).status).toBe(400);
    const ck = await created(`${MT}/am-checklists/${cl.id}/checks`, { doneBy: 'Operator 7', results: [{ ok: true }, { ok: false, note: 'Seep at fitting' }, { ok: true }] });
    expect(ck.abnormalities).toBe(1);
    expect((await a.client.post(`${MT}/am-checklists/${cl.id}/checks`, { doneBy: 'Operator 7', results: [{ ok: true }, { ok: true }, { ok: true }] })).status).toBe(409);
    const lists = await ok(await a.client.get(`${MT}/am-checklists?assetId=${res.press.id}`));
    expect(lists[0]).toMatchObject({ lastDone: today(), abnormalities30d: 1, everyDays: 1 });

    await created(`${MT}/kaizens`, { title: 'Quick die change trolley', area: 'Press shop', category: 'delivery', before: 'Die change 45 min with crane', after: 'Die change 12 min on a roller trolley', annualSavings: '180000', submittedBy: 'Imran', implementedOn: today() });
    const kz = await ok(await a.client.get(`${MT}/kaizens`));
    expect(kz.year).toMatchObject({ count: 1, implemented: 1, savings: '180000.00' });

    await created(`${MT}/five-s`, { area: 'Press shop', auditDate: addDays(today(), -30), auditor: 'QA', sort: 2, setInOrder: 2, shine: 3, standardise: 2, sustain: 2 });
    await created(`${MT}/five-s`, { area: 'Press shop', auditor: 'QA', sort: 4, setInOrder: 3, shine: 4, standardise: 3, sustain: 3 });
    const fs = await ok(await a.client.get(`${MT}/five-s`));
    expect(fs[0]).toMatchObject({ total: 17, change: 6 });
  });
});
