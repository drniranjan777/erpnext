import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, API_URL, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let wkr: Awaited<ReturnType<typeof addMember>>;
let mgr: Awaited<ReturnType<typeof addMember>>;
const emails: string[] = [];
const ctx: Record<string, any> = {};

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
// A Monday at least three weeks back, so every test day has passed.
const d0 = (() => {
  const d = addDays(today(), -21);
  return addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
})();
const H = '/hr';
const q = (o: Record<string, unknown>) => `?${new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)]))}`;

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const day = async (client: Workspace['client'], employeeId: string, date: string) => (await ok(await client.get(`${H}/attendance/day` + q({ employeeId, date })))).day;

beforeAll(async () => {
  a = await signupWorkspace('tl-a');
  emails.push(a.email);
  const role = await ok(await a.client.post('/iam/roles', { name: 'Self service', permissions: ['hr.self.use'] }), 201);
  wkr = await addMember(a.client, 'tl-wkr', [role.id]);
  mgr = await addMember(a.client, 'tl-mgr', [role.id]);
  emails.push(wkr.email, mgr.email);
  ctx.hyd = await ok(await a.client.post(`${H}/org/locations`, { code: 'HYD', name: 'Hyderabad plant', stateCode: '36', latitude: 17.4, longitude: 78.55, radiusMetres: 300 }), 201);
  const doj = addDays(today(), -400);
  ctx.boss = await ok(await a.client.post(`${H}/employees`, { firstName: 'Meena', gender: 'female', dateOfJoining: doj, locationId: ctx.hyd.id, userId: mgr.userId }), 201);
  ctx.emp = await ok(await a.client.post(`${H}/employees`, { firstName: 'Ravi', gender: 'male', dateOfJoining: doj, locationId: ctx.hyd.id, reportsToId: ctx.boss.id, userId: wkr.userId }), 201);
  ctx.other = await ok(await a.client.post(`${H}/employees`, { firstName: 'Suresh', gender: 'male', dateOfJoining: doj, locationId: ctx.hyd.id }), 201);
  ctx.types = {};
  for (const t of [
    { code: 'CL', name: 'Casual leave', accrual: 'monthly', annualQuota: 12 },
    { code: 'EL', name: 'Earned leave', accrual: 'none', carryForwardMax: 30, encashable: true, encashMax: 15 },
    { code: 'LOP', name: 'Loss of pay', isPaid: false, accrual: 'none' },
    { code: 'CO', name: 'Comp-off', isCompOff: true, accrual: 'none' },
    { code: 'ML', name: 'Maternity leave', accrual: 'none', allowNegative: true, gender: 'female' },
    { code: 'EW', name: 'Earned by work', accrual: 'per_days_worked', daysWorkedPerLeave: 2 },
  ])
    ctx.types[t.code] = await ok(await a.client.post(`${H}/leave/types`, t), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('shifts, rosters and holidays', () => {
  it('sets up shifts, a fixed roster and a rotation', async () => {
    expect((await a.client.post(`${H}/shifts`, { code: 'BAD', name: 'Bad', startTime: '09:00', endTime: '17:00', halfDayMinutes: 500, fullDayMinutes: 450 })).status).toBe(400);
    ctx.gen = await ok(await a.client.post(`${H}/shifts`, { code: 'gen', name: 'General', startTime: '09:00', endTime: '17:30' }), 201);
    ctx.ngt = await ok(await a.client.post(`${H}/shifts`, { code: 'NGT', name: 'Night', startTime: '22:00', endTime: '06:00' }), 201);
    expect((await a.client.post(`${H}/shifts`, { code: 'GEN', name: 'Copy', startTime: '09:00', endTime: '17:30' })).status).toBe(409);
    await ok(await a.client.post(`${H}/roster`, { employeeIds: [ctx.emp.id, ctx.boss.id], shiftIds: [ctx.gen.id], weeklyOffs: [0], fromDate: d0 }));
    await ok(await a.client.post(`${H}/roster`, { employeeIds: [ctx.other.id], shiftIds: [ctx.gen.id, ctx.ngt.id], rotateEveryDays: 7, fromDate: d0 }));
    const roster = await ok(await a.client.get(`${H}/roster` + q({ date: addDays(d0, 7) })));
    expect(roster.find((r: any) => r.id === ctx.other.id)).toMatchObject({ shiftToday: 'NGT', rotation: ['GEN', 'NGT'] });
    expect(roster.find((r: any) => r.id === ctx.emp.id)).toMatchObject({ shiftToday: 'GEN' });
  });

  it('keeps one holiday per date and location', async () => {
    await ok(await a.client.post(`${H}/holidays`, { date: addDays(d0, 2), name: 'Festival', locationId: ctx.hyd.id }), 201);
    expect((await a.client.post(`${H}/holidays`, { date: addDays(d0, 2), name: 'Again', locationId: ctx.hyd.id })).status).toBe(409);
  });
});

describe('punches and daily attendance', () => {
  it('takes device pushes once and works out each day', async () => {
    const code = ctx.emp.code;
    const p = (d: number, t: string) => ({ employeeCode: code, at: `${addDays(d0, d)} ${t}`, deviceId: 'GATE-1' });
    const body = { punches: [p(0, '09:05'), p(0, '17:40'), p(1, '09:30'), p(1, '17:35'), p(2, '09:00'), p(2, '17:30'), p(3, '09:00'), p(4, '09:00'), p(4, '19:30'), { employeeCode: 'NOBODY', at: `${d0} 09:00` }, { employeeCode: code, at: 'soon' }] };
    const r = await ok(await a.client.post(`${H}/attendance/punches`, body));
    expect(r).toMatchObject({ received: 11, inserted: 9, duplicates: 0, unknownCodes: ['NOBODY'] });
    expect(r.invalid).toHaveLength(1);
    expect(await ok(await a.client.post(`${H}/attendance/punches`, { punches: body.punches.slice(0, 2) }))).toMatchObject({ inserted: 0, duplicates: 2 });
    await ok(await a.client.post(`${H}/attendance/process`, { from: d0, to: addDays(d0, 13) }));

    expect(await day(a.client, ctx.emp.id, d0)).toMatchObject({ status: 'present', lateMinutes: 0, payableDays: '1.0' });
    expect(await day(a.client, ctx.emp.id, addDays(d0, 1))).toMatchObject({ status: 'present', lateMinutes: 30 });
    expect(await day(a.client, ctx.emp.id, addDays(d0, 2))).toMatchObject({ status: 'holiday', payableDays: '1.0' });
    expect(await day(a.client, ctx.emp.id, addDays(d0, 3))).toMatchObject({ status: 'missed_punch', payableDays: '0.0' });
    expect(await day(a.client, ctx.emp.id, addDays(d0, 4))).toMatchObject({ status: 'present', workedMinutes: 600, otMinutes: 60 });
    expect(await day(a.client, ctx.emp.id, addDays(d0, 5))).toMatchObject({ status: 'absent' });
    expect(await day(a.client, ctx.emp.id, addDays(d0, 6))).toMatchObject({ status: 'weekly_off' });
  });

  it('keeps a night shift across midnight together', async () => {
    const code = ctx.other.code;
    await ok(await a.client.post(`${H}/attendance/punches`, { punches: [{ employeeCode: code, at: `${addDays(d0, 7)} 21:58` }, { employeeCode: code, at: `${addDays(d0, 8)} 06:03` }] }));
    const d = await day(a.client, ctx.other.id, addDays(d0, 7));
    expect(d.status).toBe('present');
    expect(new Date(d.firstIn).toISOString()).toBe(new Date(`${addDays(d0, 7)}T21:58:00+05:30`).toISOString());
    expect((await day(a.client, ctx.other.id, addDays(d0, 8))).status).toBe('absent');
  });

  it('imports a punch file with day-first dates', async () => {
    const csv = `employee_code,punch_time\n${ctx.other.code},${dmy(d0)} 08:58\n${ctx.other.code},${dmy(d0)} 17:31\n`;
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'punches.csv');
    const res = await fetch(`${API_URL}${H}/attendance/punches/import`, { method: 'POST', headers: { authorization: `Bearer ${a.client.accessToken}` }, body: form });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ inserted: 2 });
    expect((await day(a.client, ctx.other.id, d0)).status).toBe('present');
  });

  it('builds the muster roll with comp-off earned on the holiday', async () => {
    const m = await ok(await a.client.get(`${H}/attendance/month` + q({ month: d0.slice(0, 7) })));
    const row = m.rows.find((r: any) => r.employeeId === ctx.emp.id);
    expect(row.days[d0]).toBe('P');
    expect(row.days[addDays(d0, 3)]).toBe('MP');
    if (addDays(d0, 2).slice(0, 7) === d0.slice(0, 7)) expect(row.days[addDays(d0, 2)]).toBe('H');
    expect(row.summary.lateDays).toBeGreaterThanOrEqual(1);
    const bal = await ok(await wkr.client.get(`${H}/leave/balances`));
    expect(bal.find((b: any) => b.typeCode === 'CO')).toMatchObject({ balanceNow: 1 });
  });
});

