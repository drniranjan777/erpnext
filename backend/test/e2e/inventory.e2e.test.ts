import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let b: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let wh: Record<string, string> = {};
const item: Record<string, any> = {};

async function newItem(name: string, patch: Record<string, unknown> = {}) {
  const res = await a.client.post('/masters/items', { name, type: 'raw_material', baseUomId: uom.KG, gstRate: 18, ...patch });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** Creates and submits an entry; returns the submit response. */
async function post(body: Record<string, unknown>) {
  const created = await a.client.post('/inventory/stock-entries', body);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return a.client.post(`/inventory/stock-entries/${created.body.id}/submit`, { version: created.body.version });
}

/** Position of one item in one warehouse. */
async function level(itemId: string, warehouseId: string) {
  const d = (await a.client.get(`/inventory/stock/${itemId}`)).body;
  return d.byWarehouse.find((w: any) => w.warehouseId === warehouseId) ?? { qty: '0.0000', value: '0.00' };
}

beforeAll(async () => {
  a = await signupWorkspace('inv-a');
  b = await signupWorkspace('inv-b');
  emails.push(a.email, b.email);
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  const scrap = await a.client.post('/inventory/warehouses', { code: 'SCRAP', name: 'Scrap yard', type: 'scrap', isNettable: false });
  expect(scrap.status, JSON.stringify(scrap.body)).toBe(201);
  wh.SCRAP = scrap.body.id;

  item.avg = await newItem('Mild steel sheet', { purchaseUomId: uom.BAG, conversions: [{ uomId: uom.BAG, factor: '25' }], reorderLevel: '100', reorderQty: '500' });
  item.fifo = await newItem('Copper wire', { valuationMethod: 'fifo' });
  item.batch = await newItem('Adhesive resin', { trackBatch: true, hasExpiry: true, shelfLifeDays: 180 });
  item.serial = await newItem('Servo motor', { type: 'spare', baseUomId: uom.NOS, trackSerial: true });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId, b?.tenantId].filter(Boolean), emails);
});

