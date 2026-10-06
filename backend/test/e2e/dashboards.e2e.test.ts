import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let stores: Awaited<ReturnType<typeof addMember>>;
const emails: string[] = [];
const ctx: Record<string, any> = {};

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

beforeAll(async () => {
  a = await signupWorkspace('dash-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  const wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  const bolt = await ok(await a.client.post('/masters/items', { name: 'Hex bolt', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73181500', reorderLevel: '1000' }), 201);
  const e = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: bolt.id, qty: '400', rate: '2.5' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${e.id}/submit`, { version: e.version }));
  const role = await ok(await a.client.post('/iam/roles', { name: 'Storekeeper', permissions: ['inventory.stock.read', 'masters.items.read'] }), 201);
  stores = await addMember(a.client, 'dash-stores', [role.id]);
  emails.push(stores.email);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('dashboards', () => {
  it('gives the owner the owner dashboard, every widget computed', async () => {
    const d = await ok(await a.client.get('/dashboards/view'));
    expect(d).toMatchObject({ id: null, preset: 'owner', name: 'Owner' });
    expect(d.widgets.length).toBeGreaterThanOrEqual(10);
    expect(d.widgets.filter((w: any) => w.error)).toEqual([]);
    expect(d.widgets.find((w: any) => w.key === 'stock-value').data).toMatchObject({ kind: 'kpi', value: '1000.00', unit: 'money' });
  });

  it('computes every preset without errors', async () => {
    const { presets } = await ok(await a.client.get('/dashboards'));
    expect(presets.map((p: any) => p.key)).toEqual(expect.arrayContaining(['owner', 'plant', 'sales', 'purchase', 'stores', 'production', 'finance', 'qa', 'tv']));
    for (const p of presets) {
      const d = await ok(await a.client.get(`/dashboards/view?preset=${p.key}`));
      expect(d.widgets.filter((w: any) => w.error), p.key).toEqual([]);
    }
    const stores = await ok(await a.client.get('/dashboards/view?preset=stores'));
    expect(stores.widgets.find((w: any) => w.key === 'below-reorder').data).toMatchObject({ value: '1', tone: 'bad' });
    const trend = await ok(await a.client.get('/dashboards/view?preset=sales'));
    expect(trend.widgets.find((w: any) => w.key === 'sales-trend').data.points).toHaveLength(12);
  });

  it('saves personal dashboards, one default at a time', async () => {
    const first = await ok(await a.client.post('/dashboards', { name: 'Morning check', widgets: [{ key: 'stock-value', size: 1 }, { key: 'nope', size: 1 }], isDefault: true }), 201);
    const second = await ok(await a.client.post('/dashboards', { name: 'Month end', widgets: [{ key: 'cash-bank', size: 1 }, { key: 'profit-mtd', size: 1 }], isDefault: true }), 201);
    const home = await ok(await a.client.get('/dashboards/view'));
    expect(home).toMatchObject({ id: second.id, name: 'Month end', mine: true, isDefault: true });
    const morning = await ok(await a.client.get(`/dashboards/view?id=${first.id}`));
    expect(morning.isDefault).toBe(false);
    // Unknown widgets are dropped on save.
    expect(morning.widgets.map((w: any) => w.key)).toEqual(['stock-value']);
    ctx.mine = first.id;
  });

  it('shares dashboards only from administrators, and hides widgets a viewer cannot see', async () => {
    const shared = await ok(await a.client.post('/dashboards', { name: 'Plant board', shared: true, widgets: [{ key: 'stock-value', size: 1 }, { key: 'sales-mtd', size: 1 }] }), 201);
    expect((await stores.client.post('/dashboards', { name: 'Mine to all', shared: true, widgets: [{ key: 'stock-value', size: 1 }] })).status).toBe(403);
    const list = await ok(await stores.client.get('/dashboards'));
    expect(list.saved.map((s: any) => s.name)).toEqual(['Plant board']);
    expect(list.presets.map((p: any) => p.key)).toEqual(['stores']);
    const v = await ok(await stores.client.get(`/dashboards/view?id=${shared.id}`));
    expect(v.widgets.map((w: any) => w.key)).toEqual(['stock-value']);
    expect((await stores.client.get(`/dashboards/view?id=${ctx.mine}`)).status).toBe(404);
    expect((await stores.client.delete(`/dashboards/${shared.id}`)).status).toBe(403);
    // A storekeeper's home is built from what they can see.
    const home = await ok(await stores.client.get('/dashboards/view'));
    expect(home.widgets.every((w: any) => ['stores', 'general'].includes(w.area))).toBe(true);
    await ok(await a.client.delete(`/dashboards/${shared.id}`), 204);
  });
});
