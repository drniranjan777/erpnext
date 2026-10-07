export const AI = "/ai";

export interface Recommendation {
  id: string;
  agentCode: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  evidence: Record<string, unknown>;
  entityType: string | null;
  entityId: string | null;
  link: string | null;
  action: { type: string; label: string; params: Record<string, unknown>; amount?: number | null } | null;
  confidence: string | null;
  status: string;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  autoExecuted: boolean;
  result: { link?: string; id?: string; sentTo?: string } | null;
  error: string | null;
  createdAt: string;
}

export interface AgentRow {
  code: string;
  name: string;
  description: string;
  watches: string[];
  params: Record<string, { default: number; label: string }>;
  enabled: boolean;
  schedule: string;
  runHour: number;
  guardrails: { maxAmount?: number | null; autoExecute?: boolean; autoExecuteBelow?: number | null; params?: Record<string, number> };
  actorUserId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  open: number;
}

export const SEVERITY_TONE = { info: "neutral", warning: "warning", critical: "danger" } as const;

/** "daysOfCover" → "Days of cover" for the evidence list. */
export function humanKey(k: string) {
  const s = k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
