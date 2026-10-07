import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const item: Record<string, any> = {};
const W = '/wms';

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const put = (path: string, b: unknown) => a.client.request('PUT', path, b);
async function entry(body: Record<string, unknown>) {
  const created = await ok(await a.client.post('/inventory/stock-entries', body), 201);
  return ok(await a.client.post(`/inventory/stock-entries/${created.id}/submit`, { version: created.version }));
}
async function binQty(code: string, itemId: string) {
  const b = await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/bins/${code}`));
  return b.contents.filter((c: any) => c.itemId === itemId).reduce((s: number, c: any) => s + Number(c.qty), 0);
}
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  a = await signupWorkspace('wmsc-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id])).MAIN;
  const mk = async (name: string, patch: Record<string, unknown> = {}) => ok(await a.client.post('/masters/items', { name, type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, ...patch }), 201);
  item.gear = await mk('Spur gear');
  item.shim = await mk('Brass shim');
  item.oil = await mk('Base oil SN150', { baseUomId: uom.LTR ?? uom.KG });
  item.ic = await mk('MCU QFN-32');
  await ok(await a.client.post(`${W}/warehouses/${ctx.wh}/enable`));
  const zone = await ok(await a.client.post(`${W}/zones`, { warehouseId: ctx.wh, code: 'STOR', name: 'Storage', sequence: 10 }), 201);
  ctx.zone = zone.id;
  await ok(await a.client.post(`${W}/bins/generate`, { zoneId: zone.id, aisles: ['A'], racks: 4, shelves: 1 }), 201);
  const tz = await ok(await a.client.post(`${W}/zones`, { warehouseId: ctx.wh, code: 'TANK', name: 'Tank farm', sequence: 20 }), 201);
  ctx.tankBin = await ok(await a.client.post(`${W}/bins`, { zoneId: tz.id, code: 'T-01', binType: 'bulk' }), 201);
  ctx.bins = Object.fromEntries((await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/bins`))).map((b: any) => [b.code, b.id]));
  // Gear: 100 into A-01-1 (via receiving and a move); shim: 40 into A-02-1.
  await entry({ purpose: 'material_receipt', toWarehouseId: ctx.wh, lines: [{ itemId: item.gear.id, qty: '100', rate: '50' }, { itemId: item.shim.id, qty: '40', rate: '5' }] });
  ctx.recv = (await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/bins/RECV`))).id;
  await ok(await a.client.post(`${W}/moves`, { itemId: item.gear.id, fromBinId: ctx.recv, toBinId: ctx.bins['A-04-1'], qty: 100 }));
  await ok(await a.client.post(`${W}/moves`, { itemId: item.shim.id, fromBinId: ctx.recv, toBinId: ctx.bins['A-02-1'], qty: 40 }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('stock entries with bins', () => {
  it('posts an entry line to the bin named on it', async () => {
    await entry({ purpose: 'material_issue', fromWarehouseId: ctx.wh, lines: [{ itemId: item.gear.id, qty: '10', binId: ctx.bins['A-04-1'] }] });
    expect(await binQty('A-04-1', item.gear.id)).toBe(90);
    const bad = await a.client.post('/inventory/stock-entries', { purpose: 'material_issue', fromWarehouseId: ctx.wh, lines: [{ itemId: item.gear.id, qty: '10', binId: ctx.bins['A-03-1'] }] });
    const sub = await a.client.post(`/inventory/stock-entries/${bad.body.id}/submit`, { version: bad.body.version });
    expect(sub.status).toBe(400);
    expect(sub.body.detail).toMatch(/does not hold enough/);
  });
});

describe('ABC and cycle counts', () => {
  it('classes items by issue value and saves it', async () => {
    const preview = await ok(await a.client.get(`${W}/abc`));
    expect(preview.applied).toBe(false);
    expect(preview.items.find((i: any) => i.itemId === item.gear.id)).toMatchObject({ abcClass: 'A', value: '500.00' });
    await ok(await a.client.post(`${W}/abc`));
    expect((await ok(await a.client.get(`${W}/items/${item.shim.id}/profile`))).abcClass).toBe('C');
  });

  it('counts due bins blind and posts differences to the exact bins', async () => {
    const due = await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/count-due`));
    expect(due.map((d: any) => d.code)).toEqual(['A-04-1', 'A-02-1']);
    const c = await ok(await a.client.post(`${W}/counts/cycle`, { warehouseId: ctx.wh, maxBins: 10 }), 201);
    expect(c).toMatchObject({ number: 'BC00001', bins: 2, lines: 2 });
    expect((await a.client.post(`${W}/counts/adhoc`, { warehouseId: ctx.wh, binIds: [ctx.bins['A-04-1']] })).status).toBe(409);
    const view = await ok(await a.client.get(`${W}/counts/${c.id}`));
    expect(view.lines.every((l: any) => l.systemQty === null)).toBe(true);
    const line = (code: string) => view.lines.find((l: any) => l.bin === code);
    expect((await a.client.post(`${W}/counts/${c.id}/post`)).status).toBe(409);
    await ok(await a.client.post(`${W}/counts/${c.id}/lines/${line('A-04-1').id}`, { countedQty: 88 }));
    await ok(await a.client.post(`${W}/counts/${c.id}/lines/${line('A-02-1').id}`, { countedQty: 40 }));
    await ok(await a.client.post(`${W}/counts/${c.id}/found`, { binId: ctx.bins['A-02-1'], itemId: item.gear.id, countedQty: 3 }), 201);
    const posted = await ok(await a.client.post(`${W}/counts/${c.id}/post`));
    expect(posted).toMatchObject({ adjusted: 2, accuracyPct: '33.33' });
    expect(await binQty('A-04-1', item.gear.id)).toBe(88);
    expect(await binQty('A-02-1', item.gear.id)).toBe(3);
    expect(await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/reconcile`))).toEqual([]);
    const after = await ok(await a.client.get(`${W}/counts/${c.id}`));
    expect(line('A-04-1').id).toBeTruthy();
    expect(after.lines.find((l: any) => l.bin === 'A-04-1').systemQty).toBe('90.0000');
    // Counted bins are not due again.
    expect(await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/count-due`))).toEqual([]);
  });
});

