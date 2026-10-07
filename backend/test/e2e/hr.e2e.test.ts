import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, API_URL, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const org: Record<string, any> = {};
const ctx: Record<string, any> = {};

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function created(path: string, body: unknown) {
  const r = await a.client.post(path, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const H = '/hr';
// Made-up identity numbers (valid formats; the Aadhaar has a valid Verhoeff digit).
const PAN = 'ABCPE1234F';
const AADHAAR = '234123412346';

beforeAll(async () => {
  a = await signupWorkspace('hr-a');
  emails.push(a.email);
  org.ops = await created(`${H}/org/departments`, { code: 'OPS', name: 'Operations' });
  org.prod = await created(`${H}/org/departments`, { code: 'PRD', name: 'Production', parentId: org.ops.id });
  org.qa = await created(`${H}/org/departments`, { code: 'QA', name: 'Quality' });
  org.g3 = await created(`${H}/org/grades`, { code: 'G3', name: 'Officer', minSalary: '25000', maxSalary: '45000', level: 3 });
  org.g4 = await created(`${H}/org/grades`, { code: 'G4', name: 'Senior officer', minSalary: '40000', maxSalary: '70000', level: 4 });
  org.eng = await created(`${H}/org/designations`, { code: 'ENG', name: 'Engineer', gradeId: org.g3.id });
  org.seng = await created(`${H}/org/designations`, { code: 'SENG', name: 'Senior engineer', gradeId: org.g4.id });
  org.mgr = await created(`${H}/org/designations`, { code: 'MGR', name: 'Plant manager' });
  org.hyd = await created(`${H}/org/locations`, { code: 'HYD', name: 'Hyderabad plant', stateCode: '36', latitude: 17.4, longitude: 78.55, radiusMetres: 300 });
  org.pune = await created(`${H}/org/locations`, { code: 'PUN', name: 'Pune depot', stateCode: '27', isFactory: false });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('organisation masters', () => {
  it('validates codes, bands and state codes', async () => {
    expect((await a.client.post(`${H}/org/departments`, { code: 'ops', name: 'Copy' })).status).toBe(409);
    expect((await a.client.post(`${H}/org/grades`, { code: 'G9', name: 'Bad', minSalary: '50000', maxSalary: '10000' })).status).toBe(400);
    expect((await a.client.post(`${H}/org/locations`, { code: 'X', name: 'Bad', stateCode: 'TS' })).status).toBe(400);
    const depts = await ok(await a.client.get(`${H}/org/departments`));
    expect(depts.find((d: any) => d.code === 'PRD')).toMatchObject({ parentId: org.ops.id, employees: 0 });
  });
});

describe('employees', () => {
  it('validates and encrypts statutory numbers, and masks them', async () => {
    const base = { firstName: 'Ravi', lastName: 'Kumar', gender: 'male', dateOfBirth: '1990-05-10', mobile: '9876543210', dateOfJoining: addDays(today(), -400), category: 'staff', departmentId: org.prod.id, designationId: org.eng.id, gradeId: org.g3.id, locationId: org.hyd.id };
    const bad = await a.client.post(`${H}/employees`, { ...base, pan: 'ABCZE1234F', aadhaar: '234123412345', ifsc: 'SBIN1001234' });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.map((e: any) => e.path).sort()).toEqual(['aadhaar', 'ifsc', 'pan']);
    expect((await a.client.post(`${H}/employees`, { ...base, mobile: '12345' })).status).toBe(400);

    ctx.boss = await created(`${H}/employees`, { firstName: 'Meena', lastName: 'Rao', gender: 'female', dateOfJoining: addDays(today(), -2000), employmentType: 'permanent', category: 'management', departmentId: org.ops.id, designationId: org.mgr.id, locationId: org.hyd.id });
    const e = await created(`${H}/employees`, {
      ...base,
      reportsToId: ctx.boss.id,
      pan: 'abcpe1234f',
      aadhaar: '2341 2341 2346',
      uan: '100200300400',
      esicNumber: '3100123456',
      bankName: 'State Bank of India',
      bankAccount: '30012345678',
      ifsc: 'sbin0001234',
      family: [
        { name: 'Lakshmi', relation: 'spouse', nomineeFor: ['pf', 'gratuity'], nomineeSharePct: '60' },
        { name: 'Arjun', relation: 'son', isDependent: true, nomineeFor: ['pf', 'gratuity'], nomineeSharePct: '40' },
      ],
    });
    expect(e).toMatchObject({ code: 'EMP0002', fullName: 'Ravi Kumar', panMasked: 'ABXXX1234F', aadhaarLast4: '2346', bankAccountLast4: '5678', ifsc: 'SBIN0001234', department: 'Production', designation: 'Engineer', manager: 'Meena Rao', hasPan: true, canSeeSensitive: true });
    expect(e).not.toHaveProperty('panEnc');
    expect(JSON.stringify(e)).not.toContain(PAN);
    expect(e.family).toHaveLength(2);
    expect(e.events.map((v: any) => v.kind)).toEqual(['joined']);
    expect((await ok(await a.client.post(`${H}/employees/${e.id}/reveal`, { field: 'pan' }))).value).toBe(PAN);
    expect((await ok(await a.client.post(`${H}/employees/${e.id}/reveal`, { field: 'aadhaar' }))).value).toBe(AADHAAR);
    ctx.emp = e;
  });

  it('keeps stored secrets when not resent, checks nominee shares and version', async () => {
    const e = ctx.emp;
    const body = { firstName: 'Ravi', lastName: 'Kumar', mobile: '9876500000', dateOfJoining: e.dateOfJoining, category: 'staff', family: e.family.map((f: any) => ({ ...f, nomineeSharePct: '60' })) };
    expect((await a.client.request('PUT', `${H}/employees/${e.id}`, { ...body, version: e.version })).status).toBe(400); // 120 %
    const fam = [{ name: 'Lakshmi', relation: 'spouse', nomineeFor: ['pf'], nomineeSharePct: '100' }];
    const up = await ok(await a.client.request('PUT', `${H}/employees/${e.id}`, { ...body, family: fam, version: e.version }));
    expect(up).toMatchObject({ mobile: '9876500000', panMasked: 'ABXXX1234F', hasAadhaar: true, version: e.version + 1 });
    expect((await a.client.request('PUT', `${H}/employees/${e.id}`, { ...body, family: fam, version: e.version })).status).toBe(409);
    expect((await a.client.request('PUT', `${H}/employees/${e.id}`, { ...body, family: fam, version: up.version, departmentId: org.qa.id })).status).toBe(400);
    ctx.emp = up;
  });

  it('hides unmasked numbers from people without the sensitive permission', async () => {
    const role = await ok(await a.client.post('/iam/roles', { name: 'HR viewer', permissions: ['hr.employees.read'] }), 201);
    const viewer = await addMember(a.client, 'hr-viewer', [role.id]);
    emails.push(viewer.email);
    const seen = await ok(await viewer.client.get(`${H}/employees/${ctx.emp.id}`));
    expect(seen).toMatchObject({ panMasked: 'ABXXX1234F', canSeeSensitive: false, canManage: false });
    expect((await viewer.client.post(`${H}/employees/${ctx.emp.id}/reveal`, { field: 'pan' })).status).toBe(403);
    expect((await viewer.client.post(`${H}/employees`, { firstName: 'X', dateOfJoining: today() })).status).toBe(403);
  });

  it('records promotions and transfers on the service record, without reporting loops', async () => {
    const e = ctx.emp;
    expect((await a.client.post(`${H}/employees/${ctx.boss.id}/move`, { kind: 'transfer', effectiveDate: today(), reportsToId: e.id })).status).toBe(400);
    const p = await ok(await a.client.post(`${H}/employees/${e.id}/move`, { kind: 'promotion', effectiveDate: today(), designationId: org.seng.id, gradeId: org.g4.id, remarks: 'Annual review' }));
    expect(p).toMatchObject({ designation: 'Senior engineer', grade: 'Senior officer' });
    expect(p.events[0]).toMatchObject({ kind: 'promotion', from: { designation: 'Engineer', grade: 'Officer' }, to: { designation: 'Senior engineer', grade: 'Senior officer' } });
    const c = await ok(await a.client.post(`${H}/employees/${e.id}/confirm`, { effectiveDate: addDays(e.dateOfJoining, 180) }));
    expect(c).toMatchObject({ employmentType: 'permanent', confirmedOn: addDays(e.dateOfJoining, 180) });
    expect((await a.client.post(`${H}/employees/${e.id}/confirm`, {})).status).toBe(409);
    const chart = await ok(await a.client.get(`${H}/org-chart`));
    expect(chart.find((x: any) => x.id === ctx.boss.id)).toMatchObject({ reports: 1, reportsToId: null });
    const hc = await ok(await a.client.get(`${H}/headcount`));
    expect(hc).toMatchObject({ total: 2 });
    expect(hc.byLocation).toEqual([{ key: 'Hyderabad plant', n: 2 }]);
  });

  it('stores documents and issues letters from templates', async () => {
    const e = ctx.emp;
    const form = new FormData();
    form.append('kind', 'education');
    form.append('title', 'B.Tech degree');
    form.append('file', new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), 'degree.pdf');
    const res = await fetch(`${API_URL}${H}/employees/${e.id}/documents`, { method: 'POST', headers: { authorization: `Bearer ${a.client.accessToken}` }, body: form });
    expect(res.status).toBe(201);
    const doc = await res.json();
    expect(doc).toMatchObject({ kind: 'education', title: 'B.Tech degree' });
    const dl = await a.client.download(`${H}/employees/${e.id}/documents/${doc.id}`);
    expect(dl.status).toBe(200);
    expect(new TextDecoder().decode(dl.bytes)).toBe('%PDF-1.4 fake');
    // The generic document attachment endpoint does not serve employee files.
    const view = await ok(await a.client.get(`${H}/employees/${e.id}`));
    expect(view.documents[0].fileName).toBe('degree.pdf');

    const t = await created(`${H}/letter-templates`, { code: 'PROMO', name: 'Promotion letter', kind: 'promotion', body: 'Dear {{employee.name}} ({{employee.code}}),\n\nWe are pleased to promote you to {{designation}} in {{department}} with effect from {{effective}}.\n\nFor {{company}}' });
    expect((await a.client.post(`${H}/employees/${e.id}/letters`, { templateId: t.id })).status).toBe(400);
    const l = await created(`${H}/employees/${e.id}/letters`, { templateId: t.id, extra: { effective: '1 November 2026' } });
    expect(l.body).toMatch(/^Dear Ravi Kumar \(EMP0002\),/);
    expect(l.body).toContain('Senior engineer in Production with effect from 1 November 2026');
    expect(l.body).toContain('For E2E hr-a');
    const printed = await ok(await a.client.get(`${H}/letters/${l.id}`));
    expect(printed.company.name).toMatch(/E2E hr-a/);
  });

  it('records an exit, refusing while people still report', async () => {
    expect((await a.client.post(`${H}/employees/${ctx.boss.id}/exit`, { exitDate: today(), reason: 'Resigned' })).status).toBe(409);
    const x = await ok(await a.client.post(`${H}/employees/${ctx.emp.id}/exit`, { exitDate: addDays(today(), 30), reason: 'Resigned: higher studies' }));
    expect(x).toMatchObject({ status: 'notice', exitDate: addDays(today(), 30) });
    const list = await ok(await a.client.get(`${H}/employees?status=notice`));
    expect(list.items.map((r: any) => r.code)).toEqual(['EMP0002']);
  });
});
