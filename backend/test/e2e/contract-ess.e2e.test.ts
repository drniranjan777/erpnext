import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;
type Member = Awaited<ReturnType<typeof addMember>>;

let a: Workspace;
let worker: Member;
let boss: Member;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const H = '/hr';

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// Last month, fully past.
const M = (() => {
  const d = new Date(`${today().slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
})();

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const ask = async (client: Workspace['client'], content: string) => ok(await client.post('/copilot/chat', { messages: [{ role: 'user', content }], language: 'auto' }));

beforeAll(async () => {
  a = await signupWorkspace('ess-a');
  emails.push(a.email);
  const role = await ok(await a.client.post('/iam/roles', { name: 'Self service', permissions: ['hr.self.use'] }), 201);
  worker = await addMember(a.client, 'ess-wkr', [role.id]);
  boss = await addMember(a.client, 'ess-boss', [role.id]);
  emails.push(worker.email, boss.email);
  ctx.ts = await ok(await a.client.post(`${H}/org/locations`, { code: 'HYD', name: 'Hyderabad', stateCode: '36' }), 201);
  const doj = addDays(today(), -400);
  ctx.boss = await ok(await a.client.post(`${H}/employees`, { firstName: 'Meena', gender: 'female', dateOfJoining: doj, userId: boss.userId, locationId: ctx.ts.id }), 201);
  ctx.emp = await ok(await a.client.post(`${H}/employees`, { firstName: 'Ravi', fatherOrSpouseName: 'Ramesh', gender: 'male', dateOfJoining: doj, reportsToId: ctx.boss.id, userId: worker.userId, locationId: ctx.ts.id }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('contract labour', () => {
  it('keeps contractors within their licence', async () => {
    ctx.con = await ok(await a.client.post(`${H}/contractors`, { code: 'shakti', name: 'Shakti Manpower', licenceNo: 'CLRA/TS/2026/114', licenceValidUntil: addDays(today(), 20), maxWorkers: 2, work: 'Loading and housekeeping', locationId: ctx.ts.id }), 201);
    const w = (code: string, name: string, extra: Record<string, unknown> = {}) => a.client.post(`${H}/contract-workers`, { contractorId: ctx.con.id, code, name, dailyWage: 600, joinedOn: `${M}-01`, ...extra });
    ctx.w1 = await ok(await w('CW001', 'Raju', { uan: '100200300401', skill: 'unskilled', fatherName: 'Somaiah', gender: 'male', dateOfBirth: '1995-04-01' }), 201);
    ctx.w2 = await ok(await w('CW002', 'Lakshmi', { dailyWage: 500, skill: 'semi_skilled' }), 201);
    expect((await w('CW003', 'Third')).status).toBe(400);
    expect((await w('cw001', 'Copy')).status).toBe(409);
    await ok(await a.client.post(`${H}/minimum-wages`, { stateCode: '36', skill: 'semi_skilled', dailyRate: 560, effectiveFrom: '2026-04-01' }), 201);
  });

  it('marks gate attendance and checks the wages paid against it', async () => {
    const days = Array.from({ length: 10 }, (_, i) => `${M}-${String(i + 1).padStart(2, '0')}`);
    for (const date of days) await ok(await a.client.post(`${H}/contract-attendance`, { date, entries: [{ workerId: ctx.w1.id, status: 'P' }, { workerId: ctx.w2.id, status: date === days[9] ? 'HD' : 'P', otHours: date === days[0] ? 4 : 0 }] }));
    expect((await a.client.post(`${H}/contract-attendance`, { date: addDays(today(), 1), entries: [{ workerId: ctx.w1.id, status: 'P' }] })).status).toBe(400);
    const muster = await ok(await a.client.get(`${H}/contract-attendance?month=${M}`));
    expect(muster.rows.find((r: any) => r.id === ctx.w2.id)).toMatchObject({ present: 9.5, otHours: 4 });
    // Raju is paid correctly; Lakshmi at her agreed ₹500, below the ₹560 minimum, with no ESI.
    await ok(await a.client.post(`${H}/contract-wages`, { month: M, entries: [{ workerId: ctx.w1.id, daysPaid: 10, grossPaid: 6000, pfDeducted: 720, esiDeducted: 45 }, { workerId: ctx.w2.id, daysPaid: 9.5, grossPaid: 4750, pfDeducted: 570, esiDeducted: 0 }] }));
    const c = await ok(await a.client.get(`${H}/contract-compliance?month=${M}`));
    const raju = c.workers.find((w: any) => w.workerId === ctx.w1.id);
    const lak = c.workers.find((w: any) => w.workerId === ctx.w2.id);
    expect(raju).toMatchObject({ dueGross: 6000, shortfall: 0, issues: [] });
    // 9.5 × 560 + 4 h × 2 × 70 = 5,320 + 560
    expect(lak.dueGross).toBe(5880);
    expect(lak.shortfall).toBe(1130);
    expect(lak.issues).toEqual(expect.arrayContaining(['Agreed rate ₹500 is below the minimum wage ₹560', 'ESI ₹0 deducted; ₹36 due']));
    expect(c.contractors[0]).toMatchObject({ workers: 2, withIssues: 1, shortfall: 1130 });
    expect(c.contractors[0].alerts[0]).toContain('Licence expires on');
  });
});

describe('expense claims and self-service', () => {
  it('lets the manager approve a claim into the payroll month', async () => {
    const claim = await ok(await worker.client.post(`${H}/claims`, { kind: 'travel', spentOn: addDays(today(), -3), amount: 1850, description: 'Bus fare to the Pune depot' }), 201);
    expect((await worker.client.post(`${H}/claims/${claim.id}/decide`, { approve: true })).status).toBe(403);
    expect((await worker.client.post(`${H}/claims`, { kind: 'food', spentOn: addDays(today(), 3), amount: 10, description: 'Future' })).status).toBe(400);
    const team = await ok(await boss.client.get(`${H}/claims?status=pending`));
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ isManager: true, isOwn: false });
    expect((await boss.client.post(`${H}/claims/${claim.id}/decide`, { approve: true, approvedAmount: 2000 })).status).toBe(400);
    const r = await ok(await boss.client.post(`${H}/claims/${claim.id}/decide`, { approve: true, approvedAmount: 1500, note: 'Return fare only' }));
    expect(r).toMatchObject({ status: 'approved', payMonth: today().slice(0, 7), approvedAmount: '1500.00' });
    const inputs = await ok(await a.client.get(`/payroll/inputs?month=${today().slice(0, 7)}`));
    expect(inputs.find((i: any) => i.employeeId === ctx.emp.id)).toMatchObject({ code: 'REIMB', amount: '1500.00' });
  });

  it('shows the employee their day and the manager their queue', async () => {
    const lt = await ok(await a.client.post(`${H}/leave/types`, { code: 'CL', name: 'Casual leave', accrual: 'none', allowNegative: true }), 201);
    await ok(await worker.client.post(`${H}/leave/applications`, { leaveTypeId: lt.id, fromDate: addDays(today(), 10), toDate: addDays(today(), 10), reason: 'Family function' }), 201);
    await ok(await worker.client.post(`${H}/claims`, { kind: 'phone', spentOn: today(), amount: 300, description: 'Mobile bill' }), 201);
    const mine = await ok(await worker.client.get(`${H}/home`));
    expect(mine.employee.id).toBe(ctx.emp.id);
    expect(mine.mine).toEqual({ leave: 1, claims: 1, regularisations: 0 });
    expect(mine.leave.find((l: any) => l.code === 'CL')).toMatchObject({ balance: 0 });
    const hers = await ok(await boss.client.get(`${H}/home`));
    expect(hers.team).toMatchObject({ members: 1, leave: 1, claims: 1 });
    expect((await a.client.get(`${H}/home`)).body).toEqual({ employee: null });
  });
});

describe('statutory registers', () => {
  it('lists the registers and builds them', async () => {
    const list = await ok(await a.client.get(`${H}/registers`));
    expect(list.map((r: any) => r.key)).toEqual(['adult-workers', 'muster-roll', 'leave-register', 'wages', 'clra-workmen', 'clra-muster', 'clra-wages']);
    const adults = await ok(await a.client.get(`${H}/registers/adult-workers`));
    expect(adults.rows.find((r: any) => r.code === ctx.emp.code)).toMatchObject({ name: 'Ravi', fatherOrSpouse: 'Ramesh', gender: 'male' });
    expect((await a.client.get(`${H}/registers/muster-roll`)).status).toBe(400);
    const muster = await ok(await a.client.get(`${H}/registers/muster-roll?month=${M}`));
    expect(muster.columns.length).toBeGreaterThan(30);
    const workmen = await ok(await a.client.get(`${H}/registers/clra-workmen`));
    expect(workmen.rows[0]).toMatchObject({ code: 'CW001', name: 'Raju', fatherName: 'Somaiah', contractor: 'Shakti Manpower' });
    const wages = await ok(await a.client.get(`${H}/registers/clra-wages?month=${M}`));
    expect(wages.rows.find((r: any) => r.code === 'CW001')).toMatchObject({ grossPaid: 6000, net: 6000 - 720 - 45 });
    expect((await a.client.get(`${H}/registers/nonsense`)).status).toBe(400);
    expect((await worker.client.get(`${H}/registers/adult-workers`)).status).toBe(403);
  });
});

describe('HR answers in the copilot', () => {
  it('answers leave, approvals and headcount questions within each user’s access', async () => {
    const leave = await ask(worker.client, 'what is my leave balance?');
    expect(leave.reply).toContain('Your leave balance: Casual leave');
    const hindi = await ask(worker.client, 'मेरी छुट्टी कितनी बची है?');
    expect(hindi.reply).toContain('आपकी छुट्टियाँ');
    const queue = await ask(boss.client, 'any pending approvals for me?');
    expect(queue.reply).toContain('2 requests from your team are waiting');
    const hc = await ask(a.client, 'headcount');
    expect(hc.reply).toBe('2 people on the rolls.');
    expect((await ask(worker.client, 'headcount')).reply).toContain('do not have access');
    const absent = await ask(a.client, 'who is absent today?');
    expect(absent.reply).toContain('2 people have not punched in today');
  });
});
