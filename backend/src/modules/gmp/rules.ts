import { createHash } from 'node:crypto';
import type { BatchException, EmParameter } from '@nextgen/database';

/**
 * GMP rules, kept pure: signature record hashes and the signature chain, environmental
 * monitoring limits (EU GMP Annex 1) and the exceptions of an electronic batch record.
 */

// ---- signatures ---------------------------------------------------------------------------------

/** JSON with keys sorted at every level, so the same content always hashes the same. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v as Record<string, unknown>)
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const recordHash = (payload: unknown) => sha256(stableStringify(payload));

export interface SignatureLink {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  meaning: string;
  recordHash: string;
  signedAt: string;
}

/** Hash of a signature chained to the one before it. */
export function chainHash(prev: string | null, s: SignatureLink): string {
  return sha256([prev ?? 'genesis', s.id, s.userId, s.entityType, s.entityId, s.meaning, s.recordHash, s.signedAt].join('|'));
}

/** Rows in signing order; returns the ids whose stored chain hash does not match. */
export function verifyChain(rows: (SignatureLink & { chainHash: string | null; payload: unknown })[]): { checked: number; broken: { id: string; problem: string }[] } {
  const broken: { id: string; problem: string }[] = [];
  let prev: string | null = null;
  let checked = 0;
  for (const r of rows) {
    if (!r.chainHash) continue; // signed before the chain existed
    checked++;
    if (recordHash(r.payload) !== r.recordHash) broken.push({ id: r.id, problem: 'The signed content was changed' });
    else if (chainHash(prev, r) !== r.chainHash) broken.push({ id: r.id, problem: 'The chain does not match: a signature was changed or removed before this one' });
    prev = r.chainHash;
  }
  return { checked, broken };
}

// ---- environmental monitoring -------------------------------------------------------------------

/** EU GMP Annex 1 (2022) action limits by grade, for the parameters with published limits. */
const ANNEX1: Record<string, Record<string, { in_operation: number | null; at_rest: number | null }>> = {
  viable_active: { A: { in_operation: 0, at_rest: 0 }, B: { in_operation: 10, at_rest: 10 }, C: { in_operation: 100, at_rest: 100 }, D: { in_operation: 200, at_rest: 200 } },
  viable_settle: { A: { in_operation: 0, at_rest: 0 }, B: { in_operation: 5, at_rest: 5 }, C: { in_operation: 50, at_rest: 50 }, D: { in_operation: 100, at_rest: 100 } },
  viable_contact: { A: { in_operation: 0, at_rest: 0 }, B: { in_operation: 5, at_rest: 5 }, C: { in_operation: 25, at_rest: 25 }, D: { in_operation: 50, at_rest: 50 } },
  particles_0_5: { A: { in_operation: 3_520, at_rest: 3_520 }, B: { in_operation: 352_000, at_rest: 3_520 }, C: { in_operation: 3_520_000, at_rest: 352_000 }, D: { in_operation: null, at_rest: 3_520_000 } },
  particles_5_0: { A: { in_operation: 29, at_rest: 29 }, B: { in_operation: 2_930, at_rest: 29 }, C: { in_operation: 29_300, at_rest: 2_930 }, D: { in_operation: null, at_rest: 29_300 } },
};
export const EM_UNITS: Record<string, string> = {
  viable_active: 'cfu/m³',
  viable_settle: 'cfu/4 h',
  viable_contact: 'cfu/plate',
  particles_0_5: 'particles/m³',
  particles_5_0: 'particles/m³',
  temperature: '°C',
  humidity: '% RH',
  diff_pressure: 'Pa',
};

/** The published action limit for a parameter in a grade, if there is one. */
export function annex1Limit(param: string, grade: string, condition: 'in_operation' | 'at_rest' = 'in_operation'): number | null {
  return ANNEX1[param]?.[grade]?.[condition] ?? null;
}

/** ok, alert or action for a value; the location's own limits, else the Annex 1 action limit. */
export function emStatus(p: EmParameter, grade: string, value: number, condition: 'in_operation' | 'at_rest' = 'in_operation'): 'ok' | 'alert' | 'action' {
  const action = p.actionLimit ?? annex1Limit(p.param, grade, condition);
  const beyond = (limit: number | null | undefined) => limit != null && (p.direction === 'below' ? value < limit : value > limit);
  if (beyond(action)) return 'action';
  if (beyond(p.alertLimit)) return 'alert';
  return 'ok';
}

