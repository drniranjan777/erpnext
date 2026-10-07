/**
 * Plant monitoring maths, kept pure: anomaly detection for condition monitoring, cold-chain
 * excursions and mean kinetic temperature, and electrical demand.
 */

// ---- condition monitoring ----------------------------------------------------------------------

export interface CmState {
  n: number;
  mean: number;
  variance: number;
  /** Fast-moving average of recent readings (for drift). */
  recent: number | null;
  /** Consecutive readings beyond the spike limit. */
  streak: number;
}

export interface CmParams {
  minSamples: number;
  zThreshold: number;
  consecutive: number;
  driftThreshold: number;
}

/** How quickly the recent average follows the readings. */
const RECENT_ALPHA = 0.05;

export const stdOf = (s: Pick<CmState, 'mean' | 'variance'>) => Math.max(Math.sqrt(Math.max(s.variance, 0)), Math.abs(s.mean) * 0.005, 1e-6);

/**
 * One reading. While learning (fewer than `minSamples` readings) the baseline is the exact mean
 * and variance (Welford). After that a reading is a spike when it is more than `zThreshold`
 * standard deviations from the baseline for `consecutive` readings, and drift when the recent
 * average has moved more than `driftThreshold` standard deviations. The baseline stays fixed once
 * learned, so slow wear is not absorbed into "normal"; relearn it after maintenance or a process
 * change. Spikes do not move the recent average.
 */
export function cmStep(s: CmState, x: number, p: CmParams): { state: CmState; z: number; drift: number; anomaly: 'spike' | 'drift' | null; normal: boolean } {
  const follow = (r: number | null) => (r === null ? x : r + RECENT_ALPHA * (x - r));
  if (s.n < p.minSamples) {
    const recent = follow(s.recent);
    const n = s.n + 1;
    const delta = x - s.mean;
    const mean = s.mean + delta / n;
    const m2 = s.variance * Math.max(s.n - 1, 0) + delta * (x - mean);
    return { state: { n, mean, variance: n > 1 ? m2 / (n - 1) : 0, recent, streak: 0 }, z: 0, drift: 0, anomaly: null, normal: true };
  }
  const std = stdOf(s);
  const z = (x - s.mean) / std;
  const spiking = Math.abs(z) > p.zThreshold;
  // Spikes are judged on their own; the recent average (for drift) follows the other readings.
  const recent = spiking ? (s.recent ?? s.mean) : follow(s.recent);
  const drift = (recent - s.mean) / std;
  const drifting = Math.abs(drift) > p.driftThreshold;
  const streak = spiking ? s.streak + 1 : 0;
  const anomaly = streak >= p.consecutive ? 'spike' : drifting ? 'drift' : null;
  return {
    state: { n: s.n + 1, mean: s.mean, variance: s.variance, recent, streak },
    z: Math.round(z * 100) / 100,
    drift: Math.round(drift * 100) / 100,
    anomaly,
    normal: !spiking && Math.abs(drift) < p.driftThreshold / 2,
  };
}

// ---- cold chain --------------------------------------------------------------------------------

/** Activation energy / gas constant for mean kinetic temperature (ICH: 83.144 kJ/mol). */
const DH_R = 10_000;

/** Mean kinetic temperature (°C) of temperature readings taken at regular intervals. */
export function meanKineticTemperature(tempsC: number[]): number | null {
  if (!tempsC.length) return null;
  const avg = tempsC.reduce((n, t) => n + Math.exp(-DH_R / (t + 273.15)), 0) / tempsC.length;
  return Math.round((DH_R / -Math.log(avg) - 273.15) * 100) / 100;
}

export interface Excursion {
  start: number;
  end: number;
  minutes: number;
  direction: 'high' | 'low';
  worst: number;
}

/**
 * Periods outside [low, high]. A reading holds until the next one, so each excursion runs from
 * the first reading outside the range to the first reading back inside (or the last reading).
 */
export function excursions(readings: { ts: number; value: number }[], low: number | null, high: number | null): { excursions: Excursion[]; minutesOutside: number } {
  const out: Excursion[] = [];
  let cur: Excursion | null = null;
  const sorted = [...readings].sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const dir = high !== null && r.value > high ? 'high' : low !== null && r.value < low ? 'low' : null;
    if (cur && dir !== cur.direction) {
      cur.end = r.ts;
      out.push(cur);
      cur = null;
    }
    if (dir && !cur) cur = { start: r.ts, end: r.ts, minutes: 0, direction: dir, worst: r.value };
    if (cur) cur.worst = dir === 'high' ? Math.max(cur.worst, r.value) : Math.min(cur.worst, r.value);
  }
  if (cur) {
    cur.end = sorted[sorted.length - 1].ts;
    out.push(cur);
  }
  for (const e of out) e.minutes = Math.round(((e.end - e.start) / 60_000) * 10) / 10;
  return { excursions: out, minutesOutside: Math.round(out.reduce((n, e) => n + e.minutes, 0) * 10) / 10 };
}

// ---- energy ------------------------------------------------------------------------------------

/** Start of the demand interval containing `ts` (intervals are aligned to the clock). */
export const intervalStart = (ts: number, minutes: number) => Math.floor(ts / (minutes * 60_000)) * minutes * 60_000;

/** Demand (kW) the interval will reach if consumption continues at the rate so far. */
export function projectedDemandKw(kwhSoFar: number, elapsedMinutes: number): number {
  return elapsedMinutes > 0 ? Math.round(((kwhSoFar * 60) / elapsedMinutes) * 10) / 10 : 0;
}

/** Maximum demand (kW) over complete intervals, from kWh per minute. */
export function maxDemand(minutes: { minute: number; kwh: number }[], intervalMinutes: number): { kw: number; at: number | null } {
  const byInterval = new Map<number, number>();
  for (const m of minutes) {
    const k = intervalStart(m.minute, intervalMinutes);
    byInterval.set(k, (byInterval.get(k) ?? 0) + m.kwh);
  }
  let best = { kw: 0, at: null as number | null };
  for (const [k, kwh] of byInterval) {
    const kw = Math.round(((kwh * 60) / intervalMinutes) * 10) / 10;
    if (kw > best.kw) best = { kw, at: k };
  }
  return best;
}