describe('regularisation', () => {
  it('lets the manager, not the employee, approve a missed punch', async () => {
    const r = await ok(await wkr.client.post(`${H}/attendance/regularisations`, { date: addDays(d0, 3), outTime: '17:45', reason: 'Forgot to punch out' }), 201);
    expect(r.status).toBe('pending');
    expect((await wkr.client.post(`${H}/attendance/regularisations/${r.id}/decide`, { approve: true })).status).toBe(403);
    expect((await wkr.client.post(`${H}/attendance/regularisations`, { employeeId: ctx.other.id, date: d0, inTime: '09:00', reason: 'Not mine' })).status).toBe(403);
    const list = await ok(await mgr.client.get(`${H}/attendance/regularisations` + q({ status: 'pending' })));
    expect(list.find((x: any) => x.id === r.id)).toMatchObject({ isManager: true });
    await ok(await mgr.client.post(`${H}/attendance/regularisations/${r.id}/decide`, { approve: true }));
    expect(await day(mgr.client, ctx.emp.id, addDays(d0, 3))).toMatchObject({ status: 'present' });
    // Not their team.
    expect((await mgr.client.get(`${H}/attendance/day` + q({ employeeId: ctx.other.id, date: d0 }))).status).toBe(403);
    expect((await wkr.client.get(`${H}/attendance/month` + q({ month: d0.slice(0, 7) }))).status).toBe(403);
  });
});

