import type { DocumentHeader } from "./documents";

export const MT = "/maintenance";

export const KIND = { breakdown: "Breakdown", preventive: "Preventive", condition: "Condition-based", shutdown: "Shutdown", corrective: "Corrective" } as const;
export const STAGE = { open: { label: "Open", tone: "warning" }, in_progress: { label: "In progress", tone: "primary" }, done: { label: "Done", tone: "success" } } as const;
export const ASSET_STATUS = { running: "success", down: "danger", standby: "neutral", retired: "neutral" } as const;

export interface Asset {
  id: string;
  code: string;
  name: string;
  level: string;
  parentId: string | null;
  machineId: string | null;
  machineCode: string | null;
  location: string | null;
  criticality: "A" | "B" | "C";
  status: keyof typeof ASSET_STATUS;
  meterUnit: string | null;
  meterReading: string | null;
  warrantyUntil: string | null;
  inWarranty: boolean;
  openJobs: number;
}

export interface MaintenanceOrder extends DocumentHeader {
  kind: keyof typeof KIND;
  asset: { id: string; code: string; name: string; status: string; meterUnit: string | null } | null;
  tool: { id: string; code: string; name: string; shotsUsed: number } | null;
  schedule: { id: string; title: string } | null;
  problem: string;
  priority: string;
  requestedBy: string | null;
  reportedAt: string;
  plannedDate: string | null;
  machineDown: boolean;
  stage: keyof typeof STAGE;
  assignedTo: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  downtimeMinutes: number | null;
  failureCode: string | null;
  actionTaken: string | null;
  checklist: { item: string; ok: boolean | null; note: string | null }[];
  labour: { person: string; hours: string; rate: string }[];
  meterReading: string | null;
  labourCost: string;
  sparesCost: string;
  otherCost: string;
  totalCost: string;
  spares: { id: string; itemId: string; code: string; name: string; uom: string; warehouseId: string; warehouse: string; qty: string; batchNo: string | null; value: string }[];
  canStart: boolean;
  canComplete: boolean;
  canSignOff: boolean;
}

export const hours = (minutes: number | null | undefined) => (minutes === null || minutes === undefined ? "–" : minutes >= 120 ? `${Math.round((minutes / 60) * 10) / 10} h` : `${minutes} min`);
