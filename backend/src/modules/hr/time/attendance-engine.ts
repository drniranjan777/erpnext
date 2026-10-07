/**
 * Pure attendance rules: which shift applies on a date, which punches belong to it, and what the
 * day comes to (status, worked, late, early, overtime, comp-off). Times are IST wall-clock.
 */

export interface ShiftDef {
  id: string;
  startTime: string; // HH:MM[:SS]
  endTime: string;
  breakMinutes: number;
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  otAfterMinutes: number | null;
}

export interface Assignment {
  shiftIds: string[];
  rotateEveryDays: number;
  weeklyOffs: number[];
  fromDate: string;
  toDate: string | null;
}

export type DayStatus = 'present' | 'half_day' | 'absent' | 'missed_punch' | 'weekly_off' | 'holiday' | 'leave';

export interface DayInput {
  date: string;
  shift: ShiftDef | null;
  /** All punches near the date; the ones inside the shift window are used. */
  punches: Date[];
  off: 'weekly_off' | 'holiday' | null;
  /** Approved leave on this date: 1 = full day, 0.5 = half. */
  leave: { days: number; paid: boolean; leaveTypeId: string } | null;
}

export interface DayResult {
  status: DayStatus;
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  otMinutes: number;
  leaveDays: number;
  payableDays: number;
  /** Comp-off earned by working on a weekly off or holiday. */
  compOff: number;
}

/** Factories Act s.51 / s.54: overtime beyond 9 hours a day. */
export const DAILY_OT_AFTER = 9 * 60;
/** Factories Act s.51: 48 hours a week. */
export const WEEKLY_HOURS = 48 * 60;
/** Factories Act s.55: a rest interval is due once a spell exceeds 5 hours. */
const BREAK_AFTER = 5 * 60;
const DEFAULT_FULL = 450;
const DEFAULT_HALF = 240;

