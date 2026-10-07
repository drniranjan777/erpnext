import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

const MAIL_DIR = process.env.MAIL_DIR ?? './.mail';

let a: Workspace;
const emails: string[] = [];
let wh: Record<string, string> = {};
const item: Record<string, any> = {};
const ctx: Record<string, any> = {};

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

beforeAll(async () => {
  a = await signupWorkspace('rb-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.bolt = await ok(await a.client.post('/masters/items', { name: 'Hex bolt', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73181500' }), 201);
  item.nut = await ok(await a.client.post('/masters/items', { name: 'Hex nut', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73181600' }), 201);
  const e = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.bolt.id, qty: '400', rate: '2.5' }, { itemId: item.nut.id, qty: '100', rate: '1' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${e.id}/submit`, { version: e.version }));
  const out = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'material_issue', fromWarehouseId: wh.MAIN, lines: [{ itemId: item.bolt.id, qty: '50' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${out.id}/submit`, { version: out.version }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('report builder', () => {
  it('lists datasets and runs every one with all its fields', async () => {
    const ds = await ok(await a.client.get('/report-builder/datasets'));
    expect(ds.map((d: any) => d.key)).toEqual(expect.arrayContaining(['sales_lines', 'purchase_lines', 'stock_on_hand', 'stock_movements', 'job_cards', 'production_receipts', 'inspections', 'receivables']));
    expect(ds[0].fields[0]).not.toHaveProperty('expr');
    for (const d of ds) {
      const fields = d.fields.map((f: any) => f.key);
      await ok(await a.client.post('/report-builder/run', { dataset: d.key, fields, period: { preset: 'all' } }));
      await ok(await a.client.post('/report-builder/run', { dataset: d.key, fields, group: true, period: { preset: 'fytd' } }));
    }
  });

  it('groups, aggregates, filters and sorts', async () => {
    const r = await ok(await a.client.post('/report-builder/run', { dataset: 'stock_movements', fields: ['itemCode', 'qtyIn', 'qtyOut', 'valueIn'], group: true, sort: { field: 'qtyIn', dir: 'desc' }, period: { preset: 'mtd' } }));
    expect(r.rows.map((x: any) => [x.itemCode, x.qtyIn, x.qtyOut])).toEqual([
      [item.bolt.code, '400.0000', '50.0000'],
      [item.nut.code, '100.0000', '0'],
    ]);
    expect(r.totals.valueIn).toBe('1100.00');
    const f = await ok(await a.client.post('/report-builder/run', { dataset: 'stock_on_hand', fields: ['itemCode', 'qty', 'value'], filters: [{ field: 'value', op: 'gt', value: '500' }] }));
    expect(f.rows).toEqual([{ itemCode: item.bolt.code, qty: '350.0000', value: '875.00' }]);
    const c = await ok(await a.client.post('/report-builder/run', { dataset: 'stock_on_hand', fields: ['item'], filters: [{ field: 'item', op: 'contains', value: 'nut' }] }));
    expect(c.rows).toEqual([{ item: 'Hex nut' }]);
    const inList = await ok(await a.client.post('/report-builder/run', { dataset: 'stock_on_hand', fields: ['itemCode'], filters: [{ field: 'itemCode', op: 'in', value: [item.nut.code] }] }));
    expect(inList.rows).toHaveLength(1);
    expect((await a.client.post('/report-builder/run', { dataset: 'stock_on_hand', fields: ['itemCode'], filters: [{ field: 'itemCode', op: 'eq' }] })).status).toBe(400);
  });

  it('exports what the builder shows', async () => {
    const spec = { dataset: 'stock_on_hand', fields: ['itemCode', 'qty', 'value'] };
    const r = await fetch(`http://localhost:4000/api/v1/report-builder/export`, { method: 'POST', headers: { authorization: `Bearer ${a.client.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ spec, format: 'csv', title: 'Stock check' }) });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/stock-check_/);
    expect(await r.text()).toContain('Item code,Quantity,Value');
  });

  it('saves reports and runs them by id', async () => {
    const saved = await ok(await a.client.post('/report-builder/saved', { name: 'Stock by item', spec: { dataset: 'stock_on_hand', fields: ['itemCode', 'qty', 'value'], sort: { field: 'value', dir: 'desc' } } }), 201);
    const list = await ok(await a.client.get('/report-builder/saved'));
    expect(list).toEqual([expect.objectContaining({ id: saved.id, name: 'Stock by item', mine: true, shared: false })]);
    const run = await ok(await a.client.get(`/report-builder/saved/${saved.id}/run`));
    expect(run).toMatchObject({ title: 'Stock by item', totals: { value: '975.00' } });
    expect((await a.client.post('/report-builder/saved', { name: 'Bad', spec: { dataset: 'stock_on_hand', fields: ['nope'] } })).status).toBe(400);
    ctx.saved = saved.id;
  });
});

describe('scheduled delivery', () => {
  it('plans the next run in India time and validates the rule', async () => {
    expect((await a.client.post('/report-schedules', { name: 'Weekly', reportKey: 'stock-summary', frequency: 'weekly', recipients: ['stores@example.test'] })).body.errors[0].path).toBe('weekday');
    expect((await a.client.post('/report-schedules', { name: 'Both', reportKey: 'stock-summary', savedReportId: ctx.saved, frequency: 'daily', recipients: ['x@example.test'] })).status).toBe(400);
    expect((await a.client.post('/report-schedules', { name: 'Nope', reportKey: 'nope', frequency: 'daily', recipients: ['x@example.test'] })).status).toBe(404);
    const s = await ok(await a.client.post('/report-schedules', { name: 'Morning stock', reportKey: 'stock-summary', frequency: 'daily', hour: 8, recipients: ['stores@example.test'] }), 201);
    const next = new Date(s.nextRunAt);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(next.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
    // 08:00 in India is 02:30 UTC.
    expect([next.getUTCHours(), next.getUTCMinutes()]).toEqual([2, 30]);
    ctx.daily = s.id;
  });

  it('emails the report as an attachment when run', async () => {
    const before = Date.now();
    const s = await ok(await a.client.post('/report-schedules', { name: 'Month-end stock', savedReportId: ctx.saved, frequency: 'monthly', monthDay: 1, hour: 7, recipients: ['owner@example.test'], format: 'csv' }), 201);
    expect(await ok(await a.client.post(`/report-schedules/${s.id}/run`))).toEqual({ status: 'sent', error: null });
    expect(await ok(await a.client.post(`/report-schedules/${ctx.daily}/run`))).toMatchObject({ status: 'sent' });
    const list = await ok(await a.client.get('/report-schedules'));
    expect(list.find((x: any) => x.id === s.id)).toMatchObject({ lastStatus: 'sent', frequency: 'monthly', monthDay: 1 });
    // The dev mailer writes .eml files; find the one for this schedule.
    const files = (await readdir(MAIL_DIR)).filter((f) => f.includes('owner@example.test'));
    const recent = [];
    for (const f of files) if ((await stat(join(MAIL_DIR, f))).mtimeMs >= before - 1000) recent.push(f);
    expect(recent.length).toBeGreaterThanOrEqual(1);
    const eml = await readFile(join(MAIL_DIR, recent.at(-1)!), 'utf8');
    expect(eml).toContain('Stock by item (Month-end stock)');
    expect(eml).toMatch(/filename="?stock-by-item_/);
  });
});
