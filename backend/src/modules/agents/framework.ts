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
