import type { DocumentHeader } from "./documents";

export const MFG = "/manufacturing";

export interface WorkCenter { id: string; code: string; name: string; kind: string; warehouseId: string | null; hoursPerDay: string; units: number; efficiencyPct: string; labourRate: string; machineRate: string; overheadRate: string; isActive: boolean }
export interface Machine { id: string; code: string; name: string; workCenterId: string; workCenter: string; make: string | null; model: string | null; serialNo: string | null; capacity: string | null; isActive: boolean }
export interface Tool { id: string; code: string; name: string; kind: string; cavities: number; lifeShots: number | null; shotsUsed: number; maintenanceEvery: number | null; machineId: string | null; status: string; lifeUsedPct: number | null; maintenanceDue: boolean }

export interface Bom extends DocumentHeader {
  bomVersion: number;
  item: { id: string; code: string; name: string; uom: string };
  quantity: string;
  isDefault: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  previousVersionId: string | null;
  materialCost: string;
  operationCost: string;
  subcontractCost: string;
  byproductCredit: string;
  unitCost: string;
  drawingNo: string | null;
  drawingRevision: string | null;
  notes: string | null;
  lines: { id: string; lineNo: number; kind: "component" | "byproduct" | "scrap"; itemId: string; code: string; name: string; uom: string; qty: string; scrapPct: string; isPhantom: boolean; alternateGroup: string | null; priority: number; operationSeq: number | null; recoveryRate: string | null; remarks: string | null }[];
  operations: { id: string; seq: number; name: string; workCenterId: string; workCenter: string; workCenterName: string; toolId: string | null; tool: string | null; setupMinutes: string; runMinutes: string; isSubcontract: boolean; vendorId: string | null; vendor: string | null; subcontractRate: string | null; inspection: boolean; instructions: string | null }[];
  versions: { id: string; version: number; status: string; isDefault: boolean; effectiveFrom: string | null; effectiveTo: string | null }[];
  canNewVersion: boolean;
}

export type WorkOrderStage = "planned" | "released" | "in_progress" | "completed" | "closed" | "cancelled";

export interface WoMaterial { id: string; lineNo: number; kind: "component" | "byproduct" | "scrap"; itemId: string; code: string; name: string; uom: string; requiredQty: string; issuedQty: string; receivedQty: string; outstanding: string | null; operationSeq: number | null; recoveryRate: string | null; stdRate: string; trackBatch: boolean; trackSerial: boolean; isStockItem: boolean }
export interface WoOperation { parameters: { name: string; unit: string | null; min: string | null; max: string | null }[] | null; id: string; seq: number; name: string; workCenterId: string; workCenter: string; workCenterName: string; tool: string | null; toolId: string | null; vendor: string | null; setupMinutes: string; runMinutes: string; plannedMinutes: string; isSubcontract: boolean; subcontractRate: string | null; inspection: boolean; status: "pending" | "in_progress" | "done"; goodQty: string; rejectQty: string; actualMinutes: string }
export interface WoEntry { id: string; number: string | null; status: string; docDate: string; kind: "issue" | "return" | "receipt" | "close"; goodQty: string; rejectQty: string; materialValue: string; conversionValue: string; subcontractValue: string; outputValue: string; varianceValue: string }

export interface WorkOrder extends DocumentHeader {
  kind: "mts" | "mto" | "rework" | "batch";
  stage: WorkOrderStage;
  formulaId: string | null;
  batchNo: string | null;
  item: { id: string; code: string; name: string; uom: string };
  bom: { id: string; number: string | null; version: number } | null;
  salesOrder: { id: string; number: string | null } | null;
  salesOrderLineId: string | null;
  parent: { id: string; number: string | null } | null;
  reworks: { id: string; number: string | null; status: string }[];
  qty: string;
  producedQty: string;
  rejectedQty: string;
  source: { id: string; code: string; name: string };
  target: { id: string; code: string; name: string };
  sourceWarehouseId: string;
  targetWarehouseId: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  priority: number;
  backflush: boolean;
  stdUnitCost: string;
  materialCost: string;
  conversionCost: string;
  subcontractCost: string;
  byproductValue: string;
  outputValue: string;
  varianceValue: string;
  wip: string;
  releaseCheck: { itemId: string; code: string; required: string; available: string; short: string }[] | null;
  notes: string | null;
  materials: WoMaterial[];
  operations: WoOperation[];
  entries: WoEntry[];
  canProduce: boolean;
  canRecord: boolean;
  canClose: boolean;
}

export const STAGE_LABEL: Record<WorkOrderStage, string> = { planned: "Planned", released: "Released", in_progress: "In progress", completed: "Completed", closed: "Closed", cancelled: "Cancelled" };
export const STAGE_TONE: Record<WorkOrderStage, "neutral" | "primary" | "warning" | "success" | "danger"> = { planned: "neutral", released: "primary", in_progress: "warning", completed: "success", closed: "neutral", cancelled: "danger" };
export const KIND_LABEL = { mts: "Make to stock", mto: "Make to order", rework: "Rework", batch: "Process batch" } as const;
export const ENTRY_LABEL = { issue: "Material issue", return: "Material return", receipt: "Production receipt", close: "Close" } as const;
