import { describe, expect, it } from 'vitest';
import { statutoryDue } from '../../src/modules/agents/framework';

describe('statutory due dates', () => {
  it('lists the monthly dates in the window, for the previous month', () => {
    const d = statutoryDue('2026-10-05', 7);
    expect(d.map((x) => [x.code, x.dueDate, x.period])).toEqual([
      ['tds_payment', '2026-10-07', expect.stringContaining('2026')],
      ['gstr1', '2026-10-11', expect.stringContaining('2026')],
    ]);
    // Both are for September's transactions.
    expect(d[0].period).toBe(d[1].period);
  });
  it('keeps items up to 3 days overdue and adds quarterly TDS returns', () => {
    const d = statutoryDue('2026-10-22', 10);
    expect(d.map((x) => x.code)).toEqual(['gstr3b', 'tds_return']);
    expect(d[1]).toMatchObject({ dueDate: '2026-10-31', title: 'TDS return 24Q / 26Q for Q2 (Jul–Sep)' });
  });
  it('crosses into next month', () => {
    expect(statutoryDue('2026-12-30', 10).map((x) => [x.code, x.dueDate])).toEqual([['tds_payment', '2027-01-07']]);
  });
});
