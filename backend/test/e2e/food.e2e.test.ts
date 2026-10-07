import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_URL, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const day = (n: number) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  a = await signupWorkspace('food-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  const mk = (name: string, type: string, extra: Record<string, unknown> = {}) => a.client.post('/masters/items', { name, type, baseUomId: uom.KG, gstRate: 5, hsnCode: '19053100', ...extra });
  ctx.biscuit = await ok(await mk('Milk biscuit 100 g', 'finished_good'), 201);
  ctx.rusk = await ok(await mk('Plain rusk 200 g', 'finished_good'), 201);
  ctx.flour = await ok(await mk('Wheat flour', 'raw_material', { trackBatch: true }), 201);
  ctx.cream = await ok(await mk('Milk cream', 'raw_material'), 201);
  const wc = await ok(await a.client.post('/manufacturing/work-centers', { code: 'OVEN', name: 'Tunnel oven' }), 201);
  for (const [item, lines] of [[ctx.biscuit, [ctx.flour, ctx.cream]], [ctx.rusk, [ctx.flour]]] as const) {
    const bom = await ok(await a.client.post('/manufacturing/boms', { itemId: item.id, quantity: '100', lines: lines.map((l: any) => ({ itemId: l.id, qty: '50' })), operations: [{ seq: 10, name: 'Bake', workCenterId: wc.id, runMinutes: '0.1' }] }), 201);
    await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: bom.version }));
  }
  ctx.wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'MAIN').id;
  const e = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: ctx.wh, lines: [{ itemId: ctx.flour.id, qty: '1000', rate: '30', batchNo: 'FL-2610' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${e.id}/submit`, { version: e.version }));
  ctx.cust = await ok(await a.client.post('/masters/parties', { name: 'Hyderabad Bakers', isCustomer: true, gstin: '36AABCD1234E1Z9', addresses: [{ type: 'both', line1: 'Abids', city: 'Hyderabad', stateCode: '36', pincode: '500001', isDefault: true }] }), 201);
  ctx.gw = await ok(await a.client.post('/iot/gateways', { code: 'GW1', name: 'Bakery edge' }), 201);
  ctx.oven = await ok(await a.client.post('/iot/signals', { code: 'OVEN.core', name: 'Product core temperature', gatewayId: ctx.gw.id, purpose: 'temperature', unit: '°C' }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('allergens', () => {
  it('rolls declared allergens up through the BOM and checks changeovers', async () => {
    await ok(await a.client.post('/food/allergens', { itemId: ctx.flour.id, contains: ['gluten'], mayContain: ['soy'] }));
    await ok(await a.client.post('/food/allergens', { itemId: ctx.cream.id, contains: ['milk'] }));
    const m = await ok(await a.client.get('/food/allergens'));
    const biscuit = m.items.find((i: any) => i.id === ctx.biscuit.id);
    expect(biscuit).toMatchObject({ contains: ['gluten', 'milk'], mayContain: ['soy'], statement: 'Contains: Gluten, Milk. May contain: Soybeans.' });
    expect(await ok(await a.client.get(`/food/allergens/changeover?from=${ctx.biscuit.id}&to=${ctx.rusk.id}`))).toEqual({ from: ['gluten', 'milk'], to: ['gluten'], cleanRequired: true, allergensToRemove: ['milk'] });
    expect((await ok(await a.client.get(`/food/allergens/changeover?from=${ctx.rusk.id}&to=${ctx.biscuit.id}`))).cleanRequired).toBe(false);
  });
});

describe('HACCP', () => {
  it('decides CCPs, refuses an incomplete plan, approves it and watches sensor CCPs', async () => {
    const p = await ok(await a.client.post('/food/haccp', { code: 'HACCP-BIS', title: 'Milk biscuit line', itemId: ctx.biscuit.id, team: 'QA, production, maintenance' }), 201);
    const steps = [{ no: 1, name: 'Receiving' }, { no: 2, name: 'Mixing' }, { no: 3, name: 'Baking' }, { no: 4, name: 'Packing' }];
    const hazards = [
      { id: 'h-bake', step: 3, type: 'biological', description: 'Survival of Salmonella from under-baking', severity: 3, likelihood: 2, controls: 'Oven profile', q1: true, q2: true },
      { id: 'h-metal', step: 4, type: 'physical', description: 'Metal fragments from the line', severity: 3, likelihood: 2, controls: 'Metal detector', q1: true, q2: false, q3: true, q4: false },
      { id: 'h-pest', step: 1, type: 'physical', description: 'Insects in flour', severity: 2, likelihood: 1, controls: 'Supplier approval, sieving' },
    ];
    let v = await ok(await a.client.request('PUT', `/food/haccp/${p.id}/analysis`, { steps, hazards, ccps: [] }));
    expect(v.analysis.map((h: any) => [h.id, h.significant, h.ccp])).toEqual([['h-bake', true, true], ['h-metal', true, true], ['h-pest', false, false]]);
    const early = await a.client.post(`/food/haccp/${p.id}/approve`, { password: a.password });
    expect(early.status).toBe(409);
    expect(early.body.detail).toMatch(/is a CCP but has no limits and monitoring/);
    const ccps = [
      { id: 'c-bake', hazardId: 'h-bake', name: 'Core temperature at oven exit', limitMin: 90, unit: '°C', monitoring: 'Probe 3 biscuits', frequency: 'Every 30 min and continuous probe', responsibility: 'Oven operator', correctiveAction: 'Hold the product since the last good check; re-bake or destroy', verification: 'QA reviews records daily; probe calibrated monthly', signalId: ctx.oven.id },
      { id: 'c-metal', hazardId: 'h-metal', name: 'Metal detector test pieces rejected', limitMin: 1, monitoring: 'Pass Fe 2.0, NFe 2.5, SS 3.0 mm test pieces', frequency: 'Start of shift and every hour', responsibility: 'Packing supervisor', correctiveAction: 'Stop, hold product since the last good test, re-inspect', verification: 'QA weekly' },
    ];
    v = await ok(await a.client.request('PUT', `/food/haccp/${p.id}/analysis`, { steps, hazards, ccps }));
    expect(v.problems).toEqual([]);
    v = await ok(await a.client.post(`/food/haccp/${p.id}/approve`, { password: a.password, reason: 'Reviewed by the HACCP team' }));
    expect(v).toMatchObject({ status: 'approved', approval: [expect.objectContaining({ meaning: 'HACCP plan version 1 approved' })] });
    const rules = await ok(await a.client.get(`/iot/rules?signalId=${ctx.oven.id}`));
    expect(rules).toEqual([expect.objectContaining({ name: 'CCP HACCP-BIS: Core temperature at oven exit', op: 'below', threshold: 90, severity: 'critical' })]);

    expect((await a.client.post(`/food/haccp/${p.id}/records`, { ccpId: 'c-bake', value: 86 })).status).toBe(400);
    const bad = await ok(await a.client.post(`/food/haccp/${p.id}/records`, { ccpId: 'c-bake', value: 86, batchNo: 'B-2610', correctiveAction: 'Held 2 trays, re-baked', productHeld: true }), 201);
    expect(bad.ok).toBe(false);
    expect((await ok(await a.client.post(`/food/haccp/${p.id}/records`, { ccpId: 'c-metal', value: 1 }), 201)).ok).toBe(true);
    const now = Date.now();
    await ok(await fetch(`${API_URL}/iot/device/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': ctx.gw.token }, body: JSON.stringify({ batchId: 'oven-1', readings: [94, 93, 88, 87, 95].map((v, i) => ({ s: 'OVEN.core', t: now - (5 - i) * 60_000, v })) }) }).then(async (r) => ({ status: r.status, body: await r.json() })));
    const mon = await ok(await a.client.get(`/food/haccp/${p.id}/monitoring?days=1`));
    expect(mon.records).toHaveLength(2);
    expect(mon.sensors[0]).toMatchObject({ ccpId: 'c-bake', readings: 5, min: 87, max: 95, excursions: 1, minutesOutside: 2 });
    expect((await ok(await a.client.get('/iot/alarms'))).some((x: any) => x.ruleName === 'CCP HACCP-BIS: Core temperature at oven exit')).toBe(true);
    v = await ok(await a.client.request('PUT', `/food/haccp/${p.id}/analysis`, { steps, hazards, ccps }));
    expect(v).toMatchObject({ status: 'draft', version: 2 });
  });
});

