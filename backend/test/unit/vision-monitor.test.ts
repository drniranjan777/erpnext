import { describe, expect, it } from 'vitest';
import { defectBurst, visionDrift, visionStats, type InspectionRow } from '../../src/modules/twin/vision-monitor';

const row = (result: 'ok' | 'defect', confidence = 0.9, extra: Partial<InspectionRow> = {}): InspectionRow => ({ result, defectClass: result === 'defect' ? 'scratch' : null, confidence, review: null, actualClass: null, ...extra });
const many = (n: number, f: (i: number) => InspectionRow) => [...Array(n)].map((_, i) => f(i));

describe('vision monitoring', () => {
  it('summarises defect rate, confidence, uncertain results and accuracy from reviews', () => {
    const s = visionStats(
      [
        row('ok', 0.95, { review: 'correct' }),
        row('defect', 0.8, { review: 'wrong', actualClass: null }),
        row('ok', 0.4, { review: 'wrong', actualClass: 'short_shot' }),
        row('defect', 0.9, { defectClass: 'short_shot' }),
        row('defect', 0.85),
      ],
      0.6,
    );
    expect(s).toMatchObject({ total: 5, defects: 3, defectRatePct: 60, avgConfidence: 0.78, uncertainPct: 20, reviewed: 3, accuracyPct: 33.3, falseRejects: 1, escapes: 1 });
    expect(s.byClass).toEqual([{ defectClass: 'scratch', count: 2 }, { defectClass: 'short_shot', count: 1 }]);
    expect(visionStats([], 0.6)).toMatchObject({ total: 0, defectRatePct: null, accuracyPct: null });
  });

  it('reports drift in defect rate, confidence and uncertainty, with enough results', () => {
    const baseline = visionStats(many(200, (i) => row(i % 50 === 0 ? 'defect' : 'ok', 0.92)), 0.6);
    expect(visionDrift(visionStats(many(60, (i) => row(i % 50 === 0 ? 'defect' : 'ok', 0.92)), 0.6), baseline)).toEqual([]);
    const worse = visionStats(many(60, (i) => row(i % 5 === 0 ? 'defect' : 'ok', i % 4 === 0 ? 0.5 : 0.75)), 0.6);
    expect(visionDrift(worse, baseline)).toEqual(['Defect rate rose from 2 % to 20 %', 'Average confidence fell from 0.92 to 0.688', 'Uncertain results rose from 0 % to 25 %']);
    expect(visionDrift(visionStats(many(10, () => row('defect')), 0.6), baseline)).toEqual([]);
  });

  it('spots a burst of defects at a machine', () => {
    expect(defectBurst([...Array(4)].map(() => 'defect' as const))).toBe(false);
    expect(defectBurst([...Array(5)].map(() => 'defect' as const).concat([...Array(20)].map(() => 'ok' as const)))).toBe(true);
    expect(defectBurst([...Array(5)].map(() => 'defect' as const).concat([...Array(45)].map(() => 'ok' as const)))).toBe(false);
  });
});
