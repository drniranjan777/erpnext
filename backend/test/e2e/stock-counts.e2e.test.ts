import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let groups: Record<string, string> = {};
let wh: Record<string, string> = {};
const item: Record<string, any> = {};

async function newItem(name: string, patch: Record<string, unknown> = {}) {
  const res = await a.client.post('/masters/items', { name, type: 'raw_material', baseUomId: uom.KG, gstRate: 18, groupId: groups.RM, ...patch });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function postEntry(body: Record<string, unknown>) {
  const c = (await a.client.post('/inventory/stock-entries', body)).body;
  const s = await a.client.post(`/inventory/stock-entries/${c.id}/submit`, { version: c.version });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
}

async function qty(itemId: string, warehouseId = wh.MAIN) {
  const d = (await a.client.get(`/inventory/stock/${itemId}`)).body;
  return d.byWarehouse.find((w: any) => w.warehouseId === warehouseId)?.qty ?? '0.0000';
}

beforeAll(async () => {
  a = await signupWorkspace('cnt-a');
  emails.push(a.email);
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  groups = Object.fromEntries((await a.client.get('/masters/item-groups')).body.map((g: any) => [g.code, g.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.steel = await newItem('Steel rod');
  item.resin = await newItem('Epoxy resin', { trackBatch: true });
  item.bolt = await newItem('Hex bolt M10', { type: 'spare', baseUomId: uom.NOS, groupId: groups.SPR });
  item.unused = await newItem('Spare flux');
  await postEntry({
    purpose: 'opening_stock',
    toWarehouseId: wh.MAIN,
    lines: [
      { itemId: item.steel.id, qty: '100', rate: '10' },
      { itemId: item.resin.id, qty: '10', rate: '50', batchNo: 'L1' },
      { itemId: item.resin.id, qty: '5', rate: '50', batchNo: 'L2' },
      { itemId: item.bolt.id, qty: '200', rate: '2' },
    ],
  });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('physical stock count', () => {
  let count: any;

  it('snapshots book stock per item and batch, hiding it on a blind count', async () => {
    const res = await a.client.post('/inventory/stock-counts', { warehouseId: wh.MAIN, itemGroupId: groups.RM, blind: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    count = res.body;
    expect(count.lines.map((l: any) => [l.itemName, l.batchNo])).toEqual([
      ['Steel rod', null],
      ['Epoxy resin', 'L1'],
      ['Epoxy resin', 'L2'],
    ]);
    expect(count).toMatchObject({ status: 'draft', bookHidden: true, warehouse: { code: 'MAIN' } });
    expect(count.lines.every((l: any) => l.systemQty === null && l.difference === null)).toBe(true);
    expect(count.can.amend).toBe(false);

    const withZero = (await a.client.post('/inventory/stock-counts', { warehouseId: wh.MAIN, itemGroupId: groups.RM, includeZeroStock: true })).body;
    expect(withZero.lines.map((l: any) => l.itemName)).toContain('Spare flux');
    expect(withZero.lines.find((l: any) => l.itemName === 'Steel rod').systemQty).toBe('100.0000');
    await a.client.delete(`/inventory/stock-counts/${withZero.id}?version=${withZero.version}`);
  });

  it('records counts line by line and adds stock found off-sheet', async () => {
    const [steel, l1] = count.lines;
    const res = await a.client.post(`/inventory/stock-counts/${count.id}/counts`, {
      lines: [
        { id: steel.id, countedQty: '95' },
        { id: l1.id, countedQty: '10', remarks: 'Rack B2' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const found = await a.client.post(`/inventory/stock-counts/${count.id}/lines`, { itemId: item.resin.id, batchNo: 'l3', countedQty: '4' });
    expect(found.status, JSON.stringify(found.body)).toBe(201);
    expect(found.body.lineNo).toBe(4);
    const dup = await a.client.post(`/inventory/stock-counts/${count.id}/lines`, { itemId: item.resin.id, batchNo: 'L1', countedQty: '1' });
    expect(dup.status).toBe(400);
    const noBatch = await a.client.post(`/inventory/stock-counts/${count.id}/lines`, { itemId: item.resin.id, countedQty: '1' });
    expect(noBatch.body.errors[0].path).toBe('batchNo');
  });

  it('posts differences against the book at approval time', async () => {
    // Stock moves after the sheet was printed: 5 kg of steel is issued.
    await postEntry({ purpose: 'material_issue', fromWarehouseId: wh.MAIN, lines: [{ itemId: item.steel.id, qty: '5' }] });
    const current = (await a.client.get(`/inventory/stock-counts/${count.id}`)).body;
    const res = await a.client.post(`/inventory/stock-counts/${count.id}/submit`, { version: current.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'approved', bookHidden: false });
    expect(res.body.number).toMatch(/^PSC\//);
    const lines = Object.fromEntries(res.body.lines.map((l: any) => [`${l.itemName}${l.batchNo ? ` ${l.batchNo}` : ''}`, l]));
    // Counted 95; book was 100 when snapshotted but 95 at approval: no adjustment.
    expect(lines['Steel rod']).toMatchObject({ systemQty: '100.0000', bookQtyAtPosting: '95.0000', difference: '0.0000' });
    expect(lines['Epoxy resin L3']).toMatchObject({ countedQty: '4.0000', difference: '4.0000', varianceValue: '200.00' });
    expect(lines['Epoxy resin L2']).toMatchObject({ countedQty: null, difference: null });
    expect(res.body.amount).toBe('200.00');

    expect(await qty(item.steel.id)).toBe('95.0000');
    expect(await qty(item.resin.id)).toBe('19.0000');
    const ledger = (await a.client.get(`/inventory/ledger?voucherId=${count.id}`)).body.items;
    expect(ledger.map((r: any) => [r.batchNo, r.qty, r.value])).toEqual([['L3', '4.0000', '200.00']]);
  });

  it('writes off shortages, and cancelling reverses the count', async () => {
    const c = (await a.client.post('/inventory/stock-counts', { warehouseId: wh.MAIN, itemGroupId: groups.SPR })).body;
    expect(c.lines).toHaveLength(1);
    const bad = await a.client.post(`/inventory/stock-counts/${c.id}/counts`, { lines: [{ id: c.lines[0].id, countedQty: '190.5' }] });
    expect(bad.status).toBe(400);
    expect((await a.client.post(`/inventory/stock-counts/${c.id}/submit`, { version: c.version })).status).toBe(400);

    await a.client.post(`/inventory/stock-counts/${c.id}/counts`, { lines: [{ id: c.lines[0].id, countedQty: '190' }] });
    const before = (await a.client.get(`/inventory/stock-counts/${c.id}`)).body;
    expect(before.stats).toMatchObject({ counted: 1, withDifference: 1, shortageValue: '20.00', excessValue: '0.00', estimated: true });
    const posted = (await a.client.post(`/inventory/stock-counts/${c.id}/submit`, { version: before.version })).body;
    expect(posted.lines[0]).toMatchObject({ difference: '-10.0000', varianceValue: '-20.00' });
    expect(await qty(item.bolt.id)).toBe('190.0000');

    const cancelled = await a.client.post(`/inventory/stock-counts/${c.id}/cancel`, { version: posted.version, reason: 'Recount needed' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(await qty(item.bolt.id)).toBe('200.0000');
    expect((await a.client.post(`/inventory/stock-counts/${c.id}/counts`, { lines: [{ id: c.lines[0].id, countedQty: '1' }] })).status).toBe(409);
  });

  it('lists counts with progress', async () => {
    const list = (await a.client.get('/inventory/stock-counts')).body.items;
    expect(list[0]).toMatchObject({ status: 'cancelled', lines: 1, counted: 1, warehouse: { code: 'MAIN' } });
  });
});