describe('recalls and mock recalls', () => {
  it('traces the lot to customers at once and measures the drill', async () => {
    const inv = await ok(await a.client.post('/sales/invoices', { customerId: ctx.cust.id, warehouseId: ctx.wh, lines: [{ itemId: ctx.flour.id, qty: '300', rate: '40', batchNo: 'FL-2610' }] }), 201);
    await ok(await a.client.post(`/sales/invoices/${inv.id}/submit`, { version: inv.version }));
    const r = await ok(await a.client.post('/food/recalls', { code: 'MR-26-01', kind: 'mock', itemId: ctx.flour.id, batchNo: 'FL-2610', reason: 'Annual mock recall drill', recallClass: 'II' }), 201);
    expect(r.trace.customers).toEqual([expect.objectContaining({ party: 'Hyderabad Bakers', qty: 300 })]);
    expect(r.trace.dispatchedQty).toBe(300);
    expect(r.trace.onHand).toEqual([{ warehouse: 'MAIN', qty: 700 }]);
    expect(r.metrics).toMatchObject({ traceMinutes: null, recoveredPct: 0 });
    await ok(await a.client.post(`/food/recalls/${r.id}/trace-done`));
    expect((await a.client.post(`/food/recalls/${r.id}/trace-done`)).status).toBe(409);
    const rec = await ok(await a.client.post(`/food/recalls/${r.id}/recovered`, { party: 'Hyderabad Bakers', qty: 285, note: '15 kg already used' }));
    expect(rec.metrics).toMatchObject({ traceMinutes: 0, recoveredQty: 285, recoveredPct: 95 });
    await ok(await a.client.post(`/food/recalls/${r.id}/close`, { conclusion: 'Traced in minutes; 95 % accounted for' }));
    expect((await a.client.post(`/food/recalls/${r.id}/recovered`, { party: 'X', qty: 1 })).status).toBe(409);
  });
});

