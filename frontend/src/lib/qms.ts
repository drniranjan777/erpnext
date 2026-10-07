import type { DocumentHeader } from "./documents";

export const QMS = "/qms";

export const RISK_TONE = { low: "success", medium: "warning", high: "danger" } as const;
export type RiskLevel = keyof typeof RISK_TONE;

export interface Deviation extends DocumentHeader {
  kind: "planned" | "unplanned";
  category: string;
  description: string;
  item: { id: string; code: string; name: string } | null;
  batchNo: string | null;
  workOrder: { id: string; number: string | null } | null;
  impact: string | null;
  severity: number;
  occurrence: number;
  detection: number;
  rpn: number;
  riskLevel: RiskLevel;
  productImpact: boolean;
  proposedAction: string | null;
  validUntil: string | null;
  capa: { id: string; number: string | null; status: string } | null;
  closedAt: string | null;
  closureNotes: string | null;
  expired: boolean;
  canClose: boolean;
}

export interface Gauge {
  id: string;
  code: string;
  name: string;
  kind: string;
  make: string | null;
  serialNo: string | null;
  range: string | null;
  leastCount: string | null;
  location: string | null;
  owner: string | null;
  calibrationSource: "internal" | "external";
  intervalDays: number;
  acceptance: string | null;
  lastCalibrated: string | null;
  nextDue: string | null;
  status: "in_use" | "out_of_service" | "scrapped";
  dueState?: "overdue" | "due_soon" | "ok" | null;
}

export interface GrrResult { operators: number; parts: number; trials: number; ev: number; av: number; grr: number; pv: number; tv: number; pctEv: number; pctAv: number; pctGrr: number; pctPv: number; pctTolerance: number | null; ndc: number; verdict: "acceptable" | "marginal" | "unacceptable" }

export interface Sop extends DocumentHeader {
  sopCode: string;
  sopVersion: number;
  title: string;
  department: string | null;
  purpose: string | null;
  body: string | null;
  effectiveDate: string | null;
  reviewDue: string | null;
  previousId: string | null;
  supersededAt: string | null;
  current: boolean;
  trainees: { userId: string; name: string; email: string; acknowledgedAt: string | null }[];
  versions: { id: string; sopVersion: number; status: string; effectiveDate: string | null; supersededAt: string | null }[];
  canAcknowledge: boolean;
  canRevise: boolean;
  canAssign: boolean;
}

export type Alerts = Record<
  "calibrationDue" | "calibrationOverdue" | "licencesToRenew" | "licencesExpired" | "capaActionsOverdue" | "sopReviewsDue" | "mySopsToRead" | "deviationsExpired" | "retainsDue" | "incidentsOpen" | "wasteStoredTooLong",
  number
>;

export const textarea = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
