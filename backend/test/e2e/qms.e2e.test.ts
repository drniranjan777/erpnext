import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

const OUR_GSTIN = '36AABCS1234E1ZU'; // made up, valid check digit

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let wh: Record<string, string> = {};
const item: Record<string, any> = {};
const res: Record<string, any> = {};
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
const Q = '/quality';

/** PO + GRN into MAIN; returns the inspection raised for the lot, if any. */
async function receive(vendorId: string, itemId: string, qty: string, batchNo: string) {
  const po = await created('/purchase/orders', { vendorId, lines: [{ itemId, qty, rate: '80' }] });
  const approved = await ok(await a.client.post(`/purchase/orders/${po.id}/submit`, { version: po.version }));
  const grn = await created('/purchase/receipts', { poId: approved.id, warehouseId: wh.MAIN, lines: [{ poLineId: approved.lines[0].id, receivedQty: qty, batchNo }] });
  await ok(await a.client.post(`/purchase/receipts/${grn.id}/submit`, { version: grn.version }));
  const list = await ok(await a.client.get(`${Q}/inspections?itemId=${itemId}&q=${batchNo}`));
  const row = list.items.find((r: any) => r.batchNo === batchNo);
  return row ? ok(await a.client.get(`${Q}/inspections/${row.id}`)) : null;
}
async function issue(itemId: string, batchNo: string, qty: string) {
  const se = await created('/inventory/stock-entries', { purpose: 'material_issue', fromWarehouseId: wh.MAIN, lines: [{ itemId, qty, batchNo }] });
  return a.client.post(`/inventory/stock-entries/${se.id}/submit`, { version: se.version });
}
async function decide(qi: any, accepted: string, rejected = '0') {
  return ok(await a.client.post(`${Q}/inspections/${qi.id}/submit`, { version: qi.version, acceptedQty: accepted, rejectedQty: rejected, releaseWarehouseId: wh.MAIN, rejectWarehouseId: Number(rejected) ? wh.REJ : null }));
}

