import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;
type Member = Awaited<ReturnType<typeof addMember>>;

let a: Workspace;
let worker: Member;
let boss: Member;
let approver: Member;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const H = '/hr';

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const nextMonth = () => {
  const d = new Date(`${today().slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

beforeAll(async () => {
  a = await signupWorkspace('tal-a');
  emails.push(a.email);
  const selfRole = await ok(await a.client.post('/iam/roles', { name: 'Self service', permissions: ['hr.self.use'] }), 201);
  const apprRole = await ok(await a.client.post('/iam/roles', { name: 'Hiring approver', permissions: ['hr.recruitment.read', 'hr.recruitment.approve'] }), 201);
  worker = await addMember(a.client, 'tal-wkr', [selfRole.id]);
  boss = await addMember(a.client, 'tal-boss', [selfRole.id]);
  approver = await addMember(a.client, 'tal-appr', [apprRole.id]);
  emails.push(worker.email, boss.email, approver.email);
  const doj = addDays(today(), -400);
  ctx.boss = await ok(await a.client.post(`${H}/employees`, { firstName: 'Meena', gender: 'female', dateOfJoining: doj, userId: boss.userId }), 201);
  ctx.emp = await ok(await a.client.post(`${H}/employees`, { firstName: 'Ravi', gender: 'male', dateOfJoining: doj, reportsToId: ctx.boss.id, userId: worker.userId }), 201);
  ctx.tpl = await ok(await a.client.post('/payroll/templates', { code: 'STAFF', name: 'Staff', lines: [{ code: 'BASIC', calc: 'percent_ctc', value: 40 }, { code: 'HRA', calc: 'percent_basic', value: 50 }, { code: 'SPL', calc: 'balance', value: 0 }] }), 201);
  await ok(await a.client.post('/payroll/salaries', { employeeId: ctx.emp.id, effectiveFrom: doj, templateId: ctx.tpl.id, ctcAnnual: 360000 }), 201);
  await ok(await a.client.post(`${H}/checklists`, { kind: 'onboarding', name: 'Joining', items: [{ title: 'Issue ID card', owner: 'Admin', days: 0 }, { title: 'Safety induction', owner: 'HSE', days: 2 }] }), 201);
  await ok(await a.client.post(`${H}/checklists`, { kind: 'exit', name: 'Clearance', items: [{ title: 'Return laptop', owner: 'IT', days: 0 }, { title: 'Hand over work', owner: 'Manager', days: 3 }] }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('recruitment', () => {
  it('needs an approved requisition before candidates', async () => {
    ctx.req = await ok(await a.client.post(`${H}/recruitment/requisitions`, { title: 'CNC operator', openings: 1, maxCtc: 600000 }), 201);
    expect(ctx.req.number).toBe('MRF-0001');
    expect((await a.client.post(`${H}/recruitment/candidates`, { requisitionId: ctx.req.id, name: 'Kiran Rao' })).status).toBe(400);
    expect((await a.client.post(`${H}/recruitment/requisitions/${ctx.req.id}/decide`, { approve: true })).status).toBe(403);
    await ok(await approver.client.post(`${H}/recruitment/requisitions/${ctx.req.id}/decide`, { approve: true }));
    ctx.kiran = await ok(await a.client.post(`${H}/recruitment/candidates`, { requisitionId: ctx.req.id, name: 'Kiran Rao', email: 'kiran@example.com', mobile: '9876500001', expectedCtc: 480000 }), 201);
    ctx.sunil = await ok(await a.client.post(`${H}/recruitment/candidates`, { requisitionId: ctx.req.id, name: 'Sunil Das', email: 'sunil@example.com' }), 201);
    expect((await a.client.post(`${H}/recruitment/candidates`, { requisitionId: ctx.req.id, name: 'Kiran again', email: 'KIRAN@example.com' })).status).toBe(409);
  });

  it('takes interview feedback from the interviewer only', async () => {
    const iv = await ok(await a.client.post(`${H}/recruitment/candidates/${ctx.kiran.id}/interviews`, { round: 1, scheduledAt: new Date().toISOString(), interviewerId: ctx.boss.id }), 201);
    expect((await worker.client.post(`${H}/recruitment/interviews/${iv.id}/feedback`, { result: 'selected', feedback: 'Not mine' })).status).toBe(403);
    await ok(await boss.client.post(`${H}/recruitment/interviews/${iv.id}/feedback`, { result: 'selected', score: 4, feedback: 'Good on fanuc controls' }));
    expect(await ok(await boss.client.get(`${H}/recruitment/my-interviews`))).toHaveLength(1);
  });

  it('approves offers within budget at once and sends others for approval', async () => {
    const lt = await ok(await a.client.post(`${H}/letter-templates`, { code: 'OFFER', name: 'Offer', kind: 'offer', body: 'Dear {{candidate.name}}, we offer you {{ctc}} a year from {{doj}}.' }), 201);
    const o1 = await ok(await a.client.post(`${H}/recruitment/offers`, { candidateId: ctx.kiran.id, ctcAnnual: 480000, salaryTemplateId: ctx.tpl.id, joiningDate: addDays(today(), 5), letterTemplateId: lt.id }), 201);
    expect(o1.status).toBe('approved');
    expect(o1.letterBody).toContain('Dear Kiran Rao, we offer you ₹4,80,000 a year');
    expect((await a.client.post(`${H}/recruitment/offers`, { candidateId: ctx.kiran.id, ctcAnnual: 1, joiningDate: today() })).status).toBe(409);
    const o2 = await ok(await a.client.post(`${H}/recruitment/offers`, { candidateId: ctx.sunil.id, ctcAnnual: 700000, joiningDate: addDays(today(), 10) }), 201);
    expect(o2.status).toBe('pending');
    expect((await a.client.post(`${H}/recruitment/offers/${o2.id}/accept`, {})).status).toBe(409);
    await ok(await approver.client.post(`${H}/recruitment/offers/${o2.id}/decide`, { approve: true }));
    await ok(await a.client.post(`${H}/recruitment/offers/${o2.id}/respond`, { answer: 'declined' }));
    ctx.o1 = o1;
  });

  it('hires an accepted offer with salary and onboarding tasks, and closes the requisition', async () => {
    const r = await ok(await a.client.post(`${H}/recruitment/offers/${ctx.o1.id}/accept`, { employmentType: 'probation', category: 'worker', reportsToId: ctx.boss.id }));
    expect(r.onboardingTasks).toBe(2);
    const emp = await ok(await a.client.get(`${H}/employees/${r.employeeId}`));
    expect(emp).toMatchObject({ fullName: 'Kiran Rao', employmentType: 'probation', category: 'worker', mobile: '9876500001', reportsToId: ctx.boss.id });
    expect(emp.probationEnd).toBeTruthy();
    const hist = await ok(await a.client.get(`/payroll/salaries/${r.employeeId}/history`));
    expect(Number(hist[0].ctcAnnual)).toBe(480000);
    expect(hist[0].lines.find((l: any) => l.code === 'BASIC').monthly).toBe('16000.00');
    const tasks = await ok(await a.client.get(`${H}/tasks?kind=onboarding&employeeId=${r.employeeId}`));
    expect(tasks.map((t: any) => t.title).sort()).toEqual(['Issue ID card', 'Safety induction']);
    const req = await ok(await a.client.get(`${H}/recruitment/requisitions/${ctx.req.id}`));
    expect(req.status).toBe('closed');
    expect(req.candidates.find((c: any) => c.id === ctx.kiran.id)).toMatchObject({ stage: 'hired', employeeId: r.employeeId });
  });
});

describe('performance', () => {
  it('lets the employee set goals up to 100 % and opens the review only then', async () => {
    ctx.cycle = await ok(await a.client.post(`${H}/performance/cycles`, { name: 'FY 2026-27', fromDate: '2026-04-01', toDate: '2027-03-31', incrementGuide: { '4': 10, '5': 15 } }), 201);
    const c = ctx.cycle.id;
    const g1 = await ok(await worker.client.post(`${H}/performance/cycles/${c}/goals`, { kra: 'Output', title: 'OEE of cell 3 above 80 %', weight: 60 }), 201);
    await ok(await worker.client.post(`${H}/performance/cycles/${c}/goals`, { kra: 'Quality', title: 'Scrap below 1 %', weight: 30 }), 201);
    expect((await worker.client.post(`${H}/performance/cycles/${c}/goals`, { title: 'Too much', weight: 20 })).status).toBe(400);
    expect((await a.client.post(`${H}/performance/cycles/${c}/status`, { status: 'review' })).status).toBe(400);
    // The manager adds the last 10 % for the team member.
    await ok(await boss.client.post(`${H}/performance/cycles/${c}/goals`, { employeeId: ctx.emp.id, title: 'Train two new operators', weight: 10 }), 201);
    expect((await worker.client.post(`${H}/performance/cycles/${c}/goals`, { employeeId: ctx.boss.id, title: 'Not my goal', weight: 5 })).status).toBe(403);
    await ok(await a.client.post(`${H}/performance/cycles/${c}/status`, { status: 'review' }));
    expect((await worker.client.delete(`/hr/performance/goals/${g1.id}`)).status).toBe(409);
  });

  it('takes self and manager ratings, weights them and calibrates the increment', async () => {
    const c = ctx.cycle.id;
    const mine = await ok(await worker.client.get(`${H}/performance/cycles/${c}/goals`));
    for (const g of mine.goals) await ok(await worker.client.post(`${H}/performance/goals/${g.id}/rate`, { rating: 5 }));
    const team = await ok(await boss.client.get(`${H}/performance/cycles/${c}/goals?employeeId=${ctx.emp.id}`));
    const rating: Record<number, number> = { 60: 4, 30: 3, 10: 5 };
    for (const g of team.goals) await ok(await boss.client.post(`${H}/performance/goals/${g.id}/rate`, { rating: rating[Number(g.weight)] }));
    const list = await ok(await a.client.get(`${H}/performance/cycles/${c}/appraisals`));
    // 0.6 × 4 + 0.3 × 3 + 0.1 × 5 = 3.8
    expect(list[0]).toMatchObject({ selfScore: 5, managerScore: 3.8, goals: 3, rated: 3 });
    const cal = await ok(await a.client.post(`${H}/performance/cycles/${c}/calibrate`, { employeeId: ctx.emp.id, finalRating: 4, effectiveFrom: nextMonth() }));
    expect(Number(cal.incrementPct)).toBe(10);
    expect(Number(cal.newCtc)).toBe(396000);
  });

  it('applies the increment as a salary revision', async () => {
    const r = await ok(await a.client.post(`${H}/performance/cycles/${ctx.cycle.id}/apply`));
    expect(r).toMatchObject({ increments: 1, promotions: 0, skipped: [] });
    const hist = await ok(await a.client.get(`/payroll/salaries/${ctx.emp.id}/history`));
    expect(hist[0]).toMatchObject({ effectiveFrom: nextMonth(), ctcAnnual: '396000.00' });
    expect(hist[0].lines.find((l: any) => l.code === 'BASIC').monthly).toBe('13200.00');
    expect((await ok(await a.client.post(`${H}/performance/cycles/${ctx.cycle.id}/apply`))).increments).toBe(0);
  });
});

describe('training and skills', () => {
  it('raises skill levels on a training pass and keeps the matrix', async () => {
    const skill = await ok(await a.client.post(`${H}/skills`, { code: 'cnc', name: 'CNC turning', category: 'Machining', validityMonths: 12 }), 201);
    const t = await ok(await a.client.post(`${H}/trainings`, { title: 'CNC basics', skillId: skill.id, skillLevel: 3, startsAt: new Date().toISOString(), hours: 8, capacity: 1 }), 201);
    expect((await a.client.post(`${H}/trainings/${t.id}/nominate`, { employeeIds: [ctx.emp.id, ctx.boss.id] })).status).toBe(400);
    await ok(await a.client.post(`${H}/trainings/${t.id}/nominate`, { employeeIds: [ctx.emp.id] }));
    expect((await a.client.post(`${H}/trainings/${t.id}/results`, { results: [{ employeeId: ctx.boss.id, attended: true, passed: true }] })).status).toBe(400);
    expect(await ok(await a.client.post(`${H}/trainings/${t.id}/results`, { results: [{ employeeId: ctx.emp.id, attended: true, passed: true, score: 82 }] }))).toMatchObject({ skillsRaised: 1 });
    let m = await ok(await a.client.get(`${H}/skills/matrix`));
    expect(m.rows.find((r: any) => r.id === ctx.emp.id).levels[skill.id]).toMatchObject({ level: 3, expired: false });
    expect(m.cover[skill.id]).toBe(1);
    await ok(await a.client.post(`${H}/skills/assess`, { employeeId: ctx.emp.id, skillId: skill.id, level: 2, assessedOn: addDays(today(), -400) }));
    m = await ok(await a.client.get(`${H}/skills/matrix`));
    expect(m.rows.find((r: any) => r.id === ctx.emp.id).levels[skill.id]).toMatchObject({ level: 2, expired: true });
    expect(m.cover[skill.id]).toBe(0);
    const mine = await ok(await worker.client.get(`${H}/trainings/mine`));
    expect(mine.trainings[0]).toMatchObject({ title: 'CNC basics', passed: true });
  });
});

describe('separation and full and final', () => {
  it('lets the employee resign and withdraw, and HR record a separation', async () => {
    const own = await ok(await worker.client.post(`${H}/separations`, { lastWorkingDay: addDays(today(), 30), reason: 'Moving to Pune' }), 201);
    expect(own.noticeShortfallDays).toBe(0);
    expect((await worker.client.post(`${H}/separations`, { kind: 'termination', lastWorkingDay: addDays(today(), 30), reason: 'Not allowed' })).status).toBe(403);
    expect((await worker.client.post(`${H}/separations`, { lastWorkingDay: addDays(today(), 30), reason: 'Again' })).status).toBe(409);
    await ok(await worker.client.post(`${H}/separations/${own.id}/withdraw`));
    // Notice given 20 days ago, last day yesterday: 30 − 19 = 11 days short.
    ctx.sep = await ok(await a.client.post(`${H}/separations`, { employeeId: ctx.emp.id, noticeDate: addDays(today(), -20), lastWorkingDay: addDays(today(), -1), reason: 'Better offer' }), 201);
    expect(ctx.sep.noticeShortfallDays).toBe(11);
    const acc = await ok(await a.client.post(`${H}/separations/${ctx.sep.id}/accept`, {}));
    expect(acc.exitTasks).toBe(2);
    expect((await ok(await a.client.get(`${H}/employees/${ctx.emp.id}`))).status).toBe('notice');
  });

  it('works out the settlement and needs clearance before posting it', async () => {
    const el = await ok(await a.client.post(`${H}/leave/types`, { code: 'EL', name: 'Earned leave', accrual: 'none', encashable: true }), 201);
    await ok(await a.client.post(`${H}/leave/adjust`, { employeeId: ctx.emp.id, leaveTypeId: el.id, days: 10, kind: 'opening', remarks: 'Opening' }), 201);
    await ok(await a.client.post('/payroll/loans', { employeeId: ctx.emp.id, issuedOn: addDays(today(), -60), principal: 5000, emi: 1000, startMonth: today().slice(0, 7) }), 201);
    const tasks = await ok(await a.client.get(`${H}/tasks?kind=exit&employeeId=${ctx.emp.id}`));
    await ok(await a.client.request('PUT', `${H}/tasks/${tasks.find((t: any) => t.title === 'Return laptop').id}`, { status: 'done', remarks: 'Charger missing', recovery: 1500 }));
    let s = await ok(await a.client.get(`${H}/separations/${ctx.sep.id}/settlement`));
    expect(s.checks).toEqual(['1 exit clearance task(s) still pending']);
    expect((await a.client.post(`${H}/separations/${ctx.sep.id}/settle`)).status).toBe(400);
    await ok(await a.client.request('PUT', `${H}/tasks/${tasks.find((t: any) => t.title === 'Hand over work').id}`, { status: 'done' }));
    s = await ok(await a.client.get(`${H}/separations/${ctx.sep.id}/settlement`));
    expect(s.checks).toEqual([]);
    const amount = (ls: any[], code: string) => Number(ls.find((l) => l.code === code)?.amount ?? 0);
    // Old salary (the increment starts next month): basic 12,000; gross 28,560 (30,000 less employer PF).
    expect(amount(s.deductions, 'NOTICE_REC')).toBe(Math.round((11 * 28560) / 30));
    expect(amount(s.earnings, 'LEAVE_ENC')).toBe(Math.round((10 * 12000) / 26));
    expect(amount(s.earnings, 'GRATUITY')).toBe(0);
    expect(amount(s.deductions, 'LOAN')).toBe(5000);
    expect(amount(s.deductions, 'CLEARANCE')).toBe(1500);
    expect(amount(s.deductions, 'NOTICE_REC')).toBeGreaterThan(0);
    ctx.net = Number(s.net);
    expect(ctx.net).toBeLessThan(0);
  });

  it('posts the settlement, encashes the leave, closes the loan and exits the employee', async () => {
    const r = await ok(await a.client.post(`${H}/separations/${ctx.sep.id}/settle`));
    expect(r.status).toBe('settled');
    expect(r.journalId).toBeTruthy();
    expect(Number(r.net)).toBe(ctx.net);
    expect((await ok(await a.client.get(`${H}/employees/${ctx.emp.id}`))).status).toBe('exited');
    const loans = await ok(await a.client.get(`/payroll/loans?employeeId=${ctx.emp.id}`));
    expect(loans[0]).toMatchObject({ status: 'closed', outstanding: '0.00' });
    const ledger = await ok(await a.client.get(`${H}/leave/ledger?employeeId=${ctx.emp.id}`));
    expect(ledger.filter((l: any) => l.typeCode === 'EL').reduce((t: number, l: any) => t + Number(l.days), 0)).toBe(0);
    expect((await a.client.post(`${H}/separations/${ctx.sep.id}/settle`)).status).toBe(409);
  });
});
