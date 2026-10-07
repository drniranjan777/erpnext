import type { DocumentHeader } from "./documents";

export const PROC = "/process";

export type Basis = "percent" | "fixed" | "potency";
export interface StageParameter { name: string; unit: string | null; min: string | null; max: string | null }

export interface Formula extends DocumentHeader {
  formulaVersion: number;
  item: { id: string; code: string; name: string; uom: string };
  kind: "bulk" | "packing";
  batchSize: string;
  batchMultiple: string | null;
  yieldPct: string;
  isDefault: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  materialCost: string;
  conversionCost: string;
  unitCost: string;
  declaration: string | null;
  notes: string | null;
  lines: { id: string; lineNo: number; kind: "ingredient" | "coproduct" | "byproduct"; itemId: string; code: string; name: string; uom: string; basis: Basis; qty: string; stdPotency: string | null; tolerancePct: string | null; costSharePct: string | null; recoveryRate: string | null; stageSeq: number | null; remarks: string | null }[];
  stages: { id: string; seq: number; name: string; workCenterId: string; workCenter: string; workCenterName: string; minutes: string; parameters: StageParameter[]; instructions: string | null }[];
  versions: { id: string; version: number; status: string; isDefault: boolean }[];
  canNewVersion: boolean;
}

export interface BatchView {
  formula: { number: string | null; version: number; yieldPct: string } | null;
  batchNo: string | null;
  yield: { input: string; output: string; theoretical: string; actualPct: string; loss: string };
  materials: { id: string; kind: string; code: string; name: string; uom: string; basis: Basis | null; stdPotency: string | null; tolerancePct: string | null; requiredQty: string; issuedQty: string }[];
  dispensings: { id: string; code?: string; materialId: string; batchNo: string | null; assayPct: string | null; targetQty: string; qty: string; withinTolerance: boolean; overrideReason: string | null; checkedBy: string | null; dispensedAt: string }[];
  readings: { seq: number; stage: string; readings: { name: string; value: string; ok: boolean }[]; endedAt: string; operator: string | null }[];
  outOfRange: { stage: string; name: string; value: string; ok: boolean }[];
}

export const BASIS_LABEL: Record<Basis, string> = { percent: "% of batch", fixed: "Fixed qty", potency: "By potency" };