beforeAll(async () => {
  a = await signupWorkspace('qms-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  wh.REJ = (await created('/inventory/warehouses', { code: 'REJ', name: 'Rejected', type: 'rejected', isNettable: false })).id;
  item.resin = await created('/masters/items', { name: 'Epoxy resin', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39073010', trackBatch: true });
  item.cap = await created('/masters/items', { name: 'Bottle cap', type: 'packing_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39235010', trackBatch: true });
  const vendor = (name: string) => created('/masters/parties', { name, isVendor: true, gstRegistrationType: 'unregistered', addresses: [{ type: 'both', line1: 'Road 2', city: 'Hyderabad', stateCode: '36', pincode: '500037', isDefault: true }] });
  res.vA = await vendor('Resin Corp');
  res.vB = await vendor('Polymer Works');
  const visc = (lo: string, hi: string) => [{ name: 'Viscosity', kind: 'numeric', unit: 'cP', lowerLimit: lo, upperLimit: hi }];
  await created(`${Q}/plans`, { code: 'RES-IN', name: 'Resin incoming', itemId: item.resin.id, stage: 'incoming', sampling: 'fixed', fixedSampleSize: 2, parameters: visc('100', '200') });
  await created(`${Q}/plans`, { code: 'RES-IN-B', name: 'Resin: Polymer Works spec', itemId: item.resin.id, stage: 'incoming', partyId: res.vB.id, sampling: 'fixed', fixedSampleSize: 3, parameters: visc('120', '180') });
  await created(`${Q}/plans`, { code: 'CAP-IN', name: 'Caps incoming', itemId: item.cap.id, stage: 'incoming', sampling: 'fixed', fixedSampleSize: 1, skipLotAfter: 2, skipEvery: 3, parameters: [{ name: 'Visual', kind: 'attribute' }] });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('lot status', () => {
  it('holds a received lot until QC releases it', async () => {
    const qi = await receive(res.vA.id, item.resin.id, '100', 'R-1');
    expect(qi).toMatchObject({ plan: { code: 'RES-IN' }, sampleSize: 2, party: null, lot: { qcStatus: 'quarantine' } });
    const blocked = await issue(item.resin.id, 'R-1', '5');
    expect(blocked.status).toBe(400);
    expect(blocked.body.detail).toMatch(/quarantine/);
    // Moving it to another store is allowed.
    const store = (await created('/inventory/warehouses', { code: 'QA', name: 'QA lab', type: 'store' })).id;
    const tr = await created('/inventory/stock-entries', { purpose: 'transfer', fromWarehouseId: wh.MAIN, toWarehouseId: store, lines: [{ itemId: item.resin.id, qty: '1', batchNo: 'R-1' }] });
    await ok(await a.client.post(`/inventory/stock-entries/${tr.id}/submit`, { version: tr.version }));

    const param = qi.parameters[0].id;
    let v = await ok(await a.client.request('PUT', `${Q}/inspections/${qi.id}/readings`, { readings: [1, 2].map((n) => ({ parameterId: param, sampleNo: n, value: '150' })) }));
    expect(v.lot.qcStatus).toBe('under_test');
    v = await ok(await a.client.request('PUT', `${Q}/inspections/${qi.id}/coa`, { vendorCoaRef: 'COA-778', coaVerified: true }));
    expect(v).toMatchObject({ vendorCoaRef: 'COA-778', coaVerified: true });
    // The lot is 99 in MAIN now; release what is there.
    const fresh = await ok(await a.client.get(`${Q}/inspections/${qi.id}`));
    const d = await ok(await a.client.post(`${Q}/inspections/${qi.id}/submit`, { version: fresh.version, acceptedQty: '100', rejectedQty: '0', releaseWarehouseId: wh.MAIN }));
    expect(d).toMatchObject({ status: 'approved', result: 'accepted', lot: { qcStatus: 'released' } });
    await ok(await issue(item.resin.id, 'R-1', '5'));
  });

  it('uses the vendor’s own specification and rejects the lot', async () => {
    const qi = await receive(res.vB.id, item.resin.id, '50', 'R-2');
    expect(qi).toMatchObject({ plan: { code: 'RES-IN-B' }, sampleSize: 3, party: { id: res.vB.id } });
    const v = await ok(await a.client.request('PUT', `${Q}/inspections/${qi.id}/readings`, { readings: [1, 2, 3].map((n) => ({ parameterId: qi.parameters[0].id, sampleNo: n, value: '190' })) }));
    expect(v.suggestion).toBe('reject');
    const d = await decide(v, '0', '50');
    expect(d).toMatchObject({ result: 'rejected', lot: { qcStatus: 'rejected' } });
    ctx.qiR2 = d;
  });

  it('changes a lot’s status only under an electronic signature', async () => {
    const bad = await a.client.post(`${Q}/lots/status`, { itemId: item.resin.id, batchNo: 'R-2', status: 'conditional', reason: 'Usable for the primer grade', password: 'wrong-password' });
    expect(bad.status).toBe(403);
    const r = await ok(await a.client.post(`${Q}/lots/status`, { itemId: item.resin.id, batchNo: 'R-2', status: 'conditional', reason: 'Usable for the primer grade', password: a.password }));
    expect(r).toMatchObject({ status: 'conditional', signature: { meaning: 'Conditional release', signedBy: 'Owner qms-a' } });
    const sigs = await ok(await a.client.get(`${Q}/signatures/${r.id}`));
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ reason: 'Usable for the primer grade', payload: { from: 'rejected', to: 'conditional' } });
    const held = await ok(await a.client.get(`${Q}/lots?status=conditional`));
    expect(held.items.map((l: any) => l.batchNo)).toEqual(['R-2']);
  });

  it('skips lots after a run of accepted ones, inspecting one in three', async () => {
    const results: boolean[] = [];
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const qi = await receive(res.vA.id, item.cap.id, '1000', `C-${n}`);
      results.push(!!qi);
      if (qi) {
        const v = await ok(await a.client.request('PUT', `${Q}/inspections/${qi.id}/readings`, { readings: [{ parameterId: qi.parameters[0].id, sampleNo: 1, passed: true }] }));
        await decide(v, '1000');
      }
    }
    // Two accepted lots qualify; then two are skipped and the third inspected, and so on.
    expect(results).toEqual([true, true, false, false, true, false]);
    expect((await ok(await a.client.get(`${Q}/lots?itemId=${item.cap.id}&status=released`))).total).toBe(6);
  });
});

describe('non-conformance', () => {
  it('raises an NCR from the rejected lot and costs the MRB decision', async () => {
    let n = await created(`${Q}/ncrs/from-inspection/${ctx.qiR2.id}`, {});
    expect(n).toMatchObject({ status: 'draft', source: 'incoming', qtyAffected: '50.0000', returnQty: '50.0000', party: { id: res.vB.id }, inspection: { id: ctx.qiR2.id } });
    const body = { source: 'incoming', severity: 'major', itemId: item.resin.id, batchNo: 'R-2', qtyAffected: '50', defectCategory: 'Viscosity high', description: 'Three of three samples above 180 cP', partyId: res.vB.id, inspectionId: ctx.qiR2.id };
    const over = await a.client.request('PUT', `${Q}/ncrs/${n.id}`, { ...body, version: n.version, returnQty: '30', scrapQty: '25' });
    expect(over.status).toBe(400);
    n = await ok(await a.client.request('PUT', `${Q}/ncrs/${n.id}`, { ...body, version: n.version, returnQty: '30', scrapQty: '10', sortingCost: '500', recovered: '200' }));
    const short = await a.client.post(`${Q}/ncrs/${n.id}/submit`, { version: n.version });
    expect(short.status).toBe(400);
    expect(short.body.detail).toMatch(/must cover the 50/);
    n = await ok(await a.client.request('PUT', `${Q}/ncrs/${n.id}`, { ...body, version: n.version, returnQty: '30', scrapQty: '20', sortingCost: '500', recovered: '200' }));
    n = await ok(await a.client.post(`${Q}/ncrs/${n.id}/submit`, { version: n.version }));
    // Scrap 20 kg at the ₹80 valuation = 1,600; + sorting 500 − recovered 200.
    expect(n).toMatchObject({ status: 'approved', scrapCost: '1600.00', copq: '1900.00', canClose: true });
    n = await ok(await a.client.post(`${Q}/ncrs/${n.id}/close`, { version: n.version }));
    expect(n.closedAt).toBeTruthy();
    expect((await a.client.post(`${Q}/ncrs/${n.id}/close`, { version: n.version })).status).toBe(409);
    const qi = await ok(await a.client.get(`${Q}/inspections/${ctx.qiR2.id}`));
    expect(qi.ncrs.map((x: any) => x.id)).toEqual([n.id]);

    const copq = await ok(await a.client.get(`${Q}/copq?from=${addDays(today(), -30)}&to=${today()}`));
    expect(copq.totals).toMatchObject({ count: 1, copq: '1900.00', scrap: '1600.00', recovered: '200.00' });
    expect(copq.byParty[0]).toMatchObject({ key: 'Polymer Works', copq: '1900.00' });
    expect(copq.byCategory[0].key).toBe('Viscosity high');
  });

  it('refuses an NCR for an inspection with nothing rejected', async () => {
    const list = await ok(await a.client.get(`${Q}/inspections?itemId=${item.resin.id}&q=R-1`));
    expect((await a.client.post(`${Q}/ncrs/from-inspection/${list.items[0].id}`, {})).status).toBe(409);
  });
});

describe('retain samples', () => {
  it('keeps samples and lists the ones due for disposal', async () => {
    const r = await created(`${Q}/retain-samples`, { itemId: item.resin.id, batchNo: 'r-1', qty: '0.5', location: 'Retain cabinet A, shelf 2', drawnOn: addDays(today(), -400), retainUntil: addDays(today(), -35) });
    expect(r.batchNo).toBe('R-1');
    await created(`${Q}/retain-samples`, { itemId: item.resin.id, batchNo: 'R-2', qty: '0.5', location: 'Retain cabinet A, shelf 2', retainUntil: addDays(today(), 365) });
    expect((await a.client.post(`${Q}/retain-samples`, { itemId: item.resin.id, batchNo: 'R-3', qty: '1', location: 'X', retainUntil: today() })).status).toBe(400);
    const due = await ok(await a.client.get(`${Q}/retain-samples?due=true`));
    expect(due.map((x: any) => x.batchNo)).toEqual(['R-1']);
    await ok(await a.client.post(`${Q}/retain-samples/${r.id}/dispose`, {}));
    expect(await ok(await a.client.get(`${Q}/retain-samples?due=true`))).toEqual([]);
    expect((await a.client.post(`${Q}/retain-samples/${r.id}/dispose`, {})).status).toBe(409);
  });
});
