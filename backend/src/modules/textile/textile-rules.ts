/**
 * Textile and apparel export rules: the order breakdown, the time-and-action calendar worked back
 * from the ex-factory date, garment measurements against the tech pack tolerances, and the
 * certificates a buyer requires.
 */

export function breakdownTotals(b: Record<string, Record<string, number>>) {
  const bySize: Record<string, number> = {};
  const byColour: Record<string, number> = {};
  let total = 0;
  for (const [colour, sizes] of Object.entries(b))
    for (const [size, q] of Object.entries(sizes)) {
      bySize[size] = (bySize[size] ?? 0) + q;
      byColour[colour] = (byColour[colour] ?? 0) + q;
      total += q;
    }
  return { bySize, byColour, total };
}

/** Standard export milestones and how many days before ex-factory each is due on a 90-day lead time. */
export const MILESTONES: { key: string; label: string; daysBefore: number; sample?: string }[] = [
  { key: 'lab_dip', label: 'Lab dip approved', daysBefore: 75, sample: 'lab_dip' },
  { key: 'fit', label: 'Fit sample approved', daysBefore: 65, sample: 'fit' },
  { key: 'fabric_booked', label: 'Fabric and trims booked', daysBefore: 60 },
  { key: 'fabric_in', label: 'Fabric in house', daysBefore: 40 },
  { key: 'size_set', label: 'Size set approved', daysBefore: 38, sample: 'size_set' },
  { key: 'pp', label: 'Pre-production sample approved', daysBefore: 32, sample: 'pp' },
  { key: 'trims_in', label: 'Trims in house', daysBefore: 30 },
  { key: 'cutting', label: 'Cutting started', daysBefore: 25 },
  { key: 'sewing', label: 'Sewing started', daysBefore: 20 },
  { key: 'top', label: 'Top of production approved', daysBefore: 14, sample: 'top' },
  { key: 'finishing', label: 'Finishing and packing done', daysBefore: 6 },
  { key: 'final_inspection', label: 'Final inspection passed', daysBefore: 3 },
  { key: 'ex_factory', label: 'Ex-factory', daysBefore: 0 },
];

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * The time-and-action calendar: each milestone due before ex-factory, compressed proportionally
 * when the lead time from the PO is shorter than 90 days (never before the PO date). A sample
 * milestone is done when a sample of that type is approved; others when marked done.
 */
export function tna(poDate: string, exFactory: string, done: Record<string, string>, approvedSamples: Record<string, string>, today: string) {
  const lead = Math.max(0, days(poDate, exFactory));
  const scale = Math.min(1, lead / 90);
  return MILESTONES.map((m) => {
    const due = addDays(exFactory, -Math.round(m.daysBefore * scale));
    const doneOn = (m.sample ? approvedSamples[m.sample] : undefined) ?? done[m.key] ?? null;
    const state = doneOn ? (doneOn > due ? 'done_late' : 'done') : due < today ? 'late' : days(today, due) <= 7 ? 'due_soon' : 'pending';
    return { key: m.key, label: m.label, sample: m.sample ?? null, due, doneOn, state, daysLate: doneOn ? Math.max(0, days(due, doneOn)) : Math.max(0, days(due, today)) };
  });
}

/** Measured garment against the tech pack: each point within ± tolerance for the size. */
export function measurementCheck(points: { code: string; description: string; tolerance: number; sizes: Record<string, number> }[], size: string, measured: Record<string, number>) {
  const rows = points
    .filter((p) => p.sizes[size] !== undefined && measured[p.code] !== undefined)
    .map((p) => {
      const spec = p.sizes[size];
      const dev = Math.round((measured[p.code] - spec) * 100) / 100;
      return { code: p.code, description: p.description, spec, measured: measured[p.code], deviation: dev, tolerance: p.tolerance, ok: Math.abs(dev) <= p.tolerance + 1e-9 };
    });
  return { rows, outOfTolerance: rows.filter((r) => !r.ok).length, checked: rows.length };
}

/** Certificates the buyer requires that we do not hold valid on the ex-factory date. */
export function missingCertificates(required: string[], held: { type: string; validUntil: string | null }[], onDate: string) {
  return required.filter((t) => !held.some((h) => h.type === t && (!h.validUntil || h.validUntil >= onDate)));
}

/** Social audit state: valid, expiring within 60 days, expired; corrective action plan overdue. */
export function auditState(a: { validUntil: string | null; capDueOn: string | null; capStatus: string; criticalFindings: number }, today: string) {
  const state = !a.validUntil ? 'valid' : a.validUntil < today ? 'expired' : days(today, a.validUntil) <= 60 ? 'expiring' : 'valid';
  return { state, capOverdue: a.capStatus === 'open' && !!a.capDueOn && a.capDueOn < today, critical: a.criticalFindings > 0 };
}
