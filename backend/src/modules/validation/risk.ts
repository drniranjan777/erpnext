import type { Requirement } from './catalogue';

/**
 * GAMP 5 risk assessment, kept pure: risk class from severity and probability, priority from
 * class and detectability, the testing that follows, and the traceability matrix.
 * Ratings are 1 (low) to 3 (high); for detectability, 3 means easy to detect.
 */

export type Priority = 'high' | 'medium' | 'low';

export function riskClass(severity: number, probability: number): 1 | 2 | 3 {
  if (severity === 3) return probability === 1 ? 2 : 1;
  if (severity === 2) return probability === 3 ? 1 : probability === 2 ? 2 : 3;
  return probability === 3 ? 2 : 3;
}

export function riskPriority(severity: number, probability: number, detectability: number): Priority {
  const c = riskClass(severity, probability);
  if (c === 1) return detectability === 3 ? 'medium' : 'high';
  if (c === 2) return detectability === 1 ? 'high' : detectability === 2 ? 'medium' : 'low';
  return detectability === 1 ? 'medium' : 'low';
}

/** Default ratings: GxP-direct and Part 11 requirements start high. */
export function defaultRisk(r: Pick<Requirement, 'gxp' | 'part11'>) {
  return { severity: r.gxp === 'direct' ? 3 : 2, probability: 2, detectability: r.part11 ? 1 : 2 };
}

export const TESTING: Record<Priority, string> = {
  high: 'OQ with negative tests, and PQ in the site’s own process',
  medium: 'OQ of the function',
  low: 'Vendor testing leveraged; IQ only',
};

export interface TraceRow {
  requirementId: string;
  title: string;
  priority: Priority;
  tests: { ref: string; protocol: string; result: string }[];
  /** covered (all pass) | failed | pending | gap (no test where testing is needed) */
  status: 'covered' | 'failed' | 'pending' | 'gap';
}

export function traceability(reqs: Pick<Requirement, 'id' | 'title'>[], priorities: Record<string, Priority>, tests: { ref: string; protocol: string; result: string; requirementIds: string[] }[]): TraceRow[] {
  return reqs.map((r) => {
    const t = tests.filter((x) => x.requirementIds.includes(r.id)).map((x) => ({ ref: x.ref, protocol: x.protocol, result: x.result }));
    const priority = priorities[r.id] ?? 'medium';
    const relevant = t.filter((x) => x.result !== 'na');
    const status: TraceRow['status'] = !relevant.length ? (priority === 'low' ? 'covered' : 'gap') : relevant.some((x) => x.result === 'fail') ? 'failed' : relevant.some((x) => x.result === 'pending') ? 'pending' : 'covered';
    return { requirementId: r.id, title: r.title, priority, tests: t, status };
  });
}

/** Summary for the validation summary report. */
export function summarise(rows: TraceRow[], tests: { protocol: string; result: string }[]) {
  const by = (p: string) => {
    const t = tests.filter((x) => x.protocol === p);
    return { total: t.length, pass: t.filter((x) => x.result === 'pass').length, fail: t.filter((x) => x.result === 'fail').length, pending: t.filter((x) => x.result === 'pending').length, na: t.filter((x) => x.result === 'na').length };
  };
  const status = rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {} as Record<string, number>);
  // Fit for use: every requirement covered, and no test anywhere failed or still to run.
  const fit = !rows.some((r) => r.status === 'failed' || r.status === 'gap' || r.status === 'pending') && tests.every((t) => t.result !== 'fail' && t.result !== 'pending');
  return { IQ: by('IQ'), OQ: by('OQ'), PQ: by('PQ'), requirements: rows.length, status, fitForUse: fit };
}
