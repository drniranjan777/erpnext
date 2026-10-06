import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let wh: Record<string, string> = {};
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
async function ok(res: { status: number; body: any }, status = 200) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
}
async function submit(path: string, doc: any) {
  return ok(await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version }));
}
async function closing(key: string) {
  const t = (await a.client.get(`/accounting/trial-balance?to=${addDays(today(), 30)}`)).body;
  expect(t.balanced).toBe(true);
  return t.rows.find((r: any) => r.systemKey === key || r.id === key)?.closing;
}
const invoice = async (qty: string, rate = '100') => submit('/sales/invoices', await created('/sales/invoices', { customerId: party.customer.id, warehouseId: wh.MAIN, lines: [{ itemId: item.crate.id, qty, rate }] }));
const money = async (body: Record<string, unknown>) => submit(`/accounting/money/${body.kind}`, await created('/accounting/money', body));

beforeAll(async () => {
  a = await signupWorkspace('ar-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.crate = await created('/masters/items', { name: 'Crate', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39231090' });
  item.service = await created('/masters/items', { name: 'Maintenance', type: 'service', baseUomId: uom.NOS, gstRate: 18, hsnCode: '998719' });
  await submit('/inventory/stock-entries', await created('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.crate.id, qty: '1000', rate: '50' }] }));
  const addr = (stateCode: string, city: string, pincode: string) => [{ type: 'both', line1: 'Main road', city, stateCode, pincode, isDefault: true }];
  party.customer = await created('/masters/parties', { name: 'Pune Cold Chain', isCustomer: true, gstin: CUSTOMER, email: 'accounts@example.com', creditDays: 15, addresses: addr('27', 'Pune', '411001') });
  party.vendor = await created('/masters/parties', { name: 'Sharma Polymers', isVendor: true, gstin: VENDOR, msmeCategory: 'micro', msmeUdyamNo: 'UDYAM-TS-02-0012345', creditDays: 30, addresses: addr('36', 'Hyderabad', '500055'), bankAccounts: [{ accountName: 'Sharma Polymers', accountNumber: '50200012345678', ifsc: 'HDFC0000123', bankName: 'HDFC Bank', isPrimary: true }] });
  const list = (await a.client.get('/accounting/accounts')).body;
  acc.cash = list.find((r: any) => r.code === '5310');
  const banks = list.find((r: any) => r.code === '5320');
  acc.bank = await created('/accounting/accounts', { parentId: banks.id, code: '5321', name: 'HDFC current', accountType: 'bank' });
  acc.rent = list.find((r: any) => r.code === '9560');
  acc.interest = list.find((r: any) => r.systemKey === 'interest_income');
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('receipts', () => {
  it('settles invoices bill-wise with customer TDS and bank charges; the rest stays on account', async () => {
    ctx.inv1 = await invoice('10'); // 1000 + 180 IGST = 1180
    ctx.inv2 = await invoice('20'); // 2360
    const r = await money({ kind: 'receipt', partyId: party.customer.id, accountId: acc.bank.id, mode: 'neft', amount: '3400', tdsDeducted: '20', bankCharges: '10', allocations: [{ againstDocId: ctx.inv1.id, amount: '1180' }], autoAllocate: true, reference: 'UTR778899' });
    // Settled 3430: 1180 to INV1, 2250 FIFO to INV2, nothing on account.
    expect(r).toMatchObject({ status: 'approved', settledAmount: '3430.00', onAccount: '0.00' });
    expect(r.number).toMatch(/^RV\//);
    expect(r.allocations.map((x: any) => [x.number, x.amount])).toEqual([
      [ctx.inv1.number, '1180.00'],
      [ctx.inv2.number, '2250.00'],
    ]);
    expect((await a.client.get(`/sales/invoices/${ctx.inv1.id}`)).body.outstanding).toBe('0.00');
    expect((await a.client.get(`/sales/invoices/${ctx.inv2.id}`)).body.outstanding).toBe('110.00');
    expect(await closing(acc.bank.id)).toBe('3400.00');
    expect(await closing('tds_receivable')).toBe('20.00');
    expect(await closing('bank_charges')).toBe('10.00');
    expect(await closing('receivable')).toBe('110.00');
    ctx.r1 = r;
  });

  it('refuses over-allocation and cash without a party or account', async () => {
    const over = await a.client.post('/accounting/money', { kind: 'receipt', partyId: party.customer.id, accountId: acc.bank.id, amount: '500', allocations: [{ againstDocId: ctx.inv2.id, amount: '500' }] });
    expect(over.body.errors[0].message).toMatch(/Only ₹110.00 is outstanding/);
    const neither = await a.client.post('/accounting/money', { kind: 'receipt', accountId: acc.bank.id, amount: '500' });
    expect(neither.body.errors[0].path).toBe('partyId');
    const notBank = await a.client.post('/accounting/money', { kind: 'receipt', partyId: party.customer.id, accountId: acc.rent.id, amount: '500' });
    expect(notBank.body.errors[0].path).toBe('accountId');
  });

  it('keeps an advance on account and adjusts it against a later invoice', async () => {
    const adv = await money({ kind: 'receipt', partyId: party.customer.id, accountId: acc.cash.id, mode: 'cash', amount: '1000' });
    expect(adv.onAccount).toBe('1000.00');
    expect(await closing('receivable')).toBe('-890.00');
    const inv3 = await invoice('5'); // 590
    const adj = await ok(await a.client.post(`/accounting/money/receipt/${adv.id}/adjust`, { againstDocId: inv3.id, amount: '590' }));
    expect(adj).toMatchObject({ onAccount: '410.00' });
    expect(adj.allocations[0]).toMatchObject({ number: inv3.number, amount: '590.00' });
    expect((await a.client.get(`/sales/invoices/${inv3.id}`)).body.outstanding).toBe('0.00');
    // Same party balance: the adjustment only moves the credit to the bill.
    expect(await closing('receivable')).toBe('-300.00');
    const bills = (await a.client.get(`/accounting/open-bills?partyId=${party.customer.id}&side=receivable`)).body;
    expect(bills.bills.map((b: any) => b.number)).toEqual([ctx.inv2.number]);
    expect(bills.advances[0]).toMatchObject({ number: adv.number, onAccount: '410.00' });
    expect((await a.client.post(`/accounting/money/receipt/${adv.id}/adjust`, { againstDocId: ctx.inv2.id, amount: '200' })).body.errors[0].message).toMatch(/Only ₹110.00/);
    // An advance with adjustments cannot be cancelled.
    const cur = (await a.client.get(`/accounting/money/receipt/${adv.id}`)).body;
    expect((await a.client.post(`/accounting/money/receipt/${adv.id}/cancel`, { version: cur.version, reason: 'Wrong customer' })).status).toBe(409);
  });

  it('a bounced cheque cancels the receipt and reopens the bill', async () => {
    const inv = await invoice('1'); // 118
    const r = await money({ kind: 'receipt', partyId: party.customer.id, accountId: acc.bank.id, mode: 'cheque', instrumentNo: '004512', instrumentDate: today(), amount: '118', allocations: [{ againstDocId: inv.id, amount: '118' }] });
    expect(r.chequeStatus).toBe('pending');
    const bounced = await ok(await a.client.post(`/accounting/money/receipt/${r.id}/cheque`, { status: 'bounced', reason: 'Insufficient funds' }));
    expect(bounced).toMatchObject({ status: 'cancelled', chequeStatus: 'bounced' });
    expect((await a.client.get(`/sales/invoices/${inv.id}`)).body.outstanding).toBe('118.00');
    ctx.inv4 = inv;
  });

  it('writes off a bad debt to the bad debts account', async () => {
    const w = await ok(await a.client.post('/accounting/write-off', { invoiceId: ctx.inv4.id, reason: 'Customer closed down' }));
    expect(w).toMatchObject({ status: 'approved', mode: 'write_off', amount: '118.00' });
    expect(await closing('bad_debts')).toBe('118.00');
    expect((await a.client.get(`/sales/invoices/${ctx.inv4.id}`)).body.outstanding).toBe('0.00');
  });
});

describe('payables, contra and payment runs', () => {
  it('pays a vendor bill, and a contra moves cash to the bank', async () => {
    const pi = await submit('/purchase/invoices', await created('/purchase/invoices', { vendorId: party.vendor.id, supplierInvoiceNo: 'SP/901', supplierInvoiceDate: today(), lines: [{ itemId: item.service.id, qty: '1', rate: '5000' }] }));
    ctx.pi = pi; // 5900
    const p = await money({ kind: 'payment', partyId: party.vendor.id, accountId: acc.bank.id, mode: 'neft', amount: '2000', bankCharges: '5', allocations: [{ againstDocId: pi.id, amount: '2000' }] });
    expect(p.number).toMatch(/^PV\//);
    expect((await a.client.get(`/purchase/invoices/${pi.id}`)).body.outstanding).toBe('3900.00');
    expect(await closing('payable')).toBe('-3900.00');
    const c = await money({ kind: 'contra', accountId: acc.cash.id, counterAccountId: acc.bank.id, mode: 'cash', amount: '400' });
    expect(c.number).toMatch(/^CV\//);
    // Bank: 3400 receipt − 2005 payment + 400 contra.
    expect(await closing(acc.bank.id)).toBe('1795.00');
    expect(await closing(acc.cash.id)).toBe('600.00');
    const exp = await money({ kind: 'payment', accountId: acc.cash.id, counterAccountId: acc.rent.id, mode: 'cash', amount: '100', narration: 'Office rent advance' });
    expect(exp.status).toBe('approved');
  });

  it('proposes bills by due date with MSME vendors first, pays them in a run and exports the bank file', async () => {
    const prop = (await a.client.get(`/accounting/payment-proposal?dueBy=${addDays(today(), 60)}`)).body;
    expect(prop.bills[0]).toMatchObject({ billId: ctx.pi.id, msme: 'micro', outstanding: '3900.00', hasBank: true });
    const run = await ok(await a.client.post('/accounting/payment-run', { accountId: acc.bank.id, mode: 'neft', items: [{ billId: ctx.pi.id, amount: '3900' }] }));
    expect(run.payments).toBe(1);
    expect((await a.client.get(`/purchase/invoices/${ctx.pi.id}`)).body.outstanding).toBe('0.00');
    const file = await a.client.download(`/accounting/bank-file?ids=${run.ids.join(',')}`);
    const text = new TextDecoder().decode(file.bytes);
    expect(text).toContain('NEFT,Sharma Polymers,50200012345678,HDFC0000123');
    expect(text).toContain('3900.00');
  });
});

describe('ageing, interest, statements, reminders', () => {
  it('ages receivables with configurable buckets and shows advances', async () => {
    const r = (await a.client.get(`/accounting/ageing?side=receivable&buckets=15,45&asOf=${addDays(today(), 40)}`)).body;
    expect(r.labels).toEqual(['Not due', '1–15', '16–45', 'Over 45']);
    const c = r.parties.find((p: any) => p.partyId === party.customer.id);
    // INV2's 110 was due in 15 days → 25 days overdue on the as-of date.
    expect(c).toMatchObject({ total: '110.00', advance: '410.00', net: '-300.00' });
    expect(c.buckets).toEqual(['0.00', '0.00', '110.00', '0.00']);
  });

  it('computes interest on overdue bills and builds the customer statement', async () => {
    const i = (await a.client.get(`/accounting/interest?ratePct=18&asOf=${addDays(today(), 40)}`)).body;
    expect(i.bills[0]).toMatchObject({ number: ctx.inv2.number, days: 25, interest: '1.36' });
    const s = (await a.client.get(`/accounting/statement/${party.customer.id}`)).body;
    expect(s.party.name).toBe('Pune Cold Chain');
    expect(s.ledger.closing).toBe('-300.00');
    expect(s.openBills.map((b: any) => b.number)).toEqual([ctx.inv2.number]);
  });

  it('emails reminders only to customers with overdue bills', async () => {
    const none = (await a.client.post('/accounting/dunning', {})).body;
    expect(none.sent).toBe(0);
    const any = (await a.client.post('/accounting/dunning', { minDaysOverdue: 0 })).body;
    expect(any.sent).toBe(0); // nothing is past its due date yet
  });
});

describe('bank reconciliation', () => {
  it('imports a statement, auto-matches by reference and amount, records charges, and reconciles', async () => {
    const d = (n: number) => addDays(today(), n).split('-').reverse().join('/');
    const csv = `HDFC BANK Ltd.
Account No :,50200099999999

Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
${d(0)},NEFT CR PUNE COLD CHAIN UTR778899,UTR778899,${d(0)},,"3,400.00","3,400.00"
${d(1)},NEFT DR SHARMA POLYMERS,,${d(1)},"2,005.00",,"1,395.00"
${d(1)},CASH DEPOSIT,,${d(1)},,400.00,"1,795.00"
${d(2)},NEFT DR SHARMA POLYMERS RUN,,${d(2)},"3,900.00",,"-2,105.00"
${d(3)},INTEREST CREDIT,,${d(3)},,12.50,"-2,092.50"
`;
    const r = await ok(await a.client.upload(`/accounting/bank/${acc.bank.id}/statement`, 'hdfc.csv', csv, 'text/csv'));
    expect(r).toMatchObject({ imported: 5, duplicates: 0, matched: 4, totalLines: 5, matchedLines: 4 });
    // The same file again adds nothing.
    expect((await ok(await a.client.upload(`/accounting/bank/${acc.bank.id}/statement`, 'hdfc.csv', csv, 'text/csv'))).imported).toBe(0);
    const lines = (await a.client.get(`/accounting/bank/${acc.bank.id}/lines`)).body;
    const byRef = lines.lines.find((l: any) => l.reference === 'UTR778899');
    expect(byRef).toMatchObject({ status: 'matched', matchedBy: 'reference' });
    const interest = lines.lines.find((l: any) => l.description === 'INTEREST CREDIT');
    expect(interest.status).toBe('unmatched');
    // Record the interest straight from the statement line.
    const rec = await ok(await a.client.post(`/accounting/bank/lines/${interest.id}/record`, { counterAccountId: acc.interest.id }));
    expect(rec.number).toMatch(/^RV\//);
    const brs = (await a.client.get(`/accounting/bank/${acc.bank.id}/brs?asOf=${addDays(today(), 3)}`)).body;
    expect(brs).toMatchObject({ balanceAsPerBooks: '-2092.50', statementBalance: '-2092.50', expectedBankBalance: '-2092.50', difference: '0.00' });
    expect(brs.depositsNotCredited.entries).toEqual([]);
    expect(brs.paymentsNotPresented.entries).toEqual([]);
  });
});
