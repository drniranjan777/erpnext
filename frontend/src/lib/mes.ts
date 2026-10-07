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