describe('labels, FSSAI return and certificates', () => {
  it('builds the label with allergens and %RDA', async () => {
    expect((await a.client.post('/food/labels', { itemId: ctx.biscuit.id, vegMark: 'veg', ingredients: 'Wheat flour, sugar', nutrition: { energyKcal: 480, protein: 7, carbohydrate: 68, totalSugars: 22, addedSugars: 20, totalFat: 20, saturatedFat: 9, transFat: 0.2, sodiumMg: 300 }, fssaiLicenceNo: '123' })).status).toBe(400);
    const l = await ok(await a.client.post('/food/labels', { itemId: ctx.biscuit.id, vegMark: 'veg', ingredients: 'Wheat flour (gluten), sugar, milk cream (milk), edible vegetable oil', nutrition: { energyKcal: 480, protein: 7, carbohydrate: 68, totalSugars: 22, addedSugars: 20, totalFat: 20, saturatedFat: 9, transFat: 0.2, sodiumMg: 300 }, servingSizeG: 25, netQuantity: '100 g', fssaiLicenceNo: '10012345678901' }));
    expect(l.allergenStatement).toBe('Contains: Gluten, Milk. May contain: Soybeans.');
    expect(l.panel.find((r: any) => r.nutrient === 'energyKcal')).toEqual({ nutrient: 'energyKcal', per100: 480, perServe: 120, rdaPct: 6 });
    const r = await ok(await a.client.get(`/food/fssai-return?from=${day(-30)}&to=${day(1)}`));
    expect(r.map((x: any) => x.code)).toEqual([ctx.biscuit.code, ctx.rusk.code].sort());
  });

  it('flags certificates that are expiring or expired', async () => {
    const vendor = await ok(await a.client.post('/masters/parties', { name: 'Golden Mills', isVendor: true, gstin: '36AABCS1234E1ZU', addresses: [{ type: 'both', line1: 'Patancheru', city: 'Hyderabad', stateCode: '36', pincode: '502319', isDefault: true }] }), 201);
    await ok(await a.client.post('/compliance/certificates', { subjectType: 'party', subjectId: vendor.id, type: 'fssc22000', number: 'FSSC-0091', issuer: 'TÜV', validUntil: day(20) }), 201);
    await ok(await a.client.post('/compliance/certificates', { subjectType: 'party', subjectId: vendor.id, type: 'fssai', number: '10019022000123', validUntil: day(-1) }), 201);
    await ok(await a.client.post('/compliance/certificates', { subjectType: 'company', type: 'iso22000', number: 'ISO22K-77', validUntil: day(400) }), 201);
    expect((await a.client.post('/compliance/certificates', { subjectType: 'party', type: 'gots', number: 'X' })).status).toBe(400);
    const list = await ok(await a.client.get('/compliance/certificates'));
    expect(list.map((c: any) => [c.type, c.state, c.subject])).toEqual([['fssai', 'expired', 'Golden Mills'], ['fssc22000', 'expiring', 'Golden Mills'], ['iso22000', 'valid', 'E2E food-a Pvt Ltd']]);
  });
});
