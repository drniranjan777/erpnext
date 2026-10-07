export const PLAN = "/planning";

export interface Ref { kind: string; id?: string | null; number?: string | null }
export interface Peg extends Ref { date: string; qty: number }

export interface PlannedOrder {
  id: string;
  item: { id: string; code: string; name: string; uom: string };
  source: "make" | "buy" | "batch";
  qty: string;
  dueDate: string;
  releaseDate: string;
  level: number;
  status: "planned" | "firmed" | "converted";
  pegs: Peg[];
  converted: { id: string; number: string | null; docType: string } | null;
}

export interface MrpRun {
  id: string;
  status: string;
  horizonDays: number;
  useForecast: boolean;
  stats: Record<string, number>;
  startedAt: string;
  finishedAt: string | null;
}

export interface MrpException {
  id: string;
  item: { id: string; code: string; name: string };
  kind: string;
  date: string | null;
  toDate: string | null;
  qty: string | null;
  ref: Ref | null;
  message: string;
}

export const SOURCE_LABEL = { make: "Make", buy: "Buy", batch: "Batch" } as const;

export const EXCEPTION_LABEL: Record<string, { label: string; tone: "danger" | "warning" | "primary" | "neutral" }> = {
  expedite: { label: "Expedite", tone: "danger" },
  past_due: { label: "Past due", tone: "danger" },
  late_demand: { label: "Late order", tone: "danger" },
  reschedule_in: { label: "Bring forward", tone: "warning" },
  below_safety: { label: "Below safety", tone: "warning" },
  no_structure: { label: "No BOM / formula", tone: "warning" },
  bom_loop: { label: "Structure loop", tone: "danger" },
  reschedule_out: { label: "Push out", tone: "primary" },
  cancel: { label: "Cancel", tone: "neutral" },
};

const PATHS: Record<string, string> = {
  sales_order: "/sales/orders",
  purchase_order: "/purchase/orders",
  requisition: "/purchase/requisitions",
  purchase_requisition: "/purchase/requisitions",
  work_order: "/manufacturing/work-orders",
};

/** Link to the document behind a demand, receipt or peg (none for forecasts and planned orders). */
export function refHref(ref: { kind?: string; docType?: string; id?: string | null } | null) {
  const kind = ref?.kind ?? ref?.docType;
  if (!ref?.id || !kind || !PATHS[kind]) return null;
  return `${PATHS[kind]}/${ref.id}`;
}

/** Short text for what a planned order covers. */
export function refLabel(r: Ref) {
  switch (r.kind) {
    case "sales_order":
      return r.number ?? "Sales order";
    case "forecast":
      return `Forecast ${r.number ?? ""}`.trim();
    case "planned_order":
      return `Planned ${r.number ?? "order"}`;
    case "firmed":
      return "Firmed order";
    case "work_order":
      return r.number ?? "Work order";
    case "purchase_order":
      return r.number ?? "Purchase order";
    case "requisition":
      return r.number ?? "Requisition";
    case "safety_stock":
      return "Safety stock";
    case "lot_size":
      return "Lot size";
    default:
      return r.kind.replace(/_/g, " ");
  }
}
