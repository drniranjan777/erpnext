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
async function device(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_URL}/iot/device${path}`, { method, headers: { 'content-type': 'application/json', 'x-device-token': ctx.gw.token }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
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
const job = (extra: Record<string, unknown> = {}) => ({ operationId: ctx.op.id, machineId: ctx.machine.id, toolCode: 'MLD-CR', materials: [{ code: ctx.pp.code }], stepsAcked: [0, 2], ...extra });

beforeAll(async () => {
  a = await signupWorkspace('mesx-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.crate = await ok(await a.client.post('/masters/items', { name: 'Crate 20 L', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39231090' }), 201);
  ctx.pp = await ok(await a.client.post('/masters/items', { name: 'PP granules', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39021000' }), 201);
  ctx.wc = await ok(await a.client.post('/manufacturing/work-centers', { code: 'IMM', name: 'Injection moulding', labourRate: '100' }), 201);
  ctx.machine = await ok(await a.client.post('/manufacturing/machines', { code: 'IMM-01', name: '250T moulder', workCenterId: ctx.wc.id }), 201);
  await ok(await a.client.post('/manufacturing/tools', { code: 'MLD-CR', name: 'Crate mould', kind: 'mould', cavities: 1 }), 201);
  await ok(await a.client.post('/manufacturing/tools', { code: 'MLD-X', name: 'Other mould', kind: 'mould' }), 201);
  const mould = (await a.client.get('/manufacturing/tools')).body.find((t: any) => t.code === 'MLD-CR');
  const bom = await ok(await a.client.post('/manufacturing/boms', { itemId: ctx.crate.id, quantity: '1', lines: [{ itemId: ctx.pp.id, qty: '1.2' }], operations: [{ seq: 10, name: 'Moulding', workCenterId: ctx.wc.id, toolId: mould.id, runMinutes: '0.5' }] }), 201);
  await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: bom.version }));
  const wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'MAIN').id;
  const wo = await ok(await a.client.post('/manufacturing/work-orders', { itemId: ctx.crate.id, qty: '100', sourceWarehouseId: wh, targetWarehouseId: wh }), 201);
  ctx.wo = await ok(await a.client.post(`/manufacturing/work-orders/${wo.id}/submit`, { version: wo.version, force: true }));
  ctx.op = ctx.wo.operations[0];
  ctx.gw = await ok(await a.client.post('/iot/gateways', { code: 'GW1', name: 'Moulding edge' }), 201);
  await ok(await a.client.post('/iot/signals', { code: 'IMM-01.barrel', name: 'Barrel temperature', gatewayId: ctx.gw.id, machineId: ctx.machine.id, purpose: 'temperature', unit: '°C' }), 201);
  await owner(`insert into batches (tenant_id, item_id, batch_no, qc_status) values ($1, $2, 'PP-Q1', 'quarantine')`, [a.tenantId, ctx.pp.id]);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('instructions, recipes and skills', () => {
  it('versions work instructions and releases one at a time', async () => {
    const body = {
      itemId: ctx.crate.id,
      operationSeq: 10,
      title: 'Moulding the 20 L crate',
      steps: [
        { title: 'Check the mould is clamped', body: 'All 8 clamps tight', confirm: true },
        { title: 'Purge the barrel', body: 'Two shots to the purge tray' },
        { title: 'Safety gate interlock works', body: 'Open the gate: the cycle must stop', confirm: true, caution: true },
      ],
      characteristics: [{ name: 'Weight', unit: 'g', min: 410, max: 430, everyMinutes: 30 }],
      firstOffRequired: true,
      scanMaterials: true,
    };
    const v1 = await ok(await a.client.post('/mes/instructions', body), 201);
    expect(v1).toMatchObject({ version: 1, status: 'draft' });
    await ok(await a.client.post(`/mes/instructions/${v1.id}/release`));
    expect((await a.client.post(`/mes/instructions/${v1.id}/release`)).status).toBe(409);
    const v2 = await ok(await a.client.request('PUT', `/mes/instructions/${v1.id}`, { ...body, title: 'Revised' }));
    expect(v2).toMatchObject({ version: 2, status: 'draft' });
    const list = await ok(await a.client.get(`/mes/instructions?itemId=${ctx.crate.id}`));
    expect(list.map((i: any) => [i.version, i.status])).toEqual([[2, 'draft'], [1, 'released']]);
  });

  it('keeps recipes within their limits', async () => {
    const params = [
      { name: 'Barrel temp', unit: '°C', value: 230, min: 220, max: 240, signalCode: 'IMM-01.barrel', target: { protocol: 'modbus-tcp', endpoint: '192.168.1.20:502', address: '100', dataType: 'float32' } },
      { name: 'Cooling time', unit: 's', value: 12 },
    ];
    expect((await a.client.post('/mes/recipes', { itemId: ctx.crate.id, machineId: ctx.machine.id, parameters: [{ ...params[0], value: 250 }] })).status).toBe(400);
    const r = await ok(await a.client.post('/mes/recipes', { itemId: ctx.crate.id, machineId: ctx.machine.id, parameters: params }), 201);
    await ok(await a.client.post(`/mes/recipes/${r.id}/release`));
    ctx.recipe = r;
  });

  it('records skills and logs the operator in', async () => {
    await ok(await a.client.post('/mes/skills', { operatorName: 'Ravi', workCenterId: ctx.wc.id, level: 2, validUntil: '2030-03-31' }), 201);
    await ok(await a.client.post(`/mes/machines/${ctx.machine.id}/login`, { operatorName: 'Ravi' }), 201);
    const t = await ok(await a.client.get(`/mes/machines/${ctx.machine.id}/terminal`));
    expect(t.session.operatorName).toBe('Ravi');
    expect(t.queue[0]).toMatchObject({ operationId: ctx.op.id, workOrderNumber: ctx.wo.number, toolCode: 'MLD-CR', hasInstructions: true });
    const prep = await ok(await a.client.get(`/mes/jobs/prepare?operationId=${ctx.op.id}&machineId=${ctx.machine.id}`));
    expect(prep.instruction).toMatchObject({ version: 1, firstOffRequired: true });
    expect(prep.recipe.parameters).toHaveLength(2);
    expect(prep.required).toEqual([{ itemId: ctx.pp.id, code: ctx.pp.code, name: 'PP granules' }]);
  });
});

describe('running a job', () => {
  it('refuses a start that fails its checks', async () => {
    const bad = job({ toolCode: 'MLD-X', materials: [{ code: ctx.pp.code, batchNo: 'PP-Q1' }], stepsAcked: [0] });
    const c = await ok(await a.client.post('/mes/jobs/check', bad));
    expect(c.canStart).toBe(false);
    expect(c.checks.filter((x: any) => !x.ok).map((x: any) => x.code)).toEqual(['tool', 'material', 'instructions']);
    const r = await a.client.post('/mes/jobs/start', bad);
    expect(r.status).toBe(409);
    expect(r.body.detail).toMatch(/^Cannot start: MLD-X is not the tool for this operation; Batch is quarantine; Confirm step 3$/);
  });

  it('starts a correct job and sends the recipe to the gateway', async () => {
    const e = await ok(await a.client.post('/mes/jobs/start', job()), 201);
    expect(e).toMatchObject({ operatorName: 'Ravi', firstOff: { status: 'pending' }, jobCard: { status: 'running', operation: 'Moulding', toolCode: 'MLD-CR' } });
    expect(e.checks.every((c: any) => c.ok)).toBe(true);
    expect(e.recipe.download).toMatchObject({ status: 'pending' });
    ctx.exec = e;
    const cmds = await ok(await device('GET', '/commands'));
    expect(cmds).toHaveLength(1);
    expect(cmds[0].payload.writes).toEqual([{ protocol: 'modbus-tcp', endpoint: '192.168.1.20:502', address: '100', dataType: 'float32', name: 'Barrel temp', value: 230 }]);
    await ok(await device('POST', `/commands/${cmds[0].id}/result`, { ok: true, message: 'Written: Barrel temp=230' }));
    expect((await device('POST', `/commands/${cmds[0].id}/result`, { ok: true })).status).toBe(404);
    const now = Date.now();
    await ok(await device('POST', '/ingest', { batchId: 'barrel-1', readings: [228, 231, 233].map((v, i) => ({ s: 'IMM-01.barrel', t: now + i, v })) }));
    const v = await ok(await a.client.get(`/mes/executions/${e.id}`));
    expect(v.recipe.download).toMatchObject({ status: 'done', result: 'Written: Barrel temp=230' });
    expect(v.recipe.parameters[0]).toMatchObject({ name: 'Barrel temp', setPoint: 230, written: true, measured: { min: 228, max: 233, n: 3 }, inSpec: true });
    expect(v.recipe.parameters[1]).toMatchObject({ name: 'Cooling time', written: false, measured: null, inSpec: null });
  });

  it('holds good pieces until the first-off is approved', async () => {
    const stop = await a.client.post(`/manufacturing/job-cards/${ctx.exec.jobCard.id}/stop`, { goodQty: '10', rejectQty: '0' });
    expect(stop.status).toBe(409);
    expect(stop.body.detail).toMatch(/first-off piece has not been approved/);
    expect((await a.client.post(`/mes/executions/${ctx.exec.id}/first-off`, { approved: true, readings: [{ name: 'Weight', value: 436 }] })).status).toBe(400);
    expect((await a.client.post(`/mes/executions/${ctx.exec.id}/first-off`, { approved: true, readings: [{ name: 'Colour', value: 1 }] })).status).toBe(400);
    const v = await ok(await a.client.post(`/mes/executions/${ctx.exec.id}/first-off`, { approved: true, readings: [{ name: 'weight', value: 421 }], note: 'OK' }));
    expect(v.firstOff).toMatchObject({ status: 'approved', readings: [{ name: 'Weight', value: 421, ok: true }], by: expect.any(String) });
  });

  it('calls quality when an in-line check is out of limits, then closes the job with its record', async () => {
    const v = await ok(await a.client.post(`/mes/executions/${ctx.exec.id}/inline`, { readings: [{ name: 'Weight', value: 435 }] }));
    expect(v.inlineChecks).toEqual([expect.objectContaining({ allOk: false, readings: [{ name: 'Weight', value: 435, ok: false }] })]);
    const calls = await ok(await a.client.get('/mes/andon/calls'));
    expect(calls[0]).toMatchObject({ kind: 'quality', machineCode: 'IMM-01', note: 'In-line check out of limits: Weight 435' });
    await ok(await a.client.post(`/manufacturing/job-cards/${ctx.exec.jobCard.id}/stop`, { goodQty: '10', rejectQty: '0' }));
    const done = await ok(await a.client.get(`/mes/executions/${ctx.exec.id}`));
    expect(done.jobCard).toMatchObject({ status: 'done', goodQty: 10 });
    expect(done.checksDue).toEqual([]);
    expect(done.parameters.find((p: any) => p.code === 'IMM-01.barrel')).toMatchObject({ n: 3, min: 228, max: 233 });
    expect((await a.client.post(`/mes/executions/${ctx.exec.id}/inline`, { readings: [{ name: 'Weight', value: 420 }] })).status).toBe(409);
    const list = await ok(await a.client.get(`/mes/executions?workOrderId=${ctx.wo.id}`));
    expect(list).toEqual([expect.objectContaining({ id: ctx.exec.id, firstOff: 'approved', machineCode: 'IMM-01' })]);
  });
});
