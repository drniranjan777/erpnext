/**
 * Monitoring of vision inspection models, kept pure: defect rate, confidence, uncertain results,
 * accuracy against people's reviews, and drift between a recent window and a baseline window.
 */

export interface InspectionRow extends Record<string, unknown> {
  result: 'ok' | 'defect';
  defectClass: string | null;
  confidence: number;
  review: 'correct' | 'wrong' | null;
  actualClass: string | null;
}

export interface Stats {
  total: number;
  defects: number;
  defectRatePct: number | null;
  avgConfidence: number | null;
  uncertainPct: number | null;
  byClass: { defectClass: string; count: number }[];
  reviewed: number;
  accuracyPct: number | null;
  /** Said defect, was fine: good parts thrown away. */
  falseRejects: number;
  /** Said ok, was a defect: defects that got through. */
  escapes: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function visionStats(rows: InspectionRow[], minConfidence: number): Stats {
  const total = rows.length;
  const defects = rows.filter((r) => r.result === 'defect').length;
  const classes = new Map<string, number>();
  for (const r of rows) if (r.result === 'defect') classes.set(r.defectClass ?? 'unspecified', (classes.get(r.defectClass ?? 'unspecified') ?? 0) + 1);
  const reviewed = rows.filter((r) => r.review);
  const correct = reviewed.filter((r) => r.review === 'correct').length;
  const wrong = reviewed.filter((r) => r.review === 'wrong');
  return {
    total,
    defects,
    defectRatePct: total ? r1((defects / total) * 100) : null,
    avgConfidence: total ? Math.round((rows.reduce((n, r) => n + r.confidence, 0) / total) * 1000) / 1000 : null,
    uncertainPct: total ? r1((rows.filter((r) => r.confidence < minConfidence).length / total) * 100) : null,
    byClass: [...classes.entries()].map(([defectClass, count]) => ({ defectClass, count })).sort((a, b) => b.count - a.count),
    reviewed: reviewed.length,
    accuracyPct: reviewed.length ? r1((correct / reviewed.length) * 100) : null,
    falseRejects: wrong.filter((r) => r.result === 'defect').length,
    escapes: wrong.filter((r) => r.result === 'ok').length,
  };
}

/**
 * Whether the recent window behaves differently from the baseline: the defect rate moved by more
 * than three standard errors (and at least 2 points), or the average confidence fell by more
 * than 0.1, or uncertain results doubled. Needs 30 results in each window.
 */
export function visionDrift(recent: Stats, baseline: Stats): string[] {
  if (recent.total < 30 || baseline.total < 30) return [];
  const out: string[] = [];
  const p = baseline.defects / baseline.total;
  const q = recent.defects / recent.total;
  const se = Math.sqrt(Math.max(p * (1 - p), 0.0001) / recent.total);
  if (Math.abs(q - p) > Math.max(3 * se, 0.02)) out.push(`Defect rate ${q > p ? 'rose' : 'fell'} from ${r1(p * 100)} % to ${r1(q * 100)} %`);
  if (baseline.avgConfidence !== null && recent.avgConfidence !== null && baseline.avgConfidence - recent.avgConfidence > 0.1) out.push(`Average confidence fell from ${baseline.avgConfidence} to ${recent.avgConfidence}`);
  if (baseline.uncertainPct !== null && recent.uncertainPct !== null && recent.uncertainPct >= Math.max(2 * baseline.uncertainPct, 5)) out.push(`Uncertain results rose from ${baseline.uncertainPct} % to ${recent.uncertainPct} %`);
  return out;
}

/** A machine whose recent inspections show many defects: at least `minDefects` and `ratePct` of the last results. */
export function defectBurst(results: ('ok' | 'defect')[], ratePct = 20, minDefects = 5): boolean {
  const defects = results.filter((r) => r === 'defect').length;
  return defects >= minDefects && (defects / results.length) * 100 >= ratePct;
}
