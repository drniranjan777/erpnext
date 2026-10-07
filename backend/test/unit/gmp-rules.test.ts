import { describe, expect, it } from 'vitest';
import { annex1Limit, batchExceptions, chainHash, emStatus, recordHash, stableStringify, verifyChain, type BatchFacts } from '../../src/modules/gmp/rules';

describe('signature records', () => {
  it('hashes the same content the same way whatever the key order', () => {
    expect(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
    expect(recordHash({ a: 1, b: 2 })).toBe(recordHash({ b: 2, a: 1 }));
  });

  it('detects a changed record and a removed signature in the chain', () => {
    const mk = (id: string, payload: Record<string, unknown>, prev: string | null) => {
      const s = { id, userId: 'u', entityType: 'batch', entityId: 'e', meaning: 'QA release', recordHash: recordHash(payload), signedAt: `2026-10-08T0${id}:00:00.000Z` };
      return { ...s, payload, chainHash: chainHash(prev, s) };
    };
    const a = mk('1', { to: 'released' }, null);
    const b = mk('2', { to: 'rejected' }, a.chainHash);
    const c = mk('3', { to: 'released' }, b.chainHash);
    expect(verifyChain([a, b, c])).toEqual({ checked: 3, broken: [] });
    expect(verifyChain([a, { ...b, payload: { to: 'released' } }, c]).broken).toEqual([{ id: '2', problem: 'The signed content was changed' }]);
    expect(verifyChain([a, c]).broken).toEqual([{ id: '3', problem: 'The chain does not match: a signature was changed or removed before this one' }]);
  });
});

describe('environmental monitoring', () => {
  it('uses EU GMP Annex 1 action limits unless the location sets its own', () => {
    expect(annex1Limit('particles_0_5', 'B')).toBe(352_000);
    expect(annex1Limit('particles_0_5', 'B', 'at_rest')).toBe(3_520);
    expect(annex1Limit('particles_0_5', 'D')).toBeNull();
    const settle = { param: 'viable_settle', unit: 'cfu/4 h', direction: 'above' as const, alertLimit: 3 };
    expect([0, 3, 4, 6].map((v) => emStatus(settle, 'B', v))).toEqual(['ok', 'ok', 'alert', 'action']);
    expect(emStatus({ param: 'viable_settle', unit: '', direction: 'above' }, 'A', 1)).toBe('action');
    expect(emStatus({ param: 'diff_pressure', unit: 'Pa', direction: 'below', actionLimit: 10, alertLimit: 12 }, 'C', 11)).toBe('alert');
  });
});

describe('batch record review by exception', () => {
  const clean: BatchFacts = { executions: [{ id: 'x', operation: 'Granulation', checks: [{ label: 'Tool', ok: true, blocking: true, detail: null }], firstOff: 'approved', inlineFailed: 0, recipeOut: [], recipeDownload: 'done' }], jobRejects: [{ operation: 'Granulation', qty: 0, reason: null }], alarms: [], deviations: [], clearance: { required: true, cleared: true }, inspections: [{ id: 'q', number: 'QI/1', status: 'approved', result: 'accepted' }], cleaningsUnverified: 0 };

  it('finds nothing to review in a clean batch', () => {
    expect(batchExceptions(clean)).toEqual([]);
  });

  it('lists everything a reviewer must assess', () => {
    const e = batchExceptions({
      ...clean,
      executions: [{ ...clean.executions[0], checks: [{ label: 'Tool life left', ok: false, blocking: false, detail: '92 %' }], inlineFailed: 2, recipeOut: ['Inlet air temp'] }],
      jobRejects: [{ operation: 'Compression', qty: 120, reason: 'Capping' }],
      alarms: [{ id: 'a1', message: 'Inlet air above 70 °C', severity: 'critical', machine: 'FBD-01' }],
      deviations: [{ id: 'd1', number: 'DEV/1', closed: false, kind: 'unplanned' }],
      clearance: { required: true, cleared: false },
      inspections: [{ id: 'q', number: 'QI/1', status: 'pending_approval', result: 'pending' }],
      cleaningsUnverified: 1,
    });
    expect(e.map((x) => [x.kind, x.severity, x.text])).toEqual([
      ['checks', 'minor', 'Granulation: start check "Tool life left" warned (92 %)'],
      ['inline', 'major', 'Granulation: 2 in-line check(s) out of limits'],
      ['recipe', 'major', 'Granulation: Inlet air temp ran outside its limits'],
      ['rejects', 'minor', 'Compression: 120 rejected (Capping)'],
      ['alarm', 'major', 'Machine alarm on FBD-01 during the batch: Inlet air above 70 °C'],
      ['deviation', 'major', 'Unplanned deviation DEV/1 is still open'],
      ['clearance', 'major', 'No line clearance verified by QA for this batch'],
      ['inspection', 'major', 'Inspection QI/1 is not complete'],
      ['cleaning', 'minor', '1 machine cleaning(s) before the batch not verified'],
    ]);
    expect(new Set(e.map((x) => x.key)).size).toBe(e.length);
  });
});
