/**
 * Statistical process control: control limits for variables and attribute charts, process
 * capability, and the Western Electric run rules. Constants from ASTM / AIAG SPC tables.
 */

/** d2, A2, D3, D4 by subgroup size 2…10 (X-bar R). */
const XR: Record<number, { d2: number; A2: number; D3: number; D4: number }> = {
  2: { d2: 1.128, A2: 1.88, D3: 0, D4: 3.267 },
  3: { d2: 1.693, A2: 1.023, D3: 0, D4: 2.574 },
  4: { d2: 2.059, A2: 0.729, D3: 0, D4: 2.282 },
  5: { d2: 2.326, A2: 0.577, D3: 0, D4: 2.114 },
  6: { d2: 2.534, A2: 0.483, D3: 0, D4: 2.004 },
  7: { d2: 2.704, A2: 0.419, D3: 0.076, D4: 1.924 },
  8: { d2: 2.847, A2: 0.373, D3: 0.136, D4: 1.864 },
  9: { d2: 2.97, A2: 0.337, D3: 0.184, D4: 1.816 },
  10: { d2: 3.078, A2: 0.308, D3: 0.223, D4: 1.777 },
};

/** c4 for subgroup size n (X-bar S). */
export function c4(n: number) {
  // c4 = sqrt(2/(n-1)) * Γ(n/2) / Γ((n-1)/2), via log-gamma.
  const lg = (x: number): number => {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x;
    const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
    let s = 1.000000000190015;
    for (const c of g) s += c / ++y;
    return -t + Math.log((2.5066282746310005 * s) / x);
  };
  return Math.sqrt(2 / (n - 1)) * Math.exp(lg(n / 2) - lg((n - 1) / 2));
}

