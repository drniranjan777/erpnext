import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let wh: Record<string, string> = {};
let companyId = '';
const item: Record<string, any> = {};
const party: Record<string, any> = {};
const ctx: Record<string, any> = {};

// Made-up GSTINs with valid check digits.
const OUR_GSTIN = '36AABCS1234E1ZU';
const LOCAL = '36AABCD1234E1Z9';
const MH = '27AAACN0000A1ZL';
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function created(path: string, body: unknown) {
  const res = await a.client.post(path, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
async function submit(path: string, doc: any) {
  const res = await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}
async function ok(res: { status: number; body: any }, status = 200) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
}
async function stockAt(itemId: string, warehouseId: string) {
  const d = (await a.client.get(`/inventory/stock/${itemId}`)).body;
  return d.byWarehouse.find((w: any) => w.warehouseId === warehouseId) ?? { qty: '0.0000', value: '0.00' };
}

beforeAll(async () => {
  a = await signupWorkspace('gst-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  companyId = company.id;
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, legalName: 'Sample Industries Pvt Ltd', gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.crate = await created('/masters/items', { name: 'Moulded crate 600x400', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39231090', sellingRate: '250' });
  item.install = await created('/masters/items', { name: 'Installation service', type: 'service', baseUomId: uom.NOS, gstRate: 18, hsnCode: '998719', sellingRate: '1500' });
  item.sheet = await created('/masters/items', { name: 'MS sheet 2mm', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '72085110' });
  item.bracket = await created('/masters/items', { name: 'Plated bracket', type: 'semi_finished', baseUomId: uom.NOS, gstRate: 18, hsnCode: '73269099' });
  item.resin = await created('/masters/items', { name: 'HDPE granules natural', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39012000' });
  const entry = await created('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.crate.id, qty: '100', rate: '150' }, { itemId: item.sheet.id, qty: '1000', rate: '80' }] });
  await submit('/inventory/stock-entries', entry);
  const addr = (stateCode: string, city: string, pincode: string) => [{ type: 'both', line1: 'Main road', city, stateCode, pincode, isDefault: true }];
  party.local = await created('/masters/parties', { name: 'Reddy Agro Foods', isCustomer: true, isVendor: true, gstin: LOCAL, creditDays: 30, addresses: addr('36', 'Hyderabad', '500001') });
  party.mh = await created('/masters/parties', { name: 'Pune Cold Chain', isCustomer: true, gstin: MH, addresses: addr('27', 'Pune', '411001') });
  party.b2c = await created('/masters/parties', { name: 'Walk-in buyer', isCustomer: true, gstRegistrationType: 'consumer', addresses: addr('36', 'Hyderabad', '500002') });
  party.plater = await created('/masters/parties', { name: 'Shiva Electroplaters', isVendor: true, gstRegistrationType: 'unregistered', addresses: addr('36', 'Hyderabad', '500037') });
  party.overseas = await created('/masters/parties', { name: 'Ningbo Plastics Co', isVendor: true, gstRegistrationType: 'overseas' });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

async function invoice(customerId: string, lines: any[], extra: Record<string, unknown> = {}) {
  return submit('/sales/invoices', await created('/sales/invoices', { customerId, warehouseId: wh.MAIN, lines, ...extra }));
}

describe('e-invoice (IRN)', () => {
  it('is off until the company turns it on', async () => {
    ctx.inv = await invoice(party.mh.id, [{ itemId: item.crate.id, qty: '10', rate: '250' }, { itemId: item.install.id, qty: '1', rate: '1500' }], { vehicleNo: 'TS09AB1234', transporter: 'VRL' });
    const s = await ok(await a.client.get(`/gst/einvoice/${ctx.inv.id}`));
    expect(s).toMatchObject({ enabled: false, applicable: true, irn: null });
    const res = await a.client.post(`/gst/einvoice/${ctx.inv.id}/generate`);
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/turned off/);
    expect(await ok(await a.client.request('PUT', `/gst/settings/${companyId}`, { einvoice: true, autoIrn: false, ewayThreshold: 50000 }))).toMatchObject({ einvoice: true, autoIrn: false });
  });

  it('previews the INV-01 JSON and registers the IRN with a signed QR', async () => {
    const p = await ok(await a.client.get(`/gst/einvoice/${ctx.inv.id}/preview`));
    expect(p.errors).toEqual([]);
    expect(p.payload).toMatchObject({ TranDtls: { SupTyp: 'B2B' }, SellerDtls: { Gstin: OUR_GSTIN, Pin: 500039 }, BuyerDtls: { Gstin: MH, Pos: '27', Pin: 411001 }, ValDtls: { IgstVal: 720, TotInvVal: 4720 } });
    const s = await ok(await a.client.post(`/gst/einvoice/${ctx.inv.id}/generate`));
    expect(s).toMatchObject({ irnStatus: 'generated', enabled: true });
    expect(s.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(s.ackNo).toMatch(/^\d{15}$/);
    expect(s.qrDataUri).toMatch(/^data:image\/png;base64,/);
    expect(s.cancellableUntil).toBeTruthy();
    expect(s.log[0]).toMatchObject({ action: 'irn', ok: true });
    // Once is enough.
    expect((await a.client.post(`/gst/einvoice/${ctx.inv.id}/generate`)).status).toBe(409);
    // The print carries the QR and IRN.
    const print = await ok(await a.client.get(`/documents/${ctx.inv.id}/print`));
    expect(print.html).toContain(s.irn);
    expect(print.html).toContain('data:image/png;base64');
  });

  it('blocks cancelling an invoice with a live IRN', async () => {
    const inv = (await a.client.get(`/sales/invoices/${ctx.inv.id}`)).body;
    const res = await a.client.post(`/sales/invoices/${inv.id}/cancel`, { version: inv.version, reason: 'Wrong customer' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/IRN/);
  });

  it('refuses B2C invoices and reports validation errors before calling the IRP', async () => {
    const b2c = await invoice(party.b2c.id, [{ itemId: item.crate.id, qty: '1', rate: '250' }]);
    const s = await ok(await a.client.get(`/gst/einvoice/${b2c.id}`));
    expect(s).toMatchObject({ applicable: false });
    expect(s.reason).toMatch(/B2C/);
    const res = await a.client.post(`/gst/einvoice/${b2c.id}/generate`);
    expect(res.status).toBe(422);
  });

  it('auto-generates IRNs on approval when switched on, and bulk-queues the rest', async () => {
    const pending = await invoice(party.local.id, [{ itemId: item.crate.id, qty: '2', rate: '250' }]);
    expect((await a.client.get(`/gst/einvoices?status=missing`)).body.items.map((r: any) => r.id)).toContain(pending.id);
    const bulk = await ok(await a.client.post('/gst/einvoices/bulk', { ids: [pending.id, ctx.inv.id] }));
    expect(bulk.queued).toBe(1);
    expect(bulk.skipped[0]).toMatchObject({ id: ctx.inv.id, reason: 'Already has an IRN' });
    await ok(await a.client.request('PUT', `/gst/settings/${companyId}`, { einvoice: true, autoIrn: true, ewayThreshold: 50000 }));
    const auto = await invoice(party.local.id, [{ itemId: item.crate.id, qty: '3', rate: '250' }]);
    // The worker picks the jobs up within a few seconds.
    let a1: any, a2: any;
    for (let i = 0; i < 30; i++) {
      a1 = (await a.client.get(`/gst/einvoice/${auto.id}`)).body;
      a2 = (await a.client.get(`/gst/einvoice/${pending.id}`)).body;
      if (a1.irnStatus === 'generated' && a2.irnStatus === 'generated') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(a1.irnStatus).toBe('generated');
    expect(a2.irnStatus).toBe('generated');
    ctx.localInv = auto;
  });

  it('registers credit notes with a reference to the invoice', async () => {
    const inv = (await a.client.get(`/sales/invoices/${ctx.localInv.id}`)).body;
    const cn = await submit('/sales/credit-notes', await created('/sales/credit-notes', { invoiceId: inv.id, kind: 'price_adjustment', reason: 'Rate difference', lines: [{ invoiceLineId: inv.lines[0].id, qty: '3', rate: '10' }] }));
    let s: any;
    for (let i = 0; i < 30; i++) {
      s = (await a.client.get(`/gst/einvoice/${cn.id}`)).body;
      if (s.irnStatus === 'generated') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(s.irnStatus).toBe('generated');
    const p = (await a.client.get(`/gst/einvoice/${cn.id}/preview`)).body;
    expect(p.payload).toMatchObject({ DocDtls: { Typ: 'CRN' }, RefDtls: { PrecDocDtls: [{ InvNo: inv.number }] } });
    ctx.cn = cn;
  });
});

describe('e-way bill', () => {
  it('generates from the invoice with the vehicle (Part-A + B) and validity by distance', async () => {
    const draft = await ok(await a.client.get(`/gst/eway-bills/for/${ctx.inv.id}`));
    expect(draft.request).toMatchObject({ supplyType: 'O', subSupplyType: '1', docType: 'INV', fromGstin: OUR_GSTIN, fromPincode: '500039', toGstin: MH, toPincode: '411001', toStateCode: '27', totalValue: '4720.00' });
    // Services are not goods: only the crates travel.
    expect(draft.request.items).toHaveLength(1);
    expect(draft.defaults).toMatchObject({ vehicleNo: 'TS09AB1234', transporterName: 'VRL' });
    const bad = await a.client.post('/gst/eway-bills', { documentId: ctx.inv.id, distanceKm: 560, transportMode: 'road', vehicleNo: 'XYZ' });
    expect(bad.status).toBe(422);
    const ewb = await ok(await a.client.post('/gst/eway-bills', { documentId: ctx.inv.id, distanceKm: 560, transportMode: 'road', vehicleNo: 'ts 09 ab 1234' }), 201);
    expect(ewb).toMatchObject({ status: 'active', vehicleNo: 'TS09AB1234', distanceKm: 560, canCancel: true });
    expect(ewb.ewbNo).toMatch(/^\d{12}$/);
    // 560 km → 3 days, ending at midnight.
    const days = Math.round((Date.parse(ewb.validUntil) - Date.parse(`${today()}T23:59:59+05:30`)) / 86_400_000);
    expect(days).toBe(3);
    expect((await a.client.get(`/sales/invoices/${ctx.inv.id}`)).body.ewayBillNo).toBe(ewb.ewbNo);
    expect((await a.client.post('/gst/eway-bills', { documentId: ctx.inv.id, distanceKm: 560, vehicleNo: 'TS09AB1234' })).status).toBe(409);
    ctx.ewb = ewb;
  });

  it('updates the vehicle (Part-B) and keeps the history', async () => {
    const r = await ok(await a.client.post(`/gst/eway-bills/${ctx.ewb.id}/part-b`, { vehicleNo: 'MH12CD5678', fromPlace: 'Zaheerabad', reasonCode: '1' }));
    expect(r.vehicleNo).toBe('MH12CD5678');
    expect(r.vehicleHistory.map((v: any) => v.vehicleNo)).toEqual(['TS09AB1234', 'MH12CD5678']);
    expect(r.validUntil).toBe(ctx.ewb.validUntil);
  });

  it('refuses extension far from expiry; the IRN cannot be cancelled while the e-way bill is active', async () => {
    expect((await a.client.post(`/gst/eway-bills/${ctx.ewb.id}/extend`, { remainingKm: 100, fromPlace: 'Solapur', reasonCode: '1', remark: 'Floods' })).status).toBe(409);
    const res = await a.client.post(`/gst/einvoice/${ctx.inv.id}/cancel`, { reasonCode: '2', remark: 'Wrong rate' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/e-way bill/);
  });

  it('cancels within 24 hours, then the IRN, then the invoice', async () => {
    expect(await ok(await a.client.post(`/gst/eway-bills/${ctx.ewb.id}/cancel`, { reasonCode: '3', remark: 'Wrong rate on invoice' }))).toMatchObject({ status: 'cancelled' });
    expect((await a.client.get(`/sales/invoices/${ctx.inv.id}`)).body.ewayBillNo).toBeNull();
    expect(await ok(await a.client.post(`/gst/einvoice/${ctx.inv.id}/cancel`, { reasonCode: '2', remark: 'Wrong rate' }))).toMatchObject({ irnStatus: 'cancelled' });
    const inv = (await a.client.get(`/sales/invoices/${ctx.inv.id}`)).body;
    expect(await ok(await a.client.post(`/sales/invoices/${inv.id}/cancel`, { version: inv.version, reason: 'Re-issued with right rate' }))).toMatchObject({ status: 'cancelled' });
    // The number stays burnt: no new IRN for it.
    expect((await a.client.post(`/gst/einvoice/${ctx.inv.id}/generate`)).status).toBe(409);
  });

  it('consolidates bills travelling on one vehicle', async () => {
    const i1 = await invoice(party.local.id, [{ itemId: item.crate.id, qty: '2', rate: '250' }]);
    const i2 = await invoice(party.local.id, [{ itemId: item.crate.id, qty: '2', rate: '250' }]);
    const e1 = await ok(await a.client.post('/gst/eway-bills', { documentId: i1.id, distanceKm: 20, transporterId: LOCAL }), 201);
    expect(e1.validUntil).toBeNull(); // Part-A only
    const e2 = await ok(await a.client.post('/gst/eway-bills', { documentId: i2.id, distanceKm: 20, vehicleNo: 'TS10XY0001' }), 201);
    const c = await ok(await a.client.post('/gst/eway-bills/consolidate', { ids: [e1.id, e2.id], vehicleNo: 'TS10XY0001', fromPlace: 'Hyderabad' }));
    expect(c).toMatchObject({ count: 2 });
    const list = (await a.client.get('/gst/eway-bills?status=active')).body.items;
    expect(list.filter((e: any) => e.consolidatedNo === c.consolidatedNo)).toHaveLength(2);
  });
});

describe('GST reports', () => {
  it('builds the HSN summary net of credit notes, split B2B / B2C, with CSV export', async () => {
    const r = await ok(await a.client.get(`/gst/hsn-summary?from=${today()}&to=${today()}`));
    const b2bCrates = r.rows.find((x: any) => x.section === 'b2b' && x.hsn === '39231090');
    // Approved B2B crates: 2 + 3 + 2 + 2 = 9 × 250 = 2250, less the ₹30 credit note.
    expect(b2bCrates).toMatchObject({ uqc: 'NOS', gstRate: '18', qty: '9.000', taxable: '2220.00' });
    expect(r.rows.find((x: any) => x.section === 'b2c' && x.hsn === '39231090')).toMatchObject({ qty: '1.000', taxable: '250.00' });
    const file = await a.client.download(`/gst/hsn-summary?from=${today()}&to=${today()}&format=csv`);
    expect(file.type).toMatch(/text\/csv/);
    expect(new TextDecoder().decode(file.bytes)).toContain('39231090');
  });

  it('lists documents issued with cancellations', async () => {
    const r = await ok(await a.client.get(`/gst/documents-issued?from=${today()}&to=${today()}`));
    const inv = r.rows.find((x: any) => x.docType === 'sales_invoice');
    expect(inv).toMatchObject({ total: 6, cancelled: 1, netIssued: 5 });
    expect(inv.from).toMatch(/^INV\//);
  });
});

describe('job work (ITC-04)', () => {
  it('sends material to the job worker: stock moves to their virtual warehouse at cost', async () => {
    const ch = await created('/job-work/challans', { jobWorkerId: party.plater.id, warehouseId: wh.MAIN, process: 'Zinc plating', lines: [{ itemId: item.sheet.id, qty: '200' }] });
    expect(ch).toMatchObject({ totalValue: '16000.00', jobWorkWarehouse: { code: expect.stringMatching(/^JW-/) } });
    expect(ch.lines[0]).toMatchObject({ rate: '80.0000', goodsType: 'inputs', dueBy: expect.any(String) });
    ctx.ch = await submit('/job-work/challans', ch);
    expect(ctx.ch.number).toMatch(/^JWC\//);
    expect(await stockAt(item.sheet.id, wh.MAIN)).toMatchObject({ qty: '800.0000' });
    expect(await stockAt(item.sheet.id, ctx.ch.jobWorkWarehouse.id)).toMatchObject({ qty: '200.0000', value: '16000.00' });
    // Job-work e-way bill: outward, sub-type 4.
    const d = (await a.client.get(`/gst/eway-bills/for/${ctx.ch.id}`)).body;
    expect(d.request).toMatchObject({ subSupplyType: '4', docType: 'CHL', toGstin: 'URP', toPincode: '500037', totalValue: '16000.00' });
  });

  it('receives processed goods at material cost + job charges, returns and losses settle the challan', async () => {
    const line = ctx.ch.lines[0];
    const over = await a.client.post('/job-work/receipts', { challanId: ctx.ch.id, warehouseId: wh.MAIN, outputs: [{ itemId: item.bracket.id, qty: '100' }], materials: [{ challanLineId: line.id, consumedQty: '201' }] });
    expect(over.status).toBe(400);
    const r = await created('/job-work/receipts', { challanId: ctx.ch.id, warehouseId: wh.MAIN, jwChallanNo: 'SE/77', jobCharges: '2500', outputs: [{ itemId: item.bracket.id, qty: '100' }], materials: [{ challanLineId: line.id, consumedQty: '150', lossQty: '5' }] });
    const posted = await submit('/job-work/receipts', r);
    expect(posted.number).toMatch(/^JWR\//);
    // 155 kg × 80 = 12400 + 2500 charges = 14900 for 100 brackets.
    expect(posted.amount).toBe('14900.00');
    expect(await stockAt(item.bracket.id, wh.MAIN)).toMatchObject({ qty: '100.0000', value: '14900.00' });
    expect(await stockAt(item.sheet.id, ctx.ch.jobWorkWarehouse.id)).toMatchObject({ qty: '45.0000' });
    let ch = (await a.client.get(`/job-work/challans/${ctx.ch.id}`)).body;
    expect(ch).toMatchObject({ status: 'approved', pendingQty: '45.0000' });
    const back = await submit('/job-work/receipts', await created('/job-work/receipts', { challanId: ctx.ch.id, warehouseId: wh.MAIN, materials: [{ challanLineId: line.id, returnedQty: '45' }] }));
    expect(back.status).toBe('approved');
    ch = (await a.client.get(`/job-work/challans/${ctx.ch.id}`)).body;
    expect(ch).toMatchObject({ status: 'completed', pendingQty: '0.0000' });
    expect(await stockAt(item.sheet.id, wh.MAIN)).toMatchObject({ qty: '845.0000' });
    // A challan with receipts cannot be cancelled.
    expect((await a.client.post(`/job-work/challans/${ch.id}/cancel`, { version: ch.version, reason: 'Wrong vendor' })).status).toBe(409);
  });

  it('reports ITC-04 tables 4 and 5A', async () => {
    const r = await ok(await a.client.get(`/job-work/itc-04?from=${today()}&to=${today()}`));
    expect(r.table4).toEqual([expect.objectContaining({ challanNo: ctx.ch.number, typeOfGoods: 'Inputs', uqc: 'KGS', qty: '200.000', taxableValue: '16000.00', cgstRate: '9', sgstRate: '9', igstRate: '0' })]);
    expect(r.table5a).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ originalChallanNo: ctx.ch.number, jobWorkerChallanNo: 'SE/77', qty: '150.000', lossQty: '5.000' }),
        expect.objectContaining({ qty: '45.000', lossQty: '' }),
      ]),
    );
    const file = await a.client.download(`/job-work/itc-04?from=${today()}&to=${today()}&format=csv`);
    expect(new TextDecoder().decode(file.bytes)).toContain('Table 5A');
  });
});

describe('imports: foreign-currency PO and Bill of Entry', () => {
  it('converts foreign rates at the exchange rate, with no GST on the import bill', async () => {
    const po = await created('/purchase/orders', { vendorId: party.overseas.id, currency: 'usd', exchangeRate: '83.5', lines: [{ itemId: item.resin.id, qty: '1000', rate: '0', foreignRate: '1.2' }] });
    expect(po).toMatchObject({ currency: 'USD', exchangeRate: '83.500000', taxableTotal: '100200.00', igstTotal: '0.00' });
    expect(po.lines[0]).toMatchObject({ rate: '100.2000', foreignRate: '1.2000' });
    expect((await a.client.post('/purchase/orders', { vendorId: party.overseas.id, currency: 'EUR', lines: [{ itemId: item.resin.id, qty: '1', rate: '1' }] })).status).toBe(400);
    ctx.po = await submit('/purchase/orders', po);
    ctx.grn = await submit('/purchase/receipts', await created('/purchase/receipts', { poId: ctx.po.id, lines: [{ poLineId: ctx.po.lines[0].id, receivedQty: '1000' }] }));
    expect(await stockAt(item.resin.id, wh.MAIN)).toMatchObject({ qty: '1000.0000', value: '100200.00' });
  });

  it('computes customs duty and adds BCD + SWS to the stock value', async () => {
    const body = { vendorId: party.overseas.id, boeNo: '4567890', boeDate: today(), portCode: 'INNSA1', goodsReceiptId: ctx.grn.id, currency: 'USD', exchangeRate: '83.5', lines: [{ itemId: item.resin.id, qty: '1000', foreignValue: '1200', bcdRate: '7.5' }] };
    const pv = await ok(await a.client.post('/purchase/bills-of-entry/preview', body));
    // AV 100200; BCD 7515; SWS 752 (10% of BCD); IGST 18% of 108467 = 19524.
    expect(pv.header).toMatchObject({ assessableTotal: '100200.00', bcdTotal: '7515.00', swsTotal: '752.00', igstTotal: '19524.00', dutyTotal: '27791.00' });
    const boe = await submit('/purchase/bills-of-entry', await created('/purchase/bills-of-entry', body));
    expect(boe).toMatchObject({ status: 'approved', customsDuty: '8267.00', itcAvailable: '19524.00', capitalised: '8267.00' });
    expect(boe.number).toMatch(/^BOE\//);
    expect(await stockAt(item.resin.id, wh.MAIN)).toMatchObject({ qty: '1000.0000', value: '108467.00' });
    expect((await a.client.post('/purchase/bills-of-entry', body)).status).toBe(400); // same BE number at the port
  });
});

describe('bill capture (OCR)', () => {
  it('reads a text bill, matches the vendor and the open goods receipt', async () => {
    const po = await submit('/purchase/orders', await created('/purchase/orders', { vendorId: party.local.id, lines: [{ itemId: item.resin.id, qty: '500', rate: '120' }] }));
    await submit('/purchase/receipts', await created('/purchase/receipts', { poId: po.id, lines: [{ poLineId: po.lines[0].id, receivedQty: '500' }] }));
    const bill = `REDDY AGRO FOODS
GSTIN: ${LOCAL}
TAX INVOICE
Invoice No: RAF/991   Invoice Date: ${today().split('-').reverse().join('/')}
Bill to: Sample Industries Pvt Ltd GSTIN: ${OUR_GSTIN}
1 HDPE granules natural 390120 500 KGS 120.00 60,000.00
Taxable Value 60,000.00
CGST @9% 5,400.00
SGST @9% 5,400.00
Grand Total 70,800.00`;
    const status = (await a.client.get('/purchase/invoices/capture/status')).body;
    expect(status.accepts).toContain('text/plain');
    const r = await ok(await a.client.upload('/purchase/invoices/capture', 'bill.txt', bill, 'text/plain'));
    expect(r).toMatchObject({ extractor: 'text', vendor: { id: party.local.id, matchedBy: 'gstin' }, warnings: [] });
    expect(r.confidence).toBeGreaterThan(0.8);
    expect(r.lines[0]).toMatchObject({ itemId: item.resin.id, matchedBy: 'grn', qty: '500' });
    expect(r.draft).toMatchObject({ supplierInvoiceNo: 'RAF/991', supplierInvoiceDate: today() });
    // The draft goes straight into a purchase invoice (3-way matched).
    const pi = await created('/purchase/invoices', { ...r.draft, capture: { fileName: 'bill.txt', extractor: 'text', confidence: r.confidence, warnings: r.warnings } });
    expect(pi).toMatchObject({ matchType: 'three_way', grandTotal: '70800.00' });
    // Same bill again is flagged.
    const again = await ok(await a.client.upload('/purchase/invoices/capture', 'bill.txt', bill, 'text/plain'));
    expect(again.warnings.join(' ')).toMatch(/already entered/);
  });

  it('asks for AI capture to read PDFs when no key is configured', async () => {
    const status = (await a.client.get('/purchase/invoices/capture/status')).body;
    if (status.ai) return;
    const r = await a.client.upload('/purchase/invoices/capture', 'scan.pdf', new Uint8Array([37, 80, 68, 70]), 'application/pdf');
    expect(r.status).toBe(422);
  });
});
