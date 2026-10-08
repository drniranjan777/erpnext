/**
 * Project rules: the WBS tree, planned progress, earned value, milestone billing and resource load.
 */

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

export const COST_TYPES = ['material', 'labour', 'subcontract', 'other'] as const;
export type CostType = (typeof COST_TYPES)[number];

/** A child's code extends its parent's (1.2 under 1); top-level codes are single numbers. */
export function wbsCodeProblem(code: string, parentCode: string | null) {
  if (!/^\d+(\.\d+)*$/.test(code)) return 'WBS codes are numbers separated by dots, like 1.2.3';
  if (parentCode === null) return code.includes('.') ? 'A top-level element has a single number' : null;
  return code.startsWith(`${parentCode}.`) && code.split('.').length === parentCode.split('.').length + 1 ? null : `Under ${parentCode} the code is ${parentCode}.n`;
}

/** Share of the work planned to be done by a date, spread evenly between the planned start and end. */
export function plannedPct(start: string, end: string, on: string) {
  if (on < start) return 0;
  if (on >= end) return 100;
  return Math.round(((t(on) - t(start) + DAY) / (t(end) - t(start) + DAY)) * 1000) / 10;
}

export interface WbsFigures {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  plannedStart: string;
  plannedEnd: string;
  budget: Record<CostType, number>;
  progressPct: number;
  actual: Record<CostType, number>;
  committed: number;
}

/**
 * Earned value: budget at completion (BAC), planned value (PV, budget × planned %), earned value
 * (EV, budget × progress), actual cost (AC); CPI = EV / AC, SPI = EV / PV, estimate at completion
 * EAC = BAC / CPI. Leaves carry budgets; parents roll up.
 */
export function earnedValue(wbs: WbsFigures[], on: string) {
  const isParent = new Set(wbs.map((w) => w.parentId).filter(Boolean));
  const leaves = wbs.filter((w) => !isParent.has(w.id));
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const rows = leaves.map((w) => {
    const bac = sum(w.budget);
    const ac = sum(w.actual);
    const pv = (bac * plannedPct(w.plannedStart, w.plannedEnd, on)) / 100;
    const ev = (bac * w.progressPct) / 100;
    return { id: w.id, code: w.code, name: w.name, bac: r2(bac), pv: r2(pv), ev: r2(ev), ac: r2(ac), committed: r2(w.committed), cpi: ac > 0 ? Math.round((ev / ac) * 100) / 100 : null, spi: pv > 0 ? Math.round((ev / pv) * 100) / 100 : null };
  });
  const bac = rows.reduce((a, r) => a + r.bac, 0);
  const pv = rows.reduce((a, r) => a + r.pv, 0);
  const ev = rows.reduce((a, r) => a + r.ev, 0);
  const ac = rows.reduce((a, r) => a + r.ac, 0);
  const cpi = ac > 0 ? ev / ac : null;
  const spi = pv > 0 ? ev / pv : null;
  const eac = cpi ? bac / cpi : bac;
  return {
    rows,
    total: {
      bac: r2(bac),
      pv: r2(pv),
      ev: r2(ev),
      ac: r2(ac),
      cv: r2(ev - ac),
      sv: r2(ev - pv),
      cpi: cpi === null ? null : Math.round(cpi * 100) / 100,
      spi: spi === null ? null : Math.round(spi * 100) / 100,
      eac: r2(eac),
      etc: r2(Math.max(0, eac - ac)),
      vac: r2(bac - eac),
      percentComplete: bac > 0 ? Math.round((ev / bac) * 1000) / 10 : 0,
    },
  };
}

/** Budget, actual and committed cost by WBS element, rolled up the tree (parents total their children). */
export function rollUp(wbs: WbsFigures[]) {
  const kids = new Map<string, WbsFigures[]>();
  for (const w of wbs) if (w.parentId) kids.set(w.parentId, [...(kids.get(w.parentId) ?? []), w]);
  const memo = new Map<string, { budget: number; actual: number; committed: number }>();
  const total = (w: WbsFigures): { budget: number; actual: number; committed: number } => {
    const hit = memo.get(w.id);
    if (hit) return hit;
    const own = { budget: Object.values(w.budget).reduce((a, b) => a + b, 0), actual: Object.values(w.actual).reduce((a, b) => a + b, 0), committed: w.committed };
    for (const k of kids.get(w.id) ?? []) {
      const c = total(k);
      own.budget += c.budget;
      own.actual += c.actual;
      own.committed += c.committed;
    }
    const v = { budget: r2(own.budget), actual: r2(own.actual), committed: r2(own.committed) };
    memo.set(w.id, v);
    return v;
  };
  return wbs.map((w) => ({ id: w.id, ...total(w), overBudget: total(w).actual + total(w).committed > total(w).budget + 0.005 }));
}

/** Milestones as amounts of the contract value; they may not add up to more than 100 %. */
export function milestoneAmounts(contractValue: number, milestones: { id: string; pct: number }[]) {
  const totalPct = milestones.reduce((a, m) => a + m.pct, 0);
  return { totalPct: Math.round(totalPct * 100) / 100, over: totalPct > 100.0001, amounts: Object.fromEntries(milestones.map((m) => [m.id, r2((contractValue * m.pct) / 100)])) };
}

/** Monday of the week a date falls in. */
export const weekOf = (d: string) => {
  const x = new Date(t(d));
  const dow = (x.getUTCDay() + 6) % 7;
  return new Date(t(d) - dow * DAY).toISOString().slice(0, 10);
};

/**
 * Planned hours per person per week across all projects, against weekly capacity (48 hours under the
 * Factories Act by default); weeks above it are overloaded.
 */
export function resourceLoad(assignments: { employeeId: string; employee: string; project: string; fromDate: string; toDate: string; hoursPerWeek: number }[], from: string, weeks: number, capacity = 48) {
  const start = weekOf(from);
  const cols = Array.from({ length: weeks }, (_, i) => new Date(t(start) + i * 7 * DAY).toISOString().slice(0, 10));
  const people = new Map<string, { employeeId: string; employee: string; weeks: number[]; projects: Set<string> }>();
  for (const a of assignments) {
    const p = people.get(a.employeeId) ?? { employeeId: a.employeeId, employee: a.employee, weeks: cols.map(() => 0), projects: new Set<string>() };
    cols.forEach((w, i) => {
      const wEnd = new Date(t(w) + 6 * DAY).toISOString().slice(0, 10);
      if (a.fromDate <= wEnd && a.toDate >= w) {
        p.weeks[i] += a.hoursPerWeek;
        p.projects.add(a.project);
      }
    });
    people.set(a.employeeId, p);
  }
  return {
    weeks: cols,
    capacity,
    people: [...people.values()].map((p) => ({ employeeId: p.employeeId, employee: p.employee, projects: [...p.projects], hours: p.weeks.map(r2), overloaded: p.weeks.map((h, i) => (h > capacity ? cols[i] : null)).filter(Boolean) as string[] })),
  };
}
