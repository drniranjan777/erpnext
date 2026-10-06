import type { DocumentHeader, DocumentStatus } from "./documents";

export const PR_API = "/purchase/requisitions";
export const PR_ROUTE = "/purchase/requisitions";

export type Priority = "low" | "normal" | "high" | "urgent";

export const PRIORITY_META: Record<Priority, { label: string; tone: "neutral" | "primary" | "warning" | "danger" }> = {
  low: { label: "Low", tone: "neutral" },
  normal: { label: "Normal", tone: "primary" },
  high: { label: "High", tone: "warning" },
  urgent: { label: "Urgent", tone: "danger" },
};

export interface RequisitionLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  uomId: string | null;
  itemCode: string | null;
  description: string;
  uom: string;
  quantity: string;
  estimatedRate: string | null;
  estimatedAmount: string | null;
  requiredBy: string | null;
  remarks: string | null;
  /** Quantity on approved purchase orders. */
  orderedQty: string;
}

export interface Requisition extends DocumentHeader {
  requiredBy: string | null;
  department: string | null;
  purpose: string | null;
  priority: Priority;
  notes: string | null;
  lines: RequisitionLine[];
}

export interface RequisitionListItem {
  id: string;
  number: string | null;
  revision: number;
  status: DocumentStatus;
  docDate: string;
  title: string | null;
  amount: string | null;
  priority: Priority;
  requiredBy: string | null;
  department: string | null;
  createdBy: string | null;
  createdAt: string;
}

export const prKeys = {
  list: (filters: Record<string, unknown>) => [PR_ROUTE, "list", filters] as const,
  detail: (id: string) => [PR_ROUTE, id] as const,
};

/** Common units for free-text lines (lines picked from the item master use the item's units). */
export const COMMON_UOMS = ["NOS", "PCS", "KG", "G", "MT", "LTR", "ML", "MTR", "CM", "SQM", "BOX", "SET", "PAIR", "ROLL", "BAG", "DRUM"];

// ---- Purchase orders ----------------------------------------------------------

export const PO_API = "/purchase/orders";
export const PO_ROUTE = "/purchase/orders";
export const GRN_API = "/purchase/receipts";
export const GRN_ROUTE = "/purchase/receipts";

export interface TaxTotals {
  placeOfSupply: string | null;
  interState: boolean;
  reverseCharge: boolean;
  taxKind: string;
  taxableTotal: string;
  cgstTotal: string;
  sgstTotal: string;
  igstTotal: string;
  cessTotal: string;
  taxTotal: string;
  reverseChargeTax: string;
  roundOff: string;
  grandTotal: string;
  taxNotes: string[];
}

export interface PoLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  isStockItem: boolean;
  trackBatch: boolean;
  trackSerial: boolean;
  hasExpiry: boolean;
  description: string;
  uomId: string;
  uomCode: string;
  uomDecimals: number;
  qty: string;
  conversionFactor: string;
  baseQty: string;
  rate: string;
  discountPct: string;
  hsnCode: string | null;
  gstRate: string;
  cessRate: string;
  taxability: string;
  taxableValue: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  cessAmount: string;
  lineTotal: string;
  deliveryDate: string | null;
  requisitionLineId: string | null;
  receivedQty: string;
  rejectedQty: string;
  pendingQty: string;
  remarks: string | null;
}

export interface PurchaseOrder extends DocumentHeader, TaxTotals {
  poType: "standard" | "service";
  vendor: { id: string; code: string; name: string; email: string | null; phone: string | null; gstin: string | null; stateCode: string | null; registration: string; address: { line1?: string; line2?: string; city?: string; stateCode?: string; pincode?: string } };
  deliveryWarehouse: { id: string; code: string; name: string } | null;
  ourGstin: string | null;
  ourStateCode: string | null;
  stateTaxLabel: "SGST" | "UTGST";
  expectedDate: string | null;
  vendorQuoteRef: string | null;
  paymentTerms: string | null;
  creditDays: number | null;
  tolerancePct: string;
  terms: string | null;
  notes: string | null;
  closedAt: string | null;
  closeReason: string | null;
  lines: PoLine[];
  receipts: { id: string; number: string | null; status: DocumentStatus; docDate: string; amount: string | null }[];
  canReceive: boolean;
  canShortClose: boolean;
}

export interface PoListItem {
  id: string;
  number: string | null;
  revision: number;
  status: DocumentStatus;
  docDate: string;
  title: string | null;
  vendor: { id: string; code: string; name: string };
  poType: "standard" | "service";
  expectedDate: string | null;
  grandTotal: string;
  closedAt: string | null;
  receivedPct: number;
  createdBy: string | null;
}

export interface Receivable {
  id: string;
  number: string | null;
  status: DocumentStatus;
  closed: boolean;
  vendorId: string;
  deliveryWarehouseId: string | null;
  tolerancePct: string;
  lines: (PoLine & { maxReceivableQty: string })[];
}

export interface GrnLine {
  id: string;
  lineNo: number;
  poLineId: string;
  poLineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  uomId: string;
  uomCode: string;
  orderedQty: string;
  poReceivedQty: string;
  conversionFactor: string;
  receivedQty: string;
  rejectedQty: string;
  acceptedQty: string;
  acceptedBaseQty: string;
  rate: string;
  amount: string;
  batchNo: string | null;
  mfgDate: string | null;
  expiryDate: string | null;
  serialNos: string[] | null;
  rejectionReason: string | null;
  remarks: string | null;
}

export interface GoodsReceipt extends DocumentHeader {
  purchaseOrder: { id: string; number: string | null; status: DocumentStatus };
  vendor: { id: string; code: string; name: string; gstin: string | null };
  warehouse: { id: string; code: string; name: string };
  supplierInvoiceNo: string | null;
  supplierInvoiceDate: string | null;
  challanNo: string | null;
  gateEntryNo: string | null;
  vehicleNo: string | null;
  transporter: string | null;
  lrNo: string | null;
  notes: string | null;
  lines: GrnLine[];
}

export interface GrnListItem {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  title: string | null;
  amount: string | null;
  poId: string;
  poNumber: string | null;
  vendor: { id: string; code: string; name: string };
  warehouse: { id: string; code: string };
  supplierInvoiceNo: string | null;
  createdBy: string | null;
}

export interface VendorLookup {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  stateCode: string | null;
  creditDays: number | null;
}

export const poKeys = {
  list: (filters: Record<string, unknown>) => [PO_ROUTE, "list", filters] as const,
  detail: (id: string) => [PO_ROUTE, id] as const,
};
export const grnKeys = {
  list: (filters: Record<string, unknown>) => [GRN_ROUTE, "list", filters] as const,
  detail: (id: string) => [GRN_ROUTE, id] as const,
};
