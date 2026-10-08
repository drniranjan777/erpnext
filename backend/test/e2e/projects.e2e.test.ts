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
const day = (n: number) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  a = await signupWorkspace('proj-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.billing = await ok(await a.client.post('/masters/items', { name: 'Project services', type: 'service', baseUomId: uom.NOS, gstRate: 18, hsnCode: '998719' }), 201);
  ctx.steel = await ok(await a.client.post('/masters/items', { name: 'Structural steel', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '72163100' }), 201);
  ctx.cust = await ok(await a.client.post('/masters/parties', { name: 'Telangana Power Ltd', isCustomer: true, gstin: '36AABCD1234E1Z9', addresses: [{ type: 'both', line1: 'Khairatabad', city: 'Hyderabad', stateCode: '36', pincode: '500004', isDefault: true }] }), 201);
  const loc = await ok(await a.client.post('/hr/org/locations', { code: 'HYD', name: 'Hyderabad', stateCode: '36' }), 201);
  ctx.kiran = await ok(await a.client.post('/hr/employees', { firstName: 'Kiran', gender: 'male', dateOfJoining: day(-400), locationId: loc.id }), 201);
  ctx.wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'MAIN');
  const e = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: ctx.wh.id, lines: [{ itemId: ctx.steel.id, qty: '5000', rate: '60' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${e.id}/submit`, { version: e.version }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('projects', () => {
  it('plans a project with WBS, milestones and resources', async () => {
    let p = await ok(await a.client.post('/projects', { code: 'PRJ-101', name: 'Conveyor system for coal yard', customerId: ctx.cust.id, contractValue: 2_000_000, billingItemId: ctx.billing.id, startDate: day(-30), endDate: day(60) }), 201);
    expect((await a.client.post('/projects', { code: 'prj-101', name: 'Duplicate', startDate: day(0), endDate: day(1) })).status).toBe(409);
    ctx.p = p;
    p = await ok(await a.client.post(`/projects/${p.id}/wbs`, { code: '1', name: 'Design and fabrication', plannedStart: day(-30), plannedEnd: day(30) }), 201);
    const root = p.wbs[0];
    expect((await a.client.post(`/projects/${p.id}/wbs`, { parentId: root.id, code: '2.1', name: 'Wrong', plannedStart: day(-30), plannedEnd: day(0) })).status).toBe(400);
    p = await ok(await a.client.post(`/projects/${p.id}/wbs`, { parentId: root.id, code: '1.1', name: 'Fabrication', plannedStart: day(-29), plannedEnd: day(0), budgetMaterial: 400000, budgetLabour: 100000 }), 201);
    p = await ok(await a.client.post(`/projects/${p.id}/wbs`, { parentId: root.id, code: '1.2', name: 'Erection', plannedStart: day(1), plannedEnd: day(30), budgetSubcontract: 300000 }), 201);
    ctx.fab = p.wbs.find((x: any) => x.code === '1.1');
    expect(p.wbs.find((x: any) => x.code === '1').totals.budget).toBe(800000);
    p = await ok(await a.client.post(`/projects/${p.id}/milestones`, { name: 'Drawings approved', dueDate: day(-10), pct: 20 }), 201);
    expect((await a.client.post(`/projects/${p.id}/milestones`, { name: 'Too much', dueDate: day(10), pct: 90 })).status).toBe(409);
    p = await ok(await a.client.post(`/projects/${p.id}/milestones`, { name: 'Supply complete', dueDate: day(10), pct: 50 }), 201);
    expect(p.milestones.map((m: any) => m.amount)).toEqual([400000, 1000000]);
    p = await ok(await a.client.post(`/projects/${p.id}/resources`, { wbsId: ctx.fab.id, employeeId: ctx.kiran.id, fromDate: day(-29), toDate: day(30), hoursPerWeek: 40, costRate: 500 }), 201);
    await ok(await a.client.post('/projects', { code: 'PRJ-102', name: 'Second project', startDate: day(0), endDate: day(30) }), 201);
    const list = await ok(await a.client.get('/projects'));
    const p2 = list.find((x: any) => x.code === 'PRJ-102');
    const w2 = await ok(await a.client.post(`/projects/${p2.id}/wbs`, { code: '1', name: 'All', plannedStart: day(0), plannedEnd: day(30) }), 201);
    await ok(await a.client.post(`/projects/${p2.id}/resources`, { employeeId: ctx.kiran.id, fromDate: day(0), toDate: day(20), hoursPerWeek: 20 }), 201);
    expect(w2.wbs).toHaveLength(1);
    const load = await ok(await a.client.get('/projects/resource-load?weeks=4'));
    expect(load.people[0].overloaded.length).toBeGreaterThan(0);
  });

  it('collects costs and time, and reports earned value', async () => {
    const pid = ctx.p.id;
    const issue = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'material_issue', fromWarehouseId: ctx.wh.id, lines: [{ itemId: ctx.steel.id, qty: '3000' }] }), 201);
    const posted = await ok(await a.client.post(`/inventory/stock-entries/${issue.id}/submit`, { version: issue.version }));
    const found = await ok(await a.client.get(`/projects/documents?q=${encodeURIComponent(posted.number)}`));
    expect(found.map((d: any) => d.id)).toContain(issue.id);
    let p = await ok(await a.client.post(`/projects/${pid}/costs`, { wbsId: ctx.fab.id, documentId: issue.id, costType: 'material' }), 201);
    expect((await a.client.post(`/projects/${pid}/costs`, { wbsId: ctx.fab.id, documentId: issue.id, costType: 'material' })).status).toBe(409);
    p = await ok(await a.client.post(`/projects/${pid}/time`, { wbsId: ctx.fab.id, employeeId: ctx.kiran.id, workDate: day(-1), hours: 8, note: 'Welding' }), 201);
    expect((await a.client.post(`/projects/${pid}/time`, { wbsId: ctx.fab.id, employeeId: ctx.kiran.id, workDate: day(-1), hours: 20 })).status).toBe(409);
    p = await ok(await a.client.post(`/projects/${pid}/time/approve`, { ids: p.timesheets.map((t: any) => t.id) }));
    const fab = p.wbs.find((x: any) => x.code === '1.1');
    expect(fab.actual).toEqual({ material: 180000, labour: 4000, subcontract: 0, other: 0 });
    p = await ok(await a.client.post(`/projects/wbs/${fab.id}/progress`, { progressPct: 50 }));
    expect(p.evm).toMatchObject({ bac: 800000, ev: 250000, ac: 184000 });
    expect(p.evm.cpi).toBeCloseTo(1.36, 2);
  });

  it('bills achieved milestones through sales invoices', async () => {
    const pid = ctx.p.id;
    let p = await ok(await a.client.get(`/projects/${pid}`));
    const m = p.milestones[0];
    expect((await a.client.post(`/projects/milestones/${m.id}/bill`, {})).status).toBe(409);
    await ok(await a.client.post(`/projects/milestones/${m.id}/achieved`, {}));
    p = await ok(await a.client.post(`/projects/milestones/${m.id}/bill`, {}));
    const billed = p.milestones.find((x: any) => x.id === m.id);
    expect(billed.status).toBe('billed');
    expect(billed.invoice.status).toBe('draft');
    expect(p.billing.billed).toBe(400000);
    expect(p.billing.revenueEarned).toBe(625000);
    expect((await a.client.post(`/projects/milestones/${m.id}/bill`, {})).status).toBe(409);
  });
});
