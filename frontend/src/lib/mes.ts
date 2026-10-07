export interface OeeRow {
  key: string;
  label: string;
  targetOeePct: number | null;
  windowSeconds: number;
  noDataSeconds: number;
  plannedStopSeconds: number;
  plannedSeconds: number;
  runSeconds: number;
  downtimeSeconds: number;
  operatingSeconds: number;
  good: number;
  reject: number;
  idealSeconds: number;
  losses: Record<"breakdown" | "setup" | "unexplained" | "other" | "minor_stop" | "speed" | "defects" | "startup", number>;
  stops: number;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
}

export interface BoardMachine {
  id: string;
  code: string;
  name: string;
  workCenterCode: string;
  state: "running" | "stopped" | "setup" | "planned_stop" | null;
  stateId: string | null;
  since: string | null;
  reason: string | null;
  manual: boolean;
  offline: boolean;
  targetOeePct: number;
  shift: { oee: number | null; availability: number | null; performance: number | null; quality: number | null; good: number; reject: number; stops: number };
  job: { cardId: string; workOrderId: string; number: string; item: string; operation: string; good: number; reject: number; orderQty: number; operator: string | null } | null;
  calls: { id: string; kind: string; note: string | null; raisedAt: string; ackedAt: string | null }[];
}

export interface Reason {
  id: string;
  code: string;
  name: string;
  loss: string;
  isActive: boolean;
}

export const STATE_LABEL: Record<string, string> = { running: "Running", stopped: "Stopped", setup: "Setup", planned_stop: "Planned stop" };
export const LOSS_LABEL: Record<string, string> = {
  breakdown: "Breakdowns",
  setup: "Setup & adjustments",
  unexplained: "Stops without a reason",
  other: "Other stops (material, operator…)",
  minor_stop: "Minor stops",
  speed: "Reduced speed",
  defects: "Defects",
  startup: "Start-up rejects",
  planned: "Planned (not a loss)",
};
export const CALL_LABEL: Record<string, string> = { maintenance: "Maintenance", quality: "Quality", material: "Material", supervisor: "Supervisor" };

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${Math.round(v * 1000) / 10} %`);

export function duration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ---- MES execution ----

export interface InstructionStep { title: string; body: string; imageUrl?: string | null; confirm?: boolean; caution?: boolean }
export interface Characteristic { name: string; unit?: string | null; min?: number | null; max?: number | null; everyMinutes?: number | null }
export interface Instruction { id: string; itemId: string; operationSeq: number; version: number; status: string; title: string; steps: InstructionStep[]; characteristics: Characteristic[]; firstOffRequired: boolean; scanMaterials: boolean }
export interface RecipeParameter { name: string; unit?: string | null; value: number; min?: number | null; max?: number | null; signalCode?: string | null; target?: Record<string, string | number | boolean> | null }
export interface StartCheck { code: string; label: string; ok: boolean; blocking: boolean; detail: string | null }

export interface Execution {
  id: string;
  jobCard: { id: string; status: string; startedAt: string; endedAt: string | null; goodQty: number; rejectQty: number; shots: number; operatorName: string | null; workOrderId: string; workOrderNumber: string; itemCode: string; itemName: string; operation: string; seq: number; machineCode: string | null; toolCode: string | null };
  operatorName: string | null;
  instruction: { id: string; version: number; title: string; steps: InstructionStep[]; characteristics: Characteristic[]; firstOffRequired: boolean } | null;
  stepsAcked: number[];
  checks: StartCheck[];
  scans: { tool?: string | null; materials?: { code: string; batchNo?: string | null }[] };
  firstOff: { status: "not_required" | "pending" | "approved" | "rejected"; readings: { name: string; value: number; ok: boolean }[] | null; note: string | null; by: string | null; at: string | null };
  inlineChecks: { at: string; readings: { name: string; value: number; ok: boolean }[]; allOk: boolean; by: string | null }[];
  checksDue: string[];
  recipe: { id: string; version: number; notes: string | null; parameters: { name: string; unit: string | null; setPoint: number; min: number | null; max: number | null; written: boolean; measured: { min: number | null; avg: number | null; max: number | null; n: number } | null; inSpec: boolean | null }[]; download: { status: string; result: string | null; sentAt: string | null; doneAt: string | null } | null } | null;
  parameters: { code: string; name: string; unit: string | null; purpose: string; n: number; min: number | null; avg: number | null; max: number | null }[];
  createdAt: string;
}

export const FIRST_OFF: Record<string, [string, "neutral" | "warning" | "success" | "danger"]> = {
  not_required: ["Not needed", "neutral"],
  pending: ["Waiting for approval", "warning"],
  approved: ["Approved", "success"],
  rejected: ["Rejected", "danger"],
};
