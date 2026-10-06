import { describe, expect, it } from 'vitest';
import { analyse, weekOf, type RejectFact } from '../../src/modules/manufacturing/scrap-insights.service';

const f = (date: string, workCenter: string, processed: number, rejected: number, reason = 'Burr'): RejectFact => ({ date, workCenter, item: 'BR-1', reason, processed, rejected, cost: rejected * 10 });

describe('scrap insights', () => {
  it('buckets by ISO week starting Monday', () => {
    expect(weekOf('2026-10-07')).toBe('2026-10-05'); // Wednesday
    expect(weekOf('2026-10-05')).toBe('2026-10-05');
    expect(weekOf('2026-10-11')).toBe('2026-10-05'); // Sunday
  });

  it('totals, Pareto and breakdowns', () => {
    const r = analyse([f('2026-09-21', 'PRESS', 100, 6, 'Burr'), f('2026-09-22', 'PRESS', 100, 2, 'Crack'), f('2026-09-23', 'ASSY', 200, 2, 'Burr')], []);
    expect(r.totals).toEqual({ processed: 400, rejected: 10, rate: 2.5, cost: 100 });
    expect(r.byReason).toEqual([
      { reason: 'Burr', qty: 8, share: 80, cumulative: 80 },
      { reason: 'Crack', qty: 2, share: 20, cumulative: 100 },
    ]);
    expect(r.byWorkCenter.map((w) => [w.key, w.rate])).toEqual([['PRESS', 4], ['ASSY', 1]]);
    expect(r.alerts.map((a) => a.message)).toEqual(['“Burr” is 80% of all rejects; fixing that one cause would roughly halve scrap.']);
  });

  it('flags a work centre whose latest week doubles its earlier rate, a rising trend, and poor suppliers', () => {
    const facts = [f('2026-09-14', 'PRESS', 100, 1, 'A'), f('2026-09-21', 'PRESS', 100, 2, 'B'), f('2026-09-28', 'PRESS', 100, 3, 'C'), f('2026-10-05', 'PRESS', 100, 9, 'D')];
    const r = analyse(facts, [{ vendor: 'Deccan Steels', inspected: 200, rejected: 20, lots: 2 }, { vendor: 'Good Metals', inspected: 100, rejected: 20, lots: 1 }]);
    expect(r.alerts.map((a) => a.message)).toEqual([
      'PRESS: rejects ran at 9% in the week of 2026-10-05, against 2% before.',
      '“D” is 60% of all rejects; fixing that one cause would roughly halve scrap.',
      'The reject rate has risen four weeks running, to 9%.',
      'Deccan Steels: 10% of inspected material rejected over 2 lots.',
    ]);
  });
});
