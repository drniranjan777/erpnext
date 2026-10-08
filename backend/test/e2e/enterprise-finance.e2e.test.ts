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
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const monthsAgo = (n: number) => {
  const d = new Date(today());
  d.setUTCMonth(d.getUTCMonth() - n, 1);
  return d.toISOString().slice(0, 10);
};

async function accounts(companyId: string) {
  const list = (await a.client.get(`/accounting/accounts?companyId=${companyId}`)).body;
  const by: Record<string, any> = {};
  for (const r of list) {
    if (r.systemKey) by[r.systemKey] = r;
    by[r.code] = r;
  }
  return by;
}
async function journal(companyId: string, narration: string, lines: any[], docDate = monthsAgo(3)) {
  const j = await ok(await a.client.post('/accounting/journals', { companyId, docDate, narration, lines }), 201);
  return ok(await a.client.post(`/accounting/journals/${j.id}/submit`, { version: j.version }));
}

beforeAll(async () => {
  a = await signupWorkspace('group-a');
  emails.push(a.email);
  ctx.alpha = (await a.client.get('/org/companies')).body[0];
  ctx.beta = await ok(await a.client.post('/org/companies', { name: 'Beta Components Pvt Ltd' }), 201);
  ctx.alphaParty = await ok(await a.client.post('/masters/parties', { name: 'Alpha (group)', isCustomer: true, isVendor: true, gstin: '36AABCS1234E1ZU', addresses: [{ type: 'both', line1: 'Uppal', city: 'Hyderabad', stateCode: '36', pincode: '500039', isDefault: true }] }), 201);
  ctx.betaParty = await ok(await a.client.post('/masters/parties', { name: 'Beta (group)', isCustomer: true, isVendor: true, gstin: '36AABCD1234E1Z9', addresses: [{ type: 'both', line1: 'Cherlapally', city: 'Hyderabad', stateCode: '36', pincode: '500051', isDefault: true }] }), 201);
  for (const [key, company] of [['A', ctx.alpha], ['B', ctx.beta]] as const) {
    const acc = await accounts(company.id);
    const bank = await ok(await a.client.post('/accounting/accounts', { companyId: company.id, parentId: acc['5320'].id, code: '5321', name: `${key} current account`, accountType: 'bank' }), 201);
    ctx[key] = { ...(await accounts(company.id)), bank };
  }
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('inter-company and consolidation', () => {
  it('posts inter-company transactions in both books and reconciles them', async () => {
    const A = ctx.A;
    const B = ctx.B;
    await journal(ctx.alpha.id, 'Share capital', [{ accountId: A.bank.id, debit: '1000000' }, { accountId: A.share_capital.id, credit: '1000000' }]);
    await journal(ctx.alpha.id, 'Investment in Beta (80 %)', [{ accountId: A.investments_subsidiaries.id, debit: '400000' }, { accountId: A.bank.id, credit: '400000' }]);
    await journal(ctx.beta.id, 'Share capital', [{ accountId: B.bank.id, debit: '500000' }, { accountId: B.share_capital.id, credit: '500000' }]);
    expect((await a.client.post('/finance/intercompany', { txnDate: monthsAgo(2), fromCompanyId: ctx.alpha.id, toCompanyId: ctx.beta.id, kind: 'charge', amount: 100000, description: 'Management fee Q1' })).status).toBe(409);
    await ok(await a.client.post('/finance/intercompany/links', { companyId: ctx.alpha.id, partyId: ctx.alphaParty.id }));
    await ok(await a.client.post('/finance/intercompany/links', { companyId: ctx.beta.id, partyId: ctx.betaParty.id }));
    const fee = await ok(await a.client.post('/finance/intercompany', { txnDate: monthsAgo(2), fromCompanyId: ctx.alpha.id, toCompanyId: ctx.beta.id, kind: 'charge', amount: 100000, description: 'Management fee Q1' }), 201);
    expect(fee.number).toBe('IC-00001');
    expect(fee.fromJournal).toBeTruthy();
    expect((await a.client.post('/finance/intercompany', { txnDate: monthsAgo(2), fromCompanyId: ctx.alpha.id, toCompanyId: ctx.beta.id, kind: 'loan', amount: 200000, description: 'Working capital loan' })).status).toBe(400);
    await ok(await a.client.post('/finance/intercompany', { txnDate: monthsAgo(2), fromCompanyId: ctx.alpha.id, toCompanyId: ctx.beta.id, kind: 'loan', amount: 200000, description: 'Working capital loan', fromAccountId: A.bank.id, toAccountId: B.bank.id }), 201);
    const rec = await ok(await a.client.get('/finance/intercompany/reconciliation'));
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ difference: 0, matched: true });
    expect(Math.abs(rec[0].aSaysB)).toBe(300000);
  });

  it('consolidates the group with goodwill and non-controlling interest', async () => {
    const g = await ok(await a.client.post('/finance/groups', { name: 'Alpha group', parentCompanyId: ctx.alpha.id, members: [{ companyId: ctx.beta.id, ownershipPct: 80, investmentCost: 400000, acquiredOn: monthsAgo(3) }] }), 201);
    expect((await a.client.post('/finance/groups', { name: 'Bad', parentCompanyId: ctx.alpha.id, members: [{ companyId: ctx.alpha.id, ownershipPct: 100, investmentCost: 0, acquiredOn: monthsAgo(3) }] })).status).toBe(400);
    const c = await ok(await a.client.get(`/finance/groups/${g.id}/consolidated?from=${monthsAgo(12)}&to=${today()}`));
    expect(c.unreconciledDifference).toBe(0);
    expect(c.subsidiaries[0]).toMatchObject({ goodwill: 0, nci: 80000, nciProfit: -20000 });
    expect(c.balanceSheet.assets).toEqual([expect.objectContaining({ line: 'bs.ca.cash', amount: 1100000 })]);
    expect(c.balanceSheet).toMatchObject({ totalAssets: 1100000, totalEquityAndLiabilities: 1100000, nonControllingInterest: 80000, liabilities: [] });
    expect(c.balanceSheet.equity).toEqual([expect.objectContaining({ amount: 1000000 }), expect.objectContaining({ amount: 20000 })]);
    expect(c.profitAndLoss).toMatchObject({ profit: 0, attributableToOwners: 20000, attributableToNci: -20000 });
  });
});

