import type { DocumentHeader, DocumentStatus } from "./documents";

export const SE_API = "/inventory/stock-entries";
export const SE_ROUTE = "/inventory/stock-entries";

export type Purpose =
  | "opening_stock"
  | "material_receipt"
  | "material_issue"
  | "transfer"
  | "adjustment";

export const PURPOSE_META: Record<
  Purpose,
  {
    label: string;
    hint: string;
    from: boolean;
    to: boolean;
    rate: "required" | "optional" | "none";
    signed?: boolean;
  }
> = {
  opening_stock: {
    label: "Opening stock",
    hint: "Stock on hand when you start using NextGen, at its book value.",
    from: false,
    to: true,
    rate: "required",
  },
  material_receipt: {
    label: "Material receipt",
    hint: "Stock received without a purchase order (samples, returns from site, free issue).",
    from: false,
    to: true,
    rate: "optional",
  },
  material_issue: {
    label: "Material issue",
    hint: "Stock consumed or sent out (to production, maintenance, a cost centre). Valued at stock cost.",
    from: true,
    to: false,
    rate: "none",
  },
  transfer: {
    label: "Transfer",
    hint: "Move stock between warehouses at cost. Expired batches can only go to scrap / rejected stores.",
    from: true,
    to: true,
    rate: "none",
  },
  adjustment: {
    label: "Stock adjustment",
    hint: "Correct physical differences or write off damaged / expired stock. Use + to add, − to remove.",
    from: false,
    to: true,
    rate: "optional",
    signed: true,
  },
};

export interface WarehouseRef {
  id: string;
  code: string;
  name: string;
}

export interface StockEntryLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  uomId: string;
  uomCode: string;
  qty: string;
  conversionFactor: string;
  baseQty: string;
  rate: string | null;
  amount: string | null;
  batchNo: string | null;
  mfgDate: string | null;
  expiryDate: string | null;
  serialNos: string[] | null;
  remarks: string | null;
}

export interface StockEntry extends DocumentHeader {
  purpose: Purpose;
  purposeLabel: string;
  fromWarehouse: WarehouseRef | null;
  toWarehouse: WarehouseRef | null;
  reason: string | null;
  reference: string | null;
  notes: string | null;
  lines: StockEntryLine[];
}

export interface StockEntryListItem {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  title: string | null;
  amount: string | null;
  purpose: Purpose;
  purposeLabel: string;
  fromWarehouse: WarehouseRef | null;
  toWarehouse: WarehouseRef | null;
  reference: string | null;
  createdBy: string | null;
}

export interface StockLevel {
  itemId: string;
  code: string;
  name: string;
  type: string;
  group: string | null;
  uom: string;
  qty: string;
  available: string;
  value: string;
  valuationRate: string | null;
  reorderLevel: string | null;
  reorderQty: string | null;
  belowReorder: boolean;
  suggestedOrderQty: string | null;
}

export interface ItemStock {
  item: {
    id: string;
    code: string;
    name: string;
    uom: string;
    trackBatch: boolean;
    trackSerial: boolean;
    valuationMethod: string;
    reorderLevel: string | null;
  };
  byWarehouse: {
    warehouseId: string;
    code: string;
    name: string;
    type: string;
    isNettable: boolean;
    qty: string;
    value: string;
    valuationRate: string | null;
  }[];
  byBatch: {
    batchId: string;
    batchNo: string;
    mfgDate: string | null;
    expiryDate: string | null;
    warehouseId: string;
    warehouseCode: string;
    qty: string;
  }[];
}

export interface LedgerRow {
  id: string;
  postingDate: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  uom: string;
  warehouseId: string;
  warehouseCode: string;
  batchNo: string | null;
  serialNos: string[] | null;
  qty: string;
  rate: string;
  value: string;
  balanceQty: string;
  balanceValue: string;
  valuationRate: string;
  voucherType: string;
  voucherId: string;
  voucherNumber: string | null;
  isReversal: boolean;
}

export interface BatchStock {
  batchId: string;
  batchNo: string;
  mfgDate: string | null;
  expiryDate: string | null;
  warehouseId: string;
  warehouseCode: string;
  qty: string;
  expired: boolean;
}

export interface ExpiringBatch {
  itemId: string;
  itemCode: string;
  itemName: string;
  uom: string;
  batchNo: string;
  expiryDate: string;
  daysLeft: number;
  warehouseId: string;
  warehouseCode: string;
  qty: string;
}

export const seKeys = {
  list: (filters: Record<string, unknown>) =>
    [SE_ROUTE, "list", filters] as const,
  detail: (id: string) => [SE_ROUTE, id] as const,
};

/** Every inventory query starts with this key, so posting can refresh them all at once. */
export const INVENTORY_KEY = ["inventory"] as const;

export const SC_API = "/inventory/stock-counts";
export const SC_ROUTE = "/inventory/stock-counts";

export interface StockCountLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  uom: string;
  uomDecimals: number;
  trackBatch: boolean;
  hasExpiry: boolean;
  batchNo: string | null;
  mfgDate: string | null;
  expiryDate: string | null;
  /** Null on a blind count while counting. */
  systemQty: string | null;
  countedQty: string | null;
  difference: string | null;
  bookQtyAtPosting: string | null;
  rate: string | null;
  varianceValue: string | null;
  remarks: string | null;
}

export interface StockCount extends DocumentHeader {
  warehouse: WarehouseRef;
  itemGroup: { id: string; name: string } | null;
  blind: boolean;
  bookHidden: boolean;
  snapshotAt: string;
  notes: string | null;
  stats: {
    lines: number;
    counted: number;
    withDifference: number | null;
    shortageValue: string | null;
    excessValue: string | null;
    estimated: boolean;
  };
  lines: StockCountLine[];
}

export interface StockCountListItem {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  title: string | null;
  amount: string | null;
  warehouse: WarehouseRef;
  group: string | null;
  lines: number;
  counted: number;
  createdBy: string | null;
}

export const scKeys = {
  list: (filters: Record<string, unknown>) =>
    [SC_ROUTE, "list", filters] as const,
  detail: (id: string) => [SC_ROUTE, id] as const,
};

/** Where a voucher in the ledger lives in the app. */
export function voucherHref(type: string, id: string) {
  if (type === "stock_entry") return `${SE_ROUTE}/${id}`;
  if (type === "stock_count") return `${SC_ROUTE}/${id}`;
  return null;
}
