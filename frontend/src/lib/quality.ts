import type { DocumentHeader } from "./documents";

export const QA = "/quality";

export type Stage = "incoming" | "in_process" | "final";
export const STAGE: Record<Stage, string> = { incoming: "Incoming", in_process: "In-process", final: "Final" };
export type QiResult = "pending" | "accepted" | "rejected" | "partial";
export const RESULT: Record<QiResult, { label: string; tone: "neutral" | "success" | "danger" | "warning" }> = {
  pending: { label: "Pending", tone: "neutral" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  partial: { label: "Partly accepted", tone: "warning" },
};

export const AQLS = ["0.010", "0.015", "0.025", "0.040", "0.065", "0.10", "0.15", "0.25", "0.40", "0.65", "1.0", "1.5", "2.5", "4.0", "6.5", "10", "15", "25"];
export const LEVELS = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"];

export interface Parameter { id: string; seq: number; name: string; kind: "numeric" | "attribute"; unit: string | null; nominal: string | null; lowerLimit: string | null; upperLimit: string | null; isCritical: boolean; method: string | null }

export interface Plan {
  id: string;
  code: string;
  name: string;
  itemId: string;
  item: { id: string; code: string; name: string };
  stage: Stage;
  operationSeq: number | null;
  sampling: "aql" | "full" | "fixed";
  inspectionLevel: string;
  aql: string;
  fixedSampleSize: number | null;
  partyId: string | null;
  party: { id: string; code: string; name: string } | null;
  skipLotAfter: number | null;
  skipEvery: number | null;
  isActive: boolean;
  instructions: string | null;
  parameters: Parameter[];
}

export interface Inspection extends DocumentHeader {
  stage: Stage;
  item: { id: string; code: string; name: string; uom: string };
  plan: { id: string; code: string; name: string; sampling: string; aql: string; inspectionLevel: string; instructions: string | null } | null;
  parameters: Parameter[];
  readings: { id: string; parameterId: string; sampleNo: number; value: string | null; passed: boolean | null; note: string | null }[];
  lotQty: string;
  sampleSize: number;
  acceptNo: number;
  rejectNo: number;
  codeLetter: string | null;
  defectives: number;
  suggestion: "accept" | "reject" | null;
  result: QiResult;
  acceptedQty: string;
  rejectedQty: string;
  reworkQty: string;
  batchNo: string | null;
  warehouse: { id: string; code: string; name: string } | null;
  releaseWarehouse: { id: string; code: string; name: string } | null;
  rejectWarehouse: { id: string; code: string; name: string } | null;
  source: { id: string; number: string | null; docType: string } | null;
  vendor: string | null;
  workOrder: { id: string; number: string | null } | null;
  operation: { seq: number; name: string } | null;
  reworkOrder: { id: string; number: string | null } | null;
  remarks: string | null;
  vendorCoaRef: string | null;
  coaVerified: boolean;
  lot: { qcStatus: LotStatus; qcNote: string | null } | null;
  party: { id: string; name: string } | null;
  ncrs: { id: string; number: string | null; status: string }[];
}

export type LotStatus = "quarantine" | "under_test" | "released" | "conditional" | "rejected";
export const LOT_STATUS: Record<LotStatus, { label: string; tone: "neutral" | "success" | "danger" | "warning" | "primary" }> = {
  quarantine: { label: "Quarantine", tone: "warning" },
  under_test: { label: "Under test", tone: "primary" },
  released: { label: "Released", tone: "success" },
  conditional: { label: "Conditional release", tone: "warning" },
  rejected: { label: "Rejected", tone: "danger" },
};

export type NcrSource = "incoming" | "in_process" | "final" | "customer" | "supplier" | "internal";
export const NCR_SOURCE: Record<NcrSource, string> = { incoming: "Incoming", in_process: "In-process", final: "Final", customer: "Customer", supplier: "Supplier", internal: "Internal" };
export const DISPOSITION_FIELDS = [
  ["useAsIsQty", "Use as is"],
  ["reworkQty", "Rework"],
  ["scrapQty", "Scrap"],
  ["returnQty", "Return to vendor"],
  ["sortQty", "Sort / 100% check"],
] as const;

export interface Ncr extends DocumentHeader {
  source: NcrSource;
  severity: "minor" | "major" | "critical";
  item: { id: string; code: string; name: string; uom: string };
  batchNo: string | null;
  qtyAffected: string;
  defectCategory: string;
  description: string;
  party: { id: string; name: string } | null;
  inspection: { id: string; number: string | null } | null;
  workOrder: { id: string; number: string | null } | null;
  containment: string | null;
  useAsIsQty: string;
  reworkQty: string;
  scrapQty: string;
  returnQty: string;
  sortQty: string;
  dispositionNotes: string | null;
  scrapCost: string;
  reworkCost: string;
  sortingCost: string;
  otherCost: string;
  recovered: string;
  copq: string;
  closedAt: string | null;
  canClose: boolean;
}

export interface TraceNode {
  item: { id: string; code: string; name: string; uom: string };
  batchNo: string | null;
  serialNo: string | null;
  qty: string;
  onHand?: { warehouse: string; qty: string }[];
  links: { docType: string; docId: string; number: string | null; date: string; qty: string; party: string | null; workOrder?: { id: string; number: string | null }; lots?: TraceNode[] }[];
}

export const FISHBONE = ["man", "machine", "method", "material", "measurement", "environment"] as const;
export const FISHBONE_LABEL: Record<(typeof FISHBONE)[number], string> = { man: "People", machine: "Machine", method: "Method", material: "Material", measurement: "Measurement", environment: "Environment" };
export const EIGHT_D = [
  ["d1", "D1 Team"],
  ["d2", "D2 Problem description"],
  ["d3", "D3 Containment"],
  ["d4", "D4 Root cause"],
  ["d5", "D5 Corrective actions chosen"],
  ["d6", "D6 Actions implemented and validated"],
  ["d7", "D7 Prevent recurrence"],
  ["d8", "D8 Recognise the team"],
] as const;
export const CAPA_STAGE = { open: { label: "Actions open", tone: "warning" }, verification: { label: "Awaiting verification", tone: "primary" }, closed: { label: "Closed", tone: "success" } } as const;

export interface CapaAction { id: string; kind: "containment" | "corrective" | "preventive"; action: string; owner: string | null; dueDate: string | null; doneOn: string | null; notes: string | null }
export interface Capa extends DocumentHeader {
  kind: "corrective" | "preventive";
  source: "ncr" | "complaint" | "audit" | "internal" | "supplier";
  isScar: boolean;
  party: { id: string; name: string } | null;
  item: { id: string; code: string; name: string } | null;
  ncr: { id: string; number: string | null } | null;
  complaint: { id: string; number: string | null } | null;
  responseDue: string | null;
  problem: string;
  method: "5why" | "fishbone" | "8d";
  whys: string[];
  fishbone: Partial<Record<(typeof FISHBONE)[number], string[]>>;
  eightD: Partial<Record<string, string>>;
  rootCause: string | null;
  stage: keyof typeof CAPA_STAGE;
  effectivenessDue: string | null;
  effectivenessResult: "effective" | "not_effective" | null;
  effectivenessNotes: string | null;
  closedAt: string | null;
  actions: CapaAction[];
  canAct: boolean;
  canVerify: boolean;
}

export const COMPLAINT_STAGE = { open: { label: "Open", tone: "warning" }, investigating: { label: "Investigating", tone: "primary" }, responded: { label: "Responded", tone: "neutral" }, closed: { label: "Closed", tone: "success" } } as const;
export interface Complaint extends DocumentHeader {
  customer: { id: string; name: string };
  item: { id: string; code: string; name: string } | null;
  batchNo: string | null;
  qty: string | null;
  receivedOn: string;
  channel: string;
  category: string;
  severity: string;
  description: string;
  isFieldFailure: boolean;
  warrantyCost: string;
  responseDue: string | null;
  stage: keyof typeof COMPLAINT_STAGE;
  response: string | null;
  respondedAt: string | null;
  ncr: { id: string; number: string | null; status: string; copq: string } | null;
  capa: { id: string; number: string | null; status: string } | null;
  overdue: boolean;
  canManage: boolean;
}