describe('treasury', () => {
  it('keeps loans, deposits and facilities, and posts monthly interest once', async () => {
    const loan = await ok(await a.client.post('/finance/treasury', { companyId: ctx.alpha.id, kind: 'loan', number: 'TL-001', bank: 'State Bank of India', principal: 1200000, ratePct: 12, startDate: monthsAgo(4), endDate: (() => { const d = new Date(monthsAgo(4)); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); })() }), 201);
    expect(loan.method).toBe('emi');
    const sched = await ok(await a.client.get(`/finance/treasury/${loan.id}/schedule`));
    expect(sched).toHaveLength(12);
    expect(sched[0].interest).toBe(12000);
    await ok(await a.client.post('/finance/treasury', { companyId: ctx.alpha.id, kind: 'fd', number: 'FD-77', bank: 'HDFC Bank', principal: 500000, ratePct: 7.25, startDate: monthsAgo(4), endDate: today() }), 201);
    const fac = await ok(await a.client.post('/finance/treasury', { companyId: ctx.alpha.id, kind: 'facility', number: 'NFB-1', bank: 'State Bank of India', principal: 1000000, startDate: monthsAgo(4), endDate: monthsAgo(-8) }), 201);
    await ok(await a.client.post('/finance/treasury', { companyId: ctx.alpha.id, kind: 'bg', number: 'BG-9', bank: 'State Bank of India', principal: 600000, startDate: monthsAgo(1), endDate: monthsAgo(-6), facilityId: fac.id, marginPct: 10, beneficiary: 'NTPC Ltd' }), 201);
    expect((await a.client.post('/finance/treasury', { companyId: ctx.alpha.id, kind: 'lc', number: 'LC-1', bank: 'State Bank of India', principal: 500000, startDate: monthsAgo(1), endDate: monthsAgo(-2), facilityId: fac.id })).status).toBe(409);
    const t = await ok(await a.client.get('/finance/treasury'));
    expect(t.items.find((i: any) => i.id === fac.id).use).toMatchObject({ used: 600000, available: 400000, margin: 60000 });
    expect(t.summary.lcBg).toBe(600000);
    const period = monthsAgo(2).slice(0, 7);
    const r = await ok(await a.client.post('/finance/treasury/accrue', { companyId: ctx.alpha.id, period }));
    expect(r.posted.map((p: any) => p.instrument).sort()).toEqual(['FD-77', 'TL-001']);
    expect((await ok(await a.client.post('/finance/treasury/accrue', { companyId: ctx.alpha.id, period }))).posted).toEqual([]);
  });
});

describe('cost allocation', () => {
  it('moves a service cost centre to the ones it serves', async () => {
    const cc: Record<string, any> = {};
    for (const code of ['ADMIN', 'PLANT1', 'PLANT2']) cc[code] = await ok(await a.client.post('/accounting/cost-centers', { companyId: ctx.alpha.id, code, name: code }), 201);
    const period = monthsAgo(1).slice(0, 7);
    await journal(ctx.alpha.id, 'Office rent', [{ accountId: ctx.A['9560'].id, debit: '30000', costCenterId: cc.ADMIN.id }, { accountId: ctx.A.bank.id, credit: '30000' }], `${period}-10`);
    expect((await a.client.post('/finance/allocations', { companyId: ctx.alpha.id, name: 'Admin to plants', sourceCostCenterId: cc.ADMIN.id, targets: [{ costCenterId: cc.ADMIN.id, weight: 1 }] })).status).toBe(400);
    const rule = await ok(await a.client.post('/finance/allocations', { companyId: ctx.alpha.id, name: 'Admin to plants', sourceCostCenterId: cc.ADMIN.id, basis: 'floor area', targets: [{ costCenterId: cc.PLANT1.id, weight: 2 }, { costCenterId: cc.PLANT2.id, weight: 1 }] }), 201);
    const run = await ok(await a.client.post(`/finance/allocations/${rule.id}/run`, { period }));
    expect(run).toMatchObject({ allocated: 30000, skipped: 0 });
    expect((await a.client.post(`/finance/allocations/${rule.id}/run`, { period })).status).toBe(409);
    expect((await a.client.post(`/finance/allocations/${rule.id}/run`, { period: monthsAgo(6).slice(0, 7) })).status).toBe(409);
  });
});
