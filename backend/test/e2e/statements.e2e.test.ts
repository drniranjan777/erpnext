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
const fyStart = () => {
  const [y, m] = today().split('-').map(Number);
  return m >= 4 ? y : y - 1;
};

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
const line = (s: any, key: string) => [...s.equityAndLiabilities.groups, ...s.assets.groups].flatMap((g: any) => g.lines).find((l: any) => l.key === key);

beforeAll(async () => {
  a = await signupWorkspace('fs-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  companyId = company.id;
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.crate = await created('/masters/items', { name: 'Crate', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39231090' });
  item.service = await created('/masters/items', { name: 'Maintenance', type: 'service', baseUomId: uom.NOS, gstRate: 18, hsnCode: '998719' });
  const addr = (stateCode: string, city: string, pincode: string) => [{ type: 'both', line1: 'Main road', city, stateCode, pincode, isDefault: true }];
  party.customer = await created('/masters/parties', { name: 'Pune Cold Chain', isCustomer: true, gstin: CUSTOMER, creditDays: 30, addresses: addr('27', 'Pune', '411001') });
  party.vendor = await created('/masters/parties', { name: 'Deccan Services', isVendor: true, gstin: VENDOR, addresses: addr('36', 'Hyderabad', '500055') });
  party.overseas = await created('/masters/parties', { name: 'Acme Inc', isVendor: true, gstRegistrationType: 'overseas' });
  const list = (await a.client.get('/accounting/accounts')).body;
  for (const r of list) if (r.systemKey) acc[r.systemKey] = r;
  acc.bank = await created('/accounting/accounts', { parentId: list.find((r: any) => r.code === '5320').id, code: '5321', name: 'HDFC current', accountType: 'bank' });
  acc.plant = list.find((r: any) => r.code === '4110');
  // Capital, opening stock, a sale, a service bill, a machine.
  await submit('/accounting/journals', await created('/accounting/journals', { narration: 'Capital introduced', lines: [{ accountId: acc.bank.id, debit: '200000' }, { accountId: acc.share_capital.id, credit: '200000' }] }));
  await submit('/inventory/stock-entries', await created('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.crate.id, qty: '100', rate: '50' }] }));
  await submit('/sales/invoices', await created('/sales/invoices', { customerId: party.customer.id, warehouseId: wh.MAIN, lines: [{ itemId: item.crate.id, qty: '10', rate: '250' }] }));
  await submit('/purchase/invoices', await created('/purchase/invoices', { vendorId: party.vendor.id, supplierInvoiceNo: 'DS/1', supplierInvoiceDate: today(), lines: [{ itemId: item.service.id, qty: '1', rate: '1000' }] }));
  await submit('/accounting/journals', await created('/accounting/journals', { narration: 'Machine bought', lines: [{ accountId: acc.plant.id, debit: '50000' }, { accountId: acc.bank.id, credit: '50000' }] }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('financial statements', () => {
  it('Statement of Profit and Loss on Schedule III', async () => {
    const pl = await ok(await a.client.get(`/accounting/statements/profit-and-loss?to=${today()}`));
    expect(pl.income[0]).toMatchObject({ key: 'revenue', amount: '2500.00', previous: '0.00' });
    expect(pl.expenses.find((l: any) => l.key === 'materials').amount).toBe('500.00');
    expect(pl.expenses.find((l: any) => l.key === 'other_expenses').amount).toBe('1000.00');
    expect(pl.profitBeforeTax.amount).toBe('1000.00');
  });

  it('Balance Sheet balances and reclassifies balances by nature', async () => {
    const bs = await ok(await a.client.get(`/accounting/statements/balance-sheet?to=${today()}`));
    expect(bs.balanced).toBe(true);
    expect(line(bs, 'share_capital').amount).toBe('200000.00');
    // Reserves: opening stock difference 5000 + profit 1000.
    expect(line(bs, 'reserves').amount).toBe('6000.00');
    expect(line(bs, 'trade_receivables').amount).toBe('2950.00');
    expect(line(bs, 'trade_payables').amount).toBe('1180.00');
    expect(line(bs, 'inventories').amount).toBe('4500.00');
    expect(line(bs, 'ppe').amount).toBe('50000.00');
    expect(line(bs, 'cash').amount).toBe('150000.00');
    expect(bs.assets.total).toBe(bs.equityAndLiabilities.total);
  });

  it('Cash flow (indirect) reconciles to the change in cash', async () => {
    const cf = await ok(await a.client.get(`/accounting/statements/cash-flow?to=${today()}`));
    expect(cf.difference).toBe('0.00');
    expect(cf.closingCash).toBe('150000.00');
    expect(cf.investing.total).toBe('-50000.00');
    // Share capital 200000 + opening stock difference (non-cash, offset in inventories).
    expect(cf.financing.total).toBe('205000.00');
    expect(Number(cf.operating.total) + Number(cf.investing.total) + Number(cf.financing.total)).toBe(150000);
  });

  it('ratios', async () => {
    const r = await ok(await a.client.get(`/accounting/statements/ratios?to=${today()}`));
    expect(r.grossMarginPct).toBe(80);
    expect(r.netMarginPct).toBe(40);
    expect(r.currentRatio).toBeGreaterThan(1);
  });
});

describe('budgets', () => {
  it('blocks a purchase order over budget, warns when set to warn', async () => {
    const b = await created('/accounting/budgets', { fy: fyStart(), name: 'Overheads', control: 'block', lines: [{ accountId: acc.purchase_services.id, annual: '1500' }] });
    expect(b.rows[0]).toMatchObject({ budget: '1500.00', actual: '1000.00', variance: '500.00' });
    expect(b.rows[0].months[0].budget).toBe('125.00');
    const po = await created('/purchase/orders', { vendorId: party.vendor.id, poType: 'service', lines: [{ itemId: item.service.id, qty: '1', rate: '800' }] });
    const res = await a.client.post(`/purchase/orders/${po.id}/submit`, { version: po.version });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/Over budget/);
    await ok(await a.client.request('PUT', `/accounting/budgets/${b.id}`, { fy: fyStart(), name: 'Overheads', control: 'warn', lines: [{ accountId: acc.purchase_services.id, annual: '1500' }] }));
    const fresh = (await a.client.get(`/purchase/orders/${po.id}`)).body;
    expect((await submit('/purchase/orders', fresh)).status).toBe('approved');
    const act = (await a.client.get(`/documents/${po.id}/activity`)).body;
    expect(JSON.stringify(act)).toMatch(/Budget warning/);
  });
});

describe('close', () => {
  it('revalues foreign-currency bills at the closing rate with a reversing journal', async () => {
    await submit('/purchase/invoices', await created('/purchase/invoices', { vendorId: party.overseas.id, supplierInvoiceNo: 'ACME-77', supplierInvoiceDate: today(), currency: 'USD', exchangeRate: '80', lines: [{ itemId: item.service.id, qty: '1', rate: '0', foreignRate: '100' }] }));
    const r = await ok(await a.client.post('/accounting/revalue', { date: today(), rates: [{ currency: 'USD', rate: '83.5' }] }));
    expect(r).toMatchObject({ bills: 1, net: '350.00' });
    expect(r.detail[0]).toMatchObject({ foreign: '100.00', bookRate: '80.0000', closingRate: '83.5000', difference: '350.00' });
    const t = (await a.client.get(`/accounting/trial-balance?to=${today()}`)).body;
    expect(t.rows.find((x: any) => x.systemKey === 'fx_gain_loss').closing).toBe('350.00');
    const t2 = (await a.client.get(`/accounting/trial-balance?to=${addDays(today(), 1)}`)).body;
    expect(t2.rows.find((x: any) => x.systemKey === 'fx_gain_loss').closing).toBe('0.00');
  });

  it('year-end closing moves income and expenses into retained earnings', async () => {
    const r = await ok(await a.client.post('/accounting/year-end', { fy: fyStart() }));
    expect(r.status).toBe('approved');
    const end = `${fyStart() + 1}-03-31`;
    const t = (await a.client.get(`/accounting/trial-balance?to=${end}`)).body;
    expect(t.rows.filter((x: any) => !x.isGroup && ['income', 'expense'].includes(x.nature)).every((x: any) => x.closing === '0.00')).toBe(true);
    expect(t.rows.find((x: any) => x.systemKey === 'retained_earnings').closing).toBe((-Number(r.profit)).toFixed(2));
    // The P&L still shows the year; the Balance Sheet is unchanged.
    const pl = (await a.client.get(`/accounting/statements/profit-and-loss?from=${fyStart()}-04-01&to=${end}`)).body;
    expect(pl.profitBeforeTax.amount).toBe(r.profit);
    expect((await a.client.get(`/accounting/statements/balance-sheet?to=${end}`)).body.balanced).toBe(true);
    expect((await a.client.post('/accounting/year-end', { fy: fyStart() })).status).toBe(409);
  });

  it('lists what is left before the month can be closed', async () => {
    const c = await ok(await a.client.get(`/accounting/close-checklist?period=${today().slice(0, 7)}`));
    const by = Object.fromEntries(c.items.map((i: any) => [i.key, i.status]));
    expect(by).toMatchObject({ unposted: 'ok', gst: 'todo', lock: 'todo', bank: 'todo' });
    expect(c.items.find((i: any) => i.key === 'opening').status).toBe('warn');
  });
});

describe('insights', () => {
  it('flags unusual journals and large cash payments', async () => {
    await submit('/accounting/journals', await created('/accounting/journals', { narration: 'Provision', lines: [{ accountId: acc.purchase_expenses.id, debit: '500000' }, { accountId: acc.bank.id, credit: '500000' }] }));
    const cashAcc = (await a.client.get('/accounting/accounts')).body.find((r: any) => r.code === '5310');
    await submit('/accounting/journals', await created('/accounting/journals', { lines: [{ accountId: cashAcc.id, debit: '20000' }, { accountId: acc.bank.id, credit: '20000' }] }));
    await submit('/accounting/money/payment', await created('/accounting/money', { kind: 'payment', accountId: cashAcc.id, counterAccountId: acc.purchase_expenses.id, mode: 'cash', amount: '15000' }));
    const r = await ok(await a.client.get('/accounting/anomalies'));
    const big = r.journals.find((j: any) => j.amount === 500000);
    expect(big.reasons).toEqual(expect.arrayContaining(['Large round amount']));
    expect(r.cashPayments).toHaveLength(1);
  });

  it('forecasts cash by week from open bills', async () => {
    const f = await ok(await a.client.get('/accounting/cash-forecast?weeks=8'));
    expect(f.weeks).toHaveLength(8);
    const inflow = f.weeks.reduce((s: number, w: any) => s + Number(w.inflow), 0) + Number(f.beyond.inflow);
    expect(inflow).toBe(2950);
    const outflow = f.weeks.reduce((s: number, w: any) => s + Number(w.outflow), 0) + Number(f.beyond.outflow);
    expect(outflow).toBe(1180 + 8000);
    expect(f.weeks[7].closing).toBe((Number(f.opening) + f.weeks.reduce((s: number, w: any) => s + Number(w.inflow) - Number(w.outflow), 0)).toFixed(2));
  });
});
