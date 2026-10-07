import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
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
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body;
}
async function owner(q: string, params: unknown[]) {
  const url = process.env.DATABASE_OWNER_URL ?? readFileSync(join(__dirname, '..', '..', '..', 'database', '.env'), 'utf8').match(/^DATABASE_OWNER_URL=(.*)$/m)?.[1];
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    return (await pool.query(q, params)).rows;
  } finally {
    await pool.end();
  }
}
/** Start of a 30-minute demand interval about two hours ago. */
const T = Math.floor((Date.now() - 2 * 3_600_000) / 1_800_000) * 1_800_000;
const min = (m: number) => T + m * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const wobble = (i: number) => Math.sin(i * 1.7) * 0.2 + Math.cos(i * 0.9) * 0.1;

beforeAll(async () => {
  a = await signupWorkspace('plant-a');
  emails.push(a.email);
  const wc = await ok(await a.client.post('/manufacturing/work-centers', { code: 'PRESS', name: 'Press shop' }), 201);
  ctx.machine = await ok(await a.client.post('/manufacturing/machines', { code: 'PR-01', name: '100T press', workCenterId: wc.id }), 201);
  await ok(await a.client.post('/maintenance/assets', { code: 'A-PR-01', name: '100T press', level: 'machine', machineId: ctx.machine.id }), 201);
  ctx.wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'MAIN').id;
  ctx.gw = await ok(await a.client.post('/iot/gateways', { code: 'GW1', name: 'Plant edge' }), 201);
  const sig = async (body: Record<string, unknown>) => ok(await a.client.post('/iot/signals', { gatewayId: ctx.gw.id, ...body }), 201);
  ctx.main = await sig({ code: 'MAIN.kwh', name: 'Incomer kWh', purpose: 'energy_kwh', unit: 'kWh' });
  ctx.m1kwh = await sig({ code: 'PR-01.kwh', name: 'Press kWh', purpose: 'energy_kwh', unit: 'kWh', machineId: ctx.machine.id });
  ctx.shots = await sig({ code: 'PR-01.strokes', name: 'Strokes', purpose: 'part_count', machineId: ctx.machine.id });
  ctx.vib = await sig({ code: 'PR-01.vib', name: 'Main bearing vibration', purpose: 'vibration', unit: 'mm/s', machineId: ctx.machine.id });
  ctx.cold = await sig({ code: 'COLD-1.temp', name: 'Cold room', purpose: 'temperature', unit: '°C', warehouseId: ctx.wh });
  ctx.van = await sig({ code: 'VAN-1.temp', name: 'Reefer van', purpose: 'temperature', unit: '°C', vehicleNo: 'TS 08 UB 4455' });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('energy', () => {
  it('meters kWh per machine and per unit, warns before the contract demand and reports carbon', async () => {
    await ok(await a.client.request('PUT', '/plant/energy/settings', { contractDemandKw: 100, demandIntervalMinutes: 30, alertPct: 90, gridFactor: 0.716, tariffPerKwh: 8, mainSignalIds: [ctx.main.id] }));
    const readings: { s: string; t: number; v: number }[] = [];
    for (let m = 0; m <= 10; m++) {
      readings.push({ s: 'MAIN.kwh', t: min(m), v: 5 * m }, { s: 'PR-01.kwh', t: min(m), v: 1000 + m }, { s: 'PR-01.strokes', t: min(m), v: 10 * m });
    }
    await ingest('energy-1', readings);
    const s = await ok(await a.client.get('/plant/energy/settings'));
    // 50 kWh in the first 10 minutes projects to 300 kW against 100 kW contract demand: one alert for the interval.
    expect(s.lastAlertInterval).toBe(iso(T));
    const e = await ok(await a.client.get(`/plant/energy?from=${iso(T)}&to=${iso(min(30))}`));
    expect(e).toMatchObject({ totalKwh: 50, costInr: 400, co2Kg: 35.8, maxDemandKw: 100, contractDemandKw: 100 });
    expect(e.meters.map((m: any) => [m.code, m.kwh, m.main])).toEqual([['MAIN.kwh', 50, true], ['PR-01.kwh', 10, false]]);
    expect(e.machines[0]).toMatchObject({ code: 'PR-01', kwh: 10, good: 100, kwhPerUnit: 0.1, co2KgPerUnit: 0.0716 });
    expect(e.daily.reduce((n: number, d: any) => n + d.kwh, 0)).toBe(50);
  });
});

describe('condition monitoring', () => {
  it('learns normal vibration, raises a maintenance request on a repeated spike and takes feedback', async () => {
    expect((await a.client.request('PUT', `/plant/condition/models/${ctx.shots.id}`, {})).status).toBe(400);
    await ok(await a.client.request('PUT', `/plant/condition/models/${ctx.vib.id}`, { minSamples: 30, zThreshold: 4, consecutive: 3, driftThreshold: 2.5, createMaintenance: true }));
    const base = min(40);
    const normal = [...Array(40)].map((_, i) => ({ s: 'PR-01.vib', t: base + i * 10_000, v: Math.round((2 + wobble(i)) * 1000) / 1000 }));
    await ingest('vib-1', normal);
    let models = await ok(await a.client.get('/plant/condition/models'));
    expect(models.find((m: any) => m.code === 'PR-01.vib')).toMatchObject({ enabled: true, learned: true, n: 40, openAnomalies: 0 });
    await ingest('vib-2', [9, 9.4, 9.1].map((v, i) => ({ s: 'PR-01.vib', t: base + (40 + i) * 10_000, v })));
    const { rows } = await ok(await a.client.get('/plant/condition/anomalies'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'spike', value: 9.1, machineCode: 'PR-01', clearedAt: null });
    expect(rows[0].maintenanceOrderId).toBeTruthy();
    const mo = await ok(await a.client.get(`/maintenance/orders/${rows[0].maintenanceOrderId}`));
    expect(mo).toMatchObject({ kind: 'condition', requestedBy: 'Condition monitoring' });
    await ingest('vib-3', [{ s: 'PR-01.vib', t: base + 43 * 10_000, v: 2.05 }]);
    models = await ok(await a.client.get('/plant/condition/models'));
    expect(models.find((m: any) => m.code === 'PR-01.vib').openAnomalies).toBe(0);
    await ok(await a.client.post(`/plant/condition/anomalies/${rows[0].id}/feedback`, { feedback: 'confirmed', note: 'Outer race spalling found' }));
    const after = await ok(await a.client.get('/plant/condition/anomalies?status=all'));
    expect(after.summary).toMatchObject({ total: 1, confirmed: 1, falseAlarms: 0, withMaintenance: 1, precisionPct: 100 });
    expect((await ok(await a.client.get('/plant/condition/anomalies'))).rows).toEqual([]);
  });
});

describe('cold chain', () => {
  it('reports excursions and mean kinetic temperature against the logger range', async () => {
    await ok(await a.client.post('/iot/rules', { signalId: ctx.cold.id, name: 'Cold room 2–8 °C', op: 'outside', threshold: 2, threshold2: 8, delaySeconds: 600 }), 201);
    const start = Date.now() - 2 * 3_600_000;
    const temps = [...Array(24)].map((_, i) => ({ s: 'COLD-1.temp', t: start + i * 5 * 60_000, v: i >= 6 && i < 9 ? 10 : 5 }));
    temps.push({ s: 'COLD-1.temp', t: Date.now() - 60_000, v: 5 });
    await ingest('cold-1', temps);
    const r = await ok(await a.client.get(`/plant/cold-chain/report?signalId=${ctx.cold.id}&from=${iso(start - 1000)}`));
    expect(r).toMatchObject({ range: { low: 2, high: 8 }, readings: 25, min: 5, max: 10, minutesOutside: 15 });
    expect(r.excursions).toEqual([expect.objectContaining({ direction: 'high', worst: 10, minutes: 15 })]);
    expect(r.mktC).toBeGreaterThan(5.6);
    const list = await ok(await a.client.get('/plant/cold-chain'));
    expect(list.map((l: any) => [l.code, l.status])).toEqual([['COLD-1.temp', 'ok'], ['VAN-1.temp', 'no_data']]);
    expect(list[0].last24h).toMatchObject({ excursions: 1, minutesOutside: 15 });
    // A wider range given in the query overrides the logger's own.
    const wide = await ok(await a.client.get(`/plant/cold-chain/report?signalId=${ctx.cold.id}&from=${iso(start - 1000)}&low=0&high=12`));
    expect(wide.excursions).toEqual([]);
  });

  it('gives the temperatures of a trip from the loggers in its vehicle', async () => {
    const start = Date.now() - 90 * 60_000;
    await ingest('van-1', [...Array(10)].map((_, i) => ({ s: 'VAN-1.temp', t: start + i * 6 * 60_000, v: 4 + (i === 5 ? 6 : 0) })));
    const [trip] = await owner(
      `insert into tms_trips (tenant_id, number, trip_date, vehicle_no, status, dispatched_at, completed_at) values ($1, 'TRIP/E2E/1', current_date::text, 'TS08UB4455', 'completed', $2, $3) returning id`,
      [a.tenantId, iso(start - 60_000), iso(start + 50 * 60_000)],
    );
    const r = await ok(await a.client.get(`/plant/cold-chain/trips/${trip.id}`));
    expect(r.trip.number).toBe('TRIP/E2E/1');
    expect(r.loggers).toHaveLength(1);
    expect(r.loggers[0]).toMatchObject({ readings: 9, max: 10, logger: { code: 'VAN-1.temp' } });
    expect(r.loggers[0].excursions).toEqual([]);
    const r2 = await ok(await a.client.get(`/plant/cold-chain/report?signalId=${ctx.van.id}&from=${iso(start - 1000)}&low=2&high=8`));
    expect(r2.excursions).toEqual([expect.objectContaining({ direction: 'high', minutes: 6 })]);
  });
});