export const at = (date: string, time: string) => new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+05:30`);
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const datesIn = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
/** IST calendar date of an instant. */
export const istDate = (t: Date) => new Date(t.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** The shift of a rotation that applies on a date. */
export function shiftOn(a: Assignment, date: string): string | null {
  if (date < a.fromDate || (a.toDate && date > a.toDate) || !a.shiftIds.length) return null;
  const block = Math.floor(daysBetween(a.fromDate, date) / Math.max(1, a.rotateEveryDays));
  return a.shiftIds[block % a.shiftIds.length];
}

/** Shift start and end instants; an end at or before the start is on the next day. */
export function shiftTimes(date: string, s: ShiftDef) {
  const start = at(date, s.startTime);
  const night = minutes(s.endTime) <= minutes(s.startTime);
  const end = at(night ? addDays(date, 1) : date, s.endTime);
  return { start, end, night };
}

/**
 * The punches that belong to a date: from 4 hours before the shift starts to 8 hours after it
 * ends (so a late night shift's out-punch is not taken as the next day's in-punch). Without a
 * shift, the IST calendar day.
 */
export function punchWindow(date: string, s: ShiftDef | null) {
  if (!s) return { from: at(date, '00:00'), to: at(addDays(date, 1), '00:00') };
  const { start, end } = shiftTimes(date, s);
  return { from: new Date(start.getTime() - 4 * 3_600_000), to: new Date(Math.min(end.getTime() + 8 * 3_600_000, start.getTime() + 20 * 3_600_000)) };
}

export function evaluateDay(input: DayInput): DayResult {
  const s = input.shift;
  const win = punchWindow(input.date, s);
  const ps = input.punches.filter((p) => p >= win.from && p < win.to).sort((a, b) => a.getTime() - b.getTime());
  const firstIn = ps[0] ?? null;
  const lastOut = ps.length > 1 && ps[ps.length - 1].getTime() - ps[0].getTime() >= 60_000 ? ps[ps.length - 1] : null;
  const span = firstIn && lastOut ? Math.floor((lastOut.getTime() - firstIn.getTime()) / 60_000) : 0;
  const worked = span > BREAK_AFTER ? Math.max(0, span - (s?.breakMinutes ?? 30)) : span;
  const full = s?.fullDayMinutes ?? DEFAULT_FULL;
  const half = s?.halfDayMinutes ?? DEFAULT_HALF;
  const base: DayResult = { status: 'absent', firstIn, lastOut, workedMinutes: worked, lateMinutes: 0, earlyMinutes: 0, otMinutes: 0, leaveDays: 0, payableDays: 0, compOff: 0 };

  if (input.off) {
    // Work on an off day earns comp-off rather than counting as a working day.
    return { ...base, status: input.off, payableDays: 1, compOff: worked >= full ? 1 : worked >= half ? 0.5 : 0 };
  }
  const leave = input.leave;
  if (leave && leave.days >= 1) return { ...base, status: 'leave', leaveDays: 1, payableDays: leave.paid ? 1 : 0 };

  if (s && firstIn) {
    const { start, end } = shiftTimes(input.date, s);
    const late = Math.floor((firstIn.getTime() - start.getTime()) / 60_000);
    base.lateMinutes = late > s.graceMinutes ? late : 0;
    if (lastOut) base.earlyMinutes = Math.max(0, Math.floor((end.getTime() - lastOut.getTime()) / 60_000));
  }
  const otAfter = s?.otAfterMinutes ?? DAILY_OT_AFTER;
  // Overtime is counted in completed quarter hours.
  base.otMinutes = Math.floor(Math.max(0, worked - otAfter) / 15) * 15;

  if (leave) {
    // Half a day on leave: the other half must be worked.
    const workedHalf = worked >= half;
    return { ...base, status: workedHalf ? 'half_day' : firstIn && !lastOut ? 'missed_punch' : 'absent', leaveDays: 0.5, payableDays: (leave.paid ? 0.5 : 0) + (workedHalf ? 0.5 : 0) };
  }
  if (!firstIn) return base;
  if (!lastOut) return { ...base, status: 'missed_punch' };
  if (worked >= full) return { ...base, status: 'present', payableDays: 1 };
  if (worked >= half) return { ...base, status: 'half_day', payableDays: 0.5 };
  return base;
}

/**
 * Weekly overtime under s.51: hours beyond 48 in a week that the daily rule has not already
 * counted. `days` are one week's worked and daily OT minutes.
 */
export function weeklyExtraOt(days: { workedMinutes: number; otMinutes: number }[]) {
  const worked = days.reduce((s, d) => s + d.workedMinutes, 0);
  const daily = days.reduce((s, d) => s + d.otMinutes, 0);
  return Math.floor(Math.max(0, worked - daily - WEEKLY_HOURS) / 15) * 15;
}

/**
 * Days a leave application costs: each date from..to, less weekly offs and holidays unless the
 * type counts them (sandwich rule), less half a day for a half first or last day.
 */
export function leaveDaysFor(a: { fromDate: string; toDate: string; fromHalf: boolean; toHalf: boolean }, isOff: (date: string) => boolean, countHolidays: boolean) {
  let days = 0;
  for (const d of datesIn(a.fromDate, a.toDate)) {
    if (!countHolidays && isOff(d)) continue;
    let n = 1;
    if (d === a.fromDate && a.fromHalf) n -= 0.5;
    if (d === a.toDate && a.toHalf) n -= 0.5;
    days += Math.max(0, n);
  }
  return days;
}

/** Leave falling on a date: 1, 0.5 or 0. */
export function leaveOn(a: { fromDate: string; toDate: string; fromHalf: boolean; toHalf: boolean }, date: string) {
  if (date < a.fromDate || date > a.toDate) return 0;
  let n = 1;
  if (date === a.fromDate && a.fromHalf) n -= 0.5;
  if (date === a.toDate && a.toHalf) n -= 0.5;
  return Math.max(0, n);
}

/** Great-circle distance in metres. */
export function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(a)));
}

/**
 * A punch time from a device or spreadsheet: ISO, "YYYY-MM-DD HH:MM[:SS]", "DD-MM-YYYY HH:MM" or
 * "DD/MM/YYYY HH:MM". Times without a zone are IST.
 */
export function parsePunchTime(text: string): Date | null {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) return valid(m[1], m[2], m[3], m[4], m[5], m[6]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) return valid(m[3], m[2], m[1], m[4], m[5], m[6]);
  return null;
}
function valid(y: string, mo: string, d: string, h: string, mi: string, s?: string) {
  const pad = (v: string) => v.padStart(2, '0');
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59) return null;
  const out = new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}:${pad(s ?? '0')}+05:30`);
  return Number.isNaN(out.getTime()) || istDate(out) !== `${y}-${pad(mo)}-${pad(d)}` ? null : out;
}