describe('mobile punch', () => {
  const punch = async (lat: number, lng: number) => {
    const form = new FormData();
    form.append('latitude', String(lat));
    form.append('longitude', String(lng));
    form.append('accuracy', '15');
    form.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }), 'selfie.jpg');
    const res = await fetch(`${API_URL}${H}/attendance/mobile`, { method: 'POST', headers: { authorization: `Bearer ${wkr.client.accessToken}` }, body: form });
    return { status: res.status, body: await res.json() };
  };
  it('checks the geofence and keeps the selfie', async () => {
    const inside = await punch(17.4005, 78.5502);
    expect(inside.status, JSON.stringify(inside.body)).toBe(201);
    expect(inside.body).toMatchObject({ insideFence: true, location: 'Hyderabad plant' });
    await new Promise((r) => setTimeout(r, 1100));
    const outside = await punch(17.45, 78.6);
    expect(outside.body.insideFence).toBe(false);
    expect(outside.body.distanceMetres).toBeGreaterThan(5000);
    const me = await ok(await wkr.client.get(`${H}/me`));
    expect(me.punches).toHaveLength(2);
    const flagged = await ok(await a.client.get(`${H}/attendance/punches` + q({ flagged: 'true' })));
    expect(flagged).toHaveLength(1);
    expect((await a.client.download(`${H}/attendance/punches/${flagged[0].id}/selfie`)).status).toBe(200);
    // The owner has no employee record.
    expect((await a.client.get(`${H}/me`)).status).toBe(403);
  });
});

