import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let b: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let wh: Record<string, string> = {};
const item: Record<string, any> = {};
const vendor: Record<string, any> = {};

// Made-up GSTINs with valid check digits (not real businesses).
const OUR_GSTIN = '36AABCS1234E1ZU'; // Telangana
const LOCAL_VENDOR = '36AABCD1234E1Z9'; // Telangana
const MH_VENDOR = '27AAACN0000A1ZL'; // Maharashtra

async function submit(path: string, doc: any) {
  const res = await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function qty(itemId: string) {
  const d = (await a.client.get(`/inventory/stock/${itemId}`)).body;
  return d.byWarehouse.find((w: any) => w.warehouseId === wh.MAIN)?.qty ?? '0.0000';
}

beforeAll(async () => {
  a = await signupWorkspace('p2p-a');
  b = await signupWorkspace('p2p-b');
  emails.push(a.email, b.email);
  const company = (await a.client.get('/org/companies')).body[0];
  const upd = await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN });
  expect(upd.status, JSON.stringify(upd.body)).toBe(200);
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  const mk = async (name: string, patch: Record<string, unknown>) => {
    const r = await a.client.post('/masters/items', { name, type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39021000', ...patch });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  item.resin = await mk('PP granules', { purchaseUomId: uom.BAG, conversions: [{ uomId: uom.BAG, factor: '25' }], reorderLevel: '200', reorderQty: '500' });
  item.ink = await mk('Printing ink', { baseUomId: uom.LTR, gstRate: 12, hsnCode: '32151990', trackBatch: true });
  item.service = await mk('Machine calibration', { type: 'service', baseUomId: uom.NOS, hsnCode: '998719' });
  const party = async (name: string, gstin: string | null, extra: Record<string, unknown> = {}) => {
    const r = await a.client.post('/masters/parties', { name, isVendor: true, gstin, gstRegistrationType: gstin ? 'regular' : 'unregistered', creditDays: 45, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  vendor.local = await party('Sharma Polymers', LOCAL_VENDOR);
  vendor.mh = await party('Navkar Inks', MH_VENDOR);
  vendor.unreg = await party('Local Labour Contractor', null, {
    addresses: [{ type: 'both', line1: 'Shop 3, Balanagar', city: 'Hyderabad', stateCode: '36', pincode: '500037', isDefault: true }],
  });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId, b?.tenantId].filter(Boolean), emails);
});

describe('company GSTIN', () => {
  it('can be added after signup and is checked', async () => {
    const c = (await a.client.get('/org/companies')).body[0];
    expect(c).toMatchObject({ gstin: OUR_GSTIN, stateCode: '36', pan: 'AABCS1234E' });
    const bad = await a.client.request('PUT', `/org/companies/${c.id}`, { name: c.name, gstin: '36AABCS1234E1ZX' });
    expect(bad.status).toBe(400);
  });
});

describe('purchase orders', () => {
  let po: any;

  it('previews GST while typing', async () => {
    const res = await a.client.post('/purchase/orders/preview-tax', { vendorId: vendor.mh.id, lines: [{ itemId: item.ink.id, qty: '10', rate: '450' }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.tax).toMatchObject({ interState: true, placeOfSupply: '36', igstTotal: '540.00', grandTotal: '5040.00' });
  });

  it('prices an intra-state order in the purchase unit with discount and CGST/SGST', async () => {
    const res = await a.client.post('/purchase/orders', {
      vendorId: vendor.local.id,
      expectedDate: '2026-10-20',
      tolerancePct: '2',
      vendorQuoteRef: 'Q-2291',
      lines: [{ itemId: item.resin.id, qty: '40', rate: '2968.75', discountPct: '2' }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    po = res.body;
    // 40 BAG × 2968.75 = 118750, less 2% = 116375; CGST 9% + SGST 9% = 20947.50; rounded to the rupee.
    expect(po).toMatchObject({ status: 'draft', interState: false, placeOfSupply: '36', taxableTotal: '116375.00', cgstTotal: '10473.75', sgstTotal: '10473.75', roundOff: '0.50', grandTotal: '137323.00', creditDays: 45 });
    expect(po.lines[0]).toMatchObject({ uomCode: 'BAG', baseQty: '1000.0000', conversionFactor: '25.000000', hsnCode: '39021000', gstRate: '18.00', taxableValue: '116375.00', lineTotal: '137322.50' });
    expect(po.deliveryWarehouse.code).toBe('MAIN');
    expect(po.vendor).toMatchObject({ gstin: LOCAL_VENDOR, stateCode: '36' });
    po = await submit('/purchase/orders', po);
    expect(po.status).toBe('approved');
    expect(po.number).toMatch(/^PO\//);
    expect(po.canReceive).toBe(true);
  });

  it('charges nothing from an unregistered vendor unless reverse charge applies', async () => {
    const plain = (await a.client.post('/purchase/orders', { vendorId: vendor.unreg.id, poType: 'service', lines: [{ itemId: item.service.id, qty: '1', rate: '5000' }] })).body;
    expect(plain).toMatchObject({ taxKind: 'unregistered', taxTotal: '0.00', grandTotal: '5000.00' });
    const rcm = (await a.client.post('/purchase/orders', { vendorId: vendor.unreg.id, poType: 'service', reverseCharge: true, lines: [{ itemId: item.service.id, qty: '1', rate: '5000' }] })).body;
    expect(rcm).toMatchObject({ reverseCharge: true, taxTotal: '0.00', reverseChargeTax: '900.00', grandTotal: '5000.00' });
    expect(rcm.taxNotes.join(' ')).toMatch(/reverse charge/);
  });

  it('validates vendors, units and quantities', async () => {
    const customer = (await a.client.post('/masters/parties', { name: 'Only Customer', isCustomer: true })).body;
    const notVendor = await a.client.post('/purchase/orders', { vendorId: customer.id, lines: [{ itemId: item.resin.id, qty: '1', rate: '1' }] });
    expect(notVendor.body.errors[0].path).toBe('vendorId');
    const badUnit = await a.client.post('/purchase/orders', { vendorId: vendor.local.id, lines: [{ itemId: item.resin.id, uomId: uom.LTR, qty: '1', rate: '1' }] });
    expect(badUnit.body.errors[0].path).toBe('lines.0.uomId');
    const fraction = await a.client.post('/purchase/orders', { vendorId: vendor.local.id, lines: [{ itemId: item.resin.id, qty: '1.5', rate: '1' }] });
    expect(fraction.body.errors[0].path).toBe('lines.0.qty'); // BAG is a whole-number unit
  });

  describe('goods receipts', () => {
    let grn: any;

    it('receives part of the order, rejecting some, within tolerance', async () => {
      const receivable = (await a.client.get(`/purchase/orders/${po.id}/receivable`)).body;
      expect(receivable.lines[0]).toMatchObject({ pendingQty: '40.0000', maxReceivableQty: '40.8000' });
      const res = await a.client.post('/purchase/receipts', {
        poId: po.id,
        supplierInvoiceNo: 'SP/1123',
        supplierInvoiceDate: '2026-10-06',
        vehicleNo: 'ts 09 ea 1234',
        lines: [{ poLineId: po.lines[0].id, receivedQty: '25', rejectedQty: '1', rejectionReason: 'Torn bag' }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      grn = res.body;
      expect(grn).toMatchObject({ vehicleNo: 'TS09EA1234', warehouse: { code: 'MAIN' }, amount: '69825.00' });
      expect(grn.lines[0]).toMatchObject({ acceptedQty: '24.0000', acceptedBaseQty: '600.0000', rate: '2909.3750' });
      grn = await submit('/purchase/receipts', grn);
      expect(grn.number).toMatch(/^GRN\//);
      // Stock comes in at the net PO rate per kg: 2909.375 / 25 = 116.375.
      expect(await qty(item.resin.id)).toBe('600.0000');
      const stock = (await a.client.get(`/inventory/stock/${item.resin.id}`)).body.byWarehouse[0];
      expect(stock).toMatchObject({ value: '69825.00', valuationRate: '116.375000' });
      const after = (await a.client.get(`/purchase/orders/${po.id}`)).body;
      expect(after.lines[0]).toMatchObject({ receivedQty: '24.0000', rejectedQty: '1.0000', pendingQty: '16.0000' });
      expect(after.receipts[0]).toMatchObject({ number: grn.number, status: 'approved' });
      const resin = (await a.client.get(`/masters/items/${item.resin.id}`)).body;
      expect(resin.lastPurchaseRate).toBe('116.3750');
    });

    it('refuses receipts beyond the tolerance', async () => {
      const res = await a.client.post('/purchase/receipts', { poId: po.id, lines: [{ poLineId: po.lines[0].id, receivedQty: '17' }] });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].message).toMatch(/Only 16\.8 more/);
    });

    it('completes the order when everything has arrived, and reopens it if a GRN is cancelled', async () => {
      const last = await submit('/purchase/receipts', (await a.client.post('/purchase/receipts', { poId: po.id, lines: [{ poLineId: po.lines[0].id, receivedQty: '16.8' }] })).body);
      // 16.8 BAG is not whole: the GRN uses the PO's unit as is (tolerance allows it).
      expect(last.status).toBe('approved');
      let order = (await a.client.get(`/purchase/orders/${po.id}`)).body;
      expect(order.status).toBe('completed');
      expect(order.canReceive).toBe(false);

      const cancelled = await a.client.post(`/purchase/receipts/${last.id}/cancel`, { version: last.version, reason: 'Wrong vehicle' });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      order = (await a.client.get(`/purchase/orders/${po.id}`)).body;
      expect(order.status).toBe('approved');
      expect(order.lines[0].receivedQty).toBe('24.0000');
      expect(await qty(item.resin.id)).toBe('600.0000');
    });

    it('requires batches for batch-tracked items and blocks GRNs on unapproved orders', async () => {
      const inkPo = (await a.client.post('/purchase/orders', { vendorId: vendor.mh.id, lines: [{ itemId: item.ink.id, qty: '20', rate: '450' }] })).body;
      const early = await a.client.post('/purchase/receipts', { poId: inkPo.id, lines: [{ poLineId: inkPo.lines[0].id, receivedQty: '20' }] });
      expect(early.body.errors[0].path).toBe('poId');
      const approved = await submit('/purchase/orders', inkPo);
      const noBatch = await a.client.post('/purchase/receipts', { poId: approved.id, lines: [{ poLineId: approved.lines[0].id, receivedQty: '20' }] });
      expect(noBatch.body.errors[0].path).toBe('lines.0.batchNo');
      const ok = await a.client.post('/purchase/receipts', {
        poId: approved.id,
        lines: [
          { poLineId: approved.lines[0].id, receivedQty: '12', batchNo: 'ink-a' },
          { poLineId: approved.lines[0].id, receivedQty: '8', batchNo: 'ink-b' },
        ],
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      await submit('/purchase/receipts', ok.body);
      expect((await a.client.get(`/purchase/orders/${approved.id}`)).body.status).toBe('completed');
      const batches = (await a.client.get(`/inventory/batches?itemId=${item.ink.id}`)).body.map((x: any) => [x.batchNo, x.qty]);
      expect(batches).toEqual(expect.arrayContaining([['INK-A', '12.0000'], ['INK-B', '8.0000']]));
    });
  });

  it('cannot be cancelled once goods arrived, but can be short-closed', async () => {
    const order = (await a.client.get(`/purchase/orders/${po.id}`)).body;
    const cancel = await a.client.post(`/purchase/orders/${po.id}/cancel`, { version: order.version, reason: 'Vendor delay' });
    expect(cancel.status).toBe(409);
    const closed = await a.client.post(`/purchase/orders/${po.id}/short-close`, { version: order.version, reason: 'Vendor cannot supply the rest' });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body).toMatchObject({ status: 'completed', closeReason: 'Vendor cannot supply the rest', canReceive: false });
    const grn = await a.client.post('/purchase/receipts', { poId: po.id, lines: [{ poLineId: po.lines[0].id, receivedQty: '1' }] });
    expect(grn.status).toBe(400);
  });

  it('amends an approved order, keeping receipts linked', async () => {
    const draft = (await a.client.post('/purchase/orders', { vendorId: vendor.local.id, lines: [{ itemId: item.resin.id, qty: '10', rate: '3000' }] })).body;
    const approved = await submit('/purchase/orders', draft);
    const grn = (await a.client.post('/purchase/receipts', { poId: approved.id, lines: [{ poLineId: approved.lines[0].id, receivedQty: '4' }] })).body;
    await submit('/purchase/receipts', grn);

    const amended = await a.client.post(`/purchase/orders/${approved.id}/amend`, { version: (await a.client.get(`/purchase/orders/${approved.id}`)).body.version, reason: 'Rate revised' });
    expect(amended.status, JSON.stringify(amended.body)).toBe(200);
    expect(amended.body).toMatchObject({ status: 'draft', revision: 1 });
    const line = amended.body.lines[0];
    const tooLow = await a.client.request('PUT', `/purchase/orders/${approved.id}`, { version: amended.body.version, vendorId: vendor.local.id, lines: [{ id: line.id, itemId: item.resin.id, qty: '3', rate: '2900' }] });
    expect(tooLow.body.errors[0].path).toBe('lines.0.qty');
    const removeReceived = await a.client.request('PUT', `/purchase/orders/${approved.id}`, { version: amended.body.version, vendorId: vendor.local.id, lines: [{ itemId: item.ink.id, qty: '1', rate: '1' }] });
    expect(removeReceived.status).toBe(400);

    const ok = await a.client.request('PUT', `/purchase/orders/${approved.id}`, {
      version: amended.body.version,
      vendorId: vendor.local.id,
      lines: [
        { id: line.id, itemId: item.resin.id, qty: '12', rate: '2900' },
        { itemId: item.ink.id, qty: '5', rate: '400', uomId: null },
      ],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.lines.map((l: any) => [l.lineNo, l.receivedQty])).toEqual([
      [1, '4.0000'],
      [2, '0.0000'],
    ]);
    const reapproved = await submit('/purchase/orders', ok.body);
    expect(reapproved).toMatchObject({ status: 'approved', revision: 1 });
    expect(reapproved.displayNumber).toContain('(Rev 1)');
  });

  it('prints with GST summary and amount in words', async () => {
    const res = await a.client.get(`/documents/${po.id}/print`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.html).toContain('Purchase Order');
    expect(res.body.html).toContain('Indian Rupees One Lakh Thirty Seven Thousand Three Hundred Twenty Three Only');
    expect(res.body.html).toContain(LOCAL_VENDOR);
  });
});

describe('requisition → order', () => {
  it('raises a requisition from the reorder list, net of stock on order', async () => {
    // Resin: 700 kg in stock but reorder level 200 → nothing; ink has no reorder level.
    const none = await a.client.post('/purchase/requisitions/from-reorder', {});
    expect(none.status).toBe(409);

    await a.client.request('PUT', `/masters/items/${item.resin.id}`, { ...(await a.client.get(`/masters/items/${item.resin.id}`)).body, reorderLevel: '2000' });
    const res = await a.client.post('/purchase/requisitions/from-reorder', {});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const line = res.body.lines[0];
    // Available 700 kg + on order (amended PO: 8 BAG pending = 200 kg) → shortfall 1100 kg = 44 BAG.
    expect(line).toMatchObject({ itemId: item.resin.id, uom: 'BAG', quantity: '44.0000' });
    expect(line.remarks).toMatch(/available 700, on order 200/);
  });

  it('turns an approved requisition into a PO and tracks what has been ordered', async () => {
    const pr = (await a.client.post('/purchase/requisitions', { lines: [{ itemId: item.resin.id, description: 'PP granules', uom: 'BAG', quantity: '30', estimatedRate: '2950' }, { description: 'Pallet wrap', uom: 'ROLL', quantity: '2' }] })).body;
    const approvedPr = await submit('/purchase/requisitions', pr);

    const unlinked = await a.client.post('/purchase/orders/from-requisition', { requisitionId: approvedPr.id, vendorId: vendor.local.id });
    expect(unlinked.status).toBe(400);
    expect(unlinked.body.detail).toMatch(/Pallet wrap/);

    const res = await a.client.post('/purchase/orders/from-requisition', { requisitionId: approvedPr.id, vendorId: vendor.local.id, lineIds: [approvedPr.lines[0].id] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.lines[0]).toMatchObject({ qty: '30.0000', rate: '2950.0000', uomCode: 'BAG', requisitionLineId: approvedPr.lines[0].id });
    expect(res.body.notes).toContain(approvedPr.number);

    // Ordered quantity counts only once the PO is approved.
    expect((await a.client.get(`/purchase/requisitions/${approvedPr.id}`)).body.lines[0].orderedQty).toBe('0.0000');
    const po = await submit('/purchase/orders', res.body);
    expect((await a.client.get(`/purchase/requisitions/${approvedPr.id}`)).body.lines[0].orderedQty).toBe('30.0000');
    const again = await a.client.post('/purchase/orders/from-requisition', { requisitionId: approvedPr.id, vendorId: vendor.local.id, lineIds: [approvedPr.lines[0].id] });
    expect(again.status).toBe(409);

    await a.client.post(`/purchase/orders/${po.id}/cancel`, { version: po.version, reason: 'Wrong vendor' });
    expect((await a.client.get(`/purchase/requisitions/${approvedPr.id}`)).body.lines[0].orderedQty).toBe('0.0000');
  });
});

describe('isolation', () => {
  it("other workspaces can't see orders or receipts", async () => {
    const list = (await a.client.get('/purchase/orders')).body.items;
    expect(list.length).toBeGreaterThan(0);
    expect((await b.client.get(`/purchase/orders/${list[0].id}`)).status).toBe(404);
    expect((await b.client.get('/purchase/receipts')).body.items).toEqual([]);
  });
});
