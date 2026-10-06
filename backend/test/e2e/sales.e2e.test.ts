import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let wh: Record<string, string> = {};
const item: Record<string, any> = {};
const cust: Record<string, any> = {};
const ctx: Record<string, any> = {};

const OUR_GSTIN = '36AABCS1234E1ZU'; // Telangana (made up, valid check digit)
const LOCAL_CUSTOMER = '36AABCD1234E1Z9';
const MH_CUSTOMER = '27AAACN0000A1ZL';
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function created(path: string, body: unknown) {
  const res = await a.client.post(path, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
async function submit(path: string, doc: any, extra: Record<string, unknown> = {}) {
  const res = await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}
async function onHand(itemId: string) {
  const d = (await a.client.get(`/inventory/stock/${itemId}`)).body;
  return d.byWarehouse.find((w: any) => w.warehouseId === wh.MAIN) ?? { qty: '0.0000', value: '0.00' };
}

beforeAll(async () => {
  a = await signupWorkspace('o2c-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.crate = await created('/masters/items', { name: 'Moulded crate 600x400', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39231090', sellingRate: '250' });
  item.install = await created('/masters/items', { name: 'Installation service', type: 'service', baseUomId: uom.NOS, gstRate: 18, hsnCode: '998719', sellingRate: '1500' });
  item.glue = await created('/masters/items', { name: 'Adhesive', type: 'trading', baseUomId: uom.KG, gstRate: 18, hsnCode: '35069190', trackBatch: true, sellingRate: '320' });
  const entry = await created('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.crate.id, qty: '100', rate: '150' }, { itemId: item.glue.id, qty: '50', rate: '200', batchNo: 'A1' }] });
  await submit('/inventory/stock-entries', entry);
  await created('/masters/price-lists', { name: 'Standard', type: 'selling', isDefault: true, items: [{ itemId: item.crate.id, uomId: uom.NOS, minQty: '50', rate: '240' }] });
  const addr = (stateCode: string, city: string, pincode: string) => [{ type: 'both', line1: 'Main road', city, stateCode, pincode, isDefault: true }];
  cust.local = await created('/masters/parties', { name: 'Reddy Agro Foods', isCustomer: true, gstin: LOCAL_CUSTOMER, creditLimit: '50000', creditDays: 30, addresses: addr('36', 'Hyderabad', '500001') });
  cust.mh = await created('/masters/parties', { name: 'Pune Cold Chain', isCustomer: true, gstin: MH_CUSTOMER, creditDays: 15, addresses: addr('27', 'Pune', '411001') });
  cust.export = await created('/masters/parties', { name: 'Gulf Fresh LLC', isCustomer: true, gstRegistrationType: 'overseas', currency: 'INR' });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('pricing and quotations', () => {
  it('uses the price list with quantity breaks, else the item selling rate', async () => {
    const res = await a.client.post('/sales/preview', { customerId: cust.local.id, lines: [{ itemId: item.crate.id, qty: '60' }, { itemId: item.crate.id, qty: '10' }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.lines.map((l: any) => [l.listRate, l.rate])).toEqual([
      ['240.0000', '240.0000'],
      ['250.0000', '250.0000'],
    ]);
    expect(res.body.header).toMatchObject({ interState: false, placeOfSupply: '36', costTotal: '10500.00' });
    expect((await a.client.get(`/sales/price?itemId=${item.crate.id}&qty=50`)).body.rate).toBe('240.0000');
  });

  it('routes big discounts to approval with a discount condition', async () => {
    const roles = (await a.client.get('/iam/roles')).body;
    const owner = roles.find((r: any) => r.name === 'Owner');
    const rule = await a.client.post('/platform/approval-rules', { docType: 'sales_quotation', name: 'Discount over 5%', condition: 'discount_above', conditionValue: '5', steps: [{ name: 'Sales head', approverRoleId: owner.id }] });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);

    const big = await created('/sales/quotations', { customerId: cust.local.id, validUntil: addDays(today(), 15), lines: [{ itemId: item.crate.id, qty: '20', discountPct: '10' }] });
    expect(big).toMatchObject({ maxDiscountPct: '10.00', taxableTotal: '4500.00' });
    expect((await submit('/sales/quotations', big)).status).toBe('pending_approval');

    const small = await created('/sales/quotations', { customerId: cust.local.id, validUntil: addDays(today(), 15), lines: [{ itemId: item.crate.id, qty: '20', discountPct: '2' }] });
    ctx.quotation = await submit('/sales/quotations', small);
    expect(ctx.quotation.status).toBe('approved');
    expect(ctx.quotation.number).toMatch(/^QTN\//);
  });

  it('converts an approved quotation into a sales order', async () => {
    const res = await a.client.post(`/sales/quotations/${ctx.quotation.id}/order`, { customerPoNo: 'RAF/PO/88' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ctx.so = res.body;
    // 20 × 250 less 2% = 4900; GST 18% = 882 → 5782.
    expect(ctx.so).toMatchObject({ status: 'draft', customerPoNo: 'RAF/PO/88', taxableTotal: '4900.00', grandTotal: '5782.00', warehouse: { code: 'MAIN' } });
    expect(ctx.so.lines[0].quotationLineId).toBeTruthy();
    expect((await a.client.get(`/sales/quotations/${ctx.quotation.id}`)).body).toMatchObject({ status: 'completed', order: { id: ctx.so.id } });
  });
});

describe('sales orders and credit control', () => {
  it('approves within the credit limit', async () => {
    ctx.so = await submit('/sales/orders', ctx.so);
    expect(ctx.so.status).toBe('approved');
    expect(ctx.so.creditCheck).toMatchObject({ limit: '50000.00', exposure: '5782.00', exceeded: false });
    expect(ctx.so.canDeliver).toBe(true);
  });

  it('needs a reason to go over the credit limit', async () => {
    const big = await created('/sales/orders', { customerId: cust.local.id, lines: [{ itemId: item.crate.id, qty: '200' }] });
    const blocked = await a.client.post(`/sales/orders/${big.id}/submit`, { version: big.version });
    expect(blocked.status).toBe(403);
    expect(blocked.body.errors[0].path).toBe('creditOverrideReason');
    expect(blocked.body.detail).toMatch(/over the credit limit/);
    const ok = await submit('/sales/orders', big, { creditOverrideReason: 'Advance cheque received, clearing tomorrow' });
    expect(ok).toMatchObject({ status: 'approved', creditOverrideReason: 'Advance cheque received, clearing tomorrow' });
    ctx.bigSo = ok;
  });

  it('shows available-to-promise net of open orders', async () => {
    const [atp] = (await a.client.get(`/sales/atp?itemIds=${item.crate.id}`)).body;
    expect(atp).toMatchObject({ onHand: '100.0000', reserved: '220.0000', available: '-120.0000' });
  });
});

describe('dispatch and invoicing', () => {
  it('delivers against the order and takes stock out at cost', async () => {
    const dlv = await created('/sales/deliveries', { orderId: ctx.so.id, vehicleNo: 'ts 08 ub 4455', transporter: 'VRL', packages: 4, lines: [{ soLineId: ctx.so.lines[0].id, qty: '20' }] });
    expect(dlv.vehicleNo).toBe('TS08UB4455');
    const too = await a.client.post('/sales/deliveries', { orderId: ctx.so.id, lines: [{ soLineId: ctx.so.lines[0].id, qty: '21' }] });
    expect(too.body.errors[0].path).toBe('lines.0.qty');
    ctx.dlv = await submit('/sales/deliveries', dlv);
    expect(ctx.dlv.number).toMatch(/^DLV\//);
    expect(ctx.dlv.lines[0].costValue).toBe('3000.00');
    expect(await onHand(item.crate.id)).toMatchObject({ qty: '80.0000' });
    expect((await a.client.get(`/sales/orders/${ctx.so.id}`)).body.lines[0].deliveredQty).toBe('20.0000');
  });

  it('invoices the delivery with intra-state GST and a due date', async () => {
    const billable = (await a.client.get(`/sales/invoices/billable?customerId=${cust.local.id}`)).body;
    const line = billable.deliveryLines[0];
    expect(line).toMatchObject({ deliveryNumber: ctx.dlv.number, pendingQty: '20.0000', rate: '250.0000', discountPct: '2.00' });
    const inv = await created('/sales/invoices', { customerId: cust.local.id, lines: [{ dlvLineId: line.dlvLineId, itemId: item.crate.id, qty: '20' }] });
    expect(inv).toMatchObject({ taxKind: 'tax_invoice', cgstTotal: '441.00', sgstTotal: '441.00', grandTotal: '5782.00', dueDate: addDays(today(), 30), customerPoNo: 'RAF/PO/88' });
    ctx.inv = await submit('/sales/invoices', inv);
    expect(ctx.inv.number).toMatch(/^INV\/\d{2}-\d{2}\/\d+$/);
    expect(ctx.inv.number.length).toBeLessThanOrEqual(16);
    expect(ctx.inv).toMatchObject({ costTotal: '3000.00', marginPct: '38.78', outstanding: '5782.00' });
    expect((await a.client.get(`/sales/orders/${ctx.so.id}`)).body.status).toBe('completed');

    const print = (await a.client.get(`/documents/${ctx.inv.id}/print`)).body.html;
    expect(print).toContain('Tax Invoice');
    expect(print).toContain('39231090');
    expect(print).toContain('Telangana (36)');
    expect(print).toContain('Five Thousand Seven Hundred Eighty Two');
    expect(print).toContain('Tax payable on reverse charge: No');
  });

  it('invoice-cum-challan: goods and services billed straight from the order, inter-state', async () => {
    const so = await submit('/sales/orders', await created('/sales/orders', { customerId: cust.mh.id, lines: [{ itemId: item.crate.id, qty: '10' }, { itemId: item.install.id, qty: '1' }] }));
    const inv = await created('/sales/invoices', {
      customerId: cust.mh.id,
      vehicleNo: 'MH12AB1234',
      lines: so.lines.map((l: any) => ({ soLineId: l.id, itemId: l.itemId, qty: l.qty })),
    });
    // 10 × 250 + 1500 = 4000; IGST 720.
    expect(inv).toMatchObject({ interState: true, placeOfSupply: '27', igstTotal: '720.00', grandTotal: '4720.00', dueDate: addDays(today(), 15) });
    const posted = await submit('/sales/invoices', inv);
    expect(posted.costTotal).toBe('1500.00');
    expect(await onHand(item.crate.id)).toMatchObject({ qty: '70.0000' });
    expect((await a.client.get(`/sales/orders/${so.id}`)).body.status).toBe('completed');
    ctx.mhInv = posted;
  });

  it('exports under LUT are zero-rated', async () => {
    const inv = await created('/sales/invoices', { customerId: cust.export.id, withLut: true, lines: [{ itemId: item.crate.id, qty: '5', rate: '300' }] });
    expect(inv).toMatchObject({ taxKind: 'export', placeOfSupply: '96', taxTotal: '0.00', grandTotal: '1500.00' });
    expect(inv.taxNotes[0]).toMatch(/export under LUT/);
  });

  it('batch-tracked goods need a batch to dispatch', async () => {
    const so = await submit('/sales/orders', await created('/sales/orders', { customerId: cust.mh.id, lines: [{ itemId: item.glue.id, qty: '5' }] }));
    const noBatch = await a.client.post('/sales/deliveries', { orderId: so.id, lines: [{ soLineId: so.lines[0].id, qty: '5' }] });
    expect(noBatch.body.errors[0].path).toBe('lines.0.batchNo');
    const dlv = await submit('/sales/deliveries', await created('/sales/deliveries', { orderId: so.id, lines: [{ soLineId: so.lines[0].id, qty: '5', batchNo: 'a1' }] }));
    expect(dlv.lines[0]).toMatchObject({ batchNo: 'A1', costValue: '1000.00' });
  });
});

describe('returns, credit notes and receivables', () => {
  it('takes goods back at the cost they left at', async () => {
    const cn = await created('/sales/credit-notes', { invoiceId: ctx.inv.id, kind: 'return', reason: 'Damaged in transit', lines: [{ invoiceLineId: ctx.inv.lines[0].id, qty: '5' }] });
    // 5 × 245 net = 1225 + 18% = 1445.50 → 1446.
    expect(cn).toMatchObject({ taxableTotal: '1225.00', grandTotal: '1446.00', warehouse: { code: 'MAIN' } });
    const posted = await submit('/sales/credit-notes', cn);
    expect(posted.number).toMatch(/^CN\//);
    expect(await onHand(item.crate.id)).toMatchObject({ qty: '75.0000' });
    const inv = (await a.client.get(`/sales/invoices/${ctx.inv.id}`)).body;
    expect(inv).toMatchObject({ creditedAmount: '1446.00', outstanding: '4336.00' });
    expect(inv.lines[0].returnedQty).toBe('5.0000');
  });

  it('blocks cancelling what later documents depend on', async () => {
    const inv = (await a.client.get(`/sales/invoices/${ctx.inv.id}`)).body;
    expect((await a.client.post(`/sales/invoices/${ctx.inv.id}/cancel`, { version: inv.version, reason: 'Wrong customer' })).status).toBe(409);
    const dlv = (await a.client.get(`/sales/deliveries/${ctx.dlv.id}`)).body;
    expect((await a.client.post(`/sales/deliveries/${ctx.dlv.id}/cancel`, { version: dlv.version, reason: 'Wrong customer' })).status).toBe(409);
  });

  it('price adjustment reduces what is owed without touching stock', async () => {
    const before = await onHand(item.crate.id);
    const cn = await submit('/sales/credit-notes', await created('/sales/credit-notes', { invoiceId: ctx.mhInv.id, kind: 'price_adjustment', reason: 'Rate correction', lines: [{ invoiceLineId: ctx.mhInv.lines[0].id, qty: '10', rate: '20' }] }));
    expect(cn).toMatchObject({ interState: true, taxableTotal: '200.00', igstTotal: '36.00', grandTotal: '236.00' });
    expect(await onHand(item.crate.id)).toMatchObject({ qty: before.qty });
  });

  it('ages receivables by due date', async () => {
    const r = (await a.client.get('/sales/receivables')).body;
    const local = r.customers.find((c: any) => c.customerId === cust.local.id);
    expect(local).toMatchObject({ invoices: 1, total: '4336.00', notDue: '4336.00' });
    expect(r.totals.total).toBe('8820.00'); // 4336 + (4720 − 236)
  });
});
