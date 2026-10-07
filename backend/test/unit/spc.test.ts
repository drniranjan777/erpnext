import { describe, expect, it } from 'vitest';
import { attributeChart, c4, capability, variablesCharts, westernElectric } from '../../src/modules/quality/spc';

describe('variables charts', () => {
  it('builds X-bar R for subgroups of five', () => {
    const groups = [0, 1, 2, 3].map((k) => ({ label: `L${k}`, values: [10, 11, 12, 13, 14].map((v) => v + k * 0.5) }));
    const r = variablesCharts(groups, 5, 20)!;
    expect(r.type).toBe('X-bar R');
    const [x, rg] = r.charts;
    // x̿ = 12.75, R̄ = 4, A2 = 0.577 → ±2.308; D4 = 2.114.
    expect(x.limits).toEqual({ center: 12.75, ucl: 15.058, lcl: 10.442 });
    expect(rg.limits).toEqual({ center: 4, ucl: 8.456, lcl: 0 });
    // σ within = R̄ / d2 = 4 / 2.326 = 1.7197; Cp = 15 / (6σ) = 1.454.
    expect(r.capability.cp).toBeCloseTo(1.454, 3);
    // Cpk = min((20 − 12.75), (12.75 − 5)) / 3σ = 7.25 / 5.159 = 1.405.
    expect(r.capability.cpk).toBeCloseTo(1.405, 3);
  });

  it('uses I-MR for single readings and X-bar S for large subgroups', () => {
    const single = variablesCharts([5, 7, 6, 8, 7].map((v, i) => ({ label: String(i), values: [v] })), null, 10)!;
    expect(single.type).toBe('I-MR');
    // MR̄ = (2 + 1 + 2 + 1) / 4 = 1.5 → σ = 1.33, mean 6.6.
    expect(single.charts[0].limits.center).toBe(6.6);
    expect(single.charts[0].limits.ucl).toBeCloseTo(6.6 + 3 * (1.5 / 1.128), 3);
    expect(single.capability.cp).toBeNull(); // one-sided spec
    expect(single.capability.cpk).toBeCloseTo((10 - 6.6) / (3 * (1.5 / 1.128)), 2);
    const big = variablesCharts([0, 1, 2].map((k) => ({ label: String(k), values: Array.from({ length: 12 }, (_, i) => i + k) })), null, null)!;
    expect(big.type).toBe('X-bar S');
    expect(c4(12)).toBeCloseTo(0.9776, 4);
  });

  it('computes Pp / Ppk from the overall spread', () => {
    const c = capability([9, 10, 11, 10, 10, 9, 11], 0.5, 7, 13);
    expect(c.cp).toBe(2);
    expect(c.pp).toBeCloseTo(6 / (6 * c.sigmaOverall), 3);
  });
});

describe('Western Electric rules', () => {
  it('flags each rule', () => {
    expect(westernElectric([0, 0, 3.5], 0, 1)[2]).toEqual([1]);
    expect(westernElectric([0, 2.5, 0, 2.2], 0, 1)[3]).toEqual([2]);
    expect(westernElectric([1.2, 1.5, 0.2, 1.1, 1.3], 0, 1)[4]).toEqual([3]);
    const eight = westernElectric([0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.2], 0, 1);
    expect(eight[7]).toEqual([4]);
    expect(eight[6]).toEqual([]);
  });
});

describe('attribute charts', () => {
  const lots = [
    { label: 'a', n: 100, count: 2 },
    { label: 'b', n: 100, count: 4 },
    { label: 'c', n: 100, count: 3 },
  ];
  it('p and np', () => {
    const p = attributeChart('p', lots)!;
    expect(p.limits.center).toBe(0.03);
    expect(p.limits.ucl).toBeCloseTo(0.03 + 3 * Math.sqrt((0.03 * 0.97) / 100), 4);
    expect(p.limits.lcl).toBe(0);
    expect(attributeChart('np', lots)!.limits.center).toBe(3);
  });
  it('c and u', () => {
    expect(attributeChart('c', lots)!.limits).toMatchObject({ center: 3, ucl: 8.1962 });
    expect(attributeChart('u', lots)!.limits.center).toBe(0.03);
  });
});
