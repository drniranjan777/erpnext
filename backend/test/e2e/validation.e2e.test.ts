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
const sign = (document: string, role = 'approver') => a.client.post(`/validation/projects/${ctx.p.id}/sign`, { document, role, password: a.password });

beforeAll(async () => {
  a = await signupWorkspace('val-a');
  emails.push(a.email);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('validation package', () => {
  it('scopes requirements, assesses risk and generates the protocols', async () => {
    const cat = await ok(await a.client.get('/validation/catalogue'));
    expect(Object.keys(cat.modules)).toContain('gmp');
    ctx.p = await ok(await a.client.post('/validation/projects', { name: 'NextGen ERP for tablets plant', modules: ['platform', 'gmp'], intendedUse: 'Batch release and GMP records' }), 201);
    const v = await ok(await a.client.get(`/validation/projects/${ctx.p.id}`));
    expect(v.requirements.map((r: any) => r.id)).toEqual(['URS-PLT-01', 'URS-PLT-02', 'URS-PLT-03', 'URS-PLT-04', 'URS-PLT-05', 'URS-PLT-06', 'URS-GMP-01', 'URS-GMP-02', 'URS-GMP-03']);
    expect(v.requirements.find((r: any) => r.id === 'URS-GMP-01')).toMatchObject({ priority: 'high', risk: { severity: 3, probability: 2, detectability: 1 } });
    expect(v.tests.filter((t: any) => t.protocol === 'IQ')).toHaveLength(9);
    expect(v.tests.filter((t: any) => t.protocol === 'OQ')).toHaveLength(9);
    expect(v.tests.find((t: any) => t.ref === 'OQ-GMP-01')).toMatchObject({ result: 'pending', evidence: 'Also covered by the automated test test/e2e/gmp.e2e.test.ts' });
    expect(v.summary.fitForUse).toBe(false);
    const r = await ok(await a.client.post(`/validation/projects/${ctx.p.id}/risks`, { requirementId: 'URS-PLT-06', severity: 1, probability: 1, detectability: 3, note: 'Printouts are checked by QA' }));
    expect(r.requirements.find((x: any) => x.id === 'URS-PLT-06')).toMatchObject({ priority: 'low', testing: 'Vendor testing leveraged; IQ only' });
    expect((await a.client.post(`/validation/projects/${ctx.p.id}/risks`, { requirementId: 'URS-PH-01', severity: 1, probability: 1, detectability: 1 })).status).toBe(400);
  });

  it('runs the installation checks after the IQ protocol is approved', async () => {
    expect((await a.client.post(`/validation/projects/${ctx.p.id}/iq/run`)).status).toBe(409);
    expect((await a.client.post(`/validation/projects/${ctx.p.id}/sign`, { document: 'IQ', role: 'approver', password: 'nope' })).status).toBe(403);
    await ok(await sign('IQ'));
    expect((await sign('IQ')).status).toBe(409);
    const v = await ok(await a.client.post(`/validation/projects/${ctx.p.id}/iq/run`));
    const iq = Object.fromEntries(v.tests.filter((t: any) => t.protocol === 'IQ').map((t: any) => [t.ref, t.result]));
    expect(iq).toMatchObject({ 'IQ-01': 'pass', 'IQ-02': 'pass', 'IQ-03': 'pass', 'IQ-04': 'pass', 'IQ-05': 'pass', 'IQ-06': 'pass', 'IQ-07': 'pass', 'IQ-09': 'pending' });
    expect(v.tests.find((t: any) => t.ref === 'IQ-05').actual).toBe('Update denied, delete denied');
    expect(v.status).toBe('executing');
  });

  it('executes OQ and PQ with evidence and approves the summary only when every requirement passes', async () => {
    let v = await ok(await a.client.get(`/validation/projects/${ctx.p.id}`));
    const oq = v.tests.filter((t: any) => t.protocol === 'OQ');
    expect((await a.client.post(`/validation/projects/${ctx.p.id}/tests/${oq[0].id}/execute`, { result: 'pass', actual: 'As expected' })).status).toBe(409);
    await ok(await sign('OQ'));
    expect((await a.client.post(`/validation/projects/${ctx.p.id}/tests/${oq[0].id}/execute`, { result: 'fail', actual: 'Error shown' })).status).toBe(400);
    for (const t of oq) await ok(await a.client.post(`/validation/projects/${ctx.p.id}/tests/${t.id}/execute`, { result: 'pass', actual: 'As expected', evidence: 'Screenshots in the test binder' }));
    const pq = await ok(await a.client.post(`/validation/projects/${ctx.p.id}/tests`, { protocol: 'PQ', title: 'Three consecutive batches released through the system', requirementIds: ['URS-GMP-01', 'URS-GMP-02'], steps: ['Make three batches', 'Clear the line, review and release each'], expected: 'All three released with complete records' }), 201);
    expect(pq.ref).toBe('PQ-S01');
    expect((await sign('VSR')).status).toBe(409);
    await ok(await sign('PQ'));
    v = await ok(await a.client.post(`/validation/projects/${ctx.p.id}/tests/${pq.id}/execute`, { result: 'pass', actual: 'Batches B1–B3 released', evidence: 'Batch records B1–B3' }));
    expect(v.trace.every((r: any) => r.status === 'covered')).toBe(true);
    // The production-mode check fails on this test server, and the backup check is still to be done.
    expect(v.summary).toMatchObject({ fitForUse: false, IQ: { fail: 1, pending: 1 } });
    const iq8 = v.tests.find((t: any) => t.ref === 'IQ-08');
    const iq9 = v.tests.find((t: any) => t.ref === 'IQ-09');
    await ok(await a.client.post(`/validation/projects/${ctx.p.id}/tests/${iq8.id}/execute`, { result: 'na', actual: 'Run on the test server; the production server is qualified separately' }));
    v = await ok(await a.client.post(`/validation/projects/${ctx.p.id}/tests/${iq9.id}/execute`, { result: 'pass', actual: 'Nightly backups present; restore of 7 Oct tested', evidence: 'Restore log RL-0710' }));
    expect(v.summary).toMatchObject({ fitForUse: true, OQ: { total: 9, pass: 9 }, PQ: { total: 1, pass: 1 } });
    const done = await ok(await sign('VSR'));
    expect(done.status).toBe('approved');
    expect(done.approvals.map((x: any) => x.meaning)).toEqual(['Installation qualification: approver', 'Operational qualification: approver', 'Performance qualification: approver', 'Validation summary report: approver']);
    expect((await a.client.post(`/validation/projects/${ctx.p.id}/tests/${pq.id}/execute`, { result: 'pass', actual: 'Again' })).status).toBe(409);
    const [row] = await ok(await a.client.get('/validation/projects'));
    expect(row).toMatchObject({ status: 'approved', failed: 0 });
  });
});
