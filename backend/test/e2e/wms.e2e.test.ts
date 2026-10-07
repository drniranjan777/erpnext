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

async function entry(body: Record<string, unknown>) {
  const created = await ok(await a.client.post('/inventory/stock-entries', body), 201);
  return ok(await a.client.post(`/inventory/stock-entries/${created.id}/submit`, { version: created.version }));
}

async function binQty(code: string, itemId: string) {
  const b = await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/bins/${code}`));
  return b.contents.filter((c: any) => c.itemId === itemId).reduce((s: number, c: any) => s + Number(c.qty), 0);
}

const binId = (code: string) => ctx.bins.find((b: any) => b.code === code).id;

beforeAll(async () => {
  a = await signupWorkspace('wms-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id])).MAIN;
  const mk = async (name: string, patch: Record<string, unknown> = {}) => ok(await a.client.post('/masters/items', { name, type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, ...patch }), 201);
  item.bolt = await mk('Hex bolt M12');
  item.solvent = await mk('Toluene drum', { baseUomId: uom.KG });
  item.oxid = await mk('Sodium chlorate', { baseUomId: uom.KG });
  item.vaccine = await mk('Poultry vaccine vial', { trackBatch: true, hasExpiry: true, shelfLifeDays: 365 });
  await entry({ purpose: 'opening_stock', toWarehouseId: ctx.wh, lines: [{ itemId: item.bolt.id, qty: '100', rate: '5' }] });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('switching bins on', () => {
  it('puts existing stock in the receiving bin and keeps bins equal to stock', async () => {
    const neg = await ok(await a.client.post('/inventory/warehouses', { code: 'YARD', name: 'Open yard', type: 'store', allowNegativeStock: true }), 201);
    expect((await a.client.post(`${W}/warehouses/${neg.id}/enable`)).status).toBe(400);
    const r = await ok(await a.client.post(`${W}/warehouses/${ctx.wh}/enable`));
    expect(r.linesMoved).toBe(1);
    expect((await a.client.post(`${W}/warehouses/${ctx.wh}/enable`)).status).toBe(409);
    expect(await binQty('RECV', item.bolt.id)).toBe(100);
    expect(await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/reconcile`))).toEqual([]);
  });

  it('sets up zones, bins and storage profiles', async () => {
    const zone = async (code: string, condition: string, sequence: number, kind = 'storage') => ok(await a.client.post(`${W}/zones`, { warehouseId: ctx.wh, code, name: code, condition, sequence, kind }), 201);
    ctx.stor = await zone('STOR', 'ambient', 10);
    ctx.cold = await zone('COLD', 'cold', 20);
    ctx.haz = await zone('HAZ', 'hazardous', 30);
    expect((await a.client.post(`${W}/zones`, { warehouseId: ctx.wh, code: 'stor', name: 'dup' })).status).toBe(409);
    expect(await ok(await a.client.post(`${W}/bins/generate`, { zoneId: ctx.stor.id, aisles: ['A', 'B'], racks: 2, shelves: 2 }), 201)).toEqual({ created: 8, skipped: 0 });
    await ok(await a.client.post(`${W}/bins/generate`, { zoneId: ctx.cold.id, aisles: ['C'], racks: 1, shelves: 2 }), 201);
    await ok(await a.client.post(`${W}/bins/generate`, { zoneId: ctx.haz.id, aisles: ['H'], racks: 1, shelves: 2, maxWeightKg: 1000 }), 201);
    ctx.bins = await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/bins`));
    expect(ctx.bins.map((b: any) => b.code)).toContain('B-02-1');
    // Serpentine walk: aisle B runs back down, so B-02 comes before B-01.
    const seq = (c: string) => ctx.bins.find((b: any) => b.code === c).pickSequence;
    expect(seq('A-01-1')).toBeLessThan(seq('A-02-1'));
    expect(seq('B-02-1')).toBeLessThan(seq('B-01-1'));

    const fixed = ctx.bins.find((b: any) => b.code === 'B-02-1');
    await ok(await a.client.request('PUT', `${W}/bins/${fixed.id}`, { zoneId: ctx.stor.id, code: 'B-02-1', pickSequence: fixed.pickSequence, fixedItemId: item.bolt.id }));
    await ok(await a.client.request('PUT', `${W}/items/${item.solvent.id}/profile`, { condition: 'ambient', hazardClass: '3', unitWeightKg: 1 }));
    await ok(await a.client.request('PUT', `${W}/items/${item.oxid.id}/profile`, { hazardClass: '5.1', unitWeightKg: 1 }));
    await ok(await a.client.request('PUT', `${W}/items/${item.vaccine.id}/profile`, { condition: 'cold', minShelfLifeDays: 90 }));
    expect((await a.client.request('PUT', `${W}/items/${item.bolt.id}/profile`, { hazardClass: 'flammable' })).status).toBe(400);
  });
});

describe('receiving and put-away', () => {
  it('lands receipts in receiving and plans put-away by the rules', async () => {
    await entry({ purpose: 'material_receipt', toWarehouseId: ctx.wh, lines: [{ itemId: item.solvent.id, qty: '200', rate: '90' }, { itemId: item.oxid.id, qty: '50', rate: '60' }, { itemId: item.vaccine.id, qty: '20', rate: '30', batchNo: 'VX-1', mfgDate: '2026-09-01' }] });
    expect(await binQty('RECV', item.solvent.id)).toBe(200);
    const plan = await ok(await a.client.post(`${W}/warehouses/${ctx.wh}/putaway`));
    const by = (id: string) => plan.tasks.filter((t: any) => t.itemId === id);
    expect(by(item.bolt.id)).toHaveLength(1);
    expect(by(item.bolt.id)[0]).toMatchObject({ toBinId: binId('B-02-1'), reason: 'fixed bin of the item' });
    expect(by(item.vaccine.id)[0].toBinId).toBe(binId('C-01-1'));
    expect(by(item.solvent.id)[0]).toMatchObject({ toBinId: binId('H-01-1'), reason: 'nearest empty bin' });
    // The oxidiser may not share a bin with the solvent already headed for H-01-1.
    expect(by(item.oxid.id)[0].toBinId).toBe(binId('H-01-2'));
    // Planning again adds nothing.
    expect((await ok(await a.client.post(`${W}/warehouses/${ctx.wh}/putaway`))).created).toBe(0);
    ctx.tasks = plan.tasks;
  });

  it('confirms by scan and refuses unsuitable bins', async () => {
    const t = (id: string) => ctx.tasks.find((x: any) => x.itemId === id);
    expect((await a.client.post(`${W}/tasks/${t(item.vaccine.id).id}/confirm`, { binCode: 'a-01-1', qty: 20 })).body.detail).toMatch(/needs cold storage/);
    for (const it of [item.bolt, item.vaccine, item.solvent]) await ok(await a.client.post(`${W}/tasks/${t(it.id).id}/confirm`, { binId: t(it.id).toBinId, qty: Number(t(it.id).qty) }));
    const clash = await a.client.post(`${W}/tasks/${t(item.oxid.id).id}/confirm`, { binCode: 'H-01-1', qty: 50 });
    expect(clash.status).toBe(400);
    expect(clash.body.detail).toMatch(/class 5.1 cannot be stored with class 3/);
    await ok(await a.client.post(`${W}/tasks/${t(item.oxid.id).id}/confirm`, { binCode: 'H-01-2', qty: 50 }));
    expect((await a.client.post(`${W}/tasks/${t(item.oxid.id).id}/confirm`, { binCode: 'H-01-2', qty: 50 })).status).toBe(409);
    expect(await binQty('B-02-1', item.bolt.id)).toBe(100);
    expect(await binQty('RECV', item.solvent.id)).toBe(0);
    const loc = await ok(await a.client.get(`${W}/items/${item.vaccine.id}/locations`));
    expect(loc).toEqual([expect.objectContaining({ bin: 'C-01-1', batchNo: 'VX-1', qty: '20.0000' })]);
  });

  it('refuses overfilling without a reason', async () => {
    // H-01-1 takes 1000 kg; 200 kg are in it.
    await entry({ purpose: 'material_receipt', toWarehouseId: ctx.wh, lines: [{ itemId: item.solvent.id, qty: '900', rate: '90' }] });
    const over = await a.client.post(`${W}/moves`, { itemId: item.solvent.id, fromBinId: ctx.recv ?? (await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/bins/RECV`))).id, toBinId: binId('H-01-1'), qty: 900 });
    expect(over.status).toBe(400);
    expect(over.body.detail).toMatch(/room for 800/);
    const plan = await ok(await a.client.post(`${W}/warehouses/${ctx.wh}/putaway`));
    expect(plan.tasks.map((t: any) => [t.toBinId, Number(t.qty)])).toEqual([[binId('H-01-1'), 800], [null, 100]]);
  });
});

