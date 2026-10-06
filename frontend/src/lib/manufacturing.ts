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
