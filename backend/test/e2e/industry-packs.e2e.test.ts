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
const day = (n: number) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const sections = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [String(i + 1), `Section ${i + 1} text`]));

beforeAll(async () => {
  a = await signupWorkspace('packs-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  const mk = (name: string, type: string, extra: Record<string, unknown> = {}) => a.client.post('/masters/items', { name, type, baseUomId: uom.KG, gstRate: 18, hsnCode: '29022000', ...extra });
  ctx.toluene = await ok(await mk('Toluene', 'raw_material'), 201);
  ctx.peroxide = await ok(await mk('Hydrogen peroxide 50 %', 'raw_material'), 201);
  ctx.board = await ok(await mk('Controller board', 'finished_good', { hsnCode: '85371000' }), 201);
  ctx.cap = await ok(await mk('Tantalum capacitor', 'raw_material', { hsnCode: '85322100' }), 201);
  ctx.solder = await ok(await mk('Solder wire', 'raw_material', { hsnCode: '80030010' }), 201);
  const wc = await ok(await a.client.post('/manufacturing/work-centers', { code: 'SMT', name: 'SMT line' }), 201);
  const bom = await ok(await a.client.post('/manufacturing/boms', { itemId: ctx.board.id, quantity: '1', lines: [ctx.cap, ctx.solder].map((l: any) => ({ itemId: l.id, qty: '0.01' })), operations: [{ seq: 10, name: 'Place', workCenterId: wc.id, runMinutes: '1' }] }), 201);
  await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: bom.version }));
  ctx.wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'MAIN');
  const e = await ok(
    await a.client.post('/inventory/stock-entries', {
      purpose: 'opening_stock',
      toWarehouseId: ctx.wh.id,
      lines: [
        { itemId: ctx.toluene.id, qty: '6000', rate: '90' },
        { itemId: ctx.peroxide.id, qty: '400', rate: '60' },
      ],
    }),
    201,
  );
  await ok(await a.client.post(`/inventory/stock-entries/${e.id}/submit`, { version: e.version }));
  ctx.cust = await ok(await a.client.post('/masters/parties', { name: 'Deccan Paints', isCustomer: true, gstin: '36AABCD1234E1Z9', addresses: [{ type: 'both', line1: 'Patancheru', city: 'Hyderabad', stateCode: '36', pincode: '502319', isDefault: true }] }), 201);
  ctx.buyer = await ok(await a.client.post('/masters/parties', { name: 'Nordic Apparel AB', isCustomer: true, gstRegistrationType: 'overseas' }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('chemical HSE', () => {
  it('authors, issues and distributes an SDS, and prints the GHS label', async () => {
    const bad = await a.client.post('/hse/sds', { itemId: ctx.toluene.id, hazardStatements: ['H999'] });
    expect(bad.status).toBe(400);
    let s = await ok(await a.client.post('/hse/sds', { itemId: ctx.toluene.id, sections: { 1: 'Toluene' }, hazardStatements: ['H225', 'H304', 'H315', 'H336', 'H361', 'H373'], precautionaryStatements: ['P210', 'P301+P310', 'P331'], hazardClass: '3', unNumber: 'UN1294', packingGroup: 'II', flashPointC: 4 }));
    expect(s).toMatchObject({ version: 1, status: 'draft', petroleumClass: 'A', ghs: { pictograms: ['GHS02', 'GHS07', 'GHS08'], signalWord: 'Danger' } });
    expect(s.problems[0]).toContain('sections 2, 3');
    expect((await a.client.post(`/hse/sds/${s.id}/issue`, {})).status).toBe(409);
    s = await ok(await a.client.post('/hse/sds', { itemId: ctx.toluene.id, sections, hazardStatements: ['H225', 'H304', 'H315', 'H336', 'H361', 'H373'], precautionaryStatements: ['P210', 'P301+P310', 'P331'], hazardClass: '3', unNumber: 'UN1294', packingGroup: 'II', flashPointC: 4 }));
    expect(s.version).toBe(1);
    s = await ok(await a.client.post(`/hse/sds/${s.id}/issue`, {}));
    expect(s.status).toBe('issued');
    ctx.sds = s;
    // A customer who received toluene needs the current SDS.
    const inv = await ok(await a.client.post('/sales/invoices', { customerId: ctx.cust.id, warehouseId: ctx.wh.id, lines: [{ itemId: ctx.toluene.id, qty: '1000', rate: '110' }] }), 201);
    await ok(await a.client.post(`/sales/invoices/${inv.id}/submit`, { version: inv.version }));
    s = await ok(await a.client.get(`/hse/sds/${s.id}`));
    expect(s.needsCurrent.map((n: any) => n.party)).toEqual(['Deccan Paints']);
    s = await ok(await a.client.post(`/hse/sds/${s.id}/send`, { partyIds: [ctx.cust.id] }));
    expect(s.needsCurrent).toEqual([]);
    expect(s.sent).toHaveLength(1);
    // Editing an issued SDS starts version 2; the customer then needs it again once issued.
    const v2 = await ok(await a.client.post('/hse/sds', { itemId: ctx.toluene.id, sections: { ...sections, 8: 'TWA 50 ppm' }, hazardStatements: ['H225', 'H304', 'H315', 'H336', 'H361', 'H373'], precautionaryStatements: ['P210'], hazardClass: '3', unNumber: 'UN1294', packingGroup: 'II', flashPointC: 4 }));
    expect(v2.version).toBe(2);
    const issued2 = await ok(await a.client.post(`/hse/sds/${v2.id}/issue`, {}));
    expect(issued2.needsCurrent.map((n: any) => n.lastSent)).toEqual([1]);
    expect((await ok(await a.client.get(`/hse/sds/${ctx.sds.id}`))).status).toBe('superseded');
    const label = await ok(await a.client.get(`/hse/labels/${ctx.toluene.id}`));
    expect(label).toMatchObject({ signalWord: 'Danger', unNumber: 'UN1294', sdsVersion: 2 });
    expect(label.hazard[0]).toEqual({ code: 'H225', text: 'Highly flammable liquid and vapour' });
  });

  it('checks hazardous stock against storage limits and incompatibilities', async () => {
    const sds = await ok(await a.client.post('/hse/sds', { itemId: ctx.peroxide.id, sections, hazardStatements: ['H271', 'H302', 'H314'], hazardClass: '5.1', unNumber: 'UN2014', packingGroup: 'II' }));
    await ok(await a.client.post(`/hse/sds/${sds.id}/issue`, {}));
    await ok(await a.client.post('/hse/storage/limits', { warehouseId: ctx.wh.id, hazardClass: 'petroleum_a', maxKg: 4000, note: 'PESO Form XIV licence' }));
    await ok(await a.client.post('/hse/storage/limits', { warehouseId: ctx.wh.id, hazardClass: '5', maxKg: 1000 }));
    const st = await ok(await a.client.get('/hse/storage'));
    const pet = st.usage.find((u: any) => u.hazardClass === 'petroleum_a');
    expect(pet).toMatchObject({ kg: 5000, breach: true, pct: 125 });
    expect(st.usage.find((u: any) => u.hazardClass === '5')).toMatchObject({ kg: 400, breach: false });
    expect(st.clashes).toHaveLength(1);
  });

  it('runs a hot-work permit through checklist, signed approval, gas test and closure', async () => {
    const from = new Date(Date.now() - 30 * 60_000).toISOString();
    const to = new Date(Date.now() + 4 * 3600_000).toISOString();
    let p = await ok(await a.client.post('/hse/permits', { type: 'hot_work', location: 'Tank farm T-3', description: 'Weld a support bracket on the tank T-3 pipe rack', workers: 2, validFrom: from, validTo: to }), 201);
    expect(p.number).toMatch(/^PTW-HW-\d{5}$/);
    expect(p.problems.approve[0]).toContain('checklist item(s) not confirmed');
    const line = await ok(await a.client.post('/hse/permits', { type: 'line_break', location: 'tank farm t-3', description: 'Open the T-3 outlet flange', validFrom: from, validTo: to }), 201);
    p = await ok(await a.client.post(`/hse/permits/${p.id}/checklist`, { done: p.checklist.map((c: any) => c.key) }));
    expect(p.conflicts).toEqual([`${line.number} (line break) at the same place and time`]);
    expect((await a.client.post(`/hse/permits/${p.id}/approve`, { password: a.password })).status).toBe(409);
    await ok(await a.client.post(`/hse/permits/${line.id}/close`, { note: 'Rescheduled after the hot work', cancel: true }));
    expect((await a.client.post(`/hse/permits/${p.id}/approve`, { password: 'wrong-password' })).status).toBe(403);
    p = await ok(await a.client.post(`/hse/permits/${p.id}/approve`, { password: a.password }));
    expect(p.status).toBe('approved');
    expect(p.approval.signerName).toBeTruthy();
    expect((await a.client.post(`/hse/permits/${p.id}/activate`, {})).status).toBe(409);
    const failed = await ok(await a.client.post(`/hse/permits/${p.id}/gas-tests`, { o2Pct: 20.9, lelPct: 3, h2sPpm: 0, coPpm: 0 }));
    expect(failed.testIssues).toHaveLength(1);
    expect((await a.client.post(`/hse/permits/${p.id}/activate`, {})).status).toBe(409);
    await ok(await a.client.post(`/hse/permits/${p.id}/gas-tests`, { o2Pct: 20.9, lelPct: 0, h2sPpm: 0, coPpm: 0 }));
    p = await ok(await a.client.post(`/hse/permits/${p.id}/activate`, {}));
    expect(p.status).toBe('active');
    // A failed re-test stops the work.
    p = await ok(await a.client.post(`/hse/permits/${p.id}/gas-tests`, { o2Pct: 20.9, lelPct: 1, h2sPpm: 0, coPpm: 0 }));
    expect(p.status).toBe('approved');
    await ok(await a.client.post(`/hse/permits/${p.id}/gas-tests`, { o2Pct: 20.9, lelPct: 0, h2sPpm: 0, coPpm: 0 }));
    await ok(await a.client.post(`/hse/permits/${p.id}/activate`, {}));
    p = await ok(await a.client.post(`/hse/permits/${p.id}/close`, { note: 'Work done, area cleared, fire watch completed' }));
    expect(p.status).toBe('closed');
  });
});

describe('textile export', () => {
  it('keeps a tech pack, a buyer order with time and action, samples and certificates', async () => {
    const measurements = [
      { code: 'A', description: 'Chest width', tolerance: 1, sizes: { S: 50, M: 52, L: 54 } },
      { code: 'B', description: 'Body length', tolerance: 1, sizes: { S: 70, M: 72, L: 74 } },
    ];
    let t = await ok(await a.client.post('/textile/tech-packs', { styleNo: 'NA-TEE-01', buyerId: ctx.buyer.id, season: 'SS27', description: 'Organic cotton crew-neck tee', sizes: ['S', 'M', 'L'], colours: ['Navy', 'White'], materials: [{ component: 'Body', description: 'Single jersey 160 GSM organic cotton', consumption: 0.22, unit: 'kg' }], measurements, requiredCertificates: ['gots'] }));
    t = await ok(await a.client.post(`/textile/tech-packs/${t.id}/approve`, {}));
    expect(t).toMatchObject({ status: 'approved', version: 1 });
    t = await ok(await a.client.post('/textile/tech-packs', { styleNo: 'na-tee-01', buyerId: ctx.buyer.id, description: 'Organic cotton crew-neck tee', sizes: ['S', 'M', 'L'], colours: ['Navy', 'White'], measurements, requiredCertificates: ['gots'] }));
    expect(t).toMatchObject({ status: 'draft', version: 2 });
    await ok(await a.client.post(`/textile/tech-packs/${t.id}/approve`, {}));
    const bad = await a.client.post('/textile/orders', { buyerId: ctx.buyer.id, poNo: 'PO-1', techPackId: t.id, breakdown: { Navy: { XL: 10 } }, price: 4.2, poDate: day(-20), exFactory: day(70) });
    expect(bad.status).toBe(409);
    let o = await ok(await a.client.post('/textile/orders', { buyerId: ctx.buyer.id, poNo: 'NA-4711', techPackId: t.id, breakdown: { Navy: { S: 300, M: 600, L: 300 }, White: { M: 400 } }, price: 4.2, currency: 'USD', poDate: day(-20), exFactory: day(70), incoterm: 'FOB' }), 201);
    expect(o.totals.total).toBe(1600);
    expect(o.value).toBe(6720);
    expect(o.missingCertificates).toEqual(['gots']);
    const labDip = o.tna.find((m: any) => m.key === 'lab_dip');
    expect(labDip).toMatchObject({ due: day(-5), state: 'late' });
    // Samples: a fit sample out of tolerance is rejected, the second round approved.
    const s1 = await ok(await a.client.post('/textile/samples', { techPackId: t.id, type: 'fit', size: 'M', sentOn: day(-6), measured: { A: 52.5, B: 70 } }), 201);
    const fit1 = s1.samples.find((x: any) => x.type === 'fit');
    expect(fit1.check.outOfTolerance).toBe(1);
    expect((await a.client.post(`/textile/samples/${fit1.id}/decision`, { status: 'rejected' })).status).toBe(409);
    await ok(await a.client.post(`/textile/samples/${fit1.id}/decision`, { status: 'rejected', buyerComments: 'Body length short by 2 cm' }));
    const s2 = await ok(await a.client.post('/textile/samples', { techPackId: t.id, type: 'lab_dip', colour: 'Navy', sentOn: day(-8) }), 201);
    await ok(await a.client.post(`/textile/samples/${s2.samples.find((x: any) => x.type === 'lab_dip').id}/decision`, { status: 'approved', decidedOn: day(-3) }));
    await ok(await a.client.post('/compliance/certificates', { subjectType: 'company', type: 'gots', number: 'CU-GOTS-1234', issuer: 'Control Union', validUntil: day(400) }), 201);
    o = await ok(await a.client.post(`/textile/orders/${o.id}/milestones`, { key: 'fabric_booked', date: day(-1) }));
    expect(o.tna.find((m: any) => m.key === 'lab_dip')).toMatchObject({ state: 'done_late', daysLate: 2 });
    expect(o.missingCertificates).toEqual([]);
    const list = await ok(await a.client.get('/textile/orders'));
    expect(list[0]).toMatchObject({ poNo: 'NA-4711', qty: 1600 });
  });

  it('records social audits with their corrective action plan', async () => {
    await ok(await a.client.post('/textile/audits', { standard: 'BSCI', auditedOn: day(-300), auditor: 'SGS', rating: 'C', majorFindings: 2, validUntil: day(30), capDueOn: day(-10) }), 201);
    const [r] = await ok(await a.client.get('/textile/audits'));
    expect(r).toMatchObject({ state: 'expiring', capOverdue: true, capStatus: 'open' });
    await ok(await a.client.post(`/textile/audits/${r.id}/close-cap`, {}));
    expect((await ok(await a.client.get('/textile/audits')))[0].capOverdue).toBe(false);
  });
});

describe('sustainability and materials', () => {
  it('rolls part declarations up the BOM and checks BIS', async () => {
    await ok(await a.client.post('/compliance/materials', { itemId: ctx.cap.id, rohs: 'compliant', uses3tg: true, smelters: [{ metal: 'tantalum', name: 'Conformant Ta smelter', smelterId: 'CID000211', conformant: true }] }));
    await ok(await a.client.post('/compliance/materials', { itemId: ctx.solder.id, rohs: 'exempt', rohsExemptions: ['7(a)'], svhc: [{ substance: 'Lead', cas: '7439-92-1', pct: 0.3 }], uses3tg: true, smelters: [{ metal: 'tin', name: 'Unverified tin smelter', conformant: false }] }));
    await ok(await a.client.post('/compliance/materials', { itemId: ctx.board.id, rohs: 'compliant', bisRequired: true }));
    let m = await ok(await a.client.get('/compliance/materials'));
    const board = m.find((x: any) => x.itemId === ctx.board.id);
    expect(board).toMatchObject({ isAssembly: true, rohs: 'exempt', reachArticle33: true, uses3tg: true, bisMissing: true });
    expect(board.nonConformantSmelters).toEqual([{ part: expect.stringContaining('Solder wire'), metal: 'tin', name: 'Unverified tin smelter' }]);
    await ok(await a.client.post('/compliance/certificates', { subjectType: 'item', subjectId: ctx.board.id, type: 'bis', number: 'R-41001234', issuer: 'BIS', validUntil: day(700) }), 201);
    m = await ok(await a.client.get('/compliance/materials'));
    expect(m.find((x: any) => x.itemId === ctx.board.id)).toMatchObject({ bisMissing: false, bisRegistration: 'R-41001234' });
  });

  it('computes the footprint, EPR progress and BRSR-lite', async () => {
    const factors = await ok(await a.client.get('/esg/factors'));
    expect(factors.find((f: any) => f.key === 'grid_kwh')).toMatchObject({ scope: 2, kgCo2ePerUnit: 0.716 });
    const fyNow = (() => {
      const [y, mo] = day(0).split('-').map(Number);
      const s = mo >= 4 ? y : y - 1;
      return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
    })();
    const month = `${fyNow.slice(0, 4)}-05`;
    await ok(await a.client.post('/esg/entries', { period: month, factorKey: 'diesel_l', quantity: 1000, site: 'Plant 1' }), 201);
    await ok(await a.client.post('/esg/entries', { period: month, factorKey: 'grid_kwh', quantity: 100000 }), 201);
    await ok(await a.client.post('/esg/sync', { period: month }));
    const fp = await ok(await a.client.get(`/esg/footprint?fiscalYear=${fyNow}`));
    expect([fp.scope1, fp.scope2]).toEqual([2.68, 71.6]);
    expect(fp.energy.totalGj).toBe(398.6);
    await ok(await a.client.request('PUT', '/qms/hse/epr', { category: 'plastic_packaging', fiscalYear: fyNow, targetKg: '10000', achievedKg: '0' }));
    await ok(await a.client.post('/esg/epr/certificates', { category: 'plastic_packaging', fiscalYear: fyNow, subCategory: 'Category II', number: 'EPR-PWM-0001', issuerName: 'Telangana Recyclers', qtyKg: 6000, issuedOn: day(0) }), 201);
    expect((await a.client.post('/esg/epr/certificates', { category: 'plastic_packaging', fiscalYear: fyNow, number: 'EPR-PWM-0001', qtyKg: 10, issuedOn: day(0) })).status).toBe(409);
    const epr = await ok(await a.client.get('/esg/epr'));
    expect(epr.status[0]).toMatchObject({ certifiedKg: 6000, shortfallKg: 4000, pct: 60 });
    expect((await ok(await a.client.get('/qms/hse/epr')))[0].achievedKg).toBe('6000.000');
    await ok(await a.client.post('/esg/metrics', { fiscalYear: fyNow, values: { water_withdrawal_kl: 12000, water_consumption_kl: 9000, person_hours: 400000 } }));
    const b = await ok(await a.client.get(`/esg/brsr?fiscalYear=${fyNow}`));
    expect(b.sections.emissions).toMatchObject({ scope1: 2.68, scope2: 71.6 });
    expect(b.sections.water.withdrawalKl).toBe(12000);
    expect(b.sections.safety).toMatchObject({ personHours: 400000, personHoursEstimated: false, ltifr: 0 });
    expect(b.sections.epr[0].pct).toBe(60);
    expect(b.turnover).toBeGreaterThan(0);
  });
});
