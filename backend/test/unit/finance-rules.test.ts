import { describe, expect, it } from 'vitest';
import { allocate, consolidate, depositInterestFor, depositValue, emi, facilityUse, loanInterestFor, loanSchedule, outstanding, reconcile, type AccountBalance } from '../../src/modules/enterprise/finance-rules';

describe('treasury', () => {
  it('computes EMI loans and bullet loans', () => {
    expect(emi(1_000_000, 12, 12)).toBe(88848.79);
    const rows = loanSchedule(1_000_000, 12, '2026-04-01', '2027-04-01', 'emi');
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ no: 1, date: '2026-05-01', opening: 1_000_000, interest: 10000, principal: 78848.79, payment: 88848.79, closing: 921151.21 });
    expect(rows.at(-1)!.closing).toBe(0);
    expect(loanInterestFor(rows, '2026-05')).toBe(10000);
    expect(outstanding(rows, 1_000_000, '2026-06-15')).toBe(841513.93);
    const bullet = loanSchedule(500_000, 9, '2026-01-31', '2026-04-30', 'bullet');
    expect(bullet.map((r) => [r.date, r.interest, r.principal])).toEqual([
      ['2026-02-28', 3750, 0],
      ['2026-03-31', 3750, 0],
      ['2026-04-30', 3750, 500_000],
    ]);
  });

  it('values deposits and checks facilities', () => {
    expect(depositValue(100_000, 7, '2026-01-01', '2027-01-01', 'quarterly', '2027-01-01')).toBe(107185.9);
    expect(depositValue(100_000, 7, '2026-01-01', '2027-01-01', 'simple', '2026-07-02')).toBe(103490.41);
    expect(depositValue(100_000, 7, '2026-01-01', '2027-01-01', 'quarterly', '2030-01-01')).toBe(107185.9);
    expect(depositInterestFor(100_000, 7, '2026-01-01', '2027-01-01', 'simple', '2026-01')).toBe(575.34);
    const f = facilityUse(1_000_000, [
      { number: 'LC1', kind: 'lc', principal: 400_000, endDate: '2026-10-20', status: 'active', marginPct: 10 },
      { number: 'BG1', kind: 'bg', principal: 300_000, endDate: '2027-03-31', status: 'active', marginPct: 25 },
      { number: 'BG0', kind: 'bg', principal: 900_000, endDate: '2026-01-31', status: 'closed', marginPct: 0 },
    ], '2026-10-08');
    expect(f).toMatchObject({ used: 700_000, available: 300_000, pct: 70, margin: 115_000, expiring: [{ number: 'LC1', kind: 'lc', endDate: '2026-10-20', overdue: false }] });
  });
});

describe('allocation', () => {
  it('splits exactly to the paisa', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([33.34, 33.33, 33.33]);
    expect(allocate(1000, [50, 30, 20])).toEqual([500, 300, 200]);
    expect(allocate(10, [0, 0])).toEqual([0, 0]);
    const parts = allocate(12345.67, [3, 7, 11]);
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100)).toBe(1234567);
  });
});

describe('consolidation', () => {
  const acc = (code: string, nature: AccountBalance['nature'], reportLine: string, balance: number, key: string | null = null): AccountBalance => ({ code, name: code, nature, reportLine, key, balance });
  it('replaces the investment with goodwill and shows the non-controlling interest', () => {
    const r = consolidate([
      { companyId: 'p', name: 'Parent', isParent: true, ownershipPct: 100, investmentCost: 0, netAssets: 480, netAssetsAtAcquisition: 0, profit: 60, bs: [acc('5310', 'asset', 'bs.ca.cash', 500), acc('4300', 'asset', 'bs.nca.investments', 80), acc('3210', 'liability', 'bs.cl.trade_payables', -100), acc('1100', 'equity', 'bs.equity.share_capital', -400, 'share_capital')], pl: [acc('6100', 'income', 'pl.revenue', -300), acc('7200', 'expense', 'pl.materials', 240)] },
      { companyId: 's', name: 'Sub', isParent: false, ownershipPct: 80, investmentCost: 80, netAssets: 100, netAssetsAtAcquisition: 90, profit: 10, bs: [acc('5310', 'asset', 'bs.ca.cash', 150), acc('3210', 'liability', 'bs.cl.trade_payables', -50)], pl: [acc('6100', 'income', 'pl.revenue', -100), acc('7200', 'expense', 'pl.materials', 90)] },
    ]);
    expect(r.subsidiaries[0]).toMatchObject({ goodwill: 8, nci: 20, nciProfit: 2, postAcquisitionShare: 8 });
    expect(r.balanceSheet.assets).toEqual([
      { line: 'bs.ca.cash', label: 'Cash and cash equivalents', nature: 'asset', amount: 650 },
      { line: 'bs.nca.goodwill', label: 'Goodwill', nature: 'asset', amount: 8 },
    ]);
    expect(r.balanceSheet).toMatchObject({ totalAssets: 658, totalEquityAndLiabilities: 658, nonControllingInterest: 20 });
    expect(r.balanceSheet.equity).toEqual([
      { line: 'bs.equity.share_capital', label: 'Equity share capital', amount: 400 },
      { line: 'bs.equity.other', label: 'Other equity', amount: 88 },
    ]);
    expect(r.profitAndLoss).toMatchObject({ income: 400, expenses: 330, profit: 70, attributableToOwners: 68, attributableToNci: 2 });
  });

  it('reconciles inter-company balances', () => {
    expect(reconcile([{ a: 'A', b: 'B', aSaysB: 1000, bSaysA: -1000 }, { a: 'A', b: 'C', aSaysB: 500, bSaysA: -450 }]).map((x) => [x.matched, x.difference])).toEqual([
      [true, 0],
      [false, 50],
    ]);
  });
});
