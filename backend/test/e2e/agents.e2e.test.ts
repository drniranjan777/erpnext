import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let viewer: Awaited<ReturnType<typeof addMember>>;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const AI = '/ai';

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const put = (path: string, b: unknown) => a.client.request('PUT', path, b);
async function submit(path: string, doc: any) {
  return ok(await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version }));
}
async function entry(body: Record<string, unknown>) {
  return submit('/inventory/stock-entries', await ok(await a.client.post('/inventory/stock-entries', body), 201));
}
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const find = (list: any[], kind: string, code?: string) => list.find((r) => r.kind === kind && (!code || r.title.includes(code)));

beforeAll(async () => {
  a = await signupWorkspace('ai-a');
  emails.push(a.email);
  const role = await ok(await a.client.post('/iam/roles', { name: 'Inbox only', permissions: ['ai.inbox.use', 'inventory.stock.read'] }), 201);
  viewer = await addMember(a.client, 'ai-view', [role.id]);
  emails.push(viewer.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id])).MAIN;
  const mk = async (name: string, patch: Record<string, unknown> = {}) => ok(await a.client.post('/masters/items', { name, type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39011010', ...patch }), 201);
  ctx.resin = await mk('HDPE resin', { reorderLevel: '50', reorderQty: '200', leadTimeDays: 7 });
  ctx.pigment = await mk('Blue pigment', { reorderLevel: '20' });
  ctx.gear = await mk('Spur gear', { baseUomId: uom.NOS });
  ctx.vax = await mk('Culture media', { trackBatch: true, hasExpiry: true, shelfLifeDays: 365 });
  ctx.vendor = await ok(await a.client.post('/masters/parties', { name: 'Telangana Polymers', isVendor: true, gstin: '36AABCS1234E1ZU', email: 'sales@tspolymers.in', addresses: [{ type: 'both', line1: 'IDA Jeedimetla', city: 'Hyderabad', stateCode: '36', pincode: '500055', isDefault: true }] }), 201);
  await entry({ purpose: 'opening_stock', toWarehouseId: ctx.wh, lines: [{ itemId: ctx.resin.id, qty: '100', rate: '120' }, { itemId: ctx.pigment.id, qty: '5', rate: '400' }, { itemId: ctx.vax.id, qty: '30', rate: '50', batchNo: 'CM-1', expiryDate: addDays(today(), 10) }] });
  await entry({ purpose: 'material_issue', fromWarehouseId: ctx.wh, lines: [{ itemId: ctx.resin.id, qty: '90' }] });
  // An older order at ₹100 and a fresh one at ₹130 for the gear; the fresh one is also late.
  await submit('/purchase/orders', await ok(await a.client.post('/purchase/orders', { vendorId: ctx.vendor.id, docDate: addDays(today(), -25), lines: [{ itemId: ctx.gear.id, qty: '10', rate: '100' }] }), 201));
  ctx.po = await submit('/purchase/orders', await ok(await a.client.post('/purchase/orders', { vendorId: ctx.vendor.id, docDate: addDays(today(), -20), expectedDate: addDays(today(), -10), lines: [{ itemId: ctx.gear.id, qty: '10', rate: '130' }] }), 201));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('agents', () => {
  it('lists the agents and switches them on with a schedule', async () => {
    const l = await ok(await a.client.get(`${AI}/agents`));
    expect(l.agents.map((x: any) => x.code)).toEqual(expect.arrayContaining(['inventory', 'purchase']));
    const saved = await ok(await put(`${AI}/agents/purchase`, { enabled: true, schedule: 'daily', runHour: 7 }));
    expect(saved.nextRunAt).toBeTruthy();
    await ok(await put(`${AI}/agents/inventory`, { enabled: true, schedule: 'daily', runHour: 7 }));
    expect((await put(`${AI}/agents/nobody`, { enabled: true })).status).toBe(404);
  });

  it('raises reorder, late-PO and price findings into the inbox, once', async () => {
    const run = await ok(await a.client.post(`${AI}/agents/purchase/run`));
    expect(run).toMatchObject({ status: 'ok' });
    const inbox = await ok(await a.client.get(`${AI}/inbox`));
    const reorder = find(inbox, 'reorder', ctx.resin.code);
    expect(reorder).toMatchObject({ severity: 'warning', title: `Reorder 200 KG of ${ctx.resin.code}`, action: { type: 'create_requisition' } });
    expect(find(inbox, 'reorder', ctx.pigment.code).title).toBe(`Reorder 35 KG of ${ctx.pigment.code}`);
    expect(find(inbox, 'po_late')).toMatchObject({ action: { type: 'email_party' } });
    expect(find(inbox, 'price_rise').evidence).toMatchObject({ risePct: 30 });
    const again = await ok(await a.client.post(`${AI}/agents/purchase/run`));
    expect(again).toMatchObject({ created: 0 });
    ctx.inbox = inbox;
  });

  it('shows each person only what they may act on', async () => {
    const theirs = await ok(await viewer.client.get(`${AI}/inbox`));
    expect(theirs.some((r: any) => r.kind === 'reorder')).toBe(false);
    const reorder = find(ctx.inbox, 'reorder', ctx.resin.code);
    expect((await viewer.client.post(`${AI}/inbox/${reorder.id}/decide`, { approve: true })).status).toBe(403);
  });

  it('executes an approved action through the normal service and logs it', async () => {
    const reorder = find(ctx.inbox, 'reorder', ctx.resin.code);
    const done = await ok(await a.client.post(`${AI}/inbox/${reorder.id}/decide`, { approve: true }));
    expect(done).toMatchObject({ status: 'executed', autoExecuted: false });
    const pr = await ok(await a.client.get(`/purchase/requisitions/${done.result.id}`));
    expect(pr).toMatchObject({ status: 'draft' });
    expect(pr.lines[0]).toMatchObject({ itemId: ctx.resin.id, quantity: '200.0000' });
    expect((await a.client.post(`${AI}/inbox/${reorder.id}/decide`, { approve: true })).status).toBe(409);
    const price = find(ctx.inbox, 'price_rise');
    expect((await a.client.post(`${AI}/inbox/${price.id}/decide`, { approve: false })).status).toBe(400);
    await ok(await a.client.post(`${AI}/inbox/${price.id}/decide`, { approve: false, note: 'Copper price revision agreed' }));
    const log = await ok(await a.client.get(`${AI}/actions`));
    expect(log[0]).toMatchObject({ actionType: 'create_requisition', mode: 'approved', status: 'executed' });
  });

  it('acts on its own within the guardrails, as the person who allowed it', async () => {
    const pigment = find(ctx.inbox, 'reorder', ctx.pigment.code);
    // Dismiss the open one so the next run raises it afresh... it is open, so it stays deduplicated.
    await ok(await a.client.post(`${AI}/inbox/${pigment.id}/decide`, { approve: false, note: 'testing auto mode' }));
    await ok(await put(`${AI}/agents/purchase`, { enabled: true, guardrails: { autoExecute: true, autoExecuteBelow: 100000 } }));
    // Dismissed findings are not raised again for 14 days, so add a new item that needs ordering.
    const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
    const film = await ok(await a.client.post('/masters/items', { name: 'Stretch film', type: 'packing_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39201019', reorderLevel: '10', reorderQty: '50' }), 201);
    const run = await ok(await a.client.post(`${AI}/agents/purchase/run`));
    expect(run).toMatchObject({ created: 1, executed: 1 });
    const executed = await ok(await a.client.get(`${AI}/inbox?status=executed`));
    expect(executed.find((r: any) => r.title.includes(film.code))).toMatchObject({ autoExecuted: true, decidedBy: expect.any(String) });
  });

  it('finds stock-out and expiry risks', async () => {
    await ok(await a.client.post(`${AI}/agents/inventory/run`));
    const inbox = await ok(await a.client.get(`${AI}/inbox?agent=inventory`));
    expect(find(inbox, 'stockout_risk', ctx.resin.code)).toMatchObject({ severity: 'critical', evidence: { available: 10, daysOfCover: 6 } });
    expect(find(inbox, 'expiry_risk')).toMatchObject({ severity: 'critical', title: `Batch CM-1 of ${ctx.vax.code} expires in 10 days` });
  });

  it('stops everything with the kill switch, and evaluates', async () => {
    await ok(await a.client.post(`${AI}/kill-switch`, { killed: true, reason: 'Audit week' }));
    expect(await ok(await a.client.post(`${AI}/agents/inventory/run`))).toMatchObject({ status: 'skipped' });
    const late = find(ctx.inbox, 'po_late');
    expect((await a.client.post(`${AI}/inbox/${late.id}/decide`, { approve: true })).status).toBe(409);
    expect((await ok(await a.client.get(`${AI}/agents`))).killed).toBe(true);
    await ok(await a.client.post(`${AI}/kill-switch`, { killed: false }));
    const sent = await ok(await a.client.post(`${AI}/inbox/${late.id}/decide`, { approve: true, note: 'Chase them' }));
    expect(sent.result).toEqual({ sentTo: 'sales@tspolymers.in' });
    const ev = await ok(await a.client.get(`${AI}/evaluation?days=30`));
    const reorder = ev.find((e: any) => e.agentCode === 'purchase' && e.kind === 'reorder');
    expect(reorder).toMatchObject({ executed: 2, dismissed: 1, auto: 1, acceptancePct: 66.7 });
    expect(reorder.dismissalReasons.map((r: any) => r.note)).toEqual(expect.arrayContaining(['testing auto mode', 'Copper price revision agreed']));
  });
});
