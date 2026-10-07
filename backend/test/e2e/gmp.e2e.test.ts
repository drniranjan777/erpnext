import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let qa: Awaited<ReturnType<typeof addMember>>;
const emails: string[] = [];
const ctx: Record<string, any> = {};

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
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
const job = () => ({ operationId: ctx.op.id, machineId: ctx.machine.id, operatorName: 'Ravi', materials: [], stepsAcked: [] });

beforeAll(async () => {
  a = await signupWorkspace('gmp-a');
  emails.push(a.email);
  const role = await ok(await a.client.post('/iam/roles', { name: 'QA officer', permissions: ['gmp.lineclearance.sign', 'gmp.batchrecords.review', 'quality.inspections.read', 'gmp.environment.manage'] }), 201);
  qa = await addMember(a.client, 'gmp-qa', [role.id]);
  emails.push(qa.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  const tab = await ok(await a.client.post('/masters/items', { name: 'Paracetamol 500 mg tablets', type: 'finished_good', baseUomId: uom.NOS, gstRate: 12, hsnCode: '30049099' }), 201);
  const api = await ok(await a.client.post('/masters/items', { name: 'Paracetamol IP', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '29242930' }), 201);
  const wc = await ok(await a.client.post('/manufacturing/work-centers', { code: 'COMP', name: 'Compression' }), 201);
  ctx.machine = await ok(await a.client.post('/manufacturing/machines', { code: 'TP-01', name: '27-station press', workCenterId: wc.id }), 201);
  const bom = await ok(await a.client.post('/manufacturing/boms', { itemId: tab.id, quantity: '1000', lines: [{ itemId: api.id, qty: '0.55' }], operations: [{ seq: 10, name: 'Compression', workCenterId: wc.id, runMinutes: '0.01' }] }), 201);
  await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: bom.version }));
  const wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'MAIN').id;
  const wo = await ok(await a.client.post('/manufacturing/work-orders', { itemId: tab.id, qty: '100000', sourceWarehouseId: wh, targetWarehouseId: wh }), 201);
  ctx.wo = await ok(await a.client.post(`/manufacturing/work-orders/${wo.id}/submit`, { version: wo.version, force: true }));
  ctx.op = ctx.wo.operations[0];
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('line clearance', () => {
  it('blocks the start until production has cleared the line and QA has verified it', async () => {
    const s = await ok(await a.client.request('PUT', '/gmp/settings', { requireLineClearance: true, lineClearanceHours: 12 }));
    expect(s.lineClearanceChecklist).toHaveLength(5);
    const c = await ok(await a.client.post('/mes/jobs/check', job()));
    expect(c.checks.find((x: any) => x.code === 'line_clearance')).toMatchObject({ ok: false, blocking: true, detail: 'No line clearance verified by QA in the last 12 h' });

    const checklist = s.lineClearanceChecklist.map((item: string) => ({ item, ok: true }));
    expect((await a.client.post('/gmp/line-clearances', { workOrderId: ctx.wo.id, machineId: ctx.machine.id, checklist: [{ ...checklist[0], ok: false }, ...checklist.slice(1)], password: a.password })).status).toBe(400);
    expect((await a.client.post('/gmp/line-clearances', { workOrderId: ctx.wo.id, machineId: ctx.machine.id, checklist, password: 'not-my-password' })).status).toBe(403);
    const lc = await ok(await a.client.post('/gmp/line-clearances', { workOrderId: ctx.wo.id, machineId: ctx.machine.id, area: 'Compression room 2', previousBatch: 'PCM-0925', checklist, password: a.password }), 201);
    expect(lc).toMatchObject({ status: 'pending', productionSignature: { meaning: 'Line clearance done', signedBy: 'Owner gmp-a' } });
    expect((await a.client.post(`/gmp/line-clearances/${lc.id}/verify`, { approved: true, password: a.password })).status).toBe(409);
    const v = await ok(await qa.client.post(`/gmp/line-clearances/${lc.id}/verify`, { approved: true, password: qa.password }));
    expect(v).toMatchObject({ status: 'cleared', qaSignature: { meaning: 'Line clearance verified (QA)' } });
    const [row] = await ok(await a.client.get(`/gmp/line-clearances?workOrderId=${ctx.wo.id}`));
    expect(row).toMatchObject({ status: 'cleared', productionBy: 'Owner gmp-a', qaBy: 'User gmp-qa', machineCode: 'TP-01' });

    expect((await ok(await a.client.post('/mes/jobs/check', job()))).canStart).toBe(true);
    ctx.exec = await ok(await a.client.post('/mes/jobs/start', job()), 201);
    await ok(await a.client.post(`/manufacturing/job-cards/${ctx.exec.jobCard.id}/stop`, { goodQty: '95000', rejectQty: '5000', rejectReason: 'Capping' }));
  });
});

