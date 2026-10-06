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
}

export interface TraceNode {
  item: { id: string; code: string; name: string; uom: string };
  batchNo: string | null;
  serialNo: string | null;
  qty: string;
  onHand?: { warehouse: string; qty: string }[];
  links: { docType: string; docId: string; number: string | null; date: string; qty: string; party: string | null; workOrder?: { id: string; number: string | null }; lots?: TraceNode[] }[];
}