describe('replenishment and slotting', () => {
  it('tops up a pick face from reserve', async () => {
    expect((await put(`${W}/bins/${ctx.bins['A-01-1']}/pick-face`, { replenMin: 10, replenMax: 30 })).status).toBe(400);
    const face = (await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/bins`))).find((b: any) => b.code === 'A-01-1');
    await ok(await put(`${W}/bins/${face.id}`, { zoneId: ctx.zone, code: 'A-01-1', pickSequence: face.pickSequence, fixedItemId: item.gear.id }));
    await ok(await put(`${W}/bins/${ctx.bins['A-01-1']}/pick-face`, { replenMin: 10, replenMax: 30 }));
    const r = await ok(await a.client.post(`${W}/warehouses/${ctx.wh}/replenish`));
    // FEFO then walking order: the 3 found in A-02-1 come first, the rest from A-04-1.
    expect(r.created.map((t: any) => [t.from, t.qty])).toEqual([['A-02-1', '3.0000'], ['A-04-1', '27.0000']]);
    const total = r.created.reduce((s: number, t: any) => s + Number(t.qty), 0);
    expect(total).toBe(30);
    expect((await ok(await a.client.post(`${W}/warehouses/${ctx.wh}/replenish`))).created).toEqual([]);
    const tasks = await ok(await a.client.get(`${W}/tasks?warehouseId=${ctx.wh}&kind=replenish&status=open`));
    for (const t of tasks) await ok(await a.client.post(`${W}/tasks/${t.id}/confirm`, { binId: t.toBinId, qty: Number(t.qty) }));
    expect(await binQty('A-01-1', item.gear.id)).toBe(30);
    const slot = await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/slotting`));
    expect(slot.movers.length).toBeGreaterThan(0);
  });
});

