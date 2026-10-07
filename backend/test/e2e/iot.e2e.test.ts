import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, API_URL, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let b: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
async function device(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${API_URL}/iot/device${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-device-token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}
const T0 = Math.floor((Date.now() - 10 * 60_000) / 10_000) * 10_000;
const t = (sec: number) => T0 + sec * 1000;

beforeAll(async () => {
  a = await signupWorkspace('iot-a');
  b = await signupWorkspace('iot-b');
  emails.push(a.email, b.email);
  const wc = await ok(await a.client.post('/manufacturing/work-centers', { code: 'IMM', name: 'Injection moulding' }), 201);
  ctx.machine = await ok(await a.client.post('/manufacturing/machines', { code: 'IMM-01', name: '250T moulder', workCenterId: wc.id }), 201);
  ctx.asset = await ok(await a.client.post('/maintenance/assets', { code: 'A-IMM-01', name: '250T moulder', level: 'machine', machineId: ctx.machine.id, criticality: 'A' }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId, b?.tenantId].filter(Boolean), emails);
});

describe('gateways and signals', () => {
  it('registers a gateway with a token shown once', async () => {
    const g = await ok(await a.client.post('/iot/gateways', { code: 'GW-PLANT1', name: 'Plant 1 edge PC', location: 'Moulding shop' }), 201);
    expect(g.token).toMatch(new RegExp(`^${a.tenantId}\\.`));
    expect(g.tokenHash).toBeUndefined();
    ctx.gw = g;
    expect((await a.client.post('/iot/gateways', { code: 'gw-plant1', name: 'Again' })).status).toBe(409);
    const list = await ok(await a.client.get('/iot/gateways'));
    expect(list[0]).toMatchObject({ code: 'GW-PLANT1', online: null, signals: 0, tokenHint: g.token.slice(-4) });
  });

  it('defines signals with how the agent reads them', async () => {
    ctx.temp = await ok(
      await a.client.post('/iot/signals', {
        code: 'IMM-01.mould_temp',
        name: 'Mould temperature',
        gatewayId: ctx.gw.id,
        machineId: ctx.machine.id,
        purpose: 'temperature',
        unit: '°C',
        scale: 0.1,
        deadband: 0.5,
        source: { protocol: 'modbus-tcp', endpoint: '192.168.1.20:502', unitId: 1, table: 'holding', address: '40', dataType: 'int16' },
      }),
      201,
    );
    ctx.shots = await ok(await a.client.post('/iot/signals', { code: 'IMM-01.shots', name: 'Shot counter', gatewayId: ctx.gw.id, machineId: ctx.machine.id, purpose: 'part_count', source: { protocol: 'mqtt', endpoint: 'mqtt://broker:1883', address: 'plant1/imm01/shots' } }), 201);
    expect((await a.client.post('/iot/signals', { code: 'IMM-01.shots', name: 'Dup' })).status).toBe(409);
    expect((await a.client.post('/iot/signals', { code: 'bad code!', name: 'Bad' })).status).toBe(400);
  });

  it('gives the agent its configuration only with a valid token', async () => {
    const cfg = await ok(await device('GET', '/config', ctx.gw.token));
    expect(cfg.gateway.code).toBe('GW-PLANT1');
    expect(cfg.signals.map((s: any) => [s.code, s.counter])).toEqual(expect.arrayContaining([['IMM-01.mould_temp', false], ['IMM-01.shots', true]]));
    expect(cfg.signals.find((s: any) => s.code === 'IMM-01.mould_temp')).toMatchObject({ scale: 0.1, deadband: 0.5, source: { protocol: 'modbus-tcp', address: '40' } });
    expect((await device('GET', '/config', null)).status).toBe(401);
    expect((await device('GET', '/config', `${a.tenantId}.wrong`)).status).toBe(401);
    expect((await device('GET', '/config', `${b.tenantId}.${ctx.gw.token.split('.')[1]}`)).status).toBe(401);
  });
});

describe('ingestion and alarms', () => {
  it('raises a held alarm with a maintenance request, applies a batch once and clears', async () => {
    ctx.rule = await ok(await a.client.post('/iot/rules', { signalId: ctx.temp.id, name: 'Mould overheating', op: 'above', threshold: 80, delaySeconds: 30, severity: 'critical', createMaintenance: true }), 201);
    expect((await a.client.post('/iot/rules', { signalId: ctx.temp.id, name: 'Band', op: 'outside', threshold: 50 })).status).toBe(400);

    const batch1 = {
      batchId: 'b-1',
      agentVersion: '1.0.0',
      buffered: 12,
      readings: [
        { s: 'IMM-01.mould_temp', t: t(0), v: 72 },
        { s: 'imm-01.mould_temp', t: t(10), v: 84 },
        { s: 'IMM-01.shots', t: t(10), v: 1200 },
        { s: 'IMM-02.unknown', t: t(10), v: 1 },
        { s: 'IMM-01.shots', t: Date.now() + 3_600_000, v: 1 },
      ],
    };
    const r1 = await ok(await device('POST', '/ingest', ctx.gw.token, batch1));
    expect(r1).toEqual({ batchId: 'b-1', duplicate: false, accepted: 3, unknown: ['IMM-02.unknown'], rejected: 1 });
    expect((await ok(await device('POST', '/ingest', ctx.gw.token, batch1))).duplicate).toBe(true);
    expect((await ok(await a.client.get('/iot/alarms'))).length).toBe(0);

    const r2 = await ok(await device('POST', '/ingest', ctx.gw.token, { batchId: 'b-2', readings: [{ s: 'IMM-01.mould_temp', t: new Date(t(45)).toISOString(), v: 91.5 }, { s: 'IMM-01.mould_temp', t: t(50), v: 95 }] }));
    expect(r2.accepted).toBe(2);
    const [alarm] = await ok(await a.client.get('/iot/alarms'));
    expect(alarm).toMatchObject({ severity: 'critical', value: 91.5, peakValue: 95, machineCode: 'IMM-01', clearedAt: null, ruleName: 'Mould overheating' });
    expect(alarm.message).toBe('Mould overheating: IMM-01.mould_temp is 91.5 °C (limit above 80 °C for 30 s)');
    expect(alarm.maintenanceOrderId).toBeTruthy();
    const mo = await ok(await a.client.get(`/maintenance/orders/${alarm.maintenanceOrderId}`));
    expect(mo).toMatchObject({ kind: 'condition', priority: 'urgent', requestedBy: 'IoT alarm' });

    await ok(await device('POST', '/ingest', ctx.gw.token, { batchId: 'b-3', readings: [{ s: 'IMM-01.mould_temp', t: t(70), v: 76 }] }));
    const [cleared] = await ok(await a.client.get('/iot/alarms'));
    expect(cleared.clearedAt).toBeTruthy();
    await ok(await a.client.post(`/iot/alarms/${cleared.id}/ack`, { note: 'Chiller valve stuck, fixed' }));
    expect(await ok(await a.client.get('/iot/alarms'))).toEqual([]);
    expect((await a.client.post(`/iot/alarms/${cleared.id}/ack`, {})).status).toBe(409);
    expect((await ok(await a.client.get('/iot/alarms?status=all')))[0]).toMatchObject({ note: 'Chiller valve stuck, fixed', ackedBy: expect.any(String) });
  });

  it('shows live values, gateway health and history', async () => {
    const sigs = await ok(await a.client.get(`/iot/signals?machineId=${ctx.machine.id}`));
    expect(sigs.find((s: any) => s.code === 'IMM-01.mould_temp'), JSON.stringify(sigs)).toMatchObject({ lastValue: 76, gatewayCode: 'GW-PLANT1', openAlarms: 0 });
    const [gw] = await ok(await a.client.get('/iot/gateways'));
    expect(gw).toMatchObject({ online: true, agentVersion: '1.0.0', buffered: 0, signals: 2 });
    const s = await ok(await a.client.get(`/iot/signals/${ctx.temp.id}/series?from=${new Date(t(0)).toISOString()}&to=${new Date(t(120)).toISOString()}&points=12`));
    expect(s.bucketSeconds).toBe(10);
    expect(s.points.map((p: any) => p.avg)).toEqual([72, 84, 91.5, 95, 76]);
  });

  it('refuses disabled gateways and keeps tenants apart', async () => {
    await ok(await a.client.post(`/iot/gateways/${ctx.gw.id}/status`, { status: 'disabled' }));
    expect((await device('POST', '/ingest', ctx.gw.token, { batchId: 'b-4', readings: [] })).status).toBe(401);
    const rotated = await ok(await a.client.post(`/iot/gateways/${ctx.gw.id}/token`), 201);
    expect((await device('GET', '/config', ctx.gw.token)).status).toBe(401);
    expect((await device('GET', '/config', rotated.token)).status).toBe(200);
    expect(await ok(await b.client.get('/iot/signals'))).toEqual([]);
    const role = await ok(await a.client.post('/iam/roles', { name: 'No IoT', permissions: ['inventory.stock.read'] }), 201);
    const viewer = await addMember(a.client, 'iot-none', [role.id]);
    emails.push(viewer.email);
    expect((await viewer.client.get('/iot/signals')).status).toBe(403);
  });
});
