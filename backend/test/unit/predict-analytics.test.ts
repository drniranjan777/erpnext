import { describe, expect, it } from 'vitest';
import { croston, forecastSeries } from '../../src/modules/planning/forecast';
import { marginBridge, parseWhy, paymentHabits, predictCollections } from '../../src/modules/predict/analytics';

describe('forecasting v2', () => {
  it('uses Croston for intermittent demand and gives an interval', () => {
    const h = [0, 0, 6, 0, 0, 0, 4, 0, 0, 5, 0, 0, 0, 6, 0, 0, 4, 0];
    expect(croston(h, 2)[0]).toBeGreaterThan(1);
    expect(croston(h, 2)[0]).toBeLessThan(2);
    const f = forecastSeries(h, 3);
    expect(f.intermittent).toBe(true);
    expect(f.lower!.every((v, i) => v <= f.forecast[i] && f.upper![i] >= f.forecast[i])).toBe(true);
    expect(f.upper![2] - f.forecast[2]).toBeGreaterThan(f.upper![0] - f.forecast[0]);
  });
});

describe('collections', () => {
  const paid = [
    { customerId: 'slow', daysLate: 30 },
    { customerId: 'slow', daysLate: 40 },
    { customerId: 'slow', daysLate: 35 },
    { customerId: 'fast', daysLate: 0 },
    { customerId: 'once', daysLate: 90 },
  ];
  it('learns each customer’s habit, with the overall median for thin history', () => {
    const h = paymentHabits(paid);
    expect(h.habits.get('slow')).toEqual({ days: 35, invoices: 3 });
    expect(h.overall).toBe(35);
  });
  it('predicts dates and weekly cash-in', () => {
    const r = predictCollections(
      [
        { id: 'a', customerId: 'slow', dueDate: '2026-10-01', outstanding: 1000 },
        { id: 'b', customerId: 'once', dueDate: '2026-10-10', outstanding: 500 },
        { id: 'c', customerId: 'slow', dueDate: '2026-06-01', outstanding: 200 },
      ],
      paid,
      '2026-10-08',
      8,
    );
    expect(r.rows.find((x) => x.id === 'a')).toMatchObject({ expected: '2026-11-05', basis: 'customer', atRisk: false });
    expect(r.rows.find((x) => x.id === 'b')).toMatchObject({ expected: '2026-11-14', basis: 'overall' });
    // Long overdue: expected today, flagged at risk.
    expect(r.rows.find((x) => x.id === 'c')).toMatchObject({ expected: '2026-10-08', atRisk: true });
    expect(r.buckets[0]).toMatchObject({ amount: 200, invoices: 1 });
    expect(r.buckets[4].amount).toBe(1000);
  });
});

describe('margin bridge', () => {
  it('splits a margin drop into price, cost and mix, adding up to the change', () => {
    const prev = [
      { itemId: 'A', code: 'A', qty: 100, revenue: 10_000, cost: 6_000 },
      { itemId: 'B', code: 'B', qty: 100, revenue: 5_000, cost: 4_000 },
    ];
    const curr = [
      { itemId: 'A', code: 'A', qty: 80, revenue: 8_000, cost: 5_280 },
      { itemId: 'B', code: 'B', qty: 200, revenue: 9_600, cost: 8_000 },
    ];
    const b = marginBridge(prev, curr);
    expect(b.previousPct).toBe(33.3);
    expect(b.currentPct).toBe(24.5);
    expect(Math.round((b.effects.price + b.effects.cost + b.effects.mix) * 10) / 10).toBeCloseTo(b.changePts, 0);
    expect(b.effects.cost).toBeLessThan(0);
    expect(b.effects.mix).toBeLessThan(0);
    expect(b.topCost[0]).toMatchObject({ code: 'A', costChangePct: 10 });
    expect(b.topPrice[0]).toMatchObject({ code: 'B', priceChangePct: -4 });
    expect(b.lowMarginGrowth[0].code).toBe('B');
  });
});

describe('why questions', () => {
  it('reads periods and compares with the one before', () => {
    expect(parseWhy('why did margin drop in Q2?', '2026-10-08')).toEqual({ metric: 'margin', current: { from: '2026-07-01', to: '2026-09-30', label: 'Q2 FY26-27' }, previous: { from: '2026-04-01', to: '2026-06-30', label: 'the quarter before' } });
    const m = parseWhy('why are sales down in August compared to July', '2026-10-08');
    expect(m.metric).toBe('sales');
    expect([m.previous.from, m.current.from]).toEqual(['2026-07-01', '2026-08-01']);
    expect(parseWhy('why did gross margin fall last month', '2026-10-08').current.from).toBe('2026-09-01');
  });
});