describe('weighted average', () => {
  it('posts opening stock and values receipts in alternate units', async () => {
    const open = await post({ purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.avg.id, qty: '100', rate: '10' }] });
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    expect(open.body).toMatchObject({ status: 'approved', purpose: 'opening_stock', amount: '1000.00' });
    expect(open.body.number).toMatch(/^SE\//);
    expect(open.body.can.amend).toBe(false);

    // 2 BAG × ₹260 = 50 KG @ ₹10.40
    const rcpt = await post({ purpose: 'material_receipt', toWarehouseId: wh.MAIN, lines: [{ itemId: item.avg.id, uomId: uom.BAG, qty: '2', rate: '260' }] });
    expect(rcpt.status, JSON.stringify(rcpt.body)).toBe(200);
    expect(await level(item.avg.id, wh.MAIN)).toMatchObject({ qty: '150.0000', value: '1520.00' });
  });

  it('issues at the running average and records the value on the entry', async () => {
    const res = await post({ purpose: 'material_issue', fromWarehouseId: wh.MAIN, lines: [{ itemId: item.avg.id, qty: '60' }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.amount).toBe('608.00'); // 60 × 10.133333
    expect(res.body.lines[0]).toMatchObject({ amount: '608.00', rate: '10.1333' });
    expect(await level(item.avg.id, wh.MAIN)).toMatchObject({ qty: '90.0000', value: '912.00' });
  });

  it('blocks issuing more than is available and rolls the submit back', async () => {
    const created = (await a.client.post('/inventory/stock-entries', { purpose: 'material_issue', fromWarehouseId: wh.MAIN, lines: [{ itemId: item.avg.id, qty: '1000' }] })).body;
    const res = await a.client.post(`/inventory/stock-entries/${created.id}/submit`, { version: created.version });
    expect(res.status).toBe(400);
    expect(res.body.detail ?? res.body.title).toMatch(/Not enough stock/);
    const after = (await a.client.get(`/inventory/stock-entries/${created.id}`)).body;
    expect(after).toMatchObject({ status: 'draft', number: null });
  });

  it('transfers at cost; quarantine stock is not available', async () => {
    const res = await post({ purpose: 'transfer', fromWarehouseId: wh.MAIN, toWarehouseId: wh.QC, lines: [{ itemId: item.avg.id, qty: '40' }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await level(item.avg.id, wh.QC)).toMatchObject({ qty: '40.0000', value: '405.33' });
    const lvl = (await a.client.get('/inventory/stock')).body.items.find((r: any) => r.itemId === item.avg.id);
    expect(lvl).toMatchObject({ qty: '90.0000', available: '50.0000', value: '912.00', belowReorder: true, suggestedOrderQty: '500.0000' });
    const reorder = (await a.client.get('/inventory/stock?belowReorder=true')).body.items.map((r: any) => r.itemId);
    expect(reorder).toContain(item.avg.id);
  });

  it('validates purposes, units and warehouses', async () => {
    const errs = async (body: Record<string, unknown>) => (await a.client.post('/inventory/stock-entries', body)).body.errors?.map((e: any) => e.path);
    expect(await errs({ purpose: 'material_issue', lines: [{ itemId: item.avg.id, qty: '1' }] })).toContain('fromWarehouseId');
    expect(await errs({ purpose: 'transfer', fromWarehouseId: wh.MAIN, toWarehouseId: wh.MAIN, lines: [{ itemId: item.avg.id, qty: '1' }] })).toContain('toWarehouseId');
    expect(await errs({ purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.avg.id, qty: '1' }] })).toContain('lines.0.rate');
    expect(await errs({ purpose: 'material_receipt', toWarehouseId: wh.MAIN, lines: [{ itemId: item.avg.id, qty: '-1' }] })).toContain('lines.0.qty');
    expect(await errs({ purpose: 'material_receipt', toWarehouseId: wh.MAIN, lines: [{ itemId: item.avg.id, uomId: uom.LTR, qty: '1' }] })).toContain('lines.0.uomId');
    expect(await errs({ purpose: 'adjustment', toWarehouseId: wh.MAIN, lines: [{ itemId: item.avg.id, qty: '-1' }] })).toContain('reason');
  });
});

describe('FIFO', () => {
  it('consumes the oldest layers first', async () => {
    await post({ purpose: 'material_receipt', toWarehouseId: wh.MAIN, lines: [{ itemId: item.fifo.id, qty: '10', rate: '5' }] });
    await post({ purpose: 'material_receipt', toWarehouseId: wh.MAIN, lines: [{ itemId: item.fifo.id, qty: '10', rate: '7' }] });
    const res = await post({ purpose: 'material_issue', fromWarehouseId: wh.MAIN, lines: [{ itemId: item.fifo.id, qty: '15' }] });
    expect(res.body.amount).toBe('85.00');
    expect(await level(item.fifo.id, wh.MAIN)).toMatchObject({ qty: '5.0000', value: '35.00' });
  });
});

describe('cancellation', () => {
  it('reverses an issue at its original value and keeps the ledger append-only', async () => {
    const issue = (await post({ purpose: 'material_issue', fromWarehouseId: wh.MAIN, lines: [{ itemId: item.fifo.id, qty: '5' }] })).body;
    expect(await level(item.fifo.id, wh.MAIN)).toMatchObject({ qty: '0.0000', value: '0.00' });
    const cancelled = await a.client.post(`/inventory/stock-entries/${issue.id}/cancel`, { version: issue.version, reason: 'Issued to wrong job' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(await level(item.fifo.id, wh.MAIN)).toMatchObject({ qty: '5.0000', value: '35.00' });
    const ledger = (await a.client.get(`/inventory/ledger?voucherId=${issue.id}`)).body.items;
    expect(ledger.map((r: any) => [r.qty, r.value, r.isReversal])).toEqual([
      ['5.0000', '35.00', true],
      ['-5.0000', '-35.00', false],
    ]);
  });

  it("won't cancel a receipt whose stock has already been used", async () => {
    const rcpt = (await post({ purpose: 'material_receipt', toWarehouseId: wh.MAIN, lines: [{ itemId: item.fifo.id, qty: '3', rate: '9' }] })).body;
    await post({ purpose: 'material_issue', fromWarehouseId: wh.MAIN, lines: [{ itemId: item.fifo.id, qty: '8' }] });
    const res = await a.client.post(`/inventory/stock-entries/${rcpt.id}/cancel`, { version: rcpt.version, reason: 'Wrong supplier' });
    expect(res.status).toBe(409);
  });

  it('posted entries cannot be amended', async () => {
    const list = (await a.client.get('/inventory/stock-entries?status=approved')).body.items;
    const res = await a.client.post(`/inventory/stock-entries/${list[0].id}/amend`, { version: 1, reason: 'test' });
    expect(res.status).toBe(404);
  });
});

describe('batches & expiry', () => {
  it('computes expiry from the manufacturing date and suggests FEFO order', async () => {
    const res = await post({
      purpose: 'material_receipt',
      toWarehouseId: wh.MAIN,
      lines: [
        { itemId: item.batch.id, qty: '20', rate: '100', batchNo: 'b-late', mfgDate: '2026-09-01' },
        { itemId: item.batch.id, qty: '10', rate: '100', batchNo: 'B-EARLY', mfgDate: '2026-06-01' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const batches = (await a.client.get(`/inventory/batches?itemId=${item.batch.id}&warehouseId=${wh.MAIN}`)).body;
    expect(batches.map((b: any) => [b.batchNo, b.expiryDate, b.qty])).toEqual([
      ['B-EARLY', '2026-11-28', '10.0000'],
      ['B-LATE', '2027-02-28', '20.0000'],
    ]);
  });

  it('requires a batch, checks batch stock and reports expiring lots', async () => {
    const noBatch = await a.client.post('/inventory/stock-entries', { purpose: 'material_issue', fromWarehouseId: wh.MAIN, lines: [{ itemId: item.batch.id, qty: '1' }] });
    expect(noBatch.body.errors.map((e: any) => e.path)).toContain('lines.0.batchNo');
    const tooMuch = await post({ purpose: 'material_issue', fromWarehouseId: wh.MAIN, lines: [{ itemId: item.batch.id, qty: '15', batchNo: 'B-EARLY' }] });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.detail ?? tooMuch.body.title).toMatch(/batch B-EARLY/);
    const expiring = (await a.client.get('/inventory/batches/expiring?days=3650')).body;
    expect(expiring.map((e: any) => e.batchNo)).toEqual(expect.arrayContaining(['B-EARLY', 'B-LATE']));
  });

  it('blocks issuing an expired batch but allows writing it off', async () => {
    await post({ purpose: 'material_receipt', toWarehouseId: wh.MAIN, lines: [{ itemId: item.batch.id, qty: '5', rate: '100', batchNo: 'OLD-1', mfgDate: '2020-01-01', expiryDate: '2020-06-30' }] });
    const issue = await post({ purpose: 'material_issue', fromWarehouseId: wh.MAIN, lines: [{ itemId: item.batch.id, qty: '5', batchNo: 'OLD-1' }] });
    expect(issue.status).toBe(400);
    expect(issue.body.detail ?? issue.body.title).toMatch(/expired/);
    const toScrap = await post({ purpose: 'transfer', fromWarehouseId: wh.MAIN, toWarehouseId: wh.SCRAP, lines: [{ itemId: item.batch.id, qty: '2', batchNo: 'OLD-1' }] });
    expect(toScrap.status, JSON.stringify(toScrap.body)).toBe(200);
    const writeOff = await post({ purpose: 'adjustment', toWarehouseId: wh.MAIN, reason: 'Expired, destroyed', lines: [{ itemId: item.batch.id, qty: '-3', batchNo: 'OLD-1' }] });
    expect(writeOff.status, JSON.stringify(writeOff.body)).toBe(200);
  });
});

describe('serial numbers', () => {
  it('tracks each unit', async () => {
    const bad = await a.client.post('/inventory/stock-entries', { purpose: 'material_receipt', toWarehouseId: wh.MAIN, lines: [{ itemId: item.serial.id, qty: '2', rate: '15000', serialNos: ['SM-1'] }] });
    expect(bad.body.errors.map((e: any) => e.path)).toContain('lines.0.serialNos');

    const rcpt = await post({ purpose: 'material_receipt', toWarehouseId: wh.MAIN, lines: [{ itemId: item.serial.id, qty: '2', rate: '15000', serialNos: ['sm-1', 'SM-2'] }] });
    expect(rcpt.status, JSON.stringify(rcpt.body)).toBe(200);
    const dup = await post({ purpose: 'material_receipt', toWarehouseId: wh.MAIN, lines: [{ itemId: item.serial.id, qty: '1', rate: '15000', serialNos: ['SM-2'] }] });
    expect(dup.status).toBe(400);
    const unknown = await post({ purpose: 'material_issue', fromWarehouseId: wh.MAIN, lines: [{ itemId: item.serial.id, qty: '1', serialNos: ['SM-9'] }] });
    expect(unknown.status).toBe(400);
    const wrongWh = await post({ purpose: 'transfer', fromWarehouseId: wh.QC, toWarehouseId: wh.MAIN, lines: [{ itemId: item.serial.id, qty: '1', serialNos: ['SM-1'] }] });
    expect(wrongWh.status).toBe(400);
    const ok = await post({ purpose: 'transfer', fromWarehouseId: wh.MAIN, toWarehouseId: wh.QC, lines: [{ itemId: item.serial.id, qty: '1', serialNos: ['SM-1'] }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await level(item.serial.id, wh.QC)).toMatchObject({ qty: '1.0000', value: '15000.00' });
  });
});

describe('reports & isolation', () => {
  it('values stock by warehouse and group', async () => {
    const v = (await a.client.get('/inventory/valuation')).body;
    expect(v.byWarehouse.map((w: any) => w.code)).toEqual(expect.arrayContaining(['MAIN', 'QC']));
    expect(v.byGroup.length).toBeGreaterThan(0);
  });

  it('ledger rows carry the running position', async () => {
    const rows = (await a.client.get(`/inventory/ledger?itemId=${item.avg.id}&warehouseId=${wh.MAIN}`)).body.items;
    expect(rows.map((r: any) => r.balanceQty)).toEqual(['50.0000', '90.0000', '150.0000', '100.0000']);
  });

  it("other workspaces can't see this stock", async () => {
    const entries = (await a.client.get('/inventory/stock-entries')).body.items;
    expect((await b.client.get(`/inventory/stock-entries/${entries[0].id}`)).status).toBe(404);
    expect((await b.client.get('/inventory/stock')).body.items).toEqual([]);
    expect((await b.client.get(`/inventory/ledger?itemId=${item.avg.id}`)).body.items).toEqual([]);
  });
});
