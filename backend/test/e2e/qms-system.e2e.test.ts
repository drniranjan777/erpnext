import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
const item: Record<string, any> = {};
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
const M = '/qms';
const alerts = async () => ok(await a.client.get(`${M}/alerts`));

beforeAll(async () => {
  a = await signupWorkspace('qsys-a');
  emails.push(a.email);
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  item.tablet = await created('/masters/items', { name: 'Paracetamol 500 tablet', type: 'finished_good', baseUomId: uom.NOS, gstRate: 12, hsnCode: '30049099' });
  ctx.me = (await ok(await a.client.get('/auth/me'))).user;
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('deviations and change control', () => {
  it('rates risk, approves, raises a CAPA and closes', async () => {
    expect((await a.client.post(`${M}/deviations`, { kind: 'planned', category: 'material', description: 'Alternate excipient lot', severity: 2, occurrence: 2, detection: 2 })).status).toBe(400);
    let d = await created(`${M}/deviations`, { kind: 'unplanned', category: 'equipment', description: 'Granulator ran 5 °C above range for 20 minutes', itemId: item.tablet.id, batchNo: 'pt-2610', severity: 4, occurrence: 3, detection: 3, productImpact: true, impact: 'Possible over-drying of granules' });
    expect(d).toMatchObject({ rpn: 36, riskLevel: 'medium', batchNo: 'PT-2610', status: 'draft' });
    d = await ok(await a.client.post(`${M}/deviations/${d.id}/submit`, { version: d.version }));
    expect(d).toMatchObject({ status: 'approved', canClose: true });
    const capa = await created(`${M}/deviations/${d.id}/capa`, {});
    expect(capa).toMatchObject({ source: 'internal', status: 'draft', item: { id: item.tablet.id } });
    expect((await a.client.post(`${M}/deviations/${d.id}/capa`, {})).status).toBe(409);
    d = await ok(await a.client.get(`${M}/deviations/${d.id}`));
    expect(d.capa.id).toBe(capa.id);
    d = await ok(await a.client.post(`${M}/deviations/${d.id}/close`, { version: d.version, notes: 'LOD within limits; batch released' }));
    expect(d.closedAt).toBeTruthy();

    const planned = await created(`${M}/deviations`, { kind: 'planned', category: 'document', description: 'Use the old label stock until reprint', severity: 1, occurrence: 2, detection: 1, validUntil: addDays(today(), -1) });
    await ok(await a.client.post(`${M}/deviations/${planned.id}/submit`, { version: planned.version }));
    expect((await alerts()).deviationsExpired).toBe(1);
    const open = await ok(await a.client.get(`${M}/deviations?open=true`));
    expect(open.items.map((x: any) => x.id)).toEqual([planned.id]);
  });

  it('needs a risk rating for process changes', async () => {
    const body = { kind: 'process', reason: 'Raise the drying temperature to cut cycle time', items: [{ itemId: item.tablet.id }] };
    let c = await created('/engineering/changes', body);
    expect((await a.client.post(`/engineering/changes/${c.id}/submit`, { version: c.version })).status).toBe(400);
    c = await ok(await a.client.request('PUT', `/engineering/changes/${c.id}`, { ...body, version: c.version, severity: 3, occurrence: 2, detection: 2, validationRequired: true, regulatoryImpact: true }));
    expect(c).toMatchObject({ rpn: 12, riskLevel: 'low', validationRequired: true, regulatoryImpact: true });
    c = await ok(await a.client.post(`/engineering/changes/${c.id}/submit`, { version: c.version }));
    expect(c.status).toBe('approved');
  });
});

describe('calibration and MSA', () => {
  it('tracks due dates and takes a failed gauge out of service', async () => {
    let g = await created(`${M}/gauges`, { code: 'VC-01', name: 'Vernier caliper 0–150', kind: 'vernier', leastCount: '0.02 mm', intervalDays: 365, lastCalibrated: addDays(today(), -400) });
    expect(g.nextDue).toBe(addDays(today(), -35));
    expect((await a.client.post(`${M}/gauges`, { code: 'vc-01', name: 'Copy' })).status).toBe(409);
    let list = await ok(await a.client.get(`${M}/gauges?due=true`));
    expect(list.find((x: any) => x.id === g.id).dueState).toBe('overdue');
    expect((await alerts()).calibrationOverdue).toBe(1);

    const cal = await created(`${M}/gauges/${g.id}/calibrations`, { calibratedOn: today(), calibratedBy: 'NABL lab, Hyderabad', certificateNo: 'CC-4471', result: 'pass', points: [{ nominal: '50', actual: '50.01' }, { nominal: '100', actual: '99.98' }] });
    expect(cal.points.map((p: any) => p.error)).toEqual(['0.01', '-0.02']);
    expect(cal.nextDue).toBe(addDays(today(), 365));
    list = await ok(await a.client.get(`${M}/gauges`));
    expect(list.find((x: any) => x.id === g.id)).toMatchObject({ dueState: 'ok', lastCalibrated: today() });
    expect((await a.client.post(`${M}/gauges/${g.id}/calibrations`, { calibratedOn: addDays(today(), -10), calibratedBy: 'Lab', result: 'pass' })).status).toBe(400);
    await created(`${M}/gauges/${g.id}/calibrations`, { calibratedOn: today(), calibratedBy: 'In-house', result: 'fail', notes: 'Jaw worn' });
    g = await ok(await a.client.get(`${M}/gauges/${g.id}`));
    expect(g).toMatchObject({ status: 'out_of_service', nextDue: null });
    expect(g.calibrations).toHaveLength(2);
    ctx.gauge = g;
  });

  it('runs a gauge R&R study', async () => {
    const m = [
      [[10.0, 10.1], [12.0, 12.1], [14.0, 14.0], [16.1, 16.0], [18.0, 18.1]],
      [[10.1, 10.2], [12.1, 12.1], [14.1, 14.2], [16.1, 16.2], [18.2, 18.1]],
      [[10.0, 10.0], [12.0, 11.9], [14.0, 14.1], [16.0, 16.0], [18.0, 18.0]],
    ];
    const s = await created(`${M}/gauges/${ctx.gauge.id}/grr`, { studyDate: today(), characteristic: 'Shaft OD', tolerance: '10', operators: ['Ravi', 'Asha', 'Imran'], measurements: m });
    expect(s.result).toMatchObject({ operators: 3, parts: 5, trials: 2, verdict: 'acceptable' });
    expect(s.result.ndc).toBeGreaterThanOrEqual(5);
    expect((await a.client.post(`${M}/gauges/${ctx.gauge.id}/grr`, { studyDate: today(), characteristic: 'OD', operators: ['A', 'B'], measurements: [m[0]] })).status).toBe(400);
  });
});

describe('internal audits', () => {
  it('keeps nonconformities open until their CAPA closes', async () => {
    const au = await created(`${M}/audits`, { title: 'Production area audit', standard: 'ISO 9001', area: 'Granulation', plannedDate: addDays(today(), -3), auditor: 'K. Menon' });
    expect((await ok(await a.client.get(`${M}/audits`))).find((x: any) => x.id === au.id).overdue).toBe(true);
    const f = await created(`${M}/audits/${au.id}/findings`, { kind: 'minor_nc', clause: '7.1.5', description: 'Balance calibration label missing' });
    await created(`${M}/audits/${au.id}/findings`, { kind: 'ofi', description: 'Colour-code the tool shadow board' });
    expect((await a.client.post(`${M}/findings/${f.id}/close`, {})).status).toBe(409);
    const capa = await created(`${M}/findings/${f.id}/capa`, {});
    expect(capa).toMatchObject({ source: 'audit' });
    expect(capa.problem).toMatch(/ISO 9001 7\.1\.5/);
    await ok(await a.client.post(`${M}/audits/${au.id}/done`, { summary: 'One minor NC, one OFI' }));
    const view = await ok(await a.client.get(`${M}/audits/${au.id}`));
    expect(view).toMatchObject({ status: 'done', doneOn: today() });
    expect(view.findings.find((x: any) => x.id === f.id)).toMatchObject({ capaId: capa.id, capaStage: 'open' });
    const sum = await ok(await a.client.get(`${M}/audits/summary?year=${today().slice(0, 4)}`));
    expect(sum).toEqual(expect.arrayContaining([expect.objectContaining({ standard: 'ISO 9001', kind: 'minor_nc', count: 1, open: 1 })]));
  });
});

describe('SOPs', () => {
  it('releases versions and tracks who has read them', async () => {
    let s = await created(`${M}/sops`, { sopCode: 'qa-001', title: 'Line clearance', department: 'QA' });
    expect((await a.client.post(`${M}/sops/${s.id}/submit`, { version: s.version })).status).toBe(400);
    s = await ok(await a.client.request('PUT', `${M}/sops/${s.id}`, { version: s.version, sopCode: 'QA-001', title: 'Line clearance', body: '1. Remove previous batch material…', reviewDue: addDays(today(), 20) }));
    expect((await a.client.post(`${M}/sops`, { sopCode: 'QA-001', title: 'Copy' })).status).toBe(409);
    s = await ok(await a.client.request('PUT', `${M}/sops/${s.id}/trainees`, { userIds: [ctx.me.id] }));
    s = await ok(await a.client.post(`${M}/sops/${s.id}/submit`, { version: s.version }));
    expect(s).toMatchObject({ status: 'approved', current: true, effectiveDate: today(), canAcknowledge: true });
    expect((await ok(await a.client.get(`${M}/sops/pending`))).map((x: any) => x.sopCode)).toEqual(['QA-001']);
    const al = await alerts();
    expect(al).toMatchObject({ mySopsToRead: 1, sopReviewsDue: 1 });
    s = await ok(await a.client.post(`${M}/sops/${s.id}/acknowledge`, {}));
    expect(s.trainees[0].acknowledgedAt).toBeTruthy();
    expect((await a.client.post(`${M}/sops/${s.id}/acknowledge`, {})).status).toBe(409);
    expect(await ok(await a.client.get(`${M}/sops/pending`))).toEqual([]);

    let v2 = await created(`${M}/sops/${s.id}/new-version`, {});
    expect(v2).toMatchObject({ sopVersion: 2, status: 'draft', previousId: s.id });
    expect((await a.client.post(`${M}/sops/${s.id}/new-version`, {})).status).toBe(409);
    v2 = await ok(await a.client.post(`${M}/sops/${v2.id}/submit`, { version: v2.version }));
    expect(v2.trainees.map((t: any) => [t.userId, t.acknowledgedAt])).toEqual([[ctx.me.id, null]]);
    const old = await ok(await a.client.get(`${M}/sops/${s.id}`));
    expect(old).toMatchObject({ current: false, canAcknowledge: false });
    expect(old.supersededAt).toBeTruthy();
    expect((await ok(await a.client.get(`${M}/sops?current=true`))).map((x: any) => x.sopVersion)).toEqual([2]);
    expect((await ok(await a.client.get(`${M}/sops/pending`))).map((x: any) => x.sopVersion)).toEqual([2]);
  });
});

describe('HSE', () => {
  it('records incidents, waste, EPR and licences', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await a.client.post(`${M}/hse/incidents`, { occurredAt: future, kind: 'injury', location: 'Stores', description: 'x' })).status).toBe(400);
    const inc = await created(`${M}/hse/incidents`, { occurredAt: new Date().toISOString(), kind: 'injury', severity: 'major', location: 'Compression room', description: 'Finger caught in punch guard', personInvolved: 'Operator 14', lostDays: 2 });
    await created(`${M}/hse/incidents`, { occurredAt: new Date().toISOString(), kind: 'near_miss', location: 'Stores', description: 'Pallet slipped from forklift' });
    expect(await ok(await a.client.get(`${M}/hse/stats`))).toMatchObject({ incidents: 2, injuries: 1, nearMisses: 1, lostDays: 2, open: 2, daysSinceLostTime: 0 });
    await ok(await a.client.post(`${M}/hse/incidents/${inc.id}/close`, { rootCause: 'Guard interlock bypassed' }));
    expect((await ok(await a.client.get(`${M}/hse/incidents?status=open`))).length).toBe(1);

    const w = await created(`${M}/hse/waste`, { category: '28.1 Process residue', qty: '120.5', unit: 'kg', generatedOn: addDays(today(), -100), storedAt: 'HW shed' });
    let waste = await ok(await a.client.get(`${M}/hse/waste`));
    expect(waste.entries[0].storedTooLong).toBe(true);
    expect(waste.stored).toEqual([{ category: '28.1 Process residue', unit: 'kg', qty: '120.500' }]);
    expect((await a.client.post(`${M}/hse/waste/${w.id}/dispose`, { disposedOn: addDays(today(), -200), disposalAgency: 'TSDF Dundigal' })).status).toBe(400);
    await ok(await a.client.post(`${M}/hse/waste/${w.id}/dispose`, { disposedOn: today(), disposalAgency: 'TSDF Dundigal', manifestNo: 'F10-2210' }));
    waste = await ok(await a.client.get(`${M}/hse/waste`));
    expect(waste.stored).toEqual([]);

    await ok(await a.client.request('PUT', `${M}/hse/epr`, { category: 'plastic_packaging', fiscalYear: '2026-27', targetKg: '5000', achievedKg: '1000' }));
    await ok(await a.client.request('PUT', `${M}/hse/epr`, { category: 'plastic_packaging', fiscalYear: '2026-27', targetKg: '5000', achievedKg: '2500' }));
    expect(await ok(await a.client.get(`${M}/hse/epr`))).toEqual([expect.objectContaining({ achievedKg: '2500.000', pct: '50.0' })]);

    await created(`${M}/hse/licences`, { name: 'Consent to operate (air & water)', kind: 'pollution_cto', authority: 'TSPCB', validUntil: addDays(today(), -5) });
    await created(`${M}/hse/licences`, { name: 'Fire NOC', kind: 'fire_noc', authority: 'Fire Services', validUntil: addDays(today(), 30), renewalLeadDays: 60 });
    await created(`${M}/hse/licences`, { name: 'Drug manufacturing licence', kind: 'drug', authority: 'DCA Telangana', issuedOn: addDays(today(), -10), validUntil: addDays(today(), 1800) });
    expect((await a.client.post(`${M}/hse/licences`, { name: 'Bad', kind: 'trade', authority: 'GHMC', issuedOn: today(), validUntil: addDays(today(), -1) })).status).toBe(400);
    const lic = await ok(await a.client.get(`${M}/hse/licences`));
    expect(lic.map((l: any) => l.state)).toEqual(['expired', 'renew_now', 'valid']);
    expect(await alerts()).toMatchObject({ licencesToRenew: 2, licencesExpired: 1, incidentsOpen: 1 });
  });
});
