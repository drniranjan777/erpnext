/**
 * Alarm thresholds on a signal, kept pure: a breach must hold for `delaySeconds` before the alarm
 * opens, and the alarm clears at the first reading back inside the limit.
 */

export type AlarmOp = 'above' | 'below' | 'outside' | 'equals';

export interface RuleLimits {
  op: AlarmOp;
  threshold: number;
  threshold2: number | null;
  delaySeconds: number;
}

export interface RuleState {
  /** First breach not yet held long enough. */
  pendingSince: Date | null;
  /** The open alarm, if any, with its worst value so far. */
  open: { peak: number } | null;
}

export type RuleEvent = { kind: 'raise'; at: Date; value: number } | { kind: 'clear'; at: Date; peak: number };

export function breaches(r: RuleLimits, v: number): boolean {
  switch (r.op) {
    case 'above':
      return v > r.threshold;
    case 'below':
      return v < r.threshold;
    case 'outside':
      return v < r.threshold || v > (r.threshold2 ?? r.threshold);
    case 'equals':
      return v === r.threshold;
  }
}

/** The worse of two breaching values for this rule. */
export function worse(r: RuleLimits, a: number, b: number): number {
  if (r.op === 'above') return Math.max(a, b);
  if (r.op === 'below') return Math.min(a, b);
  if (r.op === 'outside') {
    const dist = (v: number) => (v < r.threshold ? r.threshold - v : v - (r.threshold2 ?? r.threshold));
    return dist(b) > dist(a) ? b : a;
  }
  return a;
}

/** Applies readings (in time order) to a rule; returns the new state and what happened. */
export function stepRule(r: RuleLimits, state: RuleState, readings: { ts: Date; value: number }[]): { state: RuleState; events: RuleEvent[] } {
  let pendingSince = state.pendingSince;
  let open = state.open ? { ...state.open } : null;
  const events: RuleEvent[] = [];
  for (const { ts, value } of readings) {
    if (breaches(r, value)) {
      if (open) {
        open.peak = worse(r, open.peak, value);
        continue;
      }
      pendingSince ??= ts;
      if ((ts.getTime() - pendingSince.getTime()) / 1000 >= r.delaySeconds) {
        events.push({ kind: 'raise', at: ts, value });
        open = { peak: value };
        pendingSince = null;
      }
    } else {
      pendingSince = null;
      if (open) {
        events.push({ kind: 'clear', at: ts, peak: open.peak });
        open = null;
      }
    }
  }
  return { state: { pendingSince, open }, events };
}

export function describeRule(r: RuleLimits, unit: string | null) {
  const u = unit ? ` ${unit}` : '';
  const limit = r.op === 'above' ? `above ${r.threshold}${u}` : r.op === 'below' ? `below ${r.threshold}${u}` : r.op === 'outside' ? `outside ${r.threshold}–${r.threshold2}${u}` : `at ${r.threshold}${u}`;
  return r.delaySeconds ? `${limit} for ${r.delaySeconds >= 120 ? `${Math.round(r.delaySeconds / 60)} min` : `${r.delaySeconds} s`}` : limit;
}

/** Parses a reading timestamp: epoch milliseconds or an ISO string. */
export function parseTs(t: number | string): Date | null {
  const d = typeof t === 'number' ? new Date(t) : new Date(t);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Bucket width (seconds) for a chart of about `points` points over a range. */
export function bucketSeconds(from: Date, to: Date, points: number): number {
  const span = Math.max(1, (to.getTime() - from.getTime()) / 1000);
  const raw = span / Math.max(1, points);
  const steps = [1, 5, 10, 30, 60, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400];
  return steps.find((s) => s >= raw) ?? 86400;
}
