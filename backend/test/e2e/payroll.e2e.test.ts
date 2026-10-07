import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let self: Awaited<ReturnType<typeof addMember>>;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const P = '/payroll';

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// Last month, fully past.
const M = (() => {
  const d = new Date(`${today().slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
})();
const monthDays = new Date(Date.UTC(Number(M.slice(0, 4)), Number(M.slice(5, 7)), 0)).getUTCDate();
const dates = Array.from({ length: monthDays }, (_, i) => `${M}-${String(i + 1).padStart(2, '0')}`);
const line = (ls: any[], code: string) => Number(ls.find((l) => l.code === code)?.amount ?? 0);

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const closing = async (key: string) => {
  const t = await ok(await a.client.get(`/accounting/trial-balance?to=${addDays(today(), 60)}`));
  return Math.abs(Number(t.rows.find((r: any) => r.systemKey === key)?.closing ?? 0));
};

beforeAll(async () => {
  a = await signupWorkspace('pay-a');
  emails.push(a.email);
  const role = await ok(await a.client.post('/iam/roles', { name: 'Self service', permissions: ['hr.self.use'] }), 201);
  self = await addMember(a.client, 'pay-self', [role.id]);
  emails.push(self.email);
  const ts = await ok(await a.client.post('/hr/org/locations', { code: 'HYD', name: 'Hyderabad', stateCode: '36' }), 201);
  const mh = await ok(await a.client.post('/hr/org/locations', { code: 'PUN', name: 'Pune', stateCode: '27' }), 201);
  const doj = addDays(today(), -500);
  ctx.ravi = await ok(await a.client.post('/hr/employees', { firstName: 'Ravi', gender: 'male', dateOfJoining: doj, locationId: ts.id, userId: self.userId, uan: '100200300400', bankName: 'State Bank of India', bankAccount: '30012345678', ifsc: 'SBIN0001234' }), 201);
  ctx.asha = await ok(await a.client.post('/hr/employees', { firstName: 'Asha', gender: 'female', dateOfJoining: doj, locationId: mh.id }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('salary setup', () => {
  it('has built-in components and protects statutory codes', async () => {
    const comps = await ok(await a.client.get(`${P}/components`));
    expect(comps.map((c: any) => c.code)).toEqual(expect.arrayContaining(['BASIC', 'DA', 'HRA', 'OT', 'PIECE', 'BONUS', 'REIMB', 'CANTEEN']));
    expect((await a.client.post(`${P}/components`, { code: 'PF', name: 'Mine', kind: 'deduction' })).status).toBe(400);
    await ok(await a.client.post(`${P}/components`, { code: 'WASH', name: 'Washing allowance', kind: 'earning' }), 201);
  });

  it('splits a CTC with a template', async () => {
    expect((await a.client.post(`${P}/templates`, { code: 'BAD', name: 'No basic', lines: [{ code: 'HRA', calc: 'percent_ctc', value: 20 }] })).status).toBe(400);
    ctx.tpl = await ok(
      await a.client.post(`${P}/templates`, { code: 'STAFF', name: 'Staff', lines: [{ code: 'BASIC', calc: 'percent_ctc', value: 40 }, { code: 'HRA', calc: 'percent_basic', value: 50 }, { code: 'CONV', calc: 'fixed', value: 1600 }, { code: 'SPL', calc: 'balance', value: 0 }] }),
      201,
    );
    const p = await ok(await a.client.get(`${P}/templates/${ctx.tpl.id}/preview?ctc=360000`));
    // 30,000 a month: basic 12,000, HRA 6,000, conveyance 1,600, employer PF 1,440, the rest special.
    expect(p.employerPf).toBe(1440);
    expect(Object.fromEntries(p.lines.map((l: any) => [l.code, Number(l.monthly)]))).toEqual({ BASIC: 12000, HRA: 6000, CONV: 1600, SPL: 8960 });
    expect((await a.client.get(`${P}/templates/${ctx.tpl.id}/preview?ctc=30000`)).status).toBe(400);
  });

  it('sets salaries, a loan and monthly inputs', async () => {
    await ok(await a.client.post(`${P}/salaries`, { employeeId: ctx.ravi.id, effectiveFrom: addDays(today(), -400), templateId: ctx.tpl.id, ctcAnnual: 360000 }), 201);
    await ok(await a.client.post(`${P}/salaries`, { employeeId: ctx.asha.id, effectiveFrom: addDays(today(), -400), lines: [{ code: 'BASIC', monthly: 9000 }, { code: 'DA', monthly: 2000 }, { code: 'HRA', monthly: 4000 }] }), 201);
    expect((await a.client.post(`${P}/salaries`, { employeeId: ctx.asha.id, effectiveFrom: today(), lines: [{ code: 'BONUS', monthly: 100 }] })).status).toBe(400);
    const list = await ok(await a.client.get(`${P}/salaries`));
    expect(Number(list.find((s: any) => s.employeeId === ctx.ravi.id).monthlyGross)).toBe(28560);
    ctx.loan = await ok(await a.client.post(`${P}/loans`, { employeeId: ctx.ravi.id, issuedOn: `${M}-01`, principal: 10000, emi: 2500, startMonth: M }), 201);
    expect((await a.client.post(`${P}/loans`, { employeeId: ctx.ravi.id, issuedOn: `${M}-01`, principal: 1000, emi: 2500, startMonth: M })).status).toBe(400);
    await ok(await a.client.post(`${P}/inputs`, { month: M, employeeId: ctx.ravi.id, code: 'BONUS', amount: 5000 }), 201);
    await ok(await a.client.post(`${P}/inputs`, { month: M, employeeId: ctx.ravi.id, code: 'reimb', amount: 1200, remarks: 'Travel' }), 201);
    await ok(await a.client.post(`${P}/inputs`, { month: M, employeeId: ctx.asha.id, code: 'CANTEEN', amount: 300 }), 201);
    expect((await a.client.post(`${P}/inputs`, { month: M, employeeId: ctx.asha.id, code: 'BASIC', amount: 300 })).status).toBe(400);
  });

  it('lets an employee keep their own tax declaration', async () => {
    const d = await ok(await self.client.request('PUT', `${P}/declarations`, { regime: 'new', fy: '2026-27', data: { previousIncome: 0 } }));
    expect(d.regime).toBe('new');
    expect((await self.client.request('PUT', `${P}/declarations`, { employeeId: ctx.asha.id, fy: '2026-27', data: {} })).status).toBe(403);
    expect((await self.client.get(`${P}/salaries`)).status).toBe(403);
  });
});

describe('payroll run', () => {
  it('uses attendance for loss of pay and applies PF, ESI, PT and TDS', async () => {
    // Asha punches every day except Sundays and two working days.
    const absent = dates.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0).slice(3, 5);
    const punches = dates
      .filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0 && !absent.includes(d))
      .flatMap((d) => [{ employeeCode: ctx.asha.code, at: `${d} 09:00` }, { employeeCode: ctx.asha.code, at: `${d} 17:30` }]);
    await ok(await a.client.post('/hr/attendance/punches', { punches }));
    await ok(await a.client.post('/hr/attendance/process', { from: `${M}-01`, to: dates.at(-1), employeeId: ctx.asha.id }));

    expect((await a.client.post(`${P}/runs`, { month: '2099-01' })).status).toBe(400);
    const run = await ok(await a.client.post(`${P}/runs`, { month: M }));
    ctx.run = run;
    expect(run.status).toBe('draft');
    const ravi = run.payslips.find((p: any) => p.employeeId === ctx.ravi.id);
    const asha = run.payslips.find((p: any) => p.employeeId === ctx.asha.id);

    // Ravi: no attendance, so every day is paid.
    expect(ravi.warnings).toContain('No attendance processed: paid for every day employed');
    expect(Number(ravi.gross)).toBe(28560 + 5000 + 1200);
    expect(line(ravi.deductions, 'PF')).toBe(1440);
    expect(line(ravi.employer, 'EPS')).toBe(1000);
    expect(line(ravi.employer, 'EPF_ER')).toBe(440);
    expect(line(ravi.deductions, 'ESI')).toBe(0);
    expect(line(ravi.deductions, 'PT')).toBe(200);
    expect(line(ravi.deductions, 'TDS')).toBe(0);
    expect(line(ravi.deductions, 'LOAN')).toBe(2500);
    expect(Number(ravi.net)).toBe(34760 - 1440 - 200 - 2500);

    // Asha: two days' loss of pay; ESI covered; Maharashtra PT is nil for women under 25,000.
    expect(Number(asha.lopDays)).toBe(2);
    const factor = (monthDays - 2) / monthDays;
    const basic = Math.round(9000 * factor);
    const da = Math.round(2000 * factor);
    const gross = basic + da + Math.round(4000 * factor);
    expect(Number(asha.gross)).toBe(gross);
    expect(line(asha.deductions, 'PF')).toBe(Math.round((basic + da) * 0.12));
    expect(line(asha.deductions, 'ESI')).toBe(Math.ceil(gross * 0.0075));
    expect(line(asha.employer, 'ESI_ER')).toBe(Math.ceil(gross * 0.0325));
    expect(line(asha.deductions, 'PT')).toBe(0);
    expect(line(asha.deductions, 'CANTEEN')).toBe(300);
    expect(run.statutory.pf.employees).toBe(2);
    expect(run.statutory.pf.missingUan).toEqual([`${ctx.asha.code} Asha`]);
    expect(run.statutory.esi.employees).toBe(1);
    expect(run.statutory.pt).toEqual([{ stateCode: '36', employees: 1, employee: 200, employer: 0 }]);
  });

  it('approves: posts the salary journal, recovers the loan and locks attendance', async () => {
    const run = await ok(await a.client.post(`${P}/runs/${ctx.run.id}/approve`));
    expect(run.status).toBe('approved');
    expect(await closing('salary_payable')).toBe(Number(run.totals.net));
    expect(await closing('employee_loans')).toBe(2500);
    const loans = await ok(await a.client.get(`${P}/loans?employeeId=${ctx.ravi.id}`));
    expect(loans[0].outstanding).toBe('7500.00');
    expect((await a.client.post(`${P}/runs`, { month: M })).status).toBe(409);
    expect((await a.client.post(`${P}/inputs`, { month: M, employeeId: ctx.ravi.id, code: 'BONUS', amount: 1 })).status).toBe(400);
    const reg = await a.client.post('/hr/attendance/regularisations', { employeeId: ctx.asha.id, date: `${M}-05`, inTime: '09:00', outTime: '18:00', reason: 'Late correction' });
    expect(reg.status).toBe(400);
  });

  it('exports the bank file and the PF ECR', async () => {
    const bank = await a.client.download(`${P}/runs/${ctx.run.id}/bank-file`);
    expect(bank.status).toBe(200);
    const csv = new TextDecoder().decode(bank.bytes);
    expect(csv).toContain(`${ctx.ravi.code},Ravi,State Bank of India,SBIN0001234,30012345678,${(34760 - 1440 - 200 - 2500).toFixed(2)},Salary ${M}`);
    expect(csv).toContain(`${ctx.asha.code},Asha,,,,`);
    const ecr = new TextDecoder().decode((await a.client.download(`${P}/runs/${ctx.run.id}/ecr`)).bytes);
    expect(ecr.trim().split('\n')).toEqual([`100200300400#~#RAVI#~#34760#~#12000#~#12000#~#12000#~#1440#~#1000#~#440#~#0#~#0`]);
  });

  it('shows employees only their own approved payslips', async () => {
    const mine = await ok(await self.client.get(`${P}/payslips/mine`));
    expect(mine).toHaveLength(1);
    const slip = await ok(await self.client.get(`${P}/payslips/${mine[0].id}`));
    expect(slip).toMatchObject({ month: M, code: ctx.ravi.code });
    expect(slip.ytd.gross).toBeGreaterThan(0);
    const asha = ctx.run.payslips.find((p: any) => p.employeeId === ctx.asha.id);
    expect((await self.client.get(`${P}/payslips/${asha.id}`)).status).toBe(403);
    expect((await self.client.download(`${P}/runs/${ctx.run.id}/bank-file`)).status).toBe(403);
  });

  it('reopens without doubling the books, then is paid', async () => {
    await ok(await a.client.post(`${P}/runs/${ctx.run.id}/reopen`));
    expect(await closing('salary_payable')).toBe(0);
    expect((await ok(await a.client.get(`${P}/loans?employeeId=${ctx.ravi.id}`)))[0].outstanding).toBe('10000.00');
    await ok(await a.client.post(`${P}/inputs`, { month: M, employeeId: ctx.ravi.id, code: 'INCENT', amount: 1000 }), 201);
    const again = await ok(await a.client.post(`${P}/runs`, { month: M }));
    const ravi = again.payslips.find((p: any) => p.employeeId === ctx.ravi.id);
    expect(Number(ravi.gross)).toBe(35760);
    const approved = await ok(await a.client.post(`${P}/runs/${ctx.run.id}/approve`));
    expect(await closing('salary_payable')).toBe(Number(approved.totals.net));
    // A second reopen reverses only the current posting.
    await ok(await a.client.post(`${P}/runs/${ctx.run.id}/reopen`));
    expect(await closing('salary_payable')).toBe(0);
    await ok(await a.client.post(`${P}/runs/${ctx.run.id}/approve`));
    const paid = await ok(await a.client.post(`${P}/runs/${ctx.run.id}/paid`, {}));
    expect(paid.status).toBe('paid');
    expect((await a.client.post(`${P}/runs/${ctx.run.id}/reopen`)).status).toBe(409);
  });
});
