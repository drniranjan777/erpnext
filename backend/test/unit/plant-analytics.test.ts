import { describe, expect, it } from 'vitest';
import { cmStep, excursions, maxDemand, meanKineticTemperature, projectedDemandKw, type CmState } from '../../src/modules/plant/analytics';

const params = { minSamples: 50, zThreshold: 4, consecutive: 3, driftThreshold: 2 };
/** Repeatable "noise" so the test does not depend on random numbers. */
const wobble = (i: number) => Math.sin(i * 1.7) * 0.2 + Math.cos(i * 0.9) * 0.1;

function learn(n: number, level = 2) {
  let s: CmState = { n: 0, mean: 0, variance: 0, recent: null, streak: 0 };
  for (let i = 0; i < n; i++) s = cmStep(s, level + wobble(i), params).state;
  return s;
}

describe('condition monitoring', () => {
  it('learns the normal level and spread before judging', () => {
    const s = learn(50);
    expect(s.n).toBe(50);
    expect(s.mean).toBeCloseTo(2, 1);
    expect(Math.sqrt(s.variance)).toBeGreaterThan(0.1);
    expect(Math.sqrt(s.variance)).toBeLessThan(0.3);
  });

  it('reports a spike only after it repeats, without learning it', () => {
    let s = learn(60);
    const mean = s.mean;
    const steps = [9, 9.2, 9.1].map((v) => {
      const r = cmStep(s, v, params);
      s = r.state;
      return r.anomaly;
    });
    expect(steps).toEqual([null, null, 'spike']);
    expect(s.mean).toBe(mean);
    const back = cmStep(s, 2, params);
    expect(back.anomaly).toBeNull();
    expect(back.state.streak).toBe(0);
  });

  it('reports a slow drift that never spikes', () => {
    let s = learn(60);
    let found: string | null = null;
    for (let i = 0; i < 120 && !found; i++) {
      const r = cmStep(s, 2.4 + wobble(i), params);
      s = r.state;
      found = r.anomaly;
    }
    expect(found).toBe('drift');
  });
});

describe('cold chain', () => {
  it('computes mean kinetic temperature, which weighs warm periods more than the average does', () => {
    expect(meanKineticTemperature([5, 5, 5])).toBe(5);
    const mkt = meanKineticTemperature([20, 30])!;
    expect(mkt).toBeGreaterThan(25);
    expect(mkt).toBeCloseTo(26.3, 0);
    expect(meanKineticTemperature([])).toBeNull();
  });

  it('finds excursions with their length and worst value', () => {
    const m = (i: number) => i * 60_000;
    const r = excursions(
      [
        { ts: m(0), value: 5 },
        { ts: m(5), value: 9 },
        { ts: m(10), value: 10 },
        { ts: m(20), value: 6 },
        { ts: m(30), value: 1 },
        { ts: m(33), value: 5 },
      ],
      2,
      8,
    );
    expect(r.excursions).toEqual([
      { start: m(5), end: m(20), minutes: 15, direction: 'high', worst: 10 },
      { start: m(30), end: m(33), minutes: 3, direction: 'low', worst: 1 },
    ]);
    expect(r.minutesOutside).toBe(18);
  });
});

describe('electrical demand', () => {
  it('projects the interval and finds the maximum demand', () => {
    expect(projectedDemandKw(50, 10)).toBe(300);
    const start = Date.UTC(2026, 9, 8, 4, 30);
    const minutes = [...Array(60)].map((_, i) => ({ minute: start + i * 60_000, kwh: i < 30 ? 2 : 4 }));
    expect(maxDemand(minutes, 30)).toEqual({ kw: 240, at: start + 30 * 60_000 });
  });
});
