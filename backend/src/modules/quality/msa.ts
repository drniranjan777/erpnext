/**
 * Gauge R&R by the AIAG (MSA 4th ed.) average-and-range method.
 *
 * measurements[operator][part][trial]. Repeatability (EV) comes from the average range of the
 * trials, reproducibility (AV) from the spread of the operators' averages, part variation (PV)
 * from the range of the part averages. All are standard deviations; %GRR compares GRR with the
 * total variation and with the tolerance (6σ spread).
 */

const K1: Record<number, number> = { 2: 0.8862, 3: 0.5908 };
const K2: Record<number, number> = { 2: 0.7071, 3: 0.5231 };
const K3: Record<number, number> = { 2: 0.7071, 3: 0.5231, 4: 0.4467, 5: 0.403, 6: 0.3742, 7: 0.3534, 8: 0.3375, 9: 0.3249, 10: 0.3146 };

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const r1 = (v: number) => Math.round(v * 10) / 10;

export interface GrrResult {
  operators: number;
  parts: number;
  trials: number;
  ev: number;
  av: number;
  grr: number;
  pv: number;
  tv: number;
  pctEv: number;
  pctAv: number;
  pctGrr: number;
  pctPv: number;
  /** %GRR of the tolerance (6 × GRR ÷ tolerance), when the tolerance is known. */
  pctTolerance: number | null;
  /** Number of distinct categories the system can tell apart. */
  ndc: number;
  /** acceptable (< 10 %) | marginal (10–30 %) | unacceptable (> 30 %), on the worse of %GRR and %tolerance. */
  verdict: 'acceptable' | 'marginal' | 'unacceptable';
}

export function validateStudy(m: number[][][]): string | null {
  const k = m.length;
  if (k < 2 || k > 3) return 'Use 2 or 3 operators';
  const n = m[0]?.length ?? 0;
  if (n < 2 || n > 10) return 'Use 2 to 10 parts';
  const r = m[0]?.[0]?.length ?? 0;
  if (r < 2 || r > 3) return 'Use 2 or 3 trials';
  for (const op of m) {
    if (op.length !== n) return 'Every operator measures every part';
    for (const part of op) if (part.length !== r || part.some((v) => typeof v !== 'number' || Number.isNaN(v))) return 'Every part needs every trial';
  }
  return null;
}

export function gaugeRR(m: number[][][], tolerance: number | null): GrrResult {
  const k = m.length;
  const n = m[0].length;
  const r = m[0][0].length;
  // Repeatability: average range of the trials, over every operator and part.
  const ranges = m.flatMap((op) => op.map((trials) => Math.max(...trials) - Math.min(...trials)));
  const rBar = mean(ranges);
  const ev = rBar * K1[r];
  // Reproducibility: range of operator averages, less the share of repeatability in it.
  const opMeans = m.map((op) => mean(op.flat()));
  const xDiff = Math.max(...opMeans) - Math.min(...opMeans);
  const avSq = (xDiff * K2[k]) ** 2 - ev ** 2 / (n * r);
  const av = avSq > 0 ? Math.sqrt(avSq) : 0;
  const grr = Math.sqrt(ev ** 2 + av ** 2);
  // Part variation: range of the part averages (across operators and trials).
  const partMeans = Array.from({ length: n }, (_, p) => mean(m.flatMap((op) => op[p])));
  const rp = Math.max(...partMeans) - Math.min(...partMeans);
  const pv = rp * K3[n];
  const tv = Math.sqrt(grr ** 2 + pv ** 2);
  const pct = (x: number) => (tv > 0 ? r1((100 * x) / tv) : 0);
  const pctTolerance = tolerance && tolerance > 0 ? r1((100 * 6 * grr) / tolerance) : null;
  const worst = Math.max(pct(grr), pctTolerance ?? 0);
  return {
    operators: k,
    parts: n,
    trials: r,
    ev: r4(ev),
    av: r4(av),
    grr: r4(grr),
    pv: r4(pv),
    tv: r4(tv),
    pctEv: pct(ev),
    pctAv: pct(av),
    pctGrr: pct(grr),
    pctPv: pct(pv),
    pctTolerance,
    ndc: grr > 0 ? Math.floor(1.41 * (pv / grr)) : 0,
    verdict: worst < 10 ? 'acceptable' : worst <= 30 ? 'marginal' : 'unacceptable',
  };
}

/** Risk priority number from 1–5 ratings of severity, occurrence and detection, and its band. */
export function riskOf(severity: number, occurrence: number, detection: number) {
  const rpn = severity * occurrence * detection;
  return { rpn, level: severity >= 5 || rpn >= 45 ? 'high' : rpn >= 18 ? 'medium' : 'low' } as const;
}