describe('tanks', () => {
  it('converts a dip to stock and posts the variance on request', async () => {
    await ok(await a.client.post(`${W}/tanks`, { binId: ctx.tankBin.id, itemId: item.oil.id, capacityLitres: 12000, calibration: [{ mm: 0, litres: 0 }, { mm: 1000, litres: 5000 }, { mm: 2000, litres: 12000 }], tolerancePct: 0.5 }), 201);
    await entry({ purpose: 'material_receipt', toWarehouseId: ctx.wh, lines: [{ itemId: item.oil.id, qty: '8000', rate: '90', binId: ctx.tankBin.id }] });
    const [tank] = await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/tanks`));
    expect(tank).toMatchObject({ bookQty: '8000.0000' });
    const d1 = await ok(await a.client.post(`${W}/tanks/${tank.id}/dips`, { dipMm: 1500, adjust: true }), 201);
    expect(d1).toMatchObject({ litres: '8500.00', variance: '500.0000', withinTolerance: false, entryId: null });
    const d2 = await ok(await a.client.post(`${W}/tanks/${tank.id}/dips/adjust`, { dipMm: 1500, temperatureC: 32 }), 201);
    expect(d2.entryId).toBeTruthy();
    expect(await binQty('T-01', item.oil.id)).toBe(8500);
    expect((await a.client.post(`${W}/tanks/${tank.id}/dips`, { dipMm: 2500 })).status).toBe(400);
  });
});

describe('returnables, reels and consignment', () => {
  it('tracks returnable packaging with each party', async () => {
    const cust = await ok(await a.client.post('/masters/parties', { name: 'Sri Sai Traders', isCustomer: true, gstRegistrationType: 'unregistered', addresses: [{ type: 'both', line1: 'Market Road', city: 'Warangal', stateCode: '36', pincode: '506002', isDefault: true }] }), 201);
    const drum = await ok(await a.client.post(`${W}/returnables/types`, { code: 'drum210', name: '210 L MS drum', depositAmount: 1500 }), 201);
    await ok(await a.client.post(`${W}/returnables/moves`, { typeId: drum.id, partyId: cust.id, direction: 'out', qty: 12, reference: 'DN/1' }), 201);
    await ok(await a.client.post(`${W}/returnables/moves`, { typeId: drum.id, partyId: cust.id, direction: 'back', qty: 5 }), 201);
    expect((await a.client.post(`${W}/returnables/moves`, { typeId: drum.id, partyId: cust.id, direction: 'back', qty: 8 })).status).toBe(400);
    const [bal] = await ok(await a.client.get(`${W}/returnables/balances`));
    expect(bal).toMatchObject({ party: 'Sri Sai Traders', code: 'DRUM210', balance: 7, depositValue: '10500.00' });
  });

  it('runs the floor-life clock of a moisture-sensitive reel', async () => {
    await ok(await put(`${W}/items/${item.ic.id}/profile`, { mslLevel: '3' }));
    const reel = await ok(await a.client.post(`${W}/reels`, { code: 'RL-0001', itemId: item.ic.id, qty: 3000, binId: ctx.bins['A-03-1'], warehouseId: ctx.wh }), 201);
    expect(reel.mslLevel).toBe('3');
    expect((await a.client.post(`${W}/reels/${reel.id}/events`, { kind: 'seal' })).status).toBe(409);
    const opened = await ok(await a.client.post(`${W}/reels/${reel.id}/events`, { kind: 'open' }));
    expect(opened).toMatchObject({ status: 'open', expired: false });
    expect(opened.remainingMinutes).toBeGreaterThan(168 * 60 - 2);
    await ok(await a.client.post(`${W}/reels/${reel.id}/events`, { kind: 'use', qty: 1000 }));
    expect((await a.client.post(`${W}/reels/${reel.id}/events`, { kind: 'bake' })).status).toBe(409);
    const sealed = await ok(await a.client.post(`${W}/reels/${reel.id}/events`, { kind: 'seal' }));
    expect(sealed).toMatchObject({ status: 'sealed', qty: '2000.0000' });
    const [listed] = await ok(await a.client.get(`${W}/reels?itemId=${item.ic.id}`));
    expect(listed).toMatchObject({ code: 'RL-0001', remainingMinutes: expect.any(Number) });
  });

  it('states consignment stock and usage', async () => {
    const vendor = await ok(await a.client.post('/masters/parties', { name: 'Kraft Paper Mills', isVendor: true, gstRegistrationType: 'unregistered', addresses: [{ type: 'both', line1: 'Patancheru', city: 'Sangareddy', stateCode: '36', pincode: '502319', isDefault: true }] }), 201);
    const cwh = await ok(await a.client.post('/inventory/warehouses', { code: 'VMI', name: 'Vendor-managed store', type: 'store' }), 201);
    const c = await ok(await a.client.post(`${W}/consignments`, { partyId: vendor.id, direction: 'vendor_stock', warehouseId: cwh.id }), 201);
    expect((await a.client.post(`${W}/consignments`, { partyId: vendor.id, direction: 'vendor_stock', warehouseId: cwh.id })).status).toBe(409);
    await entry({ purpose: 'material_receipt', toWarehouseId: cwh.id, lines: [{ itemId: item.shim.id, qty: '500', rate: '4' }] });
    await entry({ purpose: 'material_issue', fromWarehouseId: cwh.id, lines: [{ itemId: item.shim.id, qty: '120' }] });
    const st = await ok(await a.client.get(`${W}/consignments/${c.id}/statement?from=${today()}&to=${today()}`));
    expect(st.stock).toEqual([expect.objectContaining({ code: item.shim.code, qty: '380.0000' })]);
    expect(st.used).toEqual([expect.objectContaining({ code: item.shim.code, qty: '120.0000', value: '480.00' })]);
  });
});