describe('batch record review by exception', () => {
  it('lists the exceptions, needs each assessed, and ends in a signed QA decision', async () => {
    const r = await ok(await qa.client.post('/gmp/batch-reviews', { workOrderId: ctx.wo.id }));
    expect(r.status).toBe('open');
    expect(r.exceptions.map((e: any) => [e.kind, e.text])).toEqual([
      ['checks', 'Compression: start check "Work instructions" warned (No released instructions for this operation)'],
      ['rejects', 'Compression: 5000 rejected (Capping)'],
    ]);
    const decide = { approved: true, reason: 'Rejects within the validated range; instructions to be issued', password: qa.password };
    const early = await qa.client.post(`/gmp/batch-reviews/${r.id}/decide`, decide);
    expect(early.status).toBe(409);
    expect(early.body.detail).toMatch(/2 without a comment/);
    expect((await qa.client.post(`/gmp/batch-reviews/${r.id}/comments`, { key: 'nope', text: 'Hmm' })).status).toBe(400);
    for (const e of r.exceptions) await ok(await qa.client.post(`/gmp/batch-reviews/${r.id}/comments`, { key: e.key, text: e.kind === 'rejects' ? '5 % capping, within the 6 % limit of the process validation' : 'Paper SOP COMP-07 followed' }));
    const done = await ok(await qa.client.post(`/gmp/batch-reviews/${r.id}/decide`, decide));
    expect(done).toMatchObject({ status: 'approved', pendingComments: 0, signatures: [expect.objectContaining({ meaning: 'Batch record reviewed: approved for release', signedBy: 'User gmp-qa', reason: decide.reason })] });
    expect((await qa.client.post(`/gmp/batch-reviews/${r.id}/decide`, decide)).status).toBe(409);
    expect((await ok(await qa.client.get('/gmp/batch-reviews?status=approved')))[0]).toMatchObject({ workOrderNumber: ctx.wo.number, exceptions: 2, commented: 2, decidedBy: 'User gmp-qa' });
  });
});

describe('environmental monitoring', () => {
  it('judges results against Annex 1 or own limits and raises a deviation at the action limit', async () => {
    const loc = await ok(
      await qa.client.post('/gmp/em/locations', {
        code: 'CR-02',
        name: 'Compression room 2',
        grade: 'C',
        parameters: [
          { param: 'viable_settle', alertLimit: 25 },
          { param: 'particles_0_5' },
          { param: 'diff_pressure', direction: 'below', alertLimit: 12, actionLimit: 10 },
        ],
      }),
      201,
    );
    expect(loc.parameters[0]).toMatchObject({ unit: 'cfu/4 h', direction: 'above' });
    expect((await ok(await qa.client.post('/gmp/em/samples', { locationId: loc.id, param: 'viable_settle', value: 30 }), 201)).status).toBe('alert');
    const action = await ok(await qa.client.post('/gmp/em/samples', { locationId: loc.id, param: 'viable_settle', value: 62, workOrderId: ctx.wo.id }), 201);
    expect(action).toMatchObject({ status: 'action', deviationId: expect.any(String) });
    const dev = await ok(await a.client.get(`/qms/deviations/${action.deviationId}`));
    expect(dev).toMatchObject({ kind: 'unplanned', category: 'environment' });
    expect(dev.description).toMatch(/^Environmental monitoring action limit exceeded at CR-02 Compression room 2 \(grade C\): viable settle 62 cfu\/4 h\./);
    expect((await ok(await qa.client.post('/gmp/em/samples', { locationId: loc.id, param: 'particles_0_5', value: 400_000, condition: 'at_rest' }), 201)).status).toBe('action');
    expect((await ok(await qa.client.post('/gmp/em/samples', { locationId: loc.id, param: 'particles_0_5', value: 400_000 }), 201)).status).toBe('ok');
    expect((await ok(await qa.client.post('/gmp/em/samples', { locationId: loc.id, param: 'diff_pressure', value: 11 }), 201)).status).toBe('alert');
    expect((await qa.client.post('/gmp/em/samples', { locationId: loc.id, param: 'humidity', value: 40 })).status).toBe(400);
    const [l] = await ok(await qa.client.get('/gmp/em/locations'));
    expect(l.excursions).toBe(4);
    expect(l.latest.find((x: any) => x.param === 'viable_settle')).toMatchObject({ value: 62, status: 'action' });
    const t = await ok(await qa.client.get(`/gmp/em/trend?locationId=${loc.id}&param=viable_settle`));
    expect(t).toMatchObject({ n: 2, alerts: 1, actions: 1, max: 62 });
    const batchReview = await ok(await qa.client.post('/gmp/batch-reviews', { workOrderId: ctx.wo.id }));
    expect(batchReview.status).toBe('approved');
  });
});

describe('signature chain', () => {
  it('stays intact, and shows a record changed behind the application’s back', async () => {
    const v = await ok(await a.client.get('/gmp/signatures/verify'));
    expect(v).toMatchObject({ intact: true, broken: [] });
    expect(v.checked).toBe(3);
    const [sig] = await owner(`select id from e_signatures where tenant_id = $1 and meaning = 'Line clearance done'`, [a.tenantId]);
    await owner(`update e_signatures set payload = payload || '{"area": "Somewhere else"}' where id = $1`, [sig.id]);
    const after = await ok(await a.client.get('/gmp/signatures/verify'));
    expect(after.intact).toBe(false);
    expect(after.broken).toEqual([{ id: sig.id, problem: 'The signed content was changed' }]);
  });
});
