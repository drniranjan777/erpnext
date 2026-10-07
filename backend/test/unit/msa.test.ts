import { describe, expect, it } from 'vitest';
import { gaugeRR, riskOf, validateStudy } from '../../src/modules/quality/msa';

describe('gauge R&R', () => {
  // 3 operators × 5 parts × 2 trials.
  const m = [
    [[10.0, 10.1], [12.0, 12.1], [14.0, 14.0], [16.1, 16.0], [18.0, 18.1]],
    [[10.1, 10.2], [12.1, 12.1], [14.1, 14.2], [16.1, 16.2], [18.2, 18.1]],
    [[10.0, 10.0], [12.0, 11.9], [14.0, 14.1], [16.0, 16.0], [18.0, 18.0]],
  ];

  it('validates the layout', () => {
    expect(validateStudy(m)).toBeNull();
    expect(validateStudy([m[0]])).toMatch(/operators/);
    expect(validateStudy([m[0], m[1].slice(0, 4)])).toMatch(/every part/);
  });

  it('splits variation into repeatability, reproducibility and part variation', () => {
    const r = gaugeRR(m, 10);
    // 15 ranges sum to 1.0 → R̄ = 0.0667 → EV = 0.0667 × 0.8862 = 0.0591.
    expect(r.ev).toBeCloseTo(0.0591, 4);
    // Operator means 14.04, 14.14, 14.0 → X̄diff 0.14 → AV² = (0.14 × 0.5231)² − EV² / 10.
    expect(r.av).toBeCloseTo(Math.sqrt((0.14 * 0.5231) ** 2 - ((1 / 15) * 0.8862) ** 2 / 10), 3);
    // Part means 10.067 … 18.067 → Rp 8.0 → PV = 8 × 0.403 = 3.224.
    expect(r.pv).toBeCloseTo(3.224, 2);
    expect(r.pctGrr).toBeLessThan(10);
    expect(r.ndc).toBeGreaterThanOrEqual(5);
    // 6 × GRR over a tolerance of 10.
    expect(r.pctTolerance).toBeCloseTo((600 * r.grr) / 10, 0);
    expect(r.verdict).toBe('acceptable');
  });

  it('flags a poor gauge', () => {
    const bad = [
      [[10, 11], [10.5, 9.6], [10.2, 11.1]],
      [[11.2, 10], [9.8, 10.9], [10.4, 9.5]],
    ];
    expect(gaugeRR(bad, null).verdict).toBe('unacceptable');
  });
});

describe('risk', () => {
  it('rates RPN bands', () => {
    expect(riskOf(2, 2, 2)).toEqual({ rpn: 8, level: 'low' });
    expect(riskOf(3, 3, 2)).toEqual({ rpn: 18, level: 'medium' });
    expect(riskOf(5, 1, 1).level).toBe('high');
    expect(riskOf(3, 4, 4).level).toBe('high');
  });
});
