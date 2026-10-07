import type { DocumentHeader } from "./documents";

export const ENG = "/engineering";

export type ChangeKind = "bom" | "formula" | "drawing" | "item" | "process" | "facility" | "system";
export const CHANGE_KIND: Record<ChangeKind, string> = { bom: "Bill of materials", formula: "Formula", drawing: "Drawing", item: "Item master", process: "Process / routing", facility: "Facility / equipment", system: "System / software" };
export const DISPOSITION = { use_as_is: "Use up existing stock", rework: "Rework existing stock", scrap: "Scrap existing stock", return_to_vendor: "Return to vendor" } as const;
export const STAGE = { request: { label: "Request", tone: "neutral" }, approved: { label: "Approved notice", tone: "primary" }, implemented: { label: "Implemented", tone: "success" } } as const;

export interface DocRef { id: string; number: string | null; title: string | null; status: string; docType: string }
export interface ImpactLine {
  itemId: string;
  code: string;
  name: string;
  uom: string;
  stockQty: string;
  stockValue: string;
  workOrdersMaking: { count: number; qty: string };
  workOrdersUsing: { count: number; qty: string };
  workOrdersOnCurrentVersion: number;
  onOrder: string;
  openSales: string;
  usedIn: string[];
}
export interface Impact { lines: ImpactLine[]; totals: { stockValue: string; openWorkOrders: number; itemsOnOrder: number; parents: number } }

export interface Change extends DocumentHeader {
  kind: ChangeKind;
  reason: string;
  description: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  effectiveDate: string | null;
  disposition: keyof typeof DISPOSITION;
  dispositionLabel: string;
  stage: keyof typeof STAGE;
  implementedAt: string | null;
  implementationNotes: string | null;
  severity: number | null;
  occurrence: number | null;
  detection: number | null;
  rpn: number | null;
  riskLevel: "low" | "medium" | "high" | null;
  regulatoryImpact: boolean;
  validationRequired: boolean;
  items: { id: string; lineNo: number; item: { id: string; code: string; name: string }; from: DocRef | null; to: DocRef | null; remarks: string | null }[];
  impact: Impact;
  liveImpact: Impact | null;
  canImplement: boolean;
}

export interface Drawing extends DocumentHeader {
  drawingNo: string;
  drawingRevision: string;
  title: string;
  item: { id: string; code: string; name: string } | null;
  sheetSize: string | null;
  previousId: string | null;
  changeId: string | null;
  releasedAt: string | null;
  supersededAt: string | null;
  notes: string | null;
  current: boolean;
  revisions: { id: string; revision: string; status: string; releasedAt: string | null; supersededAt: string | null }[];
  canRevise: boolean;
}

const DOC_PATH: Record<string, string> = { bom: "/manufacturing/boms", formula: "/process/formulas", drawing: "/engineering/drawings" };
export const docPath = (r: DocRef | null) => (r && DOC_PATH[r.docType] ? `${DOC_PATH[r.docType]}/${r.id}` : null);
