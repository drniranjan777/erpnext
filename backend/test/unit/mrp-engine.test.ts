import { describe, expect, it } from 'vitest';
import { backtest, forecastSeries, months } from '../../src/modules/planning/forecast';
import { addDays, eoq, lotSize, lowLevelCodes, runMrp, type MrpInput, type PlanItem } from '../../src/modules/planning/mrp-engine';

const item = (id: string, over: Partial<PlanItem> = {}): PlanItem => ({ id, code: id.toUpperCase(), source: 'buy', leadTimeDays: 0, safetyStock: 0, minOrderQty: 0, lotSizing: 'l4l', lotQty: 0, periodDays: 0, multiple: 0, ...over });
const TODAY = '2026-10-07';
const input = (over: Partial<MrpInput>): MrpInput => ({ today: TODAY, horizonEnd: addDays(TODAY, 120), items: new Map(), structure: new Map(), onHand: new Map(), demands: [], receipts: [], ...over });
const so = (itemId: string, date: string, qty: number, number = 'SO/1') => ({ itemId, date, qty, ref: { kind: 'sales_order', id: number, number } });

describe('forecast', () => {
  it('follows a trend with Holt', () => {
    const h = Array.from({ length: 12 }, (_, i) => 100 + i * 10);
    const f = forecastSeries(h, 3);
    expect(f.method).toBe('holt');
    expect(f.forecast[0]).toBeGreaterThan(205);
    expect(f.forecast[2]).toBeGreaterThan(f.forecast[0]);
  });

  it('picks up seasonality with two years of history', () => {
    const season = [50, 60, 80, 120, 200, 260, 240, 160, 100, 70, 55, 50];
    const h = [...season, ...season, ...season];
    const f = forecastSeries(h, 12);
    expect(['holt_winters', 'seasonal_naive']).toContain(f.method);
    // Peak month stays the peak.
    expect(f.forecast.indexOf(Math.max(...f.forecast))).toBe(5);
    expect(f.mae).toBeLessThan(10);
  });

  it('forecasts zero for an item with no demand, and never below zero', () => {
    expect(forecastSeries([0, 0, 0, 0], 2).forecast).toEqual([0, 0]);
    const f = forecastSeries([100, 80, 60, 40, 20, 5], 6);
    expect(Math.min(...f.forecast)).toBeGreaterThanOrEqual(0);
  });

  it('backtests on the hold-out months', () => {
    const r = backtest([10, 10, 10, 10, 10, 10], 'moving_average', 3);
    expect(r.mae).toBe(0);
    expect(r.mape).toBe(0);
  });

  it('lists months across a year end', () => {
    expect(months('2026-11', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('lot sizing', () => {
  it('applies each rule, then MOQ and multiple', () => {
    expect(lotSize(item('a'), 37, -37, 0)).toBe(37);
    expect(lotSize(item('a', { lotSizing: 'fixed', lotQty: 50 }), 37, -37, 0)).toBe(50);
    expect(lotSize(item('a', { lotSizing: 'fixed', lotQty: 50 }), 120, -120, 0)).toBe(150);
    expect(lotSize(item('a', { lotSizing: 'eoq', lotQty: 200 }), 37, -37, 0)).toBe(200);
    // min/max: order up to the max from the projected balance (here -5 → 300 + 5).
    expect(lotSize(item('a', { lotSizing: 'min_max', lotQty: 300 }), 25, -5, 0)).toBe(305);
    expect(lotSize(item('a', { lotSizing: 'period', periodDays: 30 }), 10, -10, 40)).toBe(50);
    expect(lotSize(item('a', { minOrderQty: 100 }), 37, -37, 0)).toBe(100);
    expect(lotSize(item('a', { multiple: 25 }), 37, -37, 0)).toBe(50);
  });

  it('computes the economic order quantity', () => {
    // √(2 × 1200 × 500 ÷ (100 × 20 %)) = √60000 ≈ 244.949
    expect(eoq(1200, 500, 100, 20)).toBeCloseTo(244.949, 2);
    expect(eoq(0, 500, 100, 20)).toBe(0);
  });
});

describe('low-level codes', () => {
  it('puts every component below its deepest parent', () => {
    const s = new Map([
      ['fg', [{ itemId: 'sub' }, { itemId: 'rm' }]],
      ['sub', [{ itemId: 'rm' }]],
    ]);
    const r = lowLevelCodes(['fg', 'sub', 'rm'], s);
    expect(r.level.get('fg')).toBe(0);
    expect(r.level.get('sub')).toBe(1);
    expect(r.level.get('rm')).toBe(2);
    expect(r.order.indexOf('rm')).toBeGreaterThan(r.order.indexOf('sub'));
    expect(r.looped).toEqual([]);
  });

  it('reports loops', () => {
    const s = new Map([
      ['a', [{ itemId: 'b' }]],
      ['b', [{ itemId: 'a' }]],
    ]);
    expect(lowLevelCodes(['a', 'b', 'c'], s).looped.sort()).toEqual(['a', 'b']);
  });
});

describe('MRP netting', () => {
  it('nets stock and receipts, offsets lead time and explodes to components', () => {
    const items = new Map([
      ['fg', item('fg', { source: 'make', leadTimeDays: 5 })],
      ['rm', item('rm', { leadTimeDays: 10, safetyStock: 20 })],
    ]);
    const out = runMrp(
      input({
        items,
        structure: new Map([['fg', [{ itemId: 'rm', qtyPer: 2 }]]]),
        onHand: new Map([
          ['fg', 30],
          ['rm', 50],
        ]),
        demands: [so('fg', '2026-11-10', 100)],
        receipts: [{ itemId: 'rm', date: '2026-10-20', qty: 40, ref: { kind: 'purchase_order', id: 'po1', number: 'PO/1' } }],
      }),
    );
    const fg = out.plannedOrders.find((p) => p.itemId === 'fg')!;
    expect(fg.qty).toBe(70);
    expect(fg.dueDate).toBe('2026-11-10');
    expect(fg.releaseDate).toBe('2026-11-05');
    expect(fg.pegs[0]).toMatchObject({ kind: 'sales_order', number: 'SO/1', qty: 70 });
    // rm: 50 + 40 − 140 = −50; plus safety 20 → 70, due at fg's release, ordered 10 days earlier.
    const rm = out.plannedOrders.find((p) => p.itemId === 'rm')!;
    expect(rm.qty).toBe(70);
    expect(rm.dueDate).toBe('2026-11-05');
    expect(rm.releaseDate).toBe('2026-10-26');
    expect(rm.level).toBe(1);
    expect(rm.pegs[0]).toMatchObject({ kind: 'planned_order', id: `#${fg.key}`, number: 'FG' });
    const plan = out.plans.find((p) => p.itemId === 'rm')!;
    expect(plan.endBalance).toBe(20);
  });

  it('expedites when the lead time cannot be met', () => {
    const out = runMrp(input({ items: new Map([['a', item('a', { leadTimeDays: 30 })]]), demands: [so('a', '2026-10-15', 10)] }));
    expect(out.plannedOrders[0].releaseDate).toBe(TODAY);
    expect(out.exceptions.map((e) => e.kind)).toContain('expedite');
  });

  it('pulls a later receipt in instead of planning a new order', () => {
    const out = runMrp(
      input({
        items: new Map([['a', item('a')]]),
        demands: [so('a', '2026-10-20', 50)],
        receipts: [{ itemId: 'a', date: '2026-11-15', qty: 60, ref: { kind: 'purchase_order', id: 'po', number: 'PO/9' } }],
      }),
    );
    expect(out.plannedOrders).toHaveLength(0);
    const ex = out.exceptions.find((e) => e.kind === 'reschedule_in')!;
    expect(ex).toMatchObject({ date: '2026-11-15', toDate: '2026-10-20' });
  });

  it('suggests cancelling an unneeded receipt and moving out an early one', () => {
    const out = runMrp(
      input({
        items: new Map([
          ['a', item('a')],
          ['b', item('b')],
        ]),
        onHand: new Map([['a', 100]]),
        demands: [so('a', '2026-10-20', 50), so('b', '2026-12-01', 30)],
        receipts: [
          { itemId: 'a', date: '2026-10-10', qty: 40, ref: { kind: 'purchase_order', id: 'p1', number: 'PO/1' } },
          { itemId: 'b', date: '2026-10-12', qty: 30, ref: { kind: 'purchase_order', id: 'p2', number: 'PO/2' } },
        ],
      }),
    );
    expect(out.exceptions.find((e) => e.itemId === 'a')?.kind).toBe('cancel');
    expect(out.exceptions.find((e) => e.itemId === 'b')).toMatchObject({ kind: 'reschedule_out', toDate: '2026-12-01' });
  });

  it('flags past-due receipts, late orders and stock below safety', () => {
    const out = runMrp(
      input({
        items: new Map([['a', item('a', { safetyStock: 10 })]]),
        onHand: new Map([['a', 5]]),
        demands: [so('a', '2026-09-30', 5)],
        receipts: [{ itemId: 'a', date: '2026-10-01', qty: 3, ref: { kind: 'purchase_order', id: 'p', number: 'PO/3' } }],
      }),
    );
    const kinds = out.exceptions.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['past_due', 'late_demand', 'below_safety']));
    // 5 + 3 − 5 = 3 → 7 to reach safety, today.
    expect(out.plannedOrders[0]).toMatchObject({ qty: 7, dueDate: TODAY });
  });

  it('covers a period with one order', () => {
    const out = runMrp(
      input({
        items: new Map([['a', item('a', { lotSizing: 'period', periodDays: 30 })]]),
        demands: [so('a', '2026-10-10', 10), so('a', '2026-10-20', 15), so('a', '2026-11-20', 5)],
      }),
    );
    expect(out.plannedOrders.map((p) => [p.dueDate, p.qty])).toEqual([
      ['2026-10-10', 25],
      ['2026-11-20', 5],
    ]);
  });

  it('plans 10,000 items with three levels quickly', () => {
    const items = new Map<string, PlanItem>();
    const structure = new Map<string, { itemId: string; qtyPer: number }[]>();
    const demands = [];
    for (let i = 0; i < 2000; i++) {
      items.set(`f${i}`, item(`f${i}`, { source: 'make', leadTimeDays: 3 }));
      structure.set(`f${i}`, [
        { itemId: `s${i % 1000}`, qtyPer: 1 },
        { itemId: `r${i % 3000}`, qtyPer: 2 },
        { itemId: `r${(i + 7) % 3000}`, qtyPer: 0.5 },
      ]);
      for (let w = 0; w < 8; w++) demands.push(so(`f${i}`, addDays(TODAY, 7 * w + 3), 10 + (i % 7)));
    }
    for (let i = 0; i < 1000; i++) {
      items.set(`s${i}`, item(`s${i}`, { source: 'make', leadTimeDays: 2 }));
      structure.set(`s${i}`, [{ itemId: `r${(i * 3) % 3000}`, qtyPer: 1.5 }]);
    }
    for (let i = 0; i < 7000; i++) items.set(`r${i}`, item(`r${i}`, { leadTimeDays: 10, safetyStock: 5, lotSizing: i % 2 ? 'fixed' : 'l4l', lotQty: 100 }));
    const t = Date.now();
    const out = runMrp(input({ items, structure, demands }));
    expect(Date.now() - t).toBeLessThan(15_000);
    expect(out.plannedOrders.length).toBeGreaterThan(10_000);
  });
});