describe('issues, cancellations and moves', () => {
  it('issues from bins and puts cancelled issues back', async () => {
    const issue = await entry({ purpose: 'material_issue', fromWarehouseId: ctx.wh, lines: [{ itemId: item.bolt.id, qty: '30' }] });
    expect(await binQty('B-02-1', item.bolt.id)).toBe(70);
    await ok(await a.client.post(`/inventory/stock-entries/${issue.id}/cancel`, { version: issue.version, reason: 'Issued against the wrong job' }));
    expect(await binQty('B-02-1', item.bolt.id)).toBe(100);
    expect(await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/reconcile`))).toEqual([]);
  });

  it('moves between bins and keeps a non-empty bin active', async () => {
    await ok(await a.client.post(`${W}/moves`, { itemId: item.bolt.id, fromBinId: binId('B-02-1'), toBinId: binId('A-01-1'), qty: 20 }));
    expect((await a.client.post(`${W}/moves`, { itemId: item.bolt.id, fromBinId: binId('A-01-1'), toBinId: binId('A-01-2'), qty: 25 })).status).toBe(400);
    expect((await a.client.post(`${W}/moves`, { itemId: item.bolt.id, fromBinId: binId('A-01-1'), toBinId: binId('C-01-2'), qty: 5 })).status).toBe(400);
    const locs = await ok(await a.client.get(`${W}/items/${item.bolt.id}/locations`));
    expect(locs.map((l: any) => [l.bin, l.qty])).toEqual([['A-01-1', '20.0000'], ['B-02-1', '80.0000']]);
    const b = ctx.bins.find((x: any) => x.code === 'A-01-1');
    expect((await a.client.request('PUT', `${W}/bins/${b.id}`, { zoneId: ctx.stor.id, code: 'A-01-1', isActive: false })).status).toBe(409);
    // Blocked bins are used last when issuing.
    await ok(await a.client.post(`${W}/bins/${binId('B-02-1')}/block`, { blocked: true, reason: 'Rack damaged' }));
    await entry({ purpose: 'material_issue', fromWarehouseId: ctx.wh, lines: [{ itemId: item.bolt.id, qty: '10' }] });
    expect(await binQty('A-01-1', item.bolt.id)).toBe(10);
    expect(await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/reconcile`))).toEqual([]);
    const heat = await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/heatmap`));
    expect(heat.find((h: any) => h.code === 'H-01-1')).toMatchObject({ weightKg: 200, fill: 0.2 });
  });
});
