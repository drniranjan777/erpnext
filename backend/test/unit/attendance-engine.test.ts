import { describe, expect, it } from 'vitest';
import { at, distanceMetres, evaluateDay, leaveDaysFor, leaveOn, parsePunchTime, shiftOn, weeklyExtraOt, type ShiftDef } from '../../src/modules/hr/time/attendance-engine';

const general: ShiftDef = { id: 'g', startTime: '09:00', endTime: '17:30', breakMinutes: 30, graceMinutes: 10, halfDayMinutes: 240, fullDayMinutes: 450, otAfterMinutes: null };
const night: ShiftDef = { ...general, id: 'n', startTime: '22:00', endTime: '06:00' };
const day = (date: string, punches: string[][], extra: Partial<Parameters<typeof evaluateDay>[0]> = {}) =>
  evaluateDay({ date, shift: general, punches: punches.map(([d, t]) => at(d, t)), off: null, leave: null, ...extra });

describe('evaluateDay', () => {
  it('counts a full day with the break taken out', () => {
    const r = day('2026-10-05', [['2026-10-05', '09:02'], ['2026-10-05', '17:35']]);
    expect(r.status).toBe('present');
    expect(r.workedMinutes).toBe(513 - 30);
    expect(r.lateMinutes).toBe(0);
    expect(r.payableDays).toBe(1);
  });
  it('marks late beyond grace from the shift start', () => {
    expect(day('2026-10-05', [['2026-10-05', '09:25'], ['2026-10-05', '17:30']]).lateMinutes).toBe(25);
    expect(day('2026-10-05', [['2026-10-05', '09:10'], ['2026-10-05', '17:30']]).lateMinutes).toBe(0);
  });
  it('gives a half day, absent and missed punch', () => {
    expect(day('2026-10-05', [['2026-10-05', '09:00'], ['2026-10-05', '13:30']]).status).toBe('half_day');
    expect(day('2026-10-05', [['2026-10-05', '09:00'], ['2026-10-05', '11:00']]).status).toBe('absent');
    expect(day('2026-10-05', [['2026-10-05', '09:00']]).status).toBe('missed_punch');
    expect(day('2026-10-05', []).status).toBe('absent');
  });
  it('counts overtime past 9 hours worked in quarter hours', () => {
    // 08:55 to 19:20 = 625 min − 30 break = 595 worked → 55 over 540 → 45 in quarter hours.
    const r = day('2026-10-05', [['2026-10-05', '08:55'], ['2026-10-05', '19:20']]);
    expect(r.workedMinutes).toBe(595);
    expect(r.otMinutes).toBe(45);
    expect(day('2026-10-05', [['2026-10-05', '09:00'], ['2026-10-05', '17:30']], { shift: { ...general, otAfterMinutes: 420 } }).otMinutes).toBe(60);
  });
  it('keeps a night shift together across midnight', () => {
    const r = evaluateDay({ date: '2026-10-05', shift: night, punches: [at('2026-10-05', '21:55'), at('2026-10-06', '06:05'), at('2026-10-06', '21:58')], off: null, leave: null });
    expect(r.status).toBe('present');
    expect(r.firstIn!.toISOString()).toBe(at('2026-10-05', '21:55').toISOString());
    expect(r.lastOut!.toISOString()).toBe(at('2026-10-06', '06:05').toISOString());
    const next = evaluateDay({ date: '2026-10-06', shift: night, punches: [at('2026-10-06', '06:05'), at('2026-10-06', '21:58'), at('2026-10-07', '06:01')], off: null, leave: null });
    expect(next.firstIn!.toISOString()).toBe(at('2026-10-06', '21:58').toISOString());
  });
  it('earns comp-off for work on an off day and pays the off day', () => {
    const r = day('2026-10-04', [['2026-10-04', '09:00'], ['2026-10-04', '17:30']], { off: 'weekly_off' });
    expect(r).toMatchObject({ status: 'weekly_off', payableDays: 1, compOff: 1 });
    expect(day('2026-10-04', [['2026-10-04', '09:00'], ['2026-10-04', '13:30']], { off: 'holiday' }).compOff).toBe(0.5);
  });
  it('handles full and half-day leave', () => {
    expect(day('2026-10-05', [], { leave: { days: 1, paid: true, leaveTypeId: 'cl' } })).toMatchObject({ status: 'leave', payableDays: 1, leaveDays: 1 });
    expect(day('2026-10-05', [], { leave: { days: 1, paid: false, leaveTypeId: 'lop' } }).payableDays).toBe(0);
    expect(day('2026-10-05', [['2026-10-05', '09:00'], ['2026-10-05', '13:30']], { leave: { days: 0.5, paid: true, leaveTypeId: 'cl' } })).toMatchObject({ status: 'half_day', payableDays: 1 });
    expect(day('2026-10-05', [], { leave: { days: 0.5, paid: true, leaveTypeId: 'cl' } })).toMatchObject({ status: 'absent', payableDays: 0.5 });
  });
});

describe('rosters and leave days', () => {
  it('rotates shifts every N days', () => {
    const a = { shiftIds: ['A', 'B', 'C'], rotateEveryDays: 7, weeklyOffs: [0], fromDate: '2026-10-05', toDate: null };
    expect(shiftOn(a, '2026-10-05')).toBe('A');
    expect(shiftOn(a, '2026-10-11')).toBe('A');
    expect(shiftOn(a, '2026-10-12')).toBe('B');
    expect(shiftOn(a, '2026-10-26')).toBe('A');
    expect(shiftOn(a, '2026-10-04')).toBeNull();
  });
  it('excludes offs unless the sandwich rule applies, and halves', () => {
    const sunday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
    const a = { fromDate: '2026-10-02', toDate: '2026-10-06', fromHalf: false, toHalf: true };
    expect(leaveDaysFor(a, sunday, false)).toBe(3.5);
    expect(leaveDaysFor(a, sunday, true)).toBe(4.5);
    expect(leaveDaysFor({ fromDate: '2026-10-05', toDate: '2026-10-05', fromHalf: true, toHalf: false }, sunday, false)).toBe(0.5);
    expect(leaveOn(a, '2026-10-06')).toBe(0.5);
    expect(leaveOn(a, '2026-10-07')).toBe(0);
  });
  it('adds weekly overtime beyond 48 hours not already counted daily', () => {
    expect(weeklyExtraOt(Array.from({ length: 6 }, () => ({ workedMinutes: 510, otMinutes: 0 })))).toBe(180);
    expect(weeklyExtraOt(Array.from({ length: 6 }, () => ({ workedMinutes: 600, otMinutes: 60 })))).toBe(360);
  });
});

describe('helpers', () => {
  it('parses device and spreadsheet times as IST', () => {
    expect(parsePunchTime('2026-10-05 09:02')!.toISOString()).toBe('2026-10-05T03:32:00.000Z');
    expect(parsePunchTime('05/10/2026 17:35:20')!.toISOString()).toBe('2026-10-05T12:05:20.000Z');
    expect(parsePunchTime('2026-10-05T03:32:00Z')!.toISOString()).toBe('2026-10-05T03:32:00.000Z');
    expect(parsePunchTime('31/02/2026 09:00')).toBeNull();
    expect(parsePunchTime('yesterday')).toBeNull();
  });
  it('measures distance for the geofence', () => {
    // Two points about 111 m apart along a meridian.
    expect(distanceMetres(17.385, 78.4867, 17.386, 78.4867)).toBeGreaterThan(105);
    expect(distanceMetres(17.385, 78.4867, 17.386, 78.4867)).toBeLessThan(115);
  });
});
