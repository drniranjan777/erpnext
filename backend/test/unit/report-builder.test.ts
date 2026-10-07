import { describe, expect, it } from 'vitest';
import { buildQuery, periodRange, specSchema } from '../../src/modules/reports/builder/builder';
import { nextRun, relativeDate } from '../../src/modules/reports/builder/schedule-time';

describe('schedule timing (India time)', () => {
  // 7 Oct 2026 is a Wednesday; 05:30 IST = 00:00 UTC.
  const now = new Date('2026-10-07T00:00:00Z');

  it('runs daily at the hour, today if still ahead', () => {
    expect(nextRun(now, { frequency: 'daily', hour: 8 }).toISOString()).toBe('2026-10-07T02:30:00.000Z');
    expect(nextRun(now, { frequency: 'daily', hour: 5 }).toISOString()).toBe('2026-10-07T23:30:00.000Z');
  });

  it('runs weekly on the weekday and monthly on the day', () => {
    expect(nextRun(now, { frequency: 'weekly', hour: 9, weekday: 1 }).toISOString()).toBe('2026-10-12T03:30:00.000Z');
    expect(nextRun(now, { frequency: 'weekly', hour: 9, weekday: 3 }).toISOString()).toBe('2026-10-07T03:30:00.000Z');
    expect(nextRun(now, { frequency: 'monthly', hour: 7, monthDay: 1 }).toISOString()).toBe('2026-11-01T01:30:00.000Z');
    expect(nextRun(new Date('2026-12-28T10:00:00Z'), { frequency: 'monthly', hour: 7, monthDay: 1 }).toISOString()).toBe('2027-01-01T01:30:00.000Z');
  });

  it('resolves relative dates', () => {
    expect(relativeDate('yesterday', '2026-10-01')).toBe('2026-09-30');
    expect(relativeDate('week_start', '2026-10-07')).toBe('2026-10-05');
    expect(relativeDate('prev_month_start', '2026-01-15')).toBe('2025-12-01');
    expect(relativeDate('prev_month_end', '2026-03-10')).toBe('2026-02-28');
    expect(relativeDate('2026-04-01', '2026-10-07')).toBe('2026-04-01');
  });
});

describe('report builder', () => {
  it('turns period presets into dates', () => {
    const today = '2026-10-07';
    expect(periodRange({ preset: 'mtd' }, today)).toEqual({ from: '2026-10-01', to: today });
    expect(periodRange({ preset: 'last_month' }, today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange({ preset: 'qtd' }, today)).toEqual({ from: '2026-10-01', to: today });
    expect(periodRange({ preset: 'qtd' }, '2026-02-10')).toEqual({ from: '2026-01-01', to: '2026-02-10' });
    expect(periodRange({ preset: 'fytd' }, today)).toEqual({ from: '2026-04-01', to: today });
    expect(periodRange({ preset: 'last_fy' }, today)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(periodRange({ preset: 'last_7' }, today)).toEqual({ from: '2026-10-01', to: today });
    expect(periodRange({ preset: 'all' }, today)).toBeNull();
    expect(() => periodRange({ preset: 'custom', from: '2026-10-05', to: '2026-10-01' }, today)).toThrow(/ends before/);
  });

  it('labels aggregated measures and totals only what adds up', () => {
    const spec = specSchema.parse({ dataset: 'sales_lines', fields: ['customer', 'taxable', 'qty', 'lines'], group: true, aggregates: { qty: 'avg' } });
    const { columns } = buildQuery(spec, '2026-10-07');
    expect(columns.map((c) => [c.key, c.label, c.total])).toEqual([
      ['customer', 'Customer', false],
      ['taxable', 'Taxable value', true],
      ['qty', 'Quantity (avg)', false],
      ['lines', 'Lines (count)', true],
    ]);
  });

  it('refuses unknown fields, hidden sort fields and bad filter values', () => {
    expect(() => buildQuery(specSchema.parse({ dataset: 'sales_lines', fields: ['nope'] }), '2026-10-07')).toThrow(/Unknown field/);
    expect(() => buildQuery(specSchema.parse({ dataset: 'sales_lines', fields: ['customer'], sort: { field: 'taxable', dir: 'desc' } }), '2026-10-07')).toThrow(/shown/);
    expect(() => buildQuery(specSchema.parse({ dataset: 'sales_lines', fields: ['customer'], filters: [{ field: 'taxable', op: 'gt', value: 'lots' }] }), '2026-10-07')).toThrow(/a number/);
    expect(() => buildQuery(specSchema.parse({ dataset: 'nope', fields: ['x'] }), '2026-10-07')).toThrow(/Unknown dataset/);
  });
});
