import { describe, expect, it } from 'vitest';
import { canAutoExecute, daysOfCover, nextRun, reorderQty } from '../../src/modules/agents/framework';

describe('scheduling', () => {
  const at = new Date('2026-10-07T05:10:00Z'); // 10:40 IST, a Wednesday
  it('runs hourly at the top of the next hour', () => {
    expect(nextRun('hourly', 7, at).toISOString()).toBe('2026-10-07T06:00:00.000Z');
  });
  it('runs daily at the IST hour, today if still ahead', () => {
    expect(nextRun('daily', 7, at).toISOString()).toBe('2026-10-08T01:30:00.000Z'); // 07:00 IST tomorrow
    expect(nextRun('daily', 18, at).toISOString()).toBe('2026-10-07T12:30:00.000Z'); // 18:00 IST today
  });
  it('runs weekly on Monday', () => {
    expect(nextRun('weekly', 7, at).toISOString()).toBe('2026-10-12T01:30:00.000Z');
  });
});

describe('guardrails', () => {
  const action = { type: 'create_requisition', label: 'x', params: {}, amount: 40_000 };
  it('auto-executes only when switched on, with an actor, within limits', () => {
    expect(canAutoExecute({}, action, true).ok).toBe(false);
    expect(canAutoExecute({ autoExecute: true }, action, false).why).toBe('nobody is set to act for the agent');
    expect(canAutoExecute({ autoExecute: true, autoExecuteBelow: 25_000 }, action, true).why).toMatch(/automatic limit/);
    expect(canAutoExecute({ autoExecute: true, maxAmount: 30_000 }, action, true).why).toMatch(/above the ₹30000 limit/);
    expect(canAutoExecute({ autoExecute: true, autoExecuteBelow: 50_000 }, action, true).ok).toBe(true);
    expect(canAutoExecute({ autoExecute: true }, null, true).ok).toBe(false);
  });
});

describe('stock maths', () => {
  it('works out days of cover and the order quantity', () => {
    expect(daysOfCover(10, 90, 60)).toBe(6);
    expect(daysOfCover(10, 0, 60)).toBeNull();
    expect(reorderQty(10, 50, 200)).toBe(200);
    expect(reorderQty(10, 50, null)).toBe(90);
  });
});