const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);
const sd = (v: number[]) => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};
const r = (v: number, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp;

export interface Limits {
  center: number;
  ucl: number;
  lcl: number;
}

export interface Point {
  label: string;
  value: number;
  /** Western Electric rules broken at this point (1–4). */
  rules: number[];
}

export interface Chart {
  name: string;
  limits: Limits;
  points: Point[];
}

/**
 * Western Electric rules on a series against its centre line and sigma:
 *  1. one point beyond 3σ; 2. two of three beyond 2σ (same side);
 *  3. four of five beyond 1σ (same side); 4. eight in a row on one side.
 */
export function westernElectric(values: number[], center: number, sigma: number) {
  const flags = values.map(() => new Set<number>());
  if (sigma <= 0) return flags.map(() => [] as number[]);
  const z = values.map((v) => (v - center) / sigma);
  z.forEach((x, i) => {
    if (Math.abs(x) > 3) flags[i].add(1);
    for (const side of [1, -1]) {
      if (i >= 2) {
        const w = [i - 2, i - 1, i].filter((k) => side * z[k] > 2);
        if (w.length >= 2 && side * x > 2) flags[i].add(2);
      }
      if (i >= 4) {
        const w = [i - 4, i - 3, i - 2, i - 1, i].filter((k) => side * z[k] > 1);
        if (w.length >= 4 && side * x > 1) flags[i].add(3);
      }
      if (i >= 7 && [0, 1, 2, 3, 4, 5, 6, 7].every((j) => side * z[i - j] > 0)) flags[i].add(4);
    }
  });
  return flags.map((f) => [...f].sort());
}

function chart(name: string, labels: string[], values: number[], limits: Limits, sigma: number): Chart {
  const rules = westernElectric(values, limits.center, sigma);
  return { name, limits: { center: r(limits.center), ucl: r(limits.ucl), lcl: r(limits.lcl) }, points: values.map((v, i) => ({ label: labels[i], value: r(v), rules: rules[i] })) };
}

export interface Subgroup {
  label: string;
  values: number[];
}

export interface Capability {
  n: number;
  mean: number;
  sigmaWithin: number;
  sigmaOverall: number;
  cp: number | null;
  cpk: number | null;
  pp: number | null;
  ppk: number | null;
}

export function capability(all: number[], sigmaWithin: number, lsl: number | null, usl: number | null): Capability {
  const m = mean(all);
  const so = sd(all);
  const idx = (s: number, two: boolean) => {
    if (s <= 0) return { c: null, k: null };
    const c = two && lsl !== null && usl !== null ? (usl - lsl) / (6 * s) : null;
    const ks = [usl !== null ? (usl - m) / (3 * s) : null, lsl !== null ? (m - lsl) / (3 * s) : null].filter((v): v is number => v !== null);
    return { c, k: ks.length ? Math.min(...ks) : null };
  };
  const w = idx(sigmaWithin, true);
  const o = idx(so, true);
  const rn = (v: number | null) => (v === null ? null : r(v, 3));
  return { n: all.length, mean: r(m), sigmaWithin: r(sigmaWithin), sigmaOverall: r(so), cp: rn(w.c), cpk: rn(w.k), pp: rn(o.c), ppk: rn(o.k) };
}

/**
 * Variables charts. Subgroups of equal size 2–10 give X-bar R, larger ones X-bar S, single
 * readings I-MR. Unequal subgroups use the most common size (others are dropped).
 */
export function variablesCharts(groups: Subgroup[], lsl: number | null, usl: number | null) {
  const sizes = new Map<number, number>();
  for (const g of groups) sizes.set(g.values.length, (sizes.get(g.values.length) ?? 0) + 1);
  const n = [...sizes.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
  const used = groups.filter((g) => g.values.length === n);
  const all = used.flatMap((g) => g.values);
  if (!used.length || n === 0) return null;
  if (n === 1) {
    const x = used.map((g) => g.values[0]);
    const mr = x.slice(1).map((v, i) => Math.abs(v - x[i]));
    const mrBar = mean(mr);
    const sigma = mrBar / 1.128;
    const xBar = mean(x);
    return {
      type: 'I-MR' as const,
      subgroupSize: 1,
      charts: [chart('Individuals', used.map((g) => g.label), x, { center: xBar, ucl: xBar + 3 * sigma, lcl: xBar - 3 * sigma }, sigma), chart('Moving range', used.slice(1).map((g) => g.label), mr, { center: mrBar, ucl: 3.267 * mrBar, lcl: 0 }, (3.267 * mrBar - mrBar) / 3)],
      capability: capability(all, sigma, lsl, usl),
    };
  }
  const means = used.map((g) => mean(g.values));
  const xbb = mean(means);
  const labels = used.map((g) => g.label);
  if (n <= 10) {
    const k = XR[n];
    const ranges = used.map((g) => Math.max(...g.values) - Math.min(...g.values));
    const rBar = mean(ranges);
    const sigma = rBar / k.d2;
    return {
      type: 'X-bar R' as const,
      subgroupSize: n,
      charts: [chart('Averages', labels, means, { center: xbb, ucl: xbb + k.A2 * rBar, lcl: xbb - k.A2 * rBar }, sigma / Math.sqrt(n)), chart('Ranges', labels, ranges, { center: rBar, ucl: k.D4 * rBar, lcl: k.D3 * rBar }, (k.D4 * rBar - rBar) / 3)],
      capability: capability(all, sigma, lsl, usl),
    };
  }
  const sds = used.map((g) => sd(g.values));
  const sBar = mean(sds);
  const cc = c4(n);
  const sigma = sBar / cc;
  const b = (3 / cc) * Math.sqrt(1 - cc * cc);
  return {
    type: 'X-bar S' as const,
    subgroupSize: n,
    charts: [chart('Averages', labels, means, { center: xbb, ucl: xbb + (3 * sigma) / Math.sqrt(n), lcl: xbb - (3 * sigma) / Math.sqrt(n) }, sigma / Math.sqrt(n)), chart('Std deviations', labels, sds, { center: sBar, ucl: sBar * (1 + b), lcl: Math.max(0, sBar * (1 - b)) }, sBar * b / 3)],
    capability: capability(all, sigma, lsl, usl),
  };
}

export interface AttributeLot {
  label: string;
  /** Sample size. */
  n: number;
  /** Defective units (p, np) or defects (c, u). */
  count: number;
}

/**
 * Attribute charts: p (proportion defective, variable n), np (count defective, constant n),
 * c (defects per unit, constant n), u (defects per unit, variable n). Limits for p and u use the
 * average sample size.
 */
export function attributeChart(kind: 'p' | 'np' | 'c' | 'u', lots: AttributeLot[]): Chart | null {
  if (!lots.length) return null;
  const labels = lots.map((l) => l.label);
  const nBar = mean(lots.map((l) => l.n));
  const total = lots.reduce((s, l) => s + l.count, 0);
  const totalN = lots.reduce((s, l) => s + l.n, 0);
  switch (kind) {
    case 'p': {
      const p = totalN ? total / totalN : 0;
      const s = Math.sqrt((p * (1 - p)) / nBar);
      return chart('Proportion defective (p)', labels, lots.map((l) => (l.n ? l.count / l.n : 0)), { center: p, ucl: Math.min(1, p + 3 * s), lcl: Math.max(0, p - 3 * s) }, s);
    }
    case 'np': {
      const p = totalN ? total / totalN : 0;
      const c = nBar * p;
      const s = Math.sqrt(c * (1 - p));
      return chart('Number defective (np)', labels, lots.map((l) => l.count), { center: c, ucl: c + 3 * s, lcl: Math.max(0, c - 3 * s) }, s);
    }
    case 'c': {
      const c = total / lots.length;
      const s = Math.sqrt(c);
      return chart('Defects (c)', labels, lots.map((l) => l.count), { center: c, ucl: c + 3 * s, lcl: Math.max(0, c - 3 * s) }, s);
    }
    case 'u': {
      const u = totalN ? total / totalN : 0;
      const s = Math.sqrt(u / nBar);
      return chart('Defects per unit (u)', labels, lots.map((l) => (l.n ? l.count / l.n : 0)), { center: u, ucl: u + 3 * s, lcl: Math.max(0, u - 3 * s) }, s);
    }
  }
}