describe('leave', () => {
  it('accrues monthly leave once and tops up leave earned by days worked', async () => {
    const month = today().slice(0, 7);
    const first = await ok(await a.client.post(`${H}/leave/accrue`, { month }));
    expect(first.credited).toBeGreaterThanOrEqual(3);
    const again = await ok(await a.client.post(`${H}/leave/accrue`, { month }));
    expect(again.alreadyCredited).toBeGreaterThanOrEqual(3);
    const bal = await ok(await a.client.get(`${H}/leave/balances` + q({ employeeId: ctx.emp.id })));
    expect(bal.find((b: any) => b.typeCode === 'CL').balanceNow).toBe(1);
    // About 5 days worked earn 2 days at one per 2 worked; a rerun replaces, not adds.
    const ew = bal.find((b: any) => b.typeCode === 'EW').balanceNow;
    expect(ew).toBeGreaterThanOrEqual(2);
    await ok(await a.client.post(`${H}/leave/accrue`, { month }));
    expect((await ok(await a.client.get(`${H}/leave/balances` + q({ employeeId: ctx.emp.id })))).find((b: any) => b.typeCode === 'EW').balanceNow).toBe(ew);
    expect(bal.find((b: any) => b.typeCode === 'ML')).toBeUndefined();
  });

  it('checks balance, overlaps, gender and half days on applying', async () => {
    const t = ctx.types;
    const from = addDays(today(), 14);
    expect((await wkr.client.post(`${H}/leave/applications`, { leaveTypeId: t.CL.id, fromDate: from, toDate: addDays(from, 1), reason: 'Family function' })).status).toBe(400);
    expect((await wkr.client.post(`${H}/leave/applications`, { leaveTypeId: t.ML.id, fromDate: from, toDate: from, reason: 'Not allowed' })).status).toBe(400);
    const half = await ok(await wkr.client.post(`${H}/leave/applications`, { leaveTypeId: t.CL.id, fromDate: from, toDate: from, fromHalf: true, reason: 'Bank work' }), 201);
    expect(half).toMatchObject({ days: '0.50', status: 'pending' });
    expect((await wkr.client.post(`${H}/leave/applications`, { leaveTypeId: t.LOP.id, fromDate: from, toDate: from, reason: 'Clash' })).status).toBe(409);
    // Pending days count against the balance.
    expect((await wkr.client.post(`${H}/leave/applications`, { leaveTypeId: t.CL.id, fromDate: addDays(from, 7), toDate: addDays(from, 7), reason: 'Too much' })).status).toBe(400);
    expect((await wkr.client.post(`${H}/leave/applications/${half.id}/decide`, { approve: true })).status).toBe(403);
    await ok(await mgr.client.post(`${H}/leave/applications/${half.id}/decide`, { approve: true, note: 'OK' }));
    const bal = await ok(await wkr.client.get(`${H}/leave/balances`));
    expect(bal.find((b: any) => b.typeCode === 'CL')).toMatchObject({ balanceNow: 0.5, pending: 0 });
  });

  it('marks approved past leave on attendance and gives it back on cancellation', async () => {
    const t = ctx.types;
    await ok(await a.client.post(`${H}/leave/adjust`, { employeeId: ctx.emp.id, leaveTypeId: t.EL.id, days: 40, kind: 'opening', remarks: 'Opening balance from the old system' }), 201);
    // Monday and Tuesday of the third week; the Sunday between is not counted.
    const el = await ok(await a.client.post(`${H}/leave/applications`, { employeeId: ctx.emp.id, leaveTypeId: t.EL.id, fromDate: addDays(d0, 12), toDate: addDays(d0, 14), reason: 'Travel' }), 201);
    expect(el.days).toBe('2.00');
    await ok(await a.client.post(`${H}/leave/applications/${el.id}/decide`, { approve: true }));
    expect(await day(a.client, ctx.emp.id, addDays(d0, 14))).toMatchObject({ status: 'leave', payableDays: '1.0' });
    const lop = await ok(await a.client.post(`${H}/leave/applications`, { employeeId: ctx.emp.id, leaveTypeId: t.LOP.id, fromDate: addDays(d0, 15), toDate: addDays(d0, 15), reason: 'Personal' }), 201);
    await ok(await mgr.client.post(`${H}/leave/applications/${lop.id}/decide`, { approve: true }));
    expect(await day(a.client, ctx.emp.id, addDays(d0, 15))).toMatchObject({ status: 'leave', payableDays: '0.0' });

    expect((await wkr.client.post(`${H}/leave/applications/${el.id}/cancel`)).status).toBe(403);
    await ok(await a.client.post(`${H}/leave/applications/${el.id}/cancel`));
    expect((await day(a.client, ctx.emp.id, addDays(d0, 14))).status).toBe('absent');
    const ledger = await ok(await wkr.client.get(`${H}/leave/ledger` + q({ employeeId: ctx.emp.id, year: Number(addDays(d0, 12).slice(0, 4)) })));
    expect(ledger.filter((l: any) => l.typeCode === 'EL').map((l: any) => l.kind)).toEqual(expect.arrayContaining(['availed', 'reversal']));
    const cal = await ok(await mgr.client.get(`${H}/leave/calendar` + q({ from: d0, to: addDays(today(), 30) })));
    expect(cal.length).toBeGreaterThanOrEqual(2);
  });

  it('carries forward, encashes and lapses at year end, once', async () => {
    const year = Number(today().slice(0, 4));
    const r = await ok(await a.client.post(`${H}/leave/year-end`, { year }));
    // EL 40: 30 carried, 10 encashed. CL 0.5: lapses.
    expect(r.encashedDays).toBe(10);
    expect(r.lapsedDays).toBeGreaterThanOrEqual(0.5);
    const again = await ok(await a.client.post(`${H}/leave/year-end`, { year }));
    expect(again).toMatchObject({ encashedDays: 0, lapsedDays: 0 });
    const bal = await ok(await a.client.get(`${H}/leave/balances` + q({ employeeId: ctx.emp.id, year })));
    expect(bal.find((b: any) => b.typeCode === 'EL')).toMatchObject({ balance: 30, closedOut: 10 });
  });
});
