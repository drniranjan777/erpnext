/**
 * Working-time calendar of a work centre, in IST. A working day has one shift starting
 * `shiftStart` minutes after midnight and lasting `minutesPerDay`; 5 = Mon–Fri, 6 = Mon–Sat,
 * 7 = every day. Times are epoch milliseconds.
 */
export interface Calendar {
  minutesPerDay: number;
  daysPerWeek: number;
  shiftStart: number;
}

export const IST_MS = 330 * 60_000;
const DAY = 86_400_000;
const MIN = 60_000;

/** Midnight IST of the day containing `t`. */
export function istDayStart(t: number) {
  return Math.floor((t + IST_MS) / DAY) * DAY - IST_MS;
}

export function isWorkingDay(cal: Calendar, dayStart: number) {
  const dow = new Date(dayStart + IST_MS).getUTCDay(); // 0 = Sunday
  if (cal.daysPerWeek >= 7) return true;
  if (cal.daysPerWeek === 6) return dow !== 0;
  return dow !== 0 && dow !== 6;
}

const valid = (cal: Calendar) => cal.minutesPerDay > 0 && cal.daysPerWeek > 0;

/** The first working window that ends after `t`, clipped to start no earlier than `t`. */
export function windowFrom(cal: Calendar, t: number): { start: number; end: number } {
  if (!valid(cal)) return { start: t, end: Number.MAX_SAFE_INTEGER };
  const len = Math.min(cal.minutesPerDay, 1440) * MIN;
  // A shift may run past midnight, so start from the previous day.
  for (let d = istDayStart(t) - DAY, i = 0; i < 4000; d += DAY, i++) {
    if (!isWorkingDay(cal, d)) continue;
    const ws = d + cal.shiftStart * MIN;
    const we = ws + len;
    if (we > t) return { start: Math.max(ws, t), end: we };
  }
  return { start: t, end: Number.MAX_SAFE_INTEGER };
}

export function nextWorking(cal: Calendar, t: number) {
  return windowFrom(cal, t).start;
}

/** The moment `minutes` of working time after `t`. */
export function addWorking(cal: Calendar, t: number, minutes: number) {
  let left = Math.max(0, minutes) * MIN;
  let cur = t;
  for (let i = 0; i < 4000; i++) {
    const w = windowFrom(cal, cur);
    if (left <= w.end - w.start) return w.start + left;
    left -= w.end - w.start;
    cur = w.end;
  }
  return cur + left;
}

/** Working minutes between two instants. */
export function workingMinutes(cal: Calendar, from: number, to: number) {
  let total = 0;
  let cur = from;
  for (let i = 0; i < 4000 && cur < to; i++) {
    const w = windowFrom(cal, cur);
    if (w.start >= to) break;
    total += Math.min(w.end, to) - w.start;
    cur = w.end;
  }
  return total / MIN;
}

/**
 * Spreads `minutes` of load evenly over the working time between `from` and `to`, into
 * buckets ([start, end) instants). With no working time in the window, the whole load lands
 * in the bucket containing `from` (or the first one).
 */
export function spread(cal: Calendar, from: number, to: number, minutes: number, buckets: { start: number; end: number }[]) {
  const out = buckets.map(() => 0);
  const total = workingMinutes(cal, from, Math.max(from, to));
  if (total <= 0) {
    const i = buckets.findIndex((b) => from < b.end);
    out[i < 0 ? 0 : i] += minutes;
    return out;
  }
  buckets.forEach((b, i) => {
    const a = Math.max(from, b.start);
    const z = Math.min(to, b.end);
    if (z > a) out[i] += (minutes * workingMinutes(cal, a, z)) / total;
  });
  return out;
}
