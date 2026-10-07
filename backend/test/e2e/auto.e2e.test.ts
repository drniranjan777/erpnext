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
const ist = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  a = await signupWorkspace('auto-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.bracket = await ok(await a.client.post('/masters/items', { name: 'Mounting bracket LH', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '87089900', sellingRate: '42.5' }), 201);
  ctx.oem = await ok(await a.client.post('/masters/parties', { name: 'Deccan Motors', isCustomer: true, gstin: '27AAACN0000A1ZL', addresses: [{ type: 'both', line1: 'MIDC Chakan', city: 'Pune', stateCode: '27', pincode: '410501', isDefault: true }] }), 201);
  const wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'MAIN').id;
  const e = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh, lines: [{ itemId: ctx.bracket.id, qty: '5000', rate: '30' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${e.id}/submit`, { version: e.version }));
  ctx.wh = wh;
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('APQP', () => {
  it('passes phase gates in order once the deliverables are done', async () => {
    const p = await ok(await a.client.post('/auto/apqp', { code: 'APQP-26-01', name: 'LH bracket for the new SUV', customerId: ctx.oem.id, itemId: ctx.bracket.id, customerPartNo: 'BRKT-101', program: 'SUV-X', sopDate: plusDays(180) }), 201);
    expect(p.deliverables).toHaveLength(24);
    ctx.apqp = p;
    expect((await a.client.post(`/auto/apqp/${p.id}/gates`, { phase: 2, password: a.password })).status).toBe(409);
    const early = await a.client.post(`/auto/apqp/${p.id}/gates`, { phase: 1, password: a.password });
    expect(early.status).toBe(409);
    expect(early.body.detail).toBe('Phase 1 has 5 deliverable(s) open');
    for (const d of p.deliverables.filter((x: any) => x.phase === 1)) await ok(await a.client.post(`/auto/apqp/${p.id}/deliverables`, { code: d.code, status: d.code === 'P1-05' ? 'na' : 'done', owner: 'Anil' }));
    const g = await ok(await a.client.post(`/auto/apqp/${p.id}/gates`, { phase: 1, reason: 'Feasibility signed by the OEM', password: a.password }));
    expect(g.progress[0]).toMatchObject({ pct: 100, ready: true });
    expect(g.gateSignatures).toEqual([expect.objectContaining({ meaning: 'APQP phase 1 gate passed' })]);
    expect((await a.client.post(`/auto/apqp/${p.id}/deliverables`, { code: 'P1-01', status: 'open' })).status).toBe(409);
    expect((await ok(await a.client.get('/auto/apqp')))[0]).toMatchObject({ code: 'APQP-26-01', gatesPassed: 1 });
  });
});

describe('FMEA and control plan', () => {
  it('works out action priority and drafts the control plan from the PFMEA', async () => {
    const f = await ok(
      await a.client.post('/auto/fmeas', {
        code: 'PFMEA-BRKT',
        kind: 'process',
        title: 'Bracket stamping and welding',
        itemId: ctx.bracket.id,
        rows: [
          { step: '20 Pierce holes', failureMode: 'Missing hole', effect: 'Cannot assemble at OEM', severity: 8, special: 'SC', cause: 'Broken punch', prevention: 'Punch life counter', occurrence: 4, detectionControl: 'Go / no-go pin gauge, 1 in 50', detection: 5 },
          { step: '30 Weld nut', failureMode: 'Weak weld', effect: 'Nut spins in assembly', severity: 9, cause: 'Low weld current', prevention: 'Current monitoring', occurrence: 6, detectionControl: 'Torque test, 5 per shift', detection: 6, action: 'Weld current interlock', owner: 'Ravi', newSeverity: 9, newOccurrence: 2, newDetection: 3 },
          { step: '40 Oil and pack', failureMode: 'Light rust spots', effect: 'Cosmetic complaint', severity: 3, cause: 'Oil skipped', occurrence: 3, detection: 4 },
        ],
      }),
      201,
    );
    expect(f.rows.map((r: any) => [r.ap, r.newAp])).toEqual([['M', null], ['H', 'L'], ['L', null]]);
    expect(f.summary).toEqual({ high: 0, medium: 1, low: 2, highWithoutAction: 0 });
    const d = await ok(await a.client.get(`/auto/fmeas/${f.id}/control-plan-draft`));
    expect(d.rows.map((r: any) => [r.step, r.characteristic, r.special])).toEqual([['20 Pierce holes', 'hole', 'SC'], ['30 Weld nut', 'Weak weld', null]]);
    const cp = await ok(await a.client.post('/auto/control-plans', { code: 'CP-BRKT-P', itemId: ctx.bracket.id, fmeaId: f.id, phase: 'production', rows: d.rows.map((r: any) => ({ ...r, specification: 'As drawing', sampleSize: '5', frequency: 'Per hour' })) }), 201);
    expect(cp.rows).toHaveLength(2);
    ctx.fmea = f;
  });
});

describe('PPAP', () => {
  it('needs every submitted element, signs the PSW and records the OEM decision', async () => {
    const s = await ok(await a.client.post('/auto/ppap', { code: 'PPAP-BRKT-01', itemId: ctx.bracket.id, customerId: ctx.oem.id, apqpProjectId: ctx.apqp.id, customerPartNo: 'BRKT-101', drawingRev: 'C', level: 2 }), 201);
    let v = await ok(await a.client.get(`/auto/ppap/${s.id}`));
    expect(v.open.map((e: any) => e.no)).toEqual([1, 2, 9, 10, 12, 13, 14]);
    expect(v.evidence.fmeas).toEqual([expect.objectContaining({ code: 'PFMEA-BRKT' })]);
    expect(v.evidence.controlPlans).toEqual([expect.objectContaining({ code: 'CP-BRKT-P' })]);
    const sub = await a.client.post(`/auto/ppap/${s.id}/submit`, { declaration: 'Parts meet all drawing and specification requirements', password: a.password });
    expect(sub.status).toBe(409);
    expect((await a.client.post(`/auto/ppap/${s.id}/elements`, { no: 18, status: 'complete' })).status).toBe(400);
    expect((await a.client.post(`/auto/ppap/${s.id}/elements`, { no: 3, status: 'complete', requirement: 'S' })).status).toBe(400);
    for (const no of [1, 2, 9, 10, 12, 14]) await ok(await a.client.post(`/auto/ppap/${s.id}/elements`, { no, status: 'complete', reference: `Ref ${no}` }));
    await ok(await a.client.post(`/auto/ppap/${s.id}/elements`, { no: 13, status: 'na', notes: 'Not an appearance item' }));
    v = await ok(await a.client.post(`/auto/ppap/${s.id}/submit`, { declaration: 'Parts meet all drawing and specification requirements', password: a.password }));
    expect(v).toMatchObject({ status: 'submitted', open: [], psw: [expect.objectContaining({ meaning: 'Part submission warrant signed' })] });
    expect(v.elements.find((e: any) => e.no === 18).status).toBe('complete');
    expect((await a.client.post(`/auto/ppap/${s.id}/elements`, { no: 1, status: 'in_progress' })).status).toBe(409);
    v = await ok(await a.client.post(`/auto/ppap/${s.id}/decision`, { decision: 'approved', comments: 'Full approval' }));
    expect(v.status).toBe('approved');
    expect((await ok(await a.client.get('/auto/ppap')))[0]).toMatchObject({ code: 'PPAP-BRKT-01', complete: 8, status: 'approved' });
  });
});

describe('layered process audits and customer-specific requirements', () => {
  it('records audits by layer with their findings', async () => {
    const c = await ok(await a.client.post('/auto/lpa/checklists', { area: 'Press line 2', questions: ['Work instruction at the station and current', 'First-off approved and displayed', 'Red bin for rejects labelled and used'] }), 201);
    expect((await a.client.post('/auto/lpa/audits', { checklistId: c.id, layer: 1, answers: [{ question: c.questions[0], answer: 'yes' }] })).status).toBe(400);
    expect((await a.client.post('/auto/lpa/audits', { checklistId: c.id, layer: 1, answers: c.questions.map((q: string, i: number) => ({ question: q, answer: i === 2 ? 'no' : 'yes' })) })).status).toBe(400);
    const r = await ok(await a.client.post('/auto/lpa/audits', { checklistId: c.id, layer: 1, answers: c.questions.map((q: string, i: number) => ({ question: q, answer: i === 2 ? 'no' : 'yes', note: i === 2 ? 'Red bin unlabelled' : null, fixedOnSpot: i === 2 })) }), 201);
    expect(r).toMatchObject({ findings: 1, compliancePct: 66.7 });
    await ok(await a.client.post('/auto/lpa/audits', { checklistId: c.id, layer: 2, answers: c.questions.map((q: string) => ({ question: q, answer: 'yes' })) }), 201);
    const s = await ok(await a.client.get('/auto/lpa/summary'));
    expect(s.byLayer.map((l: any) => [l.layer, l.audits, l.compliancePct])).toEqual([[1, 1, 66.7], [2, 1, 100], [3, 0, null]]);
    expect(s.findings).toEqual([expect.objectContaining({ area: 'Press line 2', note: 'Red bin unlabelled', fixedOnSpot: true })]);
  });

  it('keeps the customer’s specific requirements with how each is met', async () => {
    expect((await a.client.post('/auto/csr', { customerId: ctx.oem.id, requirement: 'Annual layout inspection of all PPAP parts', status: 'met' })).status).toBe(400);
    await ok(await a.client.post('/auto/csr', { customerId: ctx.oem.id, reference: 'Deccan Motors SQM 4.2', clause: '8.6.2', requirement: 'Annual layout inspection of all PPAP parts', howMet: 'Layout inspection in the control plan, yearly', status: 'met' }), 201);
    expect(await ok(await a.client.get(`/auto/csr?customerId=${ctx.oem.id}`))).toEqual([expect.objectContaining({ status: 'met', customer: 'Deccan Motors' })]);
  });
});

describe('EDI with the OEM', () => {
  const day = (n: number) => plusDays(n).replace(/-/g, '');
  const delfor = (parts: string) => `UNB+UNOC:3+DECCANMOT+SUPPAUTO+261008:0915+88'UNH+1+DELFOR:D:96A:UN'BGM+241+DS-88+5'${parts}UNT+9+1'UNZ+1+88'`;

  it('loads delivery schedules into the customer schedules and sends a DESADV and an INVOIC', async () => {
    await ok(await a.client.post('/auto/edi/partners', { partyId: ctx.oem.id, ourId: 'SUPPAUTO', theirId: 'DECCANMOT', partMap: { 'BRKT-101': ctx.bracket.id } }), 201);
    const bad = await ok(await a.client.post('/auto/edi/receive', { raw: delfor(`LIN+1++BRKT-999:IN'QTY+113:10:PCE'DTM+2:${day(5)}:102'`) }), 201);
    expect(bad).toMatchObject({ status: 'error', error: 'Parts not mapped to items: BRKT-999', schedules: 0 });
    expect((await a.client.post('/auto/edi/receive', { raw: "UNB+UNOC:3+X+Y+261008:0915+1'UNH+1+ORDERS:D:96A:UN'" })).status).toBe(400);
    const good = await ok(await a.client.post('/auto/edi/receive', { raw: delfor(`LIN+1++BRKT-101:IN'SCC+1'QTY+113:300:PCE'DTM+2:${day(5)}:102'QTY+113:200:PCE'DTM+2:${day(6)}:102'`) }), 201);
    expect(good).toMatchObject({ status: 'processed', error: null, schedules: 1, totals: [{ part: 'BRKT-101', itemCode: ctx.bracket.code, firm: 500, forecast: 0 }] });
    const month = plusDays(5).slice(0, 7);
    const sch = await ok(await a.client.get(`/sales/schedules?month=${month}&customerId=${ctx.oem.id}`));
    expect(sch.find((x: any) => x.itemId === ctx.bracket.id || x.item?.id === ctx.bracket.id) ?? sch[0]).toMatchObject({ qty: plusDays(6).slice(0, 7) === month ? 500 : 300 });

    const so = await ok(await a.client.post('/sales/orders', { customerId: ctx.oem.id, lines: [{ itemId: ctx.bracket.id, qty: '300', rate: '42.5' }] }), 201);
    const sos = await ok(await a.client.post(`/sales/orders/${so.id}/submit`, { version: so.version }));
    const dlv = await ok(await a.client.post('/sales/deliveries', { orderId: so.id, warehouseId: ctx.wh, lines: [{ soLineId: sos.lines[0].id, qty: '300' }] }), 201);
    expect((await a.client.post(`/auto/edi/desadv/${dlv.id}`)).status).toBe(409);
    const dl = await ok(await a.client.post(`/sales/deliveries/${dlv.id}/submit`, { version: dlv.version }));
    const desadv = await ok(await a.client.post(`/auto/edi/desadv/${dlv.id}`), 201);
    expect(desadv.raw).toContain(`BGM+351+${dl.number.replace(/\//g, '/')}+9'`);
    expect(desadv.raw).toContain("LIN+1++BRKT-101:IN'");
    expect(desadv.raw).toContain("QTY+12:300:PCE'");
    expect(desadv.raw).toContain(`RFF+ON:${sos.number}'`);

    const inv = await ok(await a.client.post('/sales/invoices', { customerId: ctx.oem.id, warehouseId: ctx.wh, lines: [{ itemId: ctx.bracket.id, qty: '100', rate: '42.5' }] }), 201);
    const invs = await ok(await a.client.post(`/sales/invoices/${inv.id}/submit`, { version: inv.version }));
    const invoic = await ok(await a.client.post(`/auto/edi/invoic/${inv.id}`), 201);
    expect(invoic.raw).toContain(`BGM+380+${invs.number}+9'`);
    expect(invoic.raw).toContain("MOA+125:4250.00'");
    expect(invoic.raw).toContain("TAX+7+VAT+++:::18'");
    const msgs = await ok(await a.client.get('/auto/edi/messages'));
    expect(msgs.map((m: any) => [m.direction, m.type, m.status])).toEqual([['out', 'INVOIC', 'sent'], ['out', 'DESADV', 'sent'], ['in', 'DELFOR', 'processed'], ['in', 'UNKNOWN', 'error'], ['in', 'DELFOR', 'error']]);
  });
});
