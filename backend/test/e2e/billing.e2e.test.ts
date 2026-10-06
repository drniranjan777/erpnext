import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let wh: Record<string, string> = {};
const item: Record<string, any> = {};
const vendor: Record<string, any> = {};
const ctx: Record<string, any> = {};

// Made-up GSTINs with valid check digits.
const OUR_GSTIN = '36AABCS1234E1ZU';
const LOCAL_VENDOR = '36AABCD1234E1Z9';
const MH_VENDOR = '27AAACN0000A1ZL';
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function submit(path: string, doc: any) {
  const res = await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}
async function created(path: string, body: unknown) {
  const res = await a.client.post(path, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
async function stock(itemId: string) {
  const d = (await a.client.get(`/inventory/stock/${itemId}`)).body;
  return d.byWarehouse.find((w: any) => w.warehouseId === wh.MAIN) ?? { qty: '0.0000', value: '0.00' };
}

beforeAll(async () => {
  a = await signupWorkspace('bill-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.resin = await created('/masters/items', { name: 'PP granules', type: 'raw_material', baseUomId: uom.KG, purchaseUomId: uom.BAG, conversions: [{ uomId: uom.BAG, factor: '25' }], gstRate: 18, hsnCode: '39021000' });
  item.service = await created('/masters/items', { name: 'Mould repair', type: 'service', baseUomId: uom.NOS, gstRate: 18, hsnCode: '998719' });
  item.diesel = await created('/masters/items', { name: 'Diesel for generator', type: 'consumable', isStockItem: false, baseUomId: uom.LTR, gstRate: 18, hsnCode: '27101944' });
  vendor.local = await created('/masters/parties', { name: 'Sharma Polymers', isVendor: true, gstin: LOCAL_VENDOR, creditDays: 60, msmeCategory: 'micro', msmeUdyamNo: 'UDYAM-TS-02-0012345', tdsSection: '194C', email: 'sales@sharma.example' });
  vendor.mh = await created('/masters/parties', { name: 'Navkar Engineering', isVendor: true, gstin: MH_VENDOR, email: 'quotes@navkar.example' });

  const po = await created('/purchase/orders', { vendorId: vendor.local.id, expectedDate: addDays(today(), 3), lines: [{ itemId: item.resin.id, qty: '40', rate: '2500' }] });
  ctx.po = await submit('/purchase/orders', po);
  const grn = await created('/purchase/receipts', { poId: ctx.po.id, lines: [{ poLineId: ctx.po.lines[0].id, receivedQty: '40', rejectedQty: '2', rejectionReason: 'Wet bags' }] });
  ctx.grn = await submit('/purchase/receipts', grn);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('purchase invoice: three-way match', () => {
  it('lists what can be billed', async () => {
    const res = (await a.client.get(`/purchase/invoices/billable?vendorId=${vendor.local.id}`)).body;
    expect(res.grnLines).toHaveLength(1);
    expect(res.grnLines[0]).toMatchObject({ grnNumber: ctx.grn.number, poNumber: ctx.po.number, pendingQty: '38.0000', rate: '2500.0000', uomCode: 'BAG' });
    ctx.grnLineId = res.grnLines[0].grnLineId;
  });

  it('flags a rate above the order and needs an explanation to submit', async () => {
    ctx.pi = await created('/purchase/invoices', {
      vendorId: vendor.local.id,
      supplierInvoiceNo: 'SP/2026/118',
      supplierInvoiceDate: today(),
      lines: [{ grnLineId: ctx.grnLineId, itemId: item.resin.id, qty: '38', rate: '2550' }],
    });
    // 38 BAG × 2550 = 96900; CGST + SGST 9% each = 8721 + 8721.
    expect(ctx.pi).toMatchObject({
      matchType: 'three_way',
      taxableTotal: '96900.00',
      cgstTotal: '8721.00',
      sgstTotal: '8721.00',
      grandTotal: '114342.00',
      itcEligibleTax: '17442.00',
      rateVariance: '1900.00',
      tdsSection: '194C',
      tdsRate: '2.000', // company (4th PAN letter C) → 2%
      tdsAmount: '1938.00',
      netPayable: '112404.00',
      dueDate: addDays(today(), 45), // micro enterprise: 60 agreed days capped at 45
      varianceNeedsNote: true,
    });
    expect(ctx.pi.lines[0]).toMatchObject({ expectedRate: '2500.0000', rateVariance: '1900.00', outOfTolerance: true, grnNumber: ctx.grn.number });

    const blocked = await a.client.post(`/purchase/invoices/${ctx.pi.id}/submit`, { version: ctx.pi.version });
    expect(blocked.status).toBe(400);
    expect(blocked.body.errors[0].message).toMatch(/differs from the order/);

    const explained = await a.client.request('PUT', `/purchase/invoices/${ctx.pi.id}`, {
      version: ctx.pi.version,
      vendorId: vendor.local.id,
      supplierInvoiceNo: 'SP/2026/118',
      supplierInvoiceDate: today(),
      varianceNote: 'Polymer price increase accepted by purchase head',
      lines: [{ grnLineId: ctx.grnLineId, itemId: item.resin.id, qty: '38', rate: '2550' }],
    });
    expect(explained.status, JSON.stringify(explained.body)).toBe(200);
    ctx.pi = await submit('/purchase/invoices', explained.body);
    expect(ctx.pi.status).toBe('approved');
    expect(ctx.pi.number).toMatch(/^PINV\//);
  });

  it('adds the price difference to stock value', async () => {
    // GRN put 950 kg in at ₹100 (95,000); the bill adds 1,900 → ₹102/kg.
    expect(await stock(item.resin.id)).toMatchObject({ qty: '950.0000', value: '96900.00', valuationRate: '102.000000' });
    const order = (await a.client.get(`/purchase/orders/${ctx.po.id}`)).body;
    expect(order.lines[0].billedQty).toBe('38.0000');
  });

  it('rejects duplicate supplier invoices and over-billing', async () => {
    const dup = await a.client.post('/purchase/invoices', { vendorId: vendor.local.id, supplierInvoiceNo: 'sp/2026/118', supplierInvoiceDate: today(), lines: [{ itemId: item.diesel.id, qty: '1', rate: '1' }] });
    expect(dup.body.errors[0]).toMatchObject({ path: 'supplierInvoiceNo' });
    const over = await a.client.post('/purchase/invoices', { vendorId: vendor.local.id, supplierInvoiceNo: 'SP/2026/119', supplierInvoiceDate: today(), lines: [{ grnLineId: ctx.grnLineId, itemId: item.resin.id, qty: '1', rate: '2500' }] });
    expect(over.body.errors[0]).toMatchObject({ path: 'lines.0.qty' });
    const stockWithoutGrn = await a.client.post('/purchase/invoices', { vendorId: vendor.local.id, supplierInvoiceNo: 'SP/2026/120', supplierInvoiceDate: today(), lines: [{ itemId: item.resin.id, qty: '1', rate: '2500' }] });
    expect(stockWithoutGrn.body.errors[0].message).toMatch(/receive it with a GRN/);
    const future = await a.client.post('/purchase/invoices', { vendorId: vendor.local.id, supplierInvoiceNo: 'SP/2026/121', supplierInvoiceDate: addDays(today(), 2), lines: [{ itemId: item.diesel.id, qty: '1', rate: '1' }] });
    expect(future.body.errors[0].path).toBe('supplierInvoiceDate');
  });

  it('shows MSME bills with their due dates', async () => {
    const list = (await a.client.get('/purchase/invoices?outstanding=true&msme=true')).body.items;
    expect(list[0]).toMatchObject({ id: ctx.pi.id, outstanding: '112404.00', vendorMsme: 'micro', daysToDue: 45 });
  });
});

describe('two-way and unmatched bills', () => {
  it('bills a service order with GST that cannot be claimed', async () => {
    const po = await submit('/purchase/orders', await created('/purchase/orders', { vendorId: vendor.mh.id, poType: 'service', lines: [{ itemId: item.service.id, qty: '2', rate: '10000' }] }));
    const billable = (await a.client.get(`/purchase/invoices/billable?vendorId=${vendor.mh.id}`)).body;
    expect(billable.poLines[0]).toMatchObject({ poNumber: po.number, pendingQty: '2.0000', rate: '10000.0000' });
    const pi = await created('/purchase/invoices', {
      vendorId: vendor.mh.id,
      supplierInvoiceNo: 'NE-77',
      supplierInvoiceDate: today(),
      tdsSection: '194J',
      lines: [{ poLineId: po.lines[0].id, itemId: item.service.id, qty: '2', rate: '10000', itcEligible: false }],
    });
    expect(pi).toMatchObject({ matchType: 'two_way', interState: true, igstTotal: '3600.00', itcEligibleTax: '0.00', itcIneligibleTax: '3600.00', tdsAmount: '2000.00', netPayable: '21600.00' });
    await submit('/purchase/invoices', pi);
    expect((await a.client.get(`/purchase/orders/${po.id}`)).body.lines[0].billedQty).toBe('2.0000');
  });

  it('records an expense bill without an order', async () => {
    const pi = await created('/purchase/invoices', { vendorId: vendor.mh.id, supplierInvoiceNo: 'NE-78', supplierInvoiceDate: today(), lines: [{ itemId: item.diesel.id, qty: '200', rate: '92.5' }] });
    expect(pi).toMatchObject({ matchType: 'none', taxableTotal: '18500.00' });
  });
});

describe('debit notes', () => {
  it('returns goods to the vendor at the bill rate', async () => {
    const dn = await created('/purchase/debit-notes', { piId: ctx.pi.id, kind: 'return', reason: 'Lumps in material', vehicleNo: 'TS09EA1234', lines: [{ piLineId: ctx.pi.lines[0].id, qty: '10' }] });
    expect(dn).toMatchObject({ kind: 'return', warehouse: { code: 'MAIN' }, taxableTotal: '25500.00', cgstTotal: '2295.00', grandTotal: '30090.00' });
    const posted = await submit('/purchase/debit-notes', dn);
    expect(posted.number).toMatch(/^DN\/\d{2}-\d{2}\/\d+$/);
    expect(posted.number.length).toBeLessThanOrEqual(16);
    // 250 kg out at ₹102 → 700 kg worth 71,400 left.
    expect(await stock(item.resin.id)).toMatchObject({ qty: '700.0000', value: '71400.00' });
    expect((await a.client.get(`/purchase/invoices/${ctx.pi.id}`)).body.lines[0].returnedQty).toBe('10.0000');
    const tooMany = await a.client.post('/purchase/debit-notes', { piId: ctx.pi.id, kind: 'return', reason: 'More lumps', lines: [{ piLineId: ctx.pi.lines[0].id, qty: '29' }] });
    expect(tooMany.body.errors[0].message).toMatch(/only 28 billed and not yet returned/i);
    ctx.returnDn = posted;
  });

  it('adjusts price on stock still held, and blocks cancelling the bill while notes exist', async () => {
    const dn = await submit('/purchase/debit-notes', await created('/purchase/debit-notes', { piId: ctx.pi.id, kind: 'price_adjustment', reason: 'Agreed rebate ₹50 per bag', lines: [{ piLineId: ctx.pi.lines[0].id, qty: '28', rate: '50' }] }));
    expect(dn).toMatchObject({ taxableTotal: '1400.00', grandTotal: '1652.00' });
    expect(await stock(item.resin.id)).toMatchObject({ qty: '700.0000', value: '70000.00' });
    const pi = (await a.client.get(`/purchase/invoices/${ctx.pi.id}`)).body;
    const cancel = await a.client.post(`/purchase/invoices/${ctx.pi.id}/cancel`, { version: pi.version, reason: 'test' });
    expect(cancel.status).toBe(409);
    expect(pi.debitNotes).toHaveLength(2);
    const print = await a.client.get(`/documents/${ctx.returnDn.id}/print`);
    expect(print.body.html).toContain('Debit Note');
    expect(print.body.html).toContain('SP/2026/118');
  });
});

describe('landed cost', () => {
  it('adds freight and duty to stock still on hand; the rest is unabsorbed', async () => {
    const lc = await created('/purchase/landed-costs', {
      grnIds: [ctx.grn.id],
      method: 'value',
      charges: [
        { chargeType: 'freight', amount: '5000', vendorId: vendor.mh.id, billRef: 'LR-551' },
        { chargeType: 'clearing', amount: '3000' },
      ],
    });
    expect(lc).toMatchObject({ totalCharges: '8000.00' });
    expect(lc.allocations[0]).toMatchObject({ amount: '8000.00', itemCode: item.resin.code });
    const posted = await submit('/purchase/landed-costs', lc);
    // 700 of the 950 kg received are still in stock: 8000 × 700 / 950.
    expect(posted).toMatchObject({ unabsorbed: '2105.26' });
    expect(posted.allocations[0]).toMatchObject({ absorbed: '5894.74', unabsorbed: '2105.26' });
    expect(await stock(item.resin.id)).toMatchObject({ value: '75894.74' });

    const cancelled = await a.client.post(`/purchase/landed-costs/${lc.id}/cancel`, { version: posted.version, reason: 'Wrong GRN' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(await stock(item.resin.id)).toMatchObject({ value: '70000.00' });
  });

  it('needs item weights to split by weight', async () => {
    const res = await a.client.post('/purchase/landed-costs', { grnIds: [ctx.grn.id], method: 'weight', charges: [{ chargeType: 'freight', amount: '100' }] });
    expect(res.body.errors[0].path).toBe('method');
  });
});

describe('RFQ and comparison', () => {
  it('issues, emails, compares and awards', async () => {
    const rfq = await created('/purchase/rfqs', { responseDueDate: addDays(today(), 5), lines: [{ itemId: item.resin.id, qty: '100' }], vendorIds: [vendor.local.id, vendor.mh.id] });
    expect(rfq.lines[0]).toMatchObject({ uomCode: 'BAG', qty: '100.0000' });
    const early = await a.client.post(`/purchase/rfqs/${rfq.id}/send`, {});
    expect(early.status).toBe(409);
    const issued = await submit('/purchase/rfqs', rfq);
    expect(issued.number).toMatch(/^RFQ\//);
    const sent = await a.client.post(`/purchase/rfqs/${rfq.id}/send`, {});
    expect(sent.body).toMatchObject({ sent: 2, withoutEmail: [] });

    const line = issued.lines[0].id;
    expect((await a.client.request('PUT', `/purchase/rfqs/${rfq.id}/quotes/${vendor.local.id}`, { quoteRef: 'SP-Q9', creditDays: 30, lines: [{ rfqLineId: line, rate: '2500', leadTimeDays: 7 }] })).status).toBe(200);
    expect((await a.client.request('PUT', `/purchase/rfqs/${rfq.id}/quotes/${vendor.mh.id}`, { quoteRef: 'NE-Q1', otherCharges: '1500', lines: [{ rfqLineId: line, rate: '2450', discountPct: '1', leadTimeDays: 20 }] })).status).toBe(200);

    const cmp = (await a.client.get(`/purchase/rfqs/${rfq.id}/comparison`)).body;
    const offers = Object.fromEntries(cmp.lines[0].offers.map((o: any) => [o.vendorId, o]));
    expect(offers[vendor.mh.id]).toMatchObject({ netRate: '2425.5000', amount: '242550.00', lowest: true });
    expect(offers[vendor.local.id]).toMatchObject({ netRate: '2500.0000', lowest: false });
    expect(cmp.lines[0].lowestVendorId).toBe(vendor.mh.id);
    const local = cmp.vendors.find((v: any) => v.vendorId === vendor.local.id);
    expect(local.performance).toMatchObject({ acceptancePct: 95, onTimePct: 100 });
    expect(cmp.vendors.find((v: any) => v.vendorId === vendor.mh.id).total).toBe('244050.00');

    const award = await a.client.post(`/purchase/rfqs/${rfq.id}/award`, { lines: [{ rfqLineId: line, vendorId: vendor.local.id }] });
    expect(award.status, JSON.stringify(award.body)).toBe(200);
    const po = (await a.client.get(`/purchase/orders/${award.body.orders[0].poId}`)).body;
    expect(po).toMatchObject({ status: 'draft', vendorQuoteRef: 'SP-Q9', creditDays: 30 });
    expect(po.lines[0]).toMatchObject({ qty: '100.0000', rate: '2500.0000' });
    expect((await a.client.get(`/purchase/rfqs/${rfq.id}`)).body.status).toBe('completed');
  });
});

describe('approved vendor list and vendor rating', () => {
  it('warns when ordering from a vendor not on the list, and records last rates', async () => {
    const saved = await a.client.request('PUT', `/masters/items/${item.resin.id}/vendors`, { vendors: [{ vendorId: vendor.mh.id, isPreferred: true, leadTimeDays: 20 }] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const po = await created('/purchase/orders', { vendorId: vendor.local.id, lines: [{ itemId: item.resin.id, qty: '1', rate: '2500' }] });
    expect(po.warnings[0]).toMatch(/not on the approved vendor list/);
    const ok = await submit('/purchase/orders', await created('/purchase/orders', { vendorId: vendor.mh.id, lines: [{ itemId: item.resin.id, qty: '2', rate: '2400' }] }));
    expect(ok.warnings).toEqual([]);
    const list = (await a.client.get(`/masters/items/${item.resin.id}/vendors`)).body;
    expect(list[0]).toMatchObject({ vendorId: vendor.mh.id, isPreferred: true, lastRate: '96.0000', lastOrderedAt: today() });
  });

  it('scores vendors from receipts', async () => {
    const report = (await a.client.get('/purchase/vendor-performance')).body;
    const local = report.find((r: any) => r.vendorId === vendor.local.id);
    expect(local).toMatchObject({ receipts: 1, acceptancePct: 95, onTimePct: 100, rateVariance: '1900.00', score: 97 });
  });
});
