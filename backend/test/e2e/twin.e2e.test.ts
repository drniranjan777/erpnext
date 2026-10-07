import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_URL, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
async function device(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_URL}/iot/device${path}`, { method, headers: { 'content-type': 'application/json', 'x-device-token': ctx.gw.token }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const istDate = (ms: number) => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  a = await signupWorkspace('twin-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.crate = await ok(await a.client.post('/masters/items', { name: 'Crate 20 L', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39231090' }), 201);
  ctx.pp = await ok(await a.client.post('/masters/items', { name: 'PP granules', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39021000' }), 201);
  ctx.wc = await ok(await a.client.post('/manufacturing/work-centers', { code: 'IMM', name: 'Injection moulding', hoursPerDay: '8', daysPerWeek: 6, units: 1 }), 201);
  ctx.machine = await ok(await a.client.post('/manufacturing/machines', { code: 'IMM-01', name: '250T moulder', workCenterId: ctx.wc.id }), 201);
  const bom = await ok(await a.client.post('/manufacturing/boms', { itemId: ctx.crate.id, quantity: '1', lines: [{ itemId: ctx.pp.id, qty: '1.2' }], operations: [{ seq: 10, name: 'Moulding', workCenterId: ctx.wc.id, setupMinutes: '30', runMinutes: '1' }] }), 201);
  await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: bom.version }));
  const wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'MAIN').id;
  ctx.wos = [];
  for (const due of [2, 3]) {
    const wo = await ok(await a.client.post('/manufacturing/work-orders', { itemId: ctx.crate.id, qty: '600', sourceWarehouseId: wh, targetWarehouseId: wh, plannedEnd: istDate(Date.now() + due * 86_400_000) }), 201);
    ctx.wos.push(await ok(await a.client.post(`/manufacturing/work-orders/${wo.id}/submit`, { version: wo.version, force: true })));
  }
  ctx.gw = await ok(await a.client.post('/iot/gateways', { code: 'GW1', name: 'Moulding edge' }), 201);
  await ok(await a.client.post('/iot/signals', { code: 'IMM-01.run', name: 'Running', gatewayId: ctx.gw.id, machineId: ctx.machine.id, purpose: 'run_state' }), 201);
  await ok(await a.client.post('/iot/signals', { code: 'IMM-01.oil', name: 'Oil temperature', gatewayId: ctx.gw.id, machineId: ctx.machine.id, purpose: 'temperature', unit: '°C' }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('what-if simulation', () => {
  it('shows how a second machine, longer hours and a rush order change the plan, without saving', async () => {
    const base = await ok(await a.client.post('/twin/simulate', {}));
    expect(base.baseline).toEqual(base.scenario);
    expect(base.orders).toHaveLength(2);

    const more = await ok(await a.client.post('/twin/simulate', { workCenters: [{ workCenterId: ctx.wc.id, units: 2, hoursPerDay: 16 }] }));
    expect(new Date(more.scenario.finishesAt).getTime()).toBeLessThan(new Date(more.baseline.finishesAt).getTime());
    expect(more.scenario.late).toBeLessThanOrEqual(more.baseline.late);
    expect(more.orders.every((o: any) => o.shiftHours <= 0)).toBe(true);
    const imm = (s: any) => s.load.find((l: any) => l.code === 'IMM');
    expect(imm(more.scenario)).toMatchObject({ units: 2, hoursPerDay: 16 });
    expect(imm(more.baseline)).toMatchObject({ units: 1, hoursPerDay: 8 });

    const rush = await ok(await a.client.post('/twin/simulate', { newOrders: [{ itemId: ctx.crate.id, qty: 300, priority: 1, due: istDate(Date.now() + 86_400_000) }] }));
    expect(rush.orders.find((o: any) => o.added)).toMatchObject({ number: 'What-if', item: `${ctx.crate.code} · Crate 20 L × 300`, before: null });
    expect(rush.orders.filter((o: any) => !o.added).every((o: any) => o.shiftHours >= 0)).toBe(true);
    expect(imm(rush.scenario).busyHours).toBeGreaterThan(imm(rush.baseline).busyHours);

    expect((await a.client.post('/twin/simulate', { newOrders: [{ itemId: ctx.pp.id, qty: 10 }] })).status).toBe(400);
    expect((await a.client.post('/twin/simulate', { workCenters: [{ workCenterId: ctx.machine.id, units: 2 }] })).status).toBe(400);
    const ops = (await ok(await a.client.get(`/manufacturing/work-orders/${ctx.wos[0].id}`))).operations;
    expect(ops[0].scheduledStart ?? null).toBeNull();
  });
});

describe('plant layout', () => {
  it('draws machines on a layout and shows them live', async () => {
    const l = await ok(
      await a.client.post('/twin/layouts', {
        name: 'Moulding shop',
        width: 40,
        height: 20,
        isDefault: true,
        nodes: [
          { kind: 'area', label: 'Moulding', x: 1, y: 1, w: 20, h: 10 },
          { kind: 'machine', machineId: ctx.machine.id, x: 3, y: 3, w: 5, h: 3 },
          { kind: 'label', label: 'Exit', x: 38, y: 18, w: 2, h: 1 },
        ],
      }),
      201,
    );
    expect(l.nodes).toHaveLength(3);
    expect((await ok(await a.client.get('/twin/layouts/default'))).id).toBe(l.id);
    await ok(await device('POST', '/ingest', { batchId: 'live-1', readings: [{ s: 'IMM-01.run', t: Date.now() - 1000, v: 1 }, { s: 'IMM-01.oil', t: Date.now() - 1000, v: 48.5 }] }));
    const live = await ok(await a.client.get(`/twin/layouts/${l.id}/live`));
    const m = live.nodes.find((n: any) => n.kind === 'machine');
    expect(m).toMatchObject({ machineCode: 'IMM-01', live: { state: 'running', offline: false, alarms: 0, anomalies: 0, signals: [expect.objectContaining({ code: 'IMM-01.oil', lastValue: 48.5 })] } });
    const moved = await ok(await a.client.request('PUT', `/twin/layouts/${l.id}`, { name: 'Moulding shop', width: 40, height: 20, nodes: [{ kind: 'machine', machineId: ctx.machine.id, x: 10, y: 4 }] }));
    expect(moved.nodes).toEqual([expect.objectContaining({ x: 10, y: 4, w: 4, h: 3 })]);
  });
});

describe('vision inspection', () => {
  it('deploys a model to a gateway, takes results once, monitors drift and calls quality on a burst of defects', async () => {
    const m = await ok(await a.client.post('/vision/models', { name: 'crate-surface', version: '1.0', classes: ['scratch', 'short_shot'], minConfidence: 0.6, artifactUrl: 'https://models.example.com/crate-surface-1.0.onnx', validation: { precision: 0.96, recall: 0.93, samples: 1200 } }), 201);
    expect((await a.client.post('/vision/models', { name: 'crate-surface', version: '1.0', classes: ['scratch'] })).status).toBe(409);
    const d = await ok(await a.client.post(`/vision/models/${m.id}/deploy`, { gatewayIds: [ctx.gw.id] }));
    expect(d.status).toBe('deployed');
    const cmds = await ok(await device('GET', '/commands'));
    expect(cmds[0]).toMatchObject({ kind: 'deploy_model', payload: { model: { name: 'crate-surface', version: '1.0', classes: ['scratch', 'short_shot'] } } });
    await ok(await device('POST', `/commands/${cmds[0].id}/result`, { ok: true, message: 'Model crate-surface 1.0 ready' }));

    const now = Date.now();
    const base = [...Array(40)].map((_, i) => ({ ref: `b${i}`, t: now - 3 * 86_400_000 - i * 60_000, model: 'crate-surface', version: '1.0', machine: 'IMM-01', result: 'ok', confidence: 0.93 }));
    const recent = [...Array(40)].map((_, i) => ({ ref: `r${i}`, t: now - i * 60_000, model: 'crate-surface', version: '1.0', machine: 'imm-01', result: i % 10 < 3 ? 'defect' : 'ok', defectClass: i % 10 < 3 ? 'scratch' : null, confidence: 0.9 }));
    const r1 = await ok(await device('POST', '/inspections', { inspections: [...base, ...recent] }));
    expect(r1).toMatchObject({ accepted: 80, rejected: 0, duplicates: 0, qualityCalls: 1 });
    expect((await ok(await device('POST', '/inspections', { inspections: recent.slice(0, 5) }))).duplicates).toBe(5);
    const calls = await ok(await a.client.get('/mes/andon/calls'));
    expect(calls[0]).toMatchObject({ kind: 'quality', machineCode: 'IMM-01', note: 'Vision inspection: many defects in the last parts' });

    const [mon] = await ok(await a.client.get('/vision/monitoring'));
    expect(mon).toMatchObject({ name: 'crate-surface', recent: { total: 40, defects: 12, defectRatePct: 30 }, baseline: { total: 40, defects: 0 } });
    expect(mon.drift[0]).toMatch(/^Defect rate rose from 0 % to 30 %/);
    expect(mon.machines[0]).toMatchObject({ machineCode: 'IMM-01', defects: 12 });

    const toReview = await ok(await a.client.get('/vision/inspections?toReview=true'));
    expect(toReview).toHaveLength(12);
    await ok(await a.client.post(`/vision/inspections/${toReview[0].id}/review`, { review: 'wrong', actualClass: null }));
    await ok(await a.client.post(`/vision/inspections/${toReview[1].id}/review`, { review: 'correct' }));
    const [after] = await ok(await a.client.get('/vision/monitoring'));
    expect(after.recent).toMatchObject({ reviewed: 2, accuracyPct: 50, falseRejects: 1 });
    const models = await ok(await a.client.get('/vision/models'));
    expect(models[0].deployments).toEqual([{ gatewayCode: 'GW1', status: 'done', result: 'Model crate-surface 1.0 ready' }]);
  });
});
