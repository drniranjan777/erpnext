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
const acc: Record<string, any> = {};
const ctx: Record<string, any> = {};

const OUR_GSTIN = '36AABCS1234E1ZU';
const VENDOR = '36AABCD1234E1Z9';
const CUSTOMER = '27AAACN0000A1ZL';
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

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
async function tb() {
  const r = await a.client.get(`/accounting/trial-balance?to=${addDays(today(), 60)}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}
const closing = (t: any, key: string) => t.rows.find((r: any) => r.systemKey === key)?.closing;
async function voucher(id: string) {
  const r = await a.client.get(`/accounting/day-book?from=${addDays(today(), -400)}&to=${addDays(today(), 60)}`);
  return r.body.vouchers.filter((v: any) => v.voucherId === id);
}

beforeAll(async () => {
  a = await signupWorkspace('gl-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  companyId = company.id;
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.crate = await created('/masters/items', { name: 'Moulded crate', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39231090', sellingRate: '250' });
  item.resin = await created('/masters/items', { name: 'HDPE resin', type: 'raw_material', baseUomId: uom.KG, gstRate: 18, hsnCode: '39012000' });
  const addr = (stateCode: string, city: string, pincode: string) => [{ type: 'both', line1: 'Main road', city, stateCode, pincode, isDefault: true }];
  party.vendor = await created('/masters/parties', { name: 'Sharma Polymers', isVendor: true, gstin: VENDOR, addresses: addr('36', 'Hyderabad', '500055') });
  party.customer = await created('/masters/parties', { name: 'Pune Cold Chain', isCustomer: true, gstin: CUSTOMER, addresses: addr('27', 'Pune', '411001') });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('books and chart of accounts', () => {
  it('sets up a Schedule III chart with system accounts on first use', async () => {
    const s = (await a.client.get('/accounting/settings')).body;
    expect(s).toMatchObject({ companyId, lockedUntil: null, unposted: 0 });
    expect(s.booksFrom).toMatch(/-04-01$/);
    const list = (await a.client.get('/accounting/accounts')).body;
    for (const r of list) if (r.systemKey) acc[r.systemKey] = r;
    expect(acc.receivable).toMatchObject({ code: '5210', isGroup: false, nature: 'asset' });
    expect(acc.payable).toMatchObject({ code: '3210', nature: 'liability' });
    acc.cash = list.find((r: any) => r.code === '5310');
    acc.rent = list.find((r: any) => r.code === '9560');
    acc.provisions = list.find((r: any) => r.code === '3500');
    acc.banks = list.find((r: any) => r.code === '5320');
    expect(acc.banks.isGroup).toBe(true);
  });

  it('adds accounts under groups, inheriting their nature', async () => {
    const bank = await created('/accounting/accounts', { parentId: acc.banks.id, code: '5321', name: 'HDFC current account', accountType: 'bank' });
    expect(bank).toMatchObject({ nature: 'asset', reportLine: 'bs.ca.cash', isGroup: false });
    acc.hdfc = bank;
    expect((await a.client.post('/accounting/accounts', { parentId: acc.cash.id, code: '5399', name: 'Under an account' })).status).toBe(400);
    expect((await a.client.post('/accounting/accounts', { parentId: acc.banks.id, code: '5321', name: 'Duplicate' })).status).toBe(409);
    expect((await a.client.request('PUT', `/accounting/accounts/${acc.stock.id}`, { isActive: false })).status).toBe(409);
  });
});

describe('automatic postings', () => {
  it('opening stock: Dr stock, Cr opening balance difference', async () => {
    const e = await submit('/inventory/stock-entries', await created('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.crate.id, qty: '100', rate: '150' }] }));
    const [v] = await voucher(e.id);
    expect(v.lines.map((l: any) => [l.accountCode, l.debit, l.credit])).toEqual(
      expect.arrayContaining([
        ['5110', '15000.00', '0.00'],
        ['1220', '0.00', '15000.00'],
      ]),
    );
  });

  it('GRN to GRNI, then the bill clears GRNI with input GST and the vendor payable', async () => {
    const po = await submit('/purchase/orders', await created('/purchase/orders', { vendorId: party.vendor.id, lines: [{ itemId: item.resin.id, qty: '100', rate: '100' }] }));
    const grn = await submit('/purchase/receipts', await created('/purchase/receipts', { poId: po.id, lines: [{ poLineId: po.lines[0].id, receivedQty: '100' }] }));
    let t = await tb();
    expect(closing(t, 'grni')).toBe('-10000.00');
    expect(closing(t, 'stock')).toBe('25000.00');
    const billable = (await a.client.get(`/purchase/invoices/billable?vendorId=${party.vendor.id}`)).body.grnLines[0];
    const pi = await submit('/purchase/invoices', await created('/purchase/invoices', { vendorId: party.vendor.id, supplierInvoiceNo: 'SP/77', supplierInvoiceDate: today(), lines: [{ grnLineId: billable.grnLineId, itemId: item.resin.id, qty: '100', rate: '100.5' }] }));
    ctx.pi = pi;
    t = await tb();
    expect(closing(t, 'grni')).toBe('0.00');
    expect(closing(t, 'ppv')).toBe('50.00');
    expect(closing(t, 'gst_in_cgst')).toBe('904.50');
    expect(closing(t, 'gst_in_sgst')).toBe('904.50');
    // 10050 + 1809 = 11859
    expect(closing(t, 'payable')).toBe('-11859.00');
    void grn;
  });

  it('sales invoice: receivable, sales, output IGST and cost of goods sold', async () => {
    const inv = await submit('/sales/invoices', await created('/sales/invoices', { customerId: party.customer.id, warehouseId: wh.MAIN, lines: [{ itemId: item.crate.id, qty: '10', rate: '250' }] }));
    ctx.inv = inv;
    const t = await tb();
    expect(closing(t, 'receivable')).toBe('2950.00');
    expect(closing(t, 'sales')).toBe('-2500.00');
    expect(closing(t, 'gst_out_igst')).toBe('-450.00');
    expect(closing(t, 'cogs')).toBe('1500.00');
    expect(closing(t, 'stock')).toBe('23500.00');
    expect(t.balanced).toBe(true);
  });

  it('credit note reverses part of it against the invoice, bill-wise', async () => {
    const inv = (await a.client.get(`/sales/invoices/${ctx.inv.id}`)).body;
    ctx.cn = await submit('/sales/credit-notes', await created('/sales/credit-notes', { invoiceId: inv.id, kind: 'price_adjustment', reason: 'Rate difference', lines: [{ invoiceLineId: inv.lines[0].id, qty: '10', rate: '10' }] }));
    const t = await tb();
    expect(closing(t, 'receivable')).toBe('2832.00');
    expect(closing(t, 'sales_returns')).toBe('100.00');
    expect(closing(t, 'gst_out_igst')).toBe('-432.00');
    const led = (await a.client.get(`/accounting/ledger?partyId=${party.customer.id}`)).body;
    expect(led.entries.map((e: any) => [e.debit, e.credit, e.against])).toEqual([
      ['2950.00', '0.00', inv.number],
      ['0.00', '118.00', inv.number],
    ]);
    expect(led.closing).toBe('2832.00');
  });

  it('cancelling a document writes reversal entries', async () => {
    const cn = (await a.client.get(`/sales/credit-notes/${ctx.cn.id}`)).body;
    expect((await a.client.post(`/sales/credit-notes/${cn.id}/cancel`, { version: cn.version, reason: 'Raised by mistake' })).status).toBe(200);
    const t = await tb();
    expect(closing(t, 'receivable')).toBe('2950.00');
    expect(closing(t, 'sales_returns')).toBe('0.00');
    const vs = await voucher(cn.id);
    expect(vs.map((v: any) => v.isReversal).sort()).toEqual([false, true]);
  });
});

describe('journal vouchers', () => {
  it('validates balance, control accounts and system-only accounts', async () => {
    const unbalanced = await a.client.post('/accounting/journals', { lines: [{ accountId: acc.rent.id, debit: '100' }, { accountId: acc.cash.id, credit: '90' }] });
    expect(unbalanced.status).toBe(400);
    expect(unbalanced.body.errors[0].path).toBe('lines');
    const noParty = await a.client.post('/accounting/journals', { lines: [{ accountId: acc.receivable.id, debit: '100' }, { accountId: acc.cash.id, credit: '100' }] });
    expect(noParty.body.errors[0].path).toBe('lines.0.partyId');
    const stock = await a.client.post('/accounting/journals', { lines: [{ accountId: acc.stock.id, debit: '100' }, { accountId: acc.cash.id, credit: '100' }] });
    expect(stock.body.errors[0].message).toMatch(/posted only by documents/);
  });

  it('posts a journal with a cost centre and shows it in the ledger', async () => {
    const cc = await created('/accounting/cost-centers', { code: 'PLANT1', name: 'Plant 1' });
    const jv = await submit('/accounting/journals', await created('/accounting/journals', { narration: 'October rent', lines: [{ accountId: acc.rent.id, debit: '5000', costCenterId: cc.id }, { accountId: acc.hdfc.id, credit: '5000' }] }));
    expect(jv).toMatchObject({ status: 'approved', totalDebit: '5000.00' });
    expect(jv.number).toMatch(/^JV\//);
    const led = (await a.client.get(`/accounting/ledger?accountId=${acc.hdfc.id}`)).body;
    expect(led).toMatchObject({ closing: '-5000.00', credit: '5000.00' });
    expect(led.entries[0]).toMatchObject({ voucherNumber: jv.number, narration: 'October rent' });
  });

  it('reversing journal posts its mirror on the reversal date', async () => {
    const jv = await submit('/accounting/journals', await created('/accounting/journals', { kind: 'reversing', reverseOn: addDays(today(), 31), narration: 'Power accrual', lines: [{ accountId: acc.rent.id, debit: '1200' }, { accountId: acc.provisions.id, credit: '1200' }] }));
    expect(jv.related).toHaveLength(1);
    const mirror = (await a.client.get(`/accounting/journals/${jv.related[0].id}`)).body;
    expect(mirror).toMatchObject({ status: 'approved', docDate: addDays(today(), 31), reversalOfId: jv.id });
    expect(mirror.lines.map((l: any) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['9560', '0.00', '1200.00'],
      ['3500', '1200.00', '0.00'],
    ]);
    // Before the reversal date the accrual stands; after it, it is gone.
    const now = (await a.client.get(`/accounting/trial-balance?to=${today()}`)).body;
    expect(now.rows.find((r: any) => r.code === '3500').closing).toBe('-1200.00');
    const later = await tb();
    expect(later.rows.find((r: any) => r.code === '3500').closing).toBe('0.00');
  });
});

describe('controls', () => {
  it('locks the period: nothing posts on or before the lock date', async () => {
    await a.client.request('PUT', `/accounting/settings/${companyId}`, { lockedUntil: today() });
    const jv = await created('/accounting/journals', { lines: [{ accountId: acc.rent.id, debit: '10' }, { accountId: acc.cash.id, credit: '10' }] });
    const res = await a.client.post(`/accounting/journals/${jv.id}/submit`, { version: jv.version });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/locked/);
    // Operational documents are held back too.
    const inv = await created('/sales/invoices', { customerId: party.customer.id, warehouseId: wh.MAIN, lines: [{ itemId: item.crate.id, qty: '1', rate: '250' }] });
    expect((await a.client.post(`/sales/invoices/${inv.id}/submit`, { version: inv.version })).status).toBe(409);
    expect((await a.client.request('PUT', `/accounting/settings/${companyId}`, { lockedUntil: addDays(today(), 5) })).status).toBe(400);
    await a.client.request('PUT', `/accounting/settings/${companyId}`, { lockedUntil: null });
    expect((await a.client.post(`/accounting/journals/${jv.id}/submit`, { version: jv.version })).status).toBe(200);
  });

  it('back-posting is idempotent and the trial balance always balances', async () => {
    const r = (await a.client.post(`/accounting/settings/${companyId}/initialise`)).body;
    expect(r.posted).toBe(0);
    expect(r.skipped).toBeGreaterThan(3);
    const t = await tb();
    expect(t.balanced).toBe(true);
    expect(t.totals.closingDebit).toBe(t.totals.closingCredit);
    // Groups roll up their children.
    const ca = t.rows.find((x: any) => x.code === '5000');
    const kids = t.rows.filter((x: any) => x.parentId === ca.id);
    expect(kids.reduce((s: number, k: any) => s + Number(k.closing), 0).toFixed(2)).toBe(ca.closing);
  });
});
