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
const minutes = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;

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
const E = '/engineering';

beforeAll(async () => {
  a = await signupWorkspace('plops-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  wh.LINE = (await created('/inventory/warehouses', { code: 'LINE', name: 'Line-side rack', type: 'production' })).id;

  item.frame = await created('/masters/items', { name: 'Cycle frame', type: 'finished_good', baseUomId: uom.NOS, gstRate: 12, hsnCode: '87149100' });
  item.tube = await created('/masters/items', { name: 'Steel tube', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73063090', standardCost: '90' });
  item.paint = await created('/masters/items', { name: 'Powder coat black', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '32089090' });
  const open = await created('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.tube.id, qty: '500', rate: '90' }] });
  await ok(await a.client.post(`/inventory/stock-entries/${open.id}/submit`, { version: open.version }));

  // Round-the-clock calendars keep the arithmetic independent of the day the test runs.
  res.cut = await created('/manufacturing/work-centers', { code: 'CUT', name: 'Tube cutting', hoursPerDay: '24', shiftStart: 0, daysPerWeek: 7, labourRate: '100' });
  res.weld = await created('/manufacturing/work-centers', { code: 'WELD', name: 'Welding', hoursPerDay: '24', shiftStart: 0, daysPerWeek: 7, units: 2, labourRate: '100' });
  const bom = await created('/manufacturing/boms', {
    itemId: item.frame.id,
    quantity: '1',
    lines: [{ itemId: item.tube.id, qty: '3' }],
    operations: [
      { seq: 10, name: 'Cut', workCenterId: res.cut.id, setupMinutes: '30', runMinutes: '1' },
      { seq: 20, name: 'Weld', workCenterId: res.weld.id, runMinutes: '2' },
    ],
  });
  ctx.bom = await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: bom.version }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('finite scheduling', () => {
  it('schedules by priority, chains operations and skips the setup for the same item', async () => {
    ctx.w1 = await created('/manufacturing/work-orders', { itemId: item.frame.id, qty: '60', priority: 1, sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN, plannedEnd: addDays(today(), 5) });
    ctx.w2 = await created('/manufacturing/work-orders', { itemId: item.frame.id, qty: '30', priority: 3, sourceWarehouseId: wh.MAIN, targetWarehouseId: wh.MAIN, plannedEnd: addDays(today(), 5) });
    const r = await ok(await a.client.post(`${P}/schedule/run`, {}));
    expect(r).toMatchObject({ operations: 4, orders: 2, late: 0, conflicts: 0, setupMinutes: 30 });
    const b = await ok(await a.client.get(`${P}/schedule?days=7`));
    expect(b.workCenters.find((w: any) => w.code === 'WELD').lanes).toBe(2);
    const op = (wo: any, seq: number) => b.operations.find((o: any) => o.workOrder.id === wo.id && o.seq === seq);
    const c1 = op(ctx.w1, 10);
    const w1 = op(ctx.w1, 20);
    const c2 = op(ctx.w2, 10);
    const w2 = op(ctx.w2, 20);
    expect(minutes(c1.start, c1.end)).toBe(90); // 30 setup + 60 × 1
    expect(w1.start).toBe(c1.end);
    expect(minutes(w1.start, w1.end)).toBe(120);
    expect(c2.start).toBe(c1.end); // the cutter is busy until then
    expect(c2.setupMinutes).toBe(0); // same frame again: no changeover
    expect(minutes(c2.start, c2.end)).toBe(30);
    // Two welding units: W2 welds in parallel with W1.
    expect(w2.start).toBe(c2.end);
    expect(w2.lane).not.toBe(w1.lane);
    ctx.c2 = c2;
  });

  it('pins a dragged operation and reflows the rest', async () => {
    const at = new Date(Date.parse(ctx.c2.start) + 10 * 3_600_000).toISOString();
    const r = await ok(await a.client.request('PUT', `${P}/schedule/operations/${ctx.c2.id}`, { start: at, lane: 0 }));
    expect(r.conflicts).toBe(0);
    const b = await ok(await a.client.get(`${P}/schedule?days=7`));
    const c2 = b.operations.find((o: any) => o.id === ctx.c2.id);
    const w2 = b.operations.find((o: any) => o.workOrder.id === ctx.w2.id && o.seq === 20);
    expect(c2).toMatchObject({ locked: true, start: at });
    expect(w2.start).toBe(c2.end);
    expect((await a.client.request('PUT', `${P}/schedule/operations/${ctx.c2.id}`, { start: at, lane: 3 })).status).toBe(400);
    await ok(await a.client.request('PUT', `${P}/schedule/operations/${ctx.c2.id}`, { locked: false }));
    const again = await ok(await a.client.get(`${P}/schedule?days=7`));
    const back = again.operations.find((o: any) => o.id === ctx.c2.id);
    expect(back.locked).toBe(false);
    expect(back.start).toBe(again.operations.find((o: any) => o.workOrder.id === ctx.w1.id && o.seq === 10).end);
  });

  it('stores changeover times between items', async () => {
    const bad = await a.client.post(`${P}/setup-transitions`, { workCenterId: res.cut.id, fromItemId: item.frame.id, toItemId: item.frame.id, minutes: '10' });
    expect(bad.status).toBe(400);
    await created(`${P}/setup-transitions`, { workCenterId: res.cut.id, fromItemId: item.frame.id, toItemId: item.tube.id, minutes: '45' });
    await created(`${P}/setup-transitions`, { workCenterId: res.cut.id, fromItemId: item.frame.id, toItemId: item.tube.id, minutes: '40' });
    const t = await ok(await a.client.get(`${P}/setup-transitions?workCenterId=${res.cut.id}`));
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ minutes: '40.00', fromCode: item.frame.code });
  });
});

describe('capacity', () => {
  it('shows rough-cut load from open orders and the detailed load from the schedule', async () => {
    const rough = await ok(await a.client.get(`${P}/capacity?mode=rough&periods=4`));
    expect(rough.buckets).toHaveLength(4);
    const cut = rough.workCenters.find((w: any) => w.code === 'CUT');
    expect(cut.capacity[1]).toBe(7 * 1440);
    // 90 + 60 planned minutes on the cutter.
    expect(cut.orders.reduce((s: number, v: number) => s + v, 0)).toBeCloseTo(150, 0);
    const detailed = await ok(await a.client.get(`${P}/capacity?mode=detailed&periods=10`));
    const dcut = detailed.workCenters.find((w: any) => w.code === 'CUT');
    // As scheduled: 90 + 30 (no second setup).
    expect(dcut.orders.reduce((s: number, v: number) => s + v, 0)).toBeCloseTo(120, 0);
    expect(dcut.utilisation.some((u: number | null) => u !== null && u > 0)).toBe(true);
  });
});

describe('kanban', () => {
  it('raises a work order, a transfer and a requisition from empty cards', async () => {
    const prod = await created(`${P}/kanban`, { itemId: item.frame.id, kind: 'production', warehouseId: wh.MAIN, containerQty: '10', cards: 2, leadTimeDays: 2 });
    const xfer = await created(`${P}/kanban`, { itemId: item.tube.id, kind: 'transfer', warehouseId: wh.LINE, sourceWarehouseId: wh.MAIN, containerQty: '50', cards: 3 });
    const buy = await created(`${P}/kanban`, { itemId: item.paint.id, kind: 'purchase', warehouseId: wh.MAIN, containerQty: '25', cards: 2, leadTimeDays: 7 });
    expect((await a.client.post(`${P}/kanban`, { itemId: item.tube.id, kind: 'transfer', warehouseId: wh.LINE, containerQty: '5', cards: 1 })).status).toBe(400);

    let loops = await ok(await a.client.get(`${P}/kanban`));
    const loop = (id: string) => loops.find((l: any) => l.id === id);
    expect(loop(prod.id).cards.map((c: any) => c.status)).toEqual(['full', 'full']);

    const s1 = await ok(await a.client.post(`${P}/kanban/cards/${loop(prod.id).cards[0].id}/signal`, {}));
    expect(s1.doc.docType).toBe('work_order');
    const wo = await ok(await a.client.get(`/manufacturing/work-orders/${s1.doc.id}`));
    expect(wo).toMatchObject({ qty: '10.0000', status: 'draft', plannedEnd: addDays(today(), 2) });
    expect((await a.client.post(`${P}/kanban/cards/${loop(prod.id).cards[0].id}/signal`, {})).status).toBe(409);

    const s2 = await ok(await a.client.post(`${P}/kanban/scan`, { code: `KB:${loop(xfer.id).cards[0].id}` }));
    expect(s2.doc.docType).toBe('stock_entry');
    const se = await ok(await a.client.get(`/inventory/stock-entries/${s2.doc.id}`));
    expect(se).toMatchObject({ purpose: 'transfer', status: 'draft' });
    expect(se.lines[0]).toMatchObject({ qty: '50.0000' });

    const s3 = await ok(await a.client.post(`${P}/kanban/cards/${loop(buy.id).cards[1].id}/signal`, {}));
    expect(s3.doc.docType).toBe('purchase_requisition');

    // Receiving the container puts the card back in the rack.
    await ok(await a.client.post(`${P}/kanban/scan`, { code: `KB:${loop(prod.id).cards[0].id}` }));
    loops = await ok(await a.client.get(`${P}/kanban`));
    expect(loop(prod.id).cards[0]).toMatchObject({ status: 'full', doc: { id: s1.doc.id } });
    expect(loop(xfer.id).full).toBe(2);

    // Fewer cards: only ones in the rack can go (the purchase loop's card 2 is out).
    expect((await a.client.request('PUT', `${P}/kanban/${xfer.id}`, { itemId: item.tube.id, kind: 'transfer', warehouseId: wh.LINE, sourceWarehouseId: wh.MAIN, containerQty: '50', cards: 0 })).status).toBe(400);
    expect((await a.client.request('PUT', `${P}/kanban/${buy.id}`, { itemId: item.paint.id, kind: 'purchase', warehouseId: wh.MAIN, containerQty: '25', cards: 1, leadTimeDays: 7 })).status).toBe(409);
    await ok(await a.client.request('PUT', `${P}/kanban/${xfer.id}`, { itemId: item.tube.id, kind: 'transfer', warehouseId: wh.LINE, sourceWarehouseId: wh.MAIN, containerQty: '50', cards: 2 }));
    loops = await ok(await a.client.get(`${P}/kanban`));
    expect(loop(xfer.id).cards.map((c: any) => c.cardNo)).toEqual([1, 2]);
    const sug = await ok(await a.client.get(`${P}/kanban/${xfer.id}/suggest`));
    expect(sug).toMatchObject({ dailyUsage: 0, cards: null });
  });
});

describe('engineering change', () => {
  it('shows the impact, needs the new version approved, then is implemented', async () => {
    const ch = await created(`${E}/changes`, { kind: 'bom', reason: 'Thicker tube for the cargo model', disposition: 'use_as_is', items: [{ itemId: item.frame.id }, { itemId: item.tube.id }] });
    expect(ch).toMatchObject({ status: 'draft', stage: 'request' });
    expect(ch.items[0].from).toMatchObject({ id: ctx.bom.id, docType: 'bom' });
    const frame = ch.impact.lines.find((l: any) => l.itemId === item.frame.id);
    expect(frame.workOrdersMaking.count).toBe(3); // two planned + the kanban order
    expect(frame.workOrdersOnCurrentVersion).toBe(3);
    const tube = ch.impact.lines.find((l: any) => l.itemId === item.tube.id);
    expect(tube).toMatchObject({ stockQty: '500.0000', usedIn: [item.frame.code] });
    expect(Number(tube.workOrdersUsing.qty)).toBe(300); // (60 + 30 + 10) × 3

    const v2 = await created(`/manufacturing/boms/${ctx.bom.id}/new-version`, {});
    const upd = await ok(await a.client.request('PUT', `${E}/changes/${ch.id}`, { version: ch.version, kind: 'bom', reason: 'Thicker tube for the cargo model', items: [{ itemId: item.frame.id, toDocId: v2.id }, { itemId: item.tube.id }] }));
    let c = await ok(await a.client.post(`${E}/changes/${ch.id}/submit`, { version: upd.version }));
    expect(c).toMatchObject({ status: 'approved', stage: 'approved', canImplement: true });
    expect(c.impact.totals.parents).toBe(1);

    const early = await a.client.post(`${E}/changes/${ch.id}/implement`, { version: c.version });
    expect(early.status).toBe(409);
    expect(early.body.detail).toMatch(/Approve the new version/);
    await ok(await a.client.post(`/manufacturing/boms/${v2.id}/submit`, { version: v2.version }));
    c = await ok(await a.client.post(`${E}/changes/${ch.id}/implement`, { version: c.version, notes: 'Cut-in from next batch' }));
    expect(c).toMatchObject({ stage: 'implemented', implementationNotes: 'Cut-in from next batch', canImplement: false });
    expect((await a.client.post(`${E}/changes/${ch.id}/cancel`, { version: c.version, reason: 'Raised in error' })).status).toBe(409);
    const list = await ok(await a.client.get(`${E}/changes?itemId=${item.tube.id}`));
    expect(list.items.map((x: any) => x.id)).toEqual([ch.id]);
    ctx.bomV2 = v2;
  });
});

describe('drawing register', () => {
  it('releases revisions, supersedes the old one and stamps the BOM', async () => {
    const d = await created(`${E}/drawings`, { drawingNo: 'drg-100', title: 'Frame weldment', itemId: item.frame.id, sheetSize: 'A2' });
    expect(d).toMatchObject({ drawingNo: 'DRG-100', drawingRevision: 'A', status: 'draft' });
    expect((await a.client.post(`${E}/drawings`, { drawingNo: 'DRG-100', revision: 'a', title: 'Copy' })).status).toBe(409);
    const ra = await ok(await a.client.post(`${E}/drawings/${d.id}/submit`, { version: d.version }));
    expect(ra).toMatchObject({ status: 'approved', current: true, canRevise: true });
    expect((await ok(await a.client.get(`/manufacturing/boms/${ctx.bomV2.id}`))).drawingRevision).toBe('A');

    const rb = await created(`${E}/drawings/${d.id}/revise`, {});
    expect(rb).toMatchObject({ drawingRevision: 'B', status: 'draft', previousId: d.id });
    expect((await a.client.post(`${E}/drawings/${d.id}/revise`, {})).status).toBe(409);
    await ok(await a.client.post(`${E}/drawings/${rb.id}/submit`, { version: rb.version }));
    const oldA = await ok(await a.client.get(`${E}/drawings/${d.id}`));
    expect(oldA.current).toBe(false);
    expect(oldA.supersededAt).toBeTruthy();
    expect(oldA.revisions.map((r: any) => r.revision)).toEqual(['B', 'A']);
    const current = await ok(await a.client.get(`${E}/drawings?current=true`));
    expect(current.items.map((x: any) => x.revision)).toEqual(['B']);
    expect((await ok(await a.client.get(`/manufacturing/boms/${ctx.bomV2.id}`))).drawingRevision).toBe('B');
  });
});
