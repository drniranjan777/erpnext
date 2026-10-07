/**
 * Statistical demand forecasting on monthly history. Each method forecasts the next months;
 * the one with the smallest error on the most recent months (walk-forward) is chosen.
 */

export type Method = 'moving_average' | 'exponential' | 'holt' | 'seasonal_naive' | 'holt_winters' | 'croston';

export interface ForecastResult {
  method: Method;
  /** Mean absolute error on the hold-out months (units). */
  mae: number;
  /** Mean absolute percentage error, % (null when actuals were zero). */
  mape: number | null;
  forecast: number[];
  /** 80 % prediction interval per month (forecast ± 1.28 × the back-test RMSE, not below zero). */
  lower?: number[];
  upper?: number[];
  /** Many months with no demand (spare parts, slow movers): Croston's method is tried. */
  intermittent?: boolean;
}

const round = (v: number) => Math.max(0, Math.round(v * 100) / 100);

function movingAverage(h: number[], horizon: number, n = 3) {
  const w = h.slice(-n);
  const avg = w.length ? w.reduce((s, v) => s + v, 0) / w.length : 0;
  return Array(horizon).fill(avg);
}

function exponential(h: number[], horizon: number, alpha = 0.3) {
  if (!h.length) return Array(horizon).fill(0);
  let level = h[0];
  for (const v of h.slice(1)) level = alpha * v + (1 - alpha) * level;
  return Array(horizon).fill(level);
}

/** Holt's linear trend (double exponential smoothing). */
function holt(h: number[], horizon: number, alpha = 0.3, beta = 0.1) {
  if (h.length < 2) return exponential(h, horizon, alpha);
  let level = h[0];
  let trend = h[1] - h[0];
  for (const v of h.slice(1)) {
    const prev = level;
    level = alpha * v + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  return Array.from({ length: horizon }, (_, i) => level + (i + 1) * trend);
}

function seasonalNaive(h: number[], horizon: number, season = 12) {
  if (h.length < season) return movingAverage(h, horizon);
  return Array.from({ length: horizon }, (_, i) => h[h.length - season + (i % season)]);
}

/** Additive Holt-Winters with a 12-month season (needs two seasons of history). */
function holtWinters(h: number[], horizon: number, alpha = 0.3, beta = 0.05, gamma = 0.2, season = 12) {
  if (h.length < 2 * season) return seasonalNaive(h, horizon, season);
  const first = h.slice(0, season);
  const second = h.slice(season, 2 * season);
  const avg1 = first.reduce((s, v) => s + v, 0) / season;
  const avg2 = second.reduce((s, v) => s + v, 0) / season;
  let level = avg1;
  let trend = (avg2 - avg1) / season;
  const seasonal = first.map((v) => v - avg1);
  for (let t = season; t < h.length; t++) {
    const s = seasonal[t % season];
    const prev = level;
    level = alpha * (h[t] - s) + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
    seasonal[t % season] = gamma * (h[t] - level) + (1 - gamma) * s;
  }
  return Array.from({ length: horizon }, (_, i) => level + (i + 1) * trend + seasonal[(h.length + i) % season]);
}

/**
 * Croston's method (with the Syntetos–Boylan correction) for intermittent demand: smooths the
 * size of non-zero demands and the interval between them separately; the rate is size ÷ interval.
 */
export function croston(h: number[], horizon: number, alpha = 0.1) {
  const firstAt = h.findIndex((v) => v > 0);
  if (firstAt < 0) return Array(horizon).fill(0);
  let size = h[firstAt];
  let interval = firstAt + 1;
  let since = 0;
  for (let t = firstAt + 1; t < h.length; t++) {
    since++;
    if (h[t] > 0) {
      size = alpha * h[t] + (1 - alpha) * size;
      interval = alpha * since + (1 - alpha) * interval;
      since = 0;
    }
  }
  const rate = (1 - alpha / 2) * (size / interval);
  return Array(horizon).fill(rate);
}

const METHODS: Record<Method, (h: number[], horizon: number) => number[]> = {
  moving_average: (h, n) => movingAverage(h, n),
  exponential: (h, n) => exponential(h, n),
  holt: (h, n) => holt(h, n),
  seasonal_naive: (h, n) => seasonalNaive(h, n),
  holt_winters: (h, n) => holtWinters(h, n),
  croston: (h, n) => croston(h, n),
};

/** Error of a method forecasting each of the last `holdout` months from the months before it. */
export function backtest(h: number[], method: Method, holdout: number) {
  let abs = 0;
  let sq = 0;
  let pct = 0;
  let pctN = 0;
  let n = 0;
  for (let t = h.length - holdout; t < h.length; t++) {
    if (t < 3) continue;
    const f = METHODS[method](h.slice(0, t), 1)[0];
    const e = Math.abs(h[t] - f);
    abs += e;
    sq += e * e;
    n++;
    if (h[t] > 0) {
      pct += e / h[t];
      pctN++;
    }
  }
  return { mae: n ? abs / n : Infinity, mape: pctN ? (pct / pctN) * 100 : null, rmse: n ? Math.sqrt(sq / n) : 0 };
}

/** Picks the best method on recent history and forecasts `horizon` months. */
export function forecastSeries(history: number[], horizon: number): ForecastResult {
  const total = history.reduce((s, v) => s + v, 0);
  if (!total) return { method: 'moving_average', mae: 0, mape: null, forecast: Array(horizon).fill(0) };
  const candidates: Method[] = history.length >= 24 ? ['holt_winters', 'seasonal_naive', 'holt', 'exponential', 'moving_average'] : history.length >= 12 ? ['seasonal_naive', 'holt', 'exponential', 'moving_average'] : ['holt', 'exponential', 'moving_average'];
  const intermittent = history.filter((v) => v === 0).length / history.length >= 0.3;
  if (intermittent) candidates.push('croston');
  const holdout = Math.min(6, Math.max(1, history.length - 3));
  let best: { method: Method; mae: number; mape: number | null; rmse: number } | null = null;
  for (const m of candidates) {
    const r = backtest(history, m, holdout);
    if (!best || r.mae < best.mae - 1e-9) best = { method: m, ...r };
  }
  const b = best!;
  const forecast = METHODS[b.method](history, horizon).map(round);
  // The spread widens slowly with the horizon (√ of months ahead).
  const band = (i: number) => 1.28 * b.rmse * Math.sqrt(i + 1);
  return {
    method: b.method,
    mae: Math.round(b.mae * 100) / 100,
    mape: b.mape === null ? null : Math.round(b.mape * 10) / 10,
    forecast,
    lower: forecast.map((f, i) => round(f - band(i))),
    upper: forecast.map((f, i) => round(f + band(i))),
    intermittent,
  };
}

/** Month keys "YYYY-MM" from `from` for `count` months. */
export function months(from: string, count: number) {
  const [y, m] = from.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}
