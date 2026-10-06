import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let wh: Record<string, string> = {};
const item: Record<string, any> = {};

async function created(path: string, body: unknown) {
  const r = await a.client.post(path, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

beforeAll(async () => {
  a = await signupWorkspace('rpt-a');
  emails.push(a.email);
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.bolt = await created('/masters/items', { name: 'Hex bolt', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73181500', reorderLevel: '1000', reorderQty: '500' });
  item.glue = await created('/masters/items', { name: 'Adhesive', type: 'trading', baseUomId: uom.KG, gstRate: 18, hsnCode: '35069190', trackBatch: true, hasExpiry: true });
  const soon = new Date(Date.now() + 5.5 * 3_600_000 + 20 * 86_400_000).toISOString().slice(0, 10); // 20 days from today in India
  const e = await created('/inventory/stock-entries', {
    purpose: 'opening_stock',
    toWarehouseId: wh.MAIN,
    lines: [
      { itemId: item.bolt.id, qty: '400', rate: '2.5' },
      { itemId: item.glue.id, qty: '10', rate: '200', batchNo: 'G-1', expiryDate: soon },
    ],
  });
  await ok(await a.client.post(`/inventory/stock-entries/${e.id}/submit`, { version: e.version }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('report catalogue', () => {
  it('lists more than sixty reports across every area', async () => {
    const c = await ok(await a.client.get('/reports'));
    expect(c.reports.length).toBeGreaterThanOrEqual(60);
    expect(new Set(c.reports.map((r: any) => r.category))).toEqual(new Set(['sales', 'purchase', 'inventory', 'production', 'quality', 'finance', 'gst']));
    const reg = c.reports.find((r: any) => r.key === 'sales-register');
    expect(reg.params.find((p: any) => p.key === 'from').default).toMatch(/^\d{4}-04-01$/);
  });

  it('runs every query report on the live schema', async () => {
    const c = await ok(await a.client.get('/reports'));
    for (const r of c.reports.filter((x: any) => x.kind === 'query')) {
      const q = r.params.some((p: any) => p.required) ? `?itemId=${item.bolt.id}` : '';
      const res = await a.client.get(`/reports/${r.key}${q}`);
      expect(res.status, `${r.key}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.columns.length).toBeGreaterThan(0);
    }
  });
});

describe('report figures, parameters and exports', () => {
  it('values stock and totals it', async () => {
    const r = await ok(await a.client.get('/reports/stock-summary'));
    const bolt = r.rows.find((x: any) => x.code === item.bolt.code);
    expect(bolt).toMatchObject({ qty: '400.0000', value: '1000.00', rate: '2.50', warehouse: 'MAIN' });
    expect(r.totals.value).toBe('3000.00');
  });

  it('shows reorder needs, expiring batches and movements', async () => {
    const reorder = await ok(await a.client.get('/reports/reorder'));
    expect(reorder.rows.find((x: any) => x.code === item.bolt.code)).toMatchObject({ onHand: '400.0000', suggested: '500.0000' });
    const exp = await ok(await a.client.get('/reports/batch-expiry?days=30'));
    expect(exp.rows[0]).toMatchObject({ batchNo: 'G-1', daysLeft: '20' });
    expect((await ok(await a.client.get('/reports/batch-expiry?days=10'))).rows).toHaveLength(0);
    const mv = await ok(await a.client.get('/reports/stock-movement'));
    expect(mv.rows.find((x: any) => x.code === item.bolt.code)).toMatchObject({ opening: '0', inward: '400.0000', closing: '400.0000' });
    const age = await ok(await a.client.get('/reports/stock-ageing'));
    expect(age.rows.find((x: any) => x.code === item.bolt.code)).toMatchObject({ d30: '400.0000', value: '1000.00' });
    const slow = await ok(await a.client.get('/reports/slow-moving?days=0'));
    expect(slow.rows.map((x: any) => x.code).sort()).toEqual([item.bolt.code, item.glue.code].sort());
  });

  it('checks parameters', async () => {
    expect((await a.client.get('/reports/purchase-price-history')).body.errors[0].path).toBe('itemId');
    expect((await a.client.get('/reports/sales-register?from=2026-13-01')).status).toBe(400);
    expect((await a.client.get('/reports/sales-register?from=2026-10-01&to=2026-09-01')).body.errors[0].message).toMatch(/ends before/);
    expect((await a.client.get('/reports/work-order-status?stage=bogus')).status).toBe(400);
    expect((await a.client.get('/reports/nope')).status).toBe(404);
    expect((await a.client.get('/reports/trial-balance')).status).toBe(404);
  });

  it('exports to Excel and CSV', async () => {
    const x = await a.client.download('/reports/stock-summary/export');
    expect(x.status).toBe(200);
    expect(x.type).toMatch(/spreadsheetml/);
    expect(x.disposition).toMatch(/stock-summary_.*\.xlsx/);
    expect(x.bytes.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    const c = await a.client.download('/reports/stock-summary/export?format=csv');
    const text = new TextDecoder().decode(c.bytes);
    expect(text).toContain('Code,Item,Group,Warehouse,Quantity');
    expect(text).toContain('Total');
  });
});
