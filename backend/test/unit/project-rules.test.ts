import { describe, expect, it } from 'vitest';
import { earnedValue, milestoneAmounts, plannedPct, resourceLoad, rollUp, wbsCodeProblem, weekOf, type WbsFigures } from '../../src/modules/projects/project-rules';

const w = (id: string, parentId: string | null, budget: number, actual: number, progressPct: number, plannedStart = '2026-01-01', plannedEnd = '2026-01-10', committed = 0): WbsFigures => ({
  id,
  code: id,
  name: id,
  parentId,
  plannedStart,
  plannedEnd,
  budget: { material: budget, labour: 0, subcontract: 0, other: 0 },
  progressPct,
  actual: { material: actual, labour: 0, subcontract: 0, other: 0 },
  committed,
});

describe('WBS', () => {
  it('checks codes against the parent', () => {
    expect(wbsCodeProblem('1', null)).toBeNull();
    expect(wbsCodeProblem('1.2', null)).toContain('single number');
    expect(wbsCodeProblem('1.2', '1')).toBeNull();
    expect(wbsCodeProblem('2.1', '1')).toBe('Under 1 the code is 1.n');
    expect(wbsCodeProblem('1.2.3', '1')).toBe('Under 1 the code is 1.n');
    expect(wbsCodeProblem('A', null)).toContain('numbers separated');
  });

  it('rolls budgets, actuals and commitments up the tree', () => {
    const r = rollUp([w('1', null, 0, 0, 0), w('1.1', '1', 100, 80, 0, undefined, undefined, 30), w('1.2', '1', 50, 10, 0)]);
    expect(r.find((x) => x.id === '1')).toEqual({ id: '1', budget: 150, actual: 90, committed: 30, overBudget: false });
    expect(r.find((x) => x.id === '1.1')!.overBudget).toBe(true);
  });
});

describe('earned value', () => {
  it('spreads planned value and computes CPI and SPI', () => {
    expect([plannedPct('2026-01-01', '2026-01-10', '2025-12-31'), plannedPct('2026-01-01', '2026-01-10', '2026-01-05'), plannedPct('2026-01-01', '2026-01-10', '2026-02-01')]).toEqual([0, 50, 100]);
    const ev = earnedValue([w('1', null, 0, 0, 0), w('1.1', '1', 1000, 600, 40), w('1.2', '1', 1000, 0, 0, '2026-02-01', '2026-02-28')], '2026-01-05');
    expect(ev.rows.map((r) => r.id)).toEqual(['1.1', '1.2']);
    expect(ev.total).toMatchObject({ bac: 2000, pv: 500, ev: 400, ac: 600, cv: -200, sv: -100, cpi: 0.67, spi: 0.8, eac: 3000, etc: 2400, vac: -1000, percentComplete: 20 });
  });

  it('works out milestone amounts and resource load', () => {
    expect(milestoneAmounts(1_000_000, [{ id: 'a', pct: 30 }, { id: 'b', pct: 75 }])).toEqual({ totalPct: 105, over: true, amounts: { a: 300000, b: 750000 } });
    expect(weekOf('2026-10-08')).toBe('2026-10-05');
    const load = resourceLoad(
      [
        { employeeId: 'e1', employee: 'Kiran', project: 'P1', fromDate: '2026-10-05', toDate: '2026-10-25', hoursPerWeek: 30 },
        { employeeId: 'e1', employee: 'Kiran', project: 'P2', fromDate: '2026-10-12', toDate: '2026-11-30', hoursPerWeek: 24 },
      ],
      '2026-10-08',
      4,
    );
    expect(load.weeks).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(load.people[0]).toMatchObject({ hours: [30, 54, 54, 24], overloaded: ['2026-10-12', '2026-10-19'], projects: ['P1', 'P2'] });
  });
});
