import { describe, expect, it } from 'vitest';
import { REQUIREMENTS, requirementsFor } from '../../src/modules/validation/catalogue';
import { defaultRisk, riskClass, riskPriority, summarise, traceability } from '../../src/modules/validation/risk';

describe('GAMP 5 risk assessment', () => {
  it('derives the risk class and priority', () => {
    expect([riskClass(3, 3), riskClass(3, 1), riskClass(2, 2), riskClass(1, 1)]).toEqual([1, 2, 2, 3]);
    expect(riskPriority(3, 3, 1)).toBe('high');
    expect(riskPriority(3, 3, 3)).toBe('medium');
    expect(riskPriority(2, 2, 2)).toBe('medium');
    expect(riskPriority(1, 1, 3)).toBe('low');
    expect(defaultRisk({ gxp: 'direct', part11: true })).toEqual({ severity: 3, probability: 2, detectability: 1 });
  });

  it('traces requirements to tests and finds gaps and failures', () => {
    const reqs = [{ id: 'A', title: 'A' }, { id: 'B', title: 'B' }, { id: 'C', title: 'C' }, { id: 'D', title: 'D' }];
    const rows = traceability(reqs, { A: 'high', B: 'medium', C: 'low', D: 'high' }, [
      { ref: 'OQ-1', protocol: 'OQ', result: 'pass', requirementIds: ['A'] },
      { ref: 'PQ-1', protocol: 'PQ', result: 'fail', requirementIds: ['A'] },
      { ref: 'OQ-2', protocol: 'OQ', result: 'pending', requirementIds: ['B'] },
    ]);
    expect(rows.map((r) => [r.requirementId, r.status])).toEqual([['A', 'failed'], ['B', 'pending'], ['C', 'covered'], ['D', 'gap']]);
    const s = summarise(rows, [{ protocol: 'OQ', result: 'pass' }, { protocol: 'OQ', result: 'pending' }, { protocol: 'PQ', result: 'fail' }]);
    expect(s).toMatchObject({ OQ: { total: 2, pass: 1, pending: 1 }, PQ: { fail: 1 }, requirements: 4, fitForUse: false });
  });
});

describe('requirement catalogue', () => {
  it('has unique ids and at least one test per requirement', () => {
    expect(new Set(REQUIREMENTS.map((r) => r.id)).size).toBe(REQUIREMENTS.length);
    expect(REQUIREMENTS.every((r) => r.tests.length > 0 && r.fs.length > 10)).toBe(true);
    expect(requirementsFor(['gmp']).map((r) => r.id)).toEqual(['URS-GMP-01', 'URS-GMP-02', 'URS-GMP-03']);
  });
});
