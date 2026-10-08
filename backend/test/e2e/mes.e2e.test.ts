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
async function ingest(batchId: string, readings: { s: string; t: number; v: number }[]) {
  const res = await fetch(`${API_URL}/iot/device/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': ctx.gw.token }, body: JSON.stringify({ batchId, readings }) });
  expect(res.status).toBe(200);
  return res.json();
}
const T0 = Math.floor((Date.now() - 3 * 3_600_000) / 60_000) * 60_000;
const t = (sec: number) => T0 + sec * 1000;
const iso = (sec: number) => new Date(t(sec)).toISOString();

beforeAll(async () => {
  a = await signupWorkspace('mes-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  const crate = await ok(await a.client.post('/masters/items', { name: 'Crate 20 L', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39231090' }), 201);
  const pp = await ok(await a.client.post('/masters/items', { name: 'PP granules', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39021000' }), 201);
  const wc = await ok(await a.client.post('/manufacturing/work-centers', { code: 'IMM', name: 'Injection moulding', labourRate: '100' }), 201);
  ctx.machine = await ok(await a.client.post('/manufacturing/machines', { code: 'IMM-01', name: '250T moulder', workCenterId: wc.id }), 201);
  const mould = await ok(await a.client.post('/manufacturing/tools', { code: 'MLD-CR', name: 'Crate mould', kind: 'mould', cavities: 2 }), 201);
  const bom = await ok(await a.client.post('/manufacturing/boms', { itemId: crate.id, quantity: '1', lines: [{ itemId: pp.id, qty: '1.2' }], operations: [{ seq: 10, name: 'Moulding', workCenterId: wc.id, toolId: mould.id, runMinutes: '0.2' }] }), 201);
  await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: bom.version }));
  const wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'MAIN').id;
  const wo = await ok(await a.client.post('/manufacturing/work-orders', { itemId: crate.id, qty: '1000', sourceWarehouseId: wh, targetWarehouseId: wh }), 201);
  ctx.wo = await ok(await a.client.post(`/manufacturing/work-orders/${wo.id}/submit`, { version: wo.version, force: true }));
  const sync = await ok(await a.client.post('/manufacturing/job-cards/sync', { events: [{ type: 'start', clientRef: `mes-${T0}`, at: iso(0), operationId: ctx.wo.operations[0].id, machineId: ctx.machine.id }] }));
  ctx.sync = sync;
  ctx.gw = await ok(await a.client.post('/iot/gateways', { code: 'GW1', name: 'Moulding edge' }), 201);
  await ok(await a.client.post('/iot/signals', { code: 'IMM-01.shots', name: 'Shots', gatewayId: ctx.gw.id, machineId: ctx.machine.id, purpose: 'part_count' }), 201);
  await ok(await a.client.post('/iot/signals', { code: 'IMM-01.rejects', name: 'Rejects', gatewayId: ctx.gw.id, machineId: ctx.machine.id, purpose: 'reject_count' }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('machine states and counts from signals', () => {
  it('sets up shifts, reasons and the machine with defaults', async () => {
    const s = await ok(await a.client.get('/mes/setup'));
    expect(s.shifts.map((x: any) => x.code)).toEqual(['A', 'B', 'C']);
    expect(s.reasons.find((r: any) => r.code === 'BRK')).toMatchObject({ loss: 'breakdown' });
    expect(s.machines[0]).toMatchObject({ code: 'IMM-01', signals: 2, stopAfterSeconds: 120, minorStopSeconds: 300 });
    await ok(await a.client.request('PUT', `/mes/machines/${ctx.machine.id}/settings`, { idealCycleSeconds: 25, stopAfterSeconds: 120, minorStopSeconds: 300, targetOeePct: 70 }));
    expect((await a.client.request('PUT', '/mes/shifts', [{ code: 'A', name: 'x', startMinute: 0, endMinute: 10 }, { code: 'a', name: 'y', startMinute: 10, endMinute: 20 }])).status).toBe(400);
  });

  it('detects running and stops from the shot counter and counts into the running job card', async () => {
    const readings: { s: string; t: number; v: number }[] = [{ s: 'IMM-01.shots', t: t(0), v: 0 }, { s: 'IMM-01.rejects', t: t(0), v: 0 }];
    for (let i = 1; i <= 20; i++) readings.push({ s: 'IMM-01.shots', t: t(i * 30), v: i });
    readings.push({ s: 'IMM-01.rejects', t: t(600), v: 4 });
    for (let sec = 660; sec <= 1500; sec += 60) readings.push({ s: 'IMM-01.shots', t: t(sec), v: 20 });
    for (let i = 0; i < 10; i++) readings.push({ s: 'IMM-01.shots', t: t(1530 + i * 30), v: 21 + i });
    const r = await ingest('run-1', readings);
    expect(r.accepted).toBe(readings.length);

    const stops = await ok(await a.client.get(`/mes/downtime?from=${iso(0)}&to=${iso(1800)}&unexplained=true`));
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ state: 'stopped', machineCode: 'IMM-01', seconds: 930, reasonId: null });
    expect(stops[0].startedAt).toBe(new Date(t(600)).toISOString().replace('T', ' ').replace('.000Z', '+00'));
    ctx.stop = stops[0];

    const board = await ok(await a.client.get('/mes/board'));
    const m = board.machines.find((x: any) => x.code === 'IMM-01');
    expect(m).toMatchObject({ state: 'running', offline: true, job: { number: ctx.wo.number, operation: 'Moulding', good: 56, reject: 4, orderQty: 1000 } });
  });

  it('computes OEE with its losses', async () => {
    const o = await ok(await a.client.get(`/mes/oee?from=${iso(0)}&to=${iso(1800)}&by=machine`));
    const row = o.rows[0];
    // Running 30–600 s and 1530–1800 s, stopped 600–1530 s; 29 shots × 2 cavities at 12 s ideal in the window
    // (the shot at 1800 s counts in the next minute); 4 rejects.
    expect(row).toMatchObject({ label: 'IMM-01 · 250T moulder', targetOeePct: 70, noDataSeconds: 30, runSeconds: 840, operatingSeconds: 840, good: 54, reject: 4, idealSeconds: 696, stops: 1 });
    // Shift breaks inside the stop count as planned; how much overlaps depends on the time of day the test runs.
    const planned = row.plannedStopSeconds;
    expect(row.losses).toMatchObject({ speed: 144, defects: 48 });
    expect(row.losses.unexplained + planned).toBe(930);
    expect([row.availability, row.performance, row.quality]).toEqual([Math.round((840 / (1770 - planned)) * 1e4) / 1e4, 0.8286, 0.931]);
    expect(o.total.oee).toBe(row.oee);
  });

  it('takes a reason for the stop, which moves it to breakdown', async () => {
    const reasons = (await ok(await a.client.get('/mes/setup'))).reasons;
    const brk = reasons.find((r: any) => r.code === 'BRK');
    await ok(await a.client.post(`/mes/states/${ctx.stop.id}/reason`, { reasonId: brk.id, note: 'Heater band failed' }));
    expect(await ok(await a.client.get(`/mes/downtime?from=${iso(0)}&to=${iso(1800)}&unexplained=true`))).toEqual([]);
    const o = await ok(await a.client.get(`/mes/oee?from=${iso(0)}&to=${iso(1800)}`));
    expect(o.rows[0].losses).toMatchObject({ breakdown: 930, unexplained: 0 });
    expect(o.rows[0].availability).toBe(0.4746);
    const byShift = await ok(await a.client.get(`/mes/oee?from=${iso(0)}&to=${iso(1800)}&by=day`));
    expect(byShift.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps a manual planned stop until the machine produces again', async () => {
    await ok(await a.client.post(`/mes/machines/${ctx.machine.id}/state`, { state: 'planned_stop', note: 'Lunch' }));
    await ingest('hb-1', [{ s: 'IMM-01.shots', t: Date.now() - 1000, v: 30 }]);
    let m = (await ok(await a.client.get('/mes/board'))).machines[0];
    expect(m).toMatchObject({ state: 'planned_stop', manual: true, offline: false });
    await ingest('run-2', [{ s: 'IMM-01.shots', t: Date.now(), v: 31 }]);
    m = (await ok(await a.client.get('/mes/board'))).machines[0];
    expect(m).toMatchObject({ state: 'running', manual: false });
  });
});

describe('Andon', () => {
  it('raises, answers and closes calls from the line', async () => {
    const call = await ok(await a.client.post('/mes/andon/calls', { machineId: ctx.machine.id, kind: 'maintenance', note: 'Hydraulic oil leak' }), 201);
    expect((await a.client.post('/mes/andon/calls', { machineId: ctx.machine.id, kind: 'maintenance' })).status).toBe(409);
    expect((await ok(await a.client.get('/mes/board'))).machines[0].calls).toEqual([expect.objectContaining({ kind: 'maintenance', ackedAt: null })]);
    await ok(await a.client.post(`/mes/andon/calls/${call.id}/ack`));
    expect((await a.client.post(`/mes/andon/calls/${call.id}/ack`)).status).toBe(409);
    await ok(await a.client.post(`/mes/andon/calls/${call.id}/resolve`, { resolution: 'Seal replaced' }));
    expect(await ok(await a.client.get('/mes/andon/calls'))).toEqual([]);
    const all = await ok(await a.client.get('/mes/andon/calls?open=false'));
    expect(all[0]).toMatchObject({ kind: 'maintenance', resolution: 'Seal replaced', machineCode: 'IMM-01' });
    expect(all[0].responseSeconds).toBeGreaterThanOrEqual(0);
  });
});
