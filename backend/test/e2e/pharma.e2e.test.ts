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
const ist = (ms: number) => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);
const today = () => ist(Date.now());
const monthsAgo = (m: number) => {
  const d = new Date(Date.now() + 5.5 * 3_600_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - m);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  a = await signupWorkspace('pharma-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.tab = await ok(await a.client.post('/masters/items', { name: 'Paracetamol 500 mg tablets', type: 'finished_good', baseUomId: uom.NOS, gstRate: 12, hsnCode: '30049099', mrp: '1.95' }), 201);
  ctx.api = await ok(await a.client.post('/masters/items', { name: 'Paracetamol IP', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '29242930' }), 201);
  const wc = await ok(await a.client.post('/manufacturing/work-centers', { code: 'COMP', name: 'Compression' }), 201);
  const bom = await ok(await a.client.post('/manufacturing/boms', { itemId: ctx.tab.id, quantity: '1000', lines: [{ itemId: ctx.api.id, qty: '0.55' }], operations: [{ seq: 10, name: 'Compression', workCenterId: wc.id, runMinutes: '0.01' }] }), 201);
  await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: bom.version }));
  const wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'MAIN').id;
  const wo = await ok(await a.client.post('/manufacturing/work-orders', { itemId: ctx.tab.id, qty: '100000', sourceWarehouseId: wh, targetWarehouseId: wh, batchNo: 'PCM2610' }), 201);
  ctx.wo = await ok(await a.client.post(`/manufacturing/work-orders/${wo.id}/submit`, { version: wo.version, force: true }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('stability', () => {
  it('schedules pulls, judges results, raises OOS deviations and estimates the shelf life', async () => {
    const s = await ok(
      await a.client.post('/pharma/stability', {
        code: 'ST-26-01',
        itemId: ctx.tab.id,
        batchNo: 'PCM2609',
        protocolNo: 'STP-PCM-01',
        kind: 'long_term',
        temperatureC: 30,
        humidityPct: 75,
        packing: 'Alu-PVC blister',
        startDate: monthsAgo(13),
        timePoints: [12, 0, 3, 6, 9, 18],
        tests: [{ name: 'Assay', unit: '%', min: 95, max: 105 }, { name: 'Total impurities', unit: '%', max: 0.5 }],
        claimedShelfLifeMonths: 24,
      }),
      201,
    );
    expect(s.timePoints).toEqual([0, 3, 6, 9, 12, 18]);
    const data = [
      [0, 100.2, 0.1],
      [3, 99.5, 0.15],
      [6, 98.9, 0.2],
      [9, 98.1, 0.27],
    ];
    for (const [t, assay, imp] of data) await ok(await a.client.post(`/pharma/stability/${s.id}/results`, { timePoint: t, results: [{ test: 'assay', value: assay }, { test: 'Total impurities', value: imp }] }));
    const v = await ok(await a.client.post(`/pharma/stability/${s.id}/results`, { timePoint: 12, results: [{ test: 'Assay', value: 97.6 }, { test: 'Total impurities', value: 0.56 }] }));
    expect(v.results.filter((r: any) => !r.ok)).toEqual([expect.objectContaining({ test: 'Total impurities', value: 0.56, deviationId: expect.any(String) })]);
    expect(v.schedule.map((x: any) => [x.timePoint, x.tested, x.oos])).toEqual([[0, true, 0], [3, true, 0], [6, true, 0], [9, true, 0], [12, true, 1], [18, false, 0]]);
    const assay = v.trends.find((t: any) => t.test === 'Assay');
    expect(assay.slopePerMonth).toBeCloseTo(-0.22, 2);
    expect(assay.shelfLifeMonths).toBeGreaterThanOrEqual(20);
    expect(v.supportedShelfLifeMonths).toBeLessThan(assay.shelfLifeMonths);
    const dev = await ok(await a.client.get(`/qms/deviations/${v.results.find((r: any) => !r.ok).deviationId}`));
    expect(dev.description).toMatch(/^Stability OOS: study ST-26-01, batch PCM2609, 12 months at 30 °C \/ 75 % RH: Total impurities 0.56 \(specification – to 0.5 %\)\./);
    expect((await a.client.post(`/pharma/stability/${s.id}/results`, { timePoint: 4, results: [{ test: 'Assay', value: 99 }] })).status).toBe(400);
    expect((await a.client.post(`/pharma/stability/${s.id}/results`, { timePoint: 18, results: [{ test: 'Dissolution', value: 99 }] })).status).toBe(400);
    const [row] = await ok(await a.client.get('/pharma/stability'));
    expect(row).toMatchObject({ code: 'ST-26-01', oos: 1, nextPull: { timePoint: 18 }, overdue: 0 });
    ctx.study = s;
  });

  it('compiles the annual product quality review', async () => {
    const r = await ok(await a.client.get(`/pharma/apqr?itemId=${ctx.tab.id}&from=${monthsAgo(12)}&to=${today()}`));
    expect(r.item).toBe(`${ctx.tab.code} · Paracetamol 500 mg tablets`);
    expect(r.batches.count).toBe(1);
    expect(r.batches.list[0]).toMatchObject({ number: ctx.wo.number, qty: 100000, stage: 'released' });
    expect(r.deviations).toEqual([expect.objectContaining({ category: 'material', kind: 'unplanned' })]);
    expect(r.stability).toEqual([expect.objectContaining({ code: 'ST-26-01', condition: '30 °C / 75 % RH', oos: 1, claimed: 24 })]);
  });
});

describe('serialisation and aggregation', () => {
  it('commissions random serials, packs them into cartons and a shipper, and traces any code', async () => {
    expect((await a.client.post('/pharma/serials/commission', { itemId: ctx.tab.id, gtin: '08901234567891', batchNo: 'PCM2610', expiryDate: '2028-09-30', count: 6 })).status).toBe(400);
    const c = await ok(await a.client.post('/pharma/serials/commission', { itemId: ctx.tab.id, gtin: '8901234567890', batchNo: 'PCM2610', expiryDate: '2028-09-30', count: 6, workOrderId: ctx.wo.id }), 201);
    expect(c).toMatchObject({ gtin: '08901234567890', count: 6 });
    expect(c.units[0].hri).toMatch(/^\(01\)08901234567890\(17\)280930\(10\)PCM2610\(21\)[0-9A-Z]{12}$/);
    const codes = c.units.map((u: any) => u.hri);
    const c1 = await ok(await a.client.post('/pharma/serials/aggregate', { level: 'carton', children: codes.slice(0, 3) }), 201);
    const c2 = await ok(await a.client.post('/pharma/serials/aggregate', { level: 'carton', children: [...codes.slice(3, 5), c.units[5].dataMatrix] }), 201);
    expect(c1).toMatchObject({ level: 'carton', units: 3, mixedBatches: false, batchNo: 'PCM2610' });
    expect((await a.client.post('/pharma/serials/aggregate', { level: 'carton', children: [codes[0]] })).status).toBe(409);
    expect((await a.client.post('/pharma/serials/aggregate', { level: 'shipper', children: [c1.code] })).status).toBe(400);
    await ok(await a.client.request('PUT', '/wms/settings', { gs1Prefix: '8901234', ssccExtension: 3 }));
    const ship = await ok(await a.client.post('/pharma/serials/aggregate', { level: 'shipper', children: [c1.code, c2.code] }), 201);
    expect(ship.code).toMatch(/^38901234\d{10}$/);
    expect((await a.client.post('/pharma/serials/aggregate', { level: 'carton', children: [ship.code] })).status).toBe(400);

    const u = await ok(await a.client.get(`/pharma/serials/lookup?code=${encodeURIComponent(codes[4])}`));
    expect(u).toMatchObject({ kind: 'unit', genuine: true, status: 'packed', batchNo: 'PCM2610', parents: [{ code: c2.code, level: 'carton' }, { code: ship.code, level: 'shipper' }] });
    expect(await ok(await a.client.get(`/pharma/serials/lookup?code=${encodeURIComponent('(01)08901234567890(21)FAKE00000000')}`))).toMatchObject({ genuine: false });
    expect(await ok(await a.client.get(`/pharma/serials/lookup?code=${ship.code}`))).toMatchObject({ kind: 'container', level: 'shipper', units: 6 });

    const extra = await ok(await a.client.post('/pharma/serials/commission', { itemId: ctx.tab.id, gtin: '08901234567890', batchNo: 'PCM2610', expiryDate: '2028-09-30', count: 2 }), 201);
    expect((await ok(await a.client.post('/pharma/serials/decommission', { codes: [extra.units[0].hri], reason: 'sample' }))).decommissioned).toBe(1);
    expect(await ok(await a.client.get(`/pharma/serials/lookup?code=${encodeURIComponent(extra.units[0].hri)}`))).toMatchObject({ genuine: false, reason: 'sample' });

    const ex = await ok(await a.client.get(`/pharma/serials/export?itemId=${ctx.tab.id}&batchNo=PCM2610`));
    expect(ex.counts).toEqual({ units: 8, packed: 6, decommissioned: 1 });
    expect(ex.hierarchy).toHaveLength(1);
    expect(ex.hierarchy[0]).toMatchObject({ code: ship.code, level: 'shipper' });
    expect(ex.hierarchy[0].children.map((x: any) => x.children.length)).toEqual([3, 3]);
    expect(ex.loose).toEqual([`08901234567890.${extra.units[1].serial}`]);
    ctx.ship = ship;
  });

  it('builds API labels with their QR content', async () => {
    await ok(await a.client.request('PUT', '/pharma/settings', { manufacturingLicenceNo: 'MFG/TS/2020/001', importLicenceNo: null }));
    const r = await ok(await a.client.get(`/pharma/api-labels?itemId=${ctx.api.id}&batchNo=API2609&batchSize=500%20kg&storage=Store%20below%2025%20%C2%B0C&containers=2`));
    expect(r.labels).toHaveLength(2);
    expect(r.labels[0].qr).toMatch(/^UPIC: .+\nAPI: Paracetamol IP\nMfr: E2E pharma-a .+\nBatch: API2609\nBatch size: 500 kg\nMfg Lic: MFG\/TS\/2020\/001\nStorage: Store below 25 °C$/);
    expect(r.missing).toEqual(['batch record (dates)']);
  });
});

describe('DPCO', () => {
  it('flags an MRP above the ceiling price in force', async () => {
    await ok(await a.client.post('/pharma/dpco/ceilings', { itemId: ctx.tab.id, ceilingPrice: 1.8, notification: 'S.O. 1234(E)', effectiveFrom: monthsAgo(6) }), 201);
    const r = await ok(await a.client.get('/pharma/dpco/check'));
    expect(r.mrp).toEqual([{ item: 'Paracetamol 500 mg tablets', mrp: 1.95, ceiling: 1.8, notification: 'S.O. 1234(E)' }]);
    expect(r.sales).toEqual([]);
    expect((await ok(await a.client.get('/pharma/dpco/ceilings')))[0]).toMatchObject({ ceilingPrice: 1.8, mrp: 1.95 });
  });
});
