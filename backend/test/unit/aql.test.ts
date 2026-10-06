import { describe, expect, it } from 'vitest';
import { codeLetter, evaluate, readingPasses, samplingPlan } from '../../src/modules/quality/aql';

describe('ISO 2859-1 sampling', () => {
  it('picks the code letter from lot size and level', () => {
    expect(codeLetter(8)).toBe('A');
    expect(codeLetter(500)).toBe('H');
    expect(codeLetter(501)).toBe('J');
    expect(codeLetter(1000, 'I')).toBe('G');
    expect(codeLetter(1000, 'III')).toBe('K');
    expect(codeLetter(1000, 'S-2')).toBe('C');
    expect(codeLetter(1_000_000)).toBe('Q');
  });

  it('reads the master table, following arrows', () => {
    expect(samplingPlan(500, '1.0')).toMatchObject({ letter: 'H', sampleSize: 50, accept: 1, reject: 2 });
    expect(samplingPlan(500, '0.25')).toMatchObject({ letter: 'H', sampleSize: 50, accept: 0, reject: 1 });
    // H at 0.40 is an up arrow → G (32) 0/1; H at 0.65 a down arrow → J (80) 1/2.
    expect(samplingPlan(500, '0.40')).toMatchObject({ letter: 'G', sampleSize: 32, accept: 0 });
    expect(samplingPlan(500, '0.65')).toMatchObject({ letter: 'J', sampleSize: 80, accept: 1, reject: 2 });
    expect(samplingPlan(500, '2.5')).toMatchObject({ sampleSize: 50, accept: 3, reject: 4 });
    expect(samplingPlan(500, '6.5')).toMatchObject({ sampleSize: 50, accept: 7, reject: 8 });
    expect(samplingPlan(1000, '2.5')).toMatchObject({ letter: 'J', sampleSize: 80, accept: 5, reject: 6 });
    expect(samplingPlan(5000, '0.10')).toMatchObject({ letter: 'K', sampleSize: 125, accept: 0, reject: 1 });
    expect(samplingPlan(5000, '0.065')).toMatchObject({ letter: 'L', sampleSize: 200, accept: 0, reject: 1 });
    expect(samplingPlan(3, '6.5')).toMatchObject({ sampleSize: 2, accept: 0, reject: 1 });
  });

  it('inspects the whole lot when the sample would be larger', () => {
    expect(samplingPlan(10, '0.65')).toMatchObject({ sampleSize: 10, full: true, accept: 0, reject: 1 });
    expect(() => samplingPlan(10, '3.0')).toThrow(/not a standard/);
  });
});

describe('judging readings', () => {
  const params = [
    { id: 'd', kind: 'numeric' as const, lowerLimit: '9.9', upperLimit: '10.1', isCritical: false },
    { id: 'c', kind: 'attribute' as const, lowerLimit: null, upperLimit: null, isCritical: true },
  ];

  it('checks numeric limits and attribute results', () => {
    expect(readingPasses(params[0], { sampleNo: 1, parameterId: 'd', value: '10.1' })).toBe(true);
    expect(readingPasses(params[0], { sampleNo: 1, parameterId: 'd', value: '9.89' })).toBe(false);
    expect(readingPasses(params[1], { sampleNo: 1, parameterId: 'c', passed: false })).toBe(false);
  });

  it('counts defective samples once and lets critical failures reject', () => {
    const r = evaluate(params, [
      { sampleNo: 1, parameterId: 'd', value: '10.2' },
      { sampleNo: 1, parameterId: 'd', value: '9.8' },
      { sampleNo: 2, parameterId: 'd', value: '10' },
    ], { accept: 1, reject: 2 });
    expect(r).toMatchObject({ defectives: 1, suggestion: 'accept', critical: false });
    expect(evaluate(params, [{ sampleNo: 4, parameterId: 'c', passed: false }], { accept: 5, reject: 6 })).toMatchObject({ defectives: 1, critical: true, suggestion: 'reject' });
    expect(evaluate(params, [{ sampleNo: 1, parameterId: 'd', value: '11' }, { sampleNo: 2, parameterId: 'd', value: '11' }], { accept: 1, reject: 2 }).suggestion).toBe('reject');
  });
});
