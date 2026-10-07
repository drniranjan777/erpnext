import type { AgentGuardrails, ProposedAction, Transaction } from '@nextgen/database';

/** What an agent finds: becomes a recommendation in the AI Inbox (once per dedupe key). */
export interface Finding {
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  evidence: Record<string, unknown>;
  dedupeKey: string;
  entityType?: string | null;
  entityId?: string | null;
  link?: string | null;
  action?: ProposedAction | null;
  confidence?: number | null;
  /** Permission needed to see and decide it. */
  permission?: string | null;
  /** Days until it expires if nobody decides. */
  expiresInDays?: number;
}

export interface AgentContext {
  tx: Transaction;
  tenantId: string;
  /** IST date. */
  today: string;
  params: Record<string, number>;
}

export interface AgentDefinition {
  code: string;
  name: string;
  description: string;
  /** What it looks at, in plain words, for the settings page. */
  watches: string[];
  defaultSchedule: 'hourly' | 'daily' | 'weekly';
  /** Tunable thresholds with their defaults and meaning. */
  params: Record<string, { default: number; label: string }>;
  run(ctx: AgentContext): Promise<Finding[]>;
}

const HOUR = 3_600_000;
const IST = 330 * 60_000;

/** Next run after `from`: the top of the next hour; the next `hour` o'clock IST; or that hour next Monday. */
export function nextRun(schedule: string, hour: number, from: Date): Date {
  if (schedule === 'hourly') return new Date(Math.floor(from.getTime() / HOUR) * HOUR + HOUR);
  const local = new Date(from.getTime() + IST);
  const at = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) - IST);
  let next = at.getTime() > from.getTime() ? at : new Date(at.getTime() + 24 * HOUR);
  if (schedule === 'weekly') {
    // Monday in IST.
    while (new Date(next.getTime() + IST).getUTCDay() !== 1) next = new Date(next.getTime() + 24 * HOUR);
  }
  return next;
}

/** Whether an action may run without a person approving it. */
export function canAutoExecute(g: AgentGuardrails, action: ProposedAction | null | undefined, hasActor: boolean): { ok: boolean; why: string } {
  if (!action) return { ok: false, why: 'nothing to execute' };
  if (!g.autoExecute) return { ok: false, why: 'automatic execution is off' };
  if (!hasActor) return { ok: false, why: 'nobody is set to act for the agent' };
  const amount = action.amount ?? 0;
  if (g.maxAmount != null && amount > g.maxAmount) return { ok: false, why: `₹${amount} is above the ₹${g.maxAmount} limit` };
  if (g.autoExecuteBelow != null && amount > g.autoExecuteBelow) return { ok: false, why: `₹${amount} is above the ₹${g.autoExecuteBelow} automatic limit` };
  return { ok: true, why: '' };
}

/** Days the available quantity lasts at the recent daily usage (null when nothing is used). */
export function daysOfCover(available: number, usedInWindow: number, windowDays: number) {
  const daily = usedInWindow / windowDays;
  if (daily <= 0) return null;
  return Math.max(0, Math.floor(available / daily));
}

/** Quantity to order: the reorder quantity, or enough to lift the position to twice the reorder level. */
export function reorderQty(position: number, reorderLevel: number, reorderQtySet: number | null) {
  if (reorderQtySet && reorderQtySet > 0) return reorderQtySet;
  return Math.max(0, Math.ceil(reorderLevel * 2 - position));
}

/** Monthly and quarterly statutory dates for Indian manufacturers (the usual due dates; holidays and extensions are not modelled). */
const MONTHLY: { code: string; day: number; title: string; permission: string; forPrevMonth: boolean }[] = [
  { code: 'tds_payment', day: 7, title: 'TDS / TCS deposit (challan 281)', permission: 'accounting.tax.manage', forPrevMonth: true },
  { code: 'gstr1', day: 11, title: 'GSTR-1 (outward supplies)', permission: 'gst.reports.read', forPrevMonth: true },
  { code: 'pf_esi', day: 15, title: 'PF ECR and ESI contributions', permission: 'hr.employees.read', forPrevMonth: true },
  { code: 'gstr3b', day: 20, title: 'GSTR-3B and GST payment', permission: 'gst.reports.read', forPrevMonth: true },
];
/** Quarterly TDS returns: due date (month index, day) → quarter it covers. */
const TDS_RETURNS: { month: number; day: number; quarter: string }[] = [
  { month: 6, day: 31, quarter: 'Q1 (Apr–Jun)' },
  { month: 9, day: 31, quarter: 'Q2 (Jul–Sep)' },
  { month: 0, day: 31, quarter: 'Q3 (Oct–Dec)' },
  { month: 4, day: 31, quarter: 'Q4 (Jan–Mar)' },
];

export interface DueItem {
  code: string;
  title: string;
  dueDate: string;
  period: string;
  permission: string;
}

/** Statutory items falling due within `windowDays` of `today` (inclusive), or overdue up to 3 days. */
export function statutoryDue(today: string, windowDays: number): DueItem[] {
  const t = Date.parse(`${today}T00:00:00Z`);
  const out: DueItem[] = [];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthName = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  for (let k = -1; k <= 1; k++) {
    const base = new Date(t);
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + k;
    for (const s of MONTHLY) {
      const due = new Date(Date.UTC(y, m, s.day));
      const days = (due.getTime() - t) / 86_400_000;
      if (days < -3 || days > windowDays) continue;
      const pm = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() - (s.forPrevMonth ? 1 : 0), 1));
      out.push({ code: s.code, title: s.title, dueDate: iso(due), period: monthName(pm.getUTCFullYear(), pm.getUTCMonth()), permission: s.permission });
    }
    for (const q of TDS_RETURNS) {
      for (const yy of [y - 1, y, y + 1]) {
        const due = new Date(Date.UTC(yy, q.month, q.day));
        const days = (due.getTime() - t) / 86_400_000;
        if (days < -3 || days > windowDays || k !== 0) continue;
        out.push({ code: 'tds_return', title: `TDS return 24Q / 26Q for ${q.quarter}`, dueDate: iso(due), period: `${q.quarter} ${q.month === 4 ? yy - 1 : yy}`, permission: 'accounting.tax.manage' });
      }
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
