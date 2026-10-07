import { describe, expect, it } from 'vitest';
import { fullAndFinal, type SettlementInput } from '../../src/modules/hr/talent/settlement';

const base: SettlementInput = { kind: 'resignation', basicDa: 26_000, monthlyGross: 45_000, dateOfJoining: '2019-01-01', lastWorkingDay: '2026-09-30', leaveDays: 10, noticeShortfallDays: 0, waiveShortfall: false, loanOutstanding: 0, recoveries: 0 };
const amt = (ls: { code: string; amount: string }[], code: string) => Number(ls.find((l) => l.code === code)?.amount ?? 0);

describe('full and final settlement', () => {
  it('encashes leave and pays gratuity after five years', () => {
    const r = fullAndFinal(base);
    expect(amt(r.earnings, 'LEAVE_ENC')).toBe(10_000);
    // 7 years 9 months: the part year over six months counts, so 8 years × 15 days.
    expect(amt(r.earnings, 'GRATUITY')).toBe(15_000 * 8);
    expect(r.net).toBe('130000.00');
  });
  it('pays no gratuity under five years unless the employee died', () => {
    const short = { ...base, dateOfJoining: '2023-01-01' };
    expect(amt(fullAndFinal(short).earnings, 'GRATUITY')).toBe(0);
    expect(amt(fullAndFinal({ ...short, kind: 'death' }).earnings, 'GRATUITY')).toBe(15_000 * 4);
  });
  it('recovers notice not served, unless waived, and pays it in lieu on termination', () => {
    const r = fullAndFinal({ ...base, noticeShortfallDays: 15, loanOutstanding: 7_500, recoveries: 2_000 });
    expect(amt(r.deductions, 'NOTICE_REC')).toBe(22_500);
    expect(amt(r.deductions, 'LOAN')).toBe(7_500);
    expect(amt(r.deductions, 'CLEARANCE')).toBe(2_000);
    expect(Number(r.net)).toBe(130_000 - 22_500 - 7_500 - 2_000);
    expect(amt(fullAndFinal({ ...base, noticeShortfallDays: 15, waiveShortfall: true }).deductions, 'NOTICE_REC')).toBe(0);
    expect(amt(fullAndFinal({ ...base, kind: 'termination', noticeShortfallDays: 30 }).earnings, 'NOTICE_PAY')).toBe(45_000);
  });
});