// ---- batch record exceptions --------------------------------------------------------------------

export interface BatchFacts {
  executions: { id: string; operation: string; checks: { label: string; ok: boolean; blocking: boolean; detail: string | null }[]; firstOff: string; inlineFailed: number; recipeOut: string[]; recipeDownload: string | null }[];
  jobRejects: { operation: string; qty: number; reason: string | null }[];
  alarms: { id: string; message: string; severity: string; machine: string }[];
  deviations: { id: string; number: string | null; closed: boolean; kind: string }[];
  clearance: { required: boolean; cleared: boolean };
  inspections: { id: string; number: string | null; status: string; result: string | null }[];
  cleaningsUnverified: number;
}

/** Everything in the batch record that a reviewer must look at; the rest needs no review. */
export function batchExceptions(f: BatchFacts): BatchException[] {
  const out: BatchException[] = [];
  for (const e of f.executions) {
    for (const c of e.checks.filter((x) => !x.ok)) out.push({ key: `check:${e.id}:${c.label}`, kind: 'checks', severity: c.blocking ? 'major' : 'minor', text: `${e.operation}: start check "${c.label}" ${c.blocking ? 'failed' : 'warned'}${c.detail ? ` (${c.detail})` : ''}`, link: `/print/batch-record/${e.id}` });
    if (e.firstOff === 'rejected') out.push({ key: `firstoff:${e.id}`, kind: 'first_off', severity: 'major', text: `${e.operation}: first-off piece rejected`, link: `/print/batch-record/${e.id}` });
    if (e.firstOff === 'pending') out.push({ key: `firstoff:${e.id}`, kind: 'first_off', severity: 'major', text: `${e.operation}: first-off never approved`, link: `/print/batch-record/${e.id}` });
    if (e.inlineFailed) out.push({ key: `inline:${e.id}`, kind: 'inline', severity: 'major', text: `${e.operation}: ${e.inlineFailed} in-line check(s) out of limits`, link: `/print/batch-record/${e.id}` });
    for (const r of e.recipeOut) out.push({ key: `recipe:${e.id}:${r}`, kind: 'recipe', severity: 'major', text: `${e.operation}: ${r} ran outside its limits`, link: `/print/batch-record/${e.id}` });
    if (e.recipeDownload === 'failed') out.push({ key: `download:${e.id}`, kind: 'recipe', severity: 'major', text: `${e.operation}: the recipe could not be sent to the machine`, link: `/print/batch-record/${e.id}` });
  }
  for (const r of f.jobRejects) if (r.qty > 0) out.push({ key: `rejects:${r.operation}`, kind: 'rejects', severity: 'minor', text: `${r.operation}: ${r.qty} rejected${r.reason ? ` (${r.reason})` : ''}` });
  for (const a of f.alarms) out.push({ key: `alarm:${a.id}`, kind: 'alarm', severity: a.severity === 'critical' ? 'major' : 'minor', text: `Machine alarm on ${a.machine} during the batch: ${a.message}`, link: '/iot/alarms' });
  for (const d of f.deviations) out.push({ key: `deviation:${d.id}`, kind: 'deviation', severity: d.closed ? 'minor' : 'major', text: `${d.kind === 'planned' ? 'Planned' : 'Unplanned'} deviation ${d.number ?? ''}${d.closed ? ' (closed)' : ' is still open'}`.replace('  ', ' '), link: `/quality/deviations/${d.id}` });
  if (f.clearance.required && !f.clearance.cleared) out.push({ key: 'clearance', kind: 'clearance', severity: 'major', text: 'No line clearance verified by QA for this batch' });
  for (const i of f.inspections) {
    if (i.status !== 'approved') out.push({ key: `inspection:${i.id}`, kind: 'inspection', severity: 'major', text: `Inspection ${i.number ?? ''} is not complete`.replace('  ', ' '), link: `/quality/inspections/${i.id}` });
    else if (i.result && i.result !== 'accepted') out.push({ key: `inspection:${i.id}`, kind: 'inspection', severity: 'major', text: `Inspection ${i.number ?? ''} result: ${i.result}`.replace('  ', ' '), link: `/quality/inspections/${i.id}` });
  }
  if (f.cleaningsUnverified) out.push({ key: 'cleaning', kind: 'cleaning', severity: 'minor', text: `${f.cleaningsUnverified} machine cleaning(s) before the batch not verified` });
  return out;
}
