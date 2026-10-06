import { describe, expect, it } from 'vitest';
import { spread } from '../../src/modules/accounting/budgets.service';
import { flagLines, type AnomalyLine } from '../../src/modules/accounting/insights.service';

const line = (patch: Partial<AnomalyLine>): AnomalyLine => ({
  voucherId: 'v1',
  number: 'JV/1',
  postingDate: '2026-10-05',
  // 11:00 IST on a Monday
  createdAt: new Date('2026-10-05T05:30:00Z'),
  createdBy: 'u1',
  accountId: 'a1',
  accountCode: '9560',
  accountName: 'Rent',
  amount: 5000,
  ...patch,
});

describe('journal anomaly rules', () => {
  it('leaves ordinary entries alone', () => {
    expect(flagLines([line({})], new Map([['a1', [4800, 5000, 5200, 5100, 4900]]]), new Set())).toEqual([]);
  });

  it('flags outliers against the account history, round amounts, odd hours, back-dating and first use', () => {
    const history = new Map([['a1', [4800, 5000, 5200, 5100, 4900, 5050]]]);
    const r = flagLines(
      [
        line({ voucherId: 'big', amount: 300000 }),
        line({ voucherId: 'late', createdAt: new Date('2026-10-05T17:00:00Z') }),
        line({ voucherId: 'sunday', createdAt: new Date('2026-10-04T05:30:00Z') }),
        line({ voucherId: 'old', postingDate: '2026-07-01' }),
        line({ voucherId: 'new', accountId: 'a2', amount: 75000 }),
      ],
      history,
      new Set(['u1|a2|new']),
    );
    const by = Object.fromEntries(r.map((x) => [x.line.voucherId, x.reasons]));
    expect(by.big).toEqual(expect.arrayContaining([expect.stringMatching(/Unusually large/), 'Large round amount']));
    expect(by.late).toEqual(['Entered at 22:30']);
    expect(by.sunday).toEqual(['Entered on a Sunday']);
    expect(by.old).toEqual(['Back-dated by 96 days']);
    expect(by.new).toEqual(['First time this user posted to this account']);
    expect(r[0].line.voucherId).toBe('big');
  });
});

describe('budget spreading', () => {
  it('spreads evenly with the rounding in the last month', () => {
    const m = spread('1000');
    expect(m).toHaveLength(12);
    expect(m[0]).toBe('83.33');
    expect(m[11]).toBe('83.37');
    expect(m.reduce((s, v) => s + Number(v), 0).toFixed(2)).toBe('1000.00');
  });
});
