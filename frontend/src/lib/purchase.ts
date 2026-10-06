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
  foreignRate?: string | null;
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
  billedQty: string;
  pendingQty: string;
  remarks: string | null;
}

export interface PurchaseOrder extends DocumentHeader, TaxTotals {
  poType: "standard" | "service";
  /** Import orders: rates are entered in `currency` (from the header) at this rate. */
  exchangeRate?: string;
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
  warnings: string[];
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

// ---- Purchase invoices, debit notes, landed cost, RFQ ----------------------------

export const PI_API = "/purchase/invoices";
export const PI_ROUTE = "/purchase/invoices";
export const DN_API = "/purchase/debit-notes";
export const DN_ROUTE = "/purchase/debit-notes";
export const LC_API = "/purchase/landed-costs";
export const LC_ROUTE = "/purchase/landed-costs";
export const RFQ_API = "/purchase/rfqs";
export const RFQ_ROUTE = "/purchase/rfqs";

export interface PiLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  isStockItem: boolean;
  description: string;
  uomId: string;
  uomCode: string;
  qty: string;
  rate: string;
  discountPct: string;
  hsnCode: string | null;
  gstRate: string;
  taxableValue: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  cessAmount: string;
  lineTotal: string;
  itcEligible: boolean;
  poLineId: string | null;
  grnLineId: string | null;
  grnNumber: string | null;
  expectedRate: string | null;
  rateVariance: string;
  outOfTolerance: boolean;
  returnedQty: string;
  remarks: string | null;
}

export interface PurchaseInvoice extends DocumentHeader, TaxTotals {
  vendor: { id: string; code: string; name: string; gstin: string | null; stateCode: string | null; registration: string; msme: string | null };
  purchaseOrder: { id: string; number: string | null } | null;
  supplierInvoiceNo: string;
  supplierInvoiceDate: string;
  matchType: "three_way" | "two_way" | "none";
  itcEligibleTax: string;
  itcIneligibleTax: string;
  tdsSection: string | null;
  tdsRate: string;
  tdsAmount: string;
  netPayable: string;
  paidAmount: string;
  outstanding: string;
  dueDate: string | null;
  daysToDue: number | null;
  rateTolerancePct: string;
  rateVariance: string;
  varianceNote: string | null;
  varianceNeedsNote: boolean;
  notes: string | null;
  ourGstin: string | null;
  stateTaxLabel: "SGST" | "UTGST";
  lines: PiLine[];
  debitNotes: { id: string; number: string | null; status: DocumentStatus; docDate: string; amount: string | null; kind: "return" | "price_adjustment" }[];
  canDebitNote: boolean;
}

export interface PiListItem {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  vendor: { id: string; code: string; name: string };
  supplierInvoiceNo: string;
  supplierInvoiceDate: string;
  matchType: string;
  grandTotal: string;
  tdsAmount: string;
  netPayable: string;
  outstanding: string;
  dueDate: string | null;
  daysToDue: number | null;
  vendorMsme: string | null;
  rateVariance: string;
}

export interface Billable {
  grnLines: { grnLineId: string; grnId: string; grnNumber: string | null; grnDate: string; supplierInvoiceNo: string | null; poId: string; poNumber: string | null; poLineId: string; itemId: string; itemCode: string; itemName: string; uomId: string; uomCode: string; pendingQty: string; rate: string }[];
  poLines: { poLineId: string; poId: string; poNumber: string | null; itemId: string; itemCode: string; itemName: string; description: string; uomId: string; uomCode: string; pendingQty: string; rate: string }[];
}

export interface DebitNote extends DocumentHeader, TaxTotals {
  kind: "return" | "price_adjustment";
  reason: string;
  vehicleNo: string | null;
  notes: string | null;
  invoice: { id: string; number: string | null; supplierInvoiceNo: string; supplierInvoiceDate: string };
  vendor: { id: string; code: string; name: string; gstin: string | null };
  warehouse: { id: string; code: string; name: string } | null;
  stateTaxLabel: "SGST" | "UTGST";
  lines: { id: string; lineNo: number; piLineId: string; itemCode: string; description: string; uomCode: string; qty: string; rate: string; taxableValue: string; gstRate: string; lineTotal: string; batchNo: string | null }[];
}

export interface LandedCost extends DocumentHeader {
  method: "value" | "qty" | "weight";
  totalCharges: string;
  unabsorbed: string;
  notes: string | null;
  receipts: { id: string; number: string | null; docDate: string }[];
  charges: { id: string; lineNo: number; chargeType: string; description: string | null; billRef: string | null; amount: string; vendor: { id: string; name: string } | null }[];
  allocations: { id: string; itemCode: string; itemName: string; warehouseCode: string; basis: string; amount: string; absorbed: string; unabsorbed: string }[];
}

export interface Rfq extends DocumentHeader {
  responseDueDate: string | null;
  deliveryWarehouse: { id: string; code: string; name: string } | null;
  terms: string | null;
  notes: string | null;
  awardedAt: string | null;
  lines: { id: string; lineNo: number; itemId: string; itemCode: string; description: string; uomId: string; uomCode: string; qty: string; requiredBy: string | null; awardedVendorId: string | null; poId: string | null }[];
  vendors: { vendorId: string; code: string; name: string; email: string | null; sentAt: string | null; respondedAt: string | null; quoteRef: string | null }[];
  canQuote: boolean;
  canAward: boolean;
}

export interface VendorPerformance {
  vendorId: string;
  vendor: { id: string; code: string; name: string; msmeCategory: string | null };
  orders: number;
  orderValue: string;
  receipts: number;
  acceptancePct: number | null;
  onTimePct: number | null;
  avgDelayDays: number | null;
  rateVariance: string;
  score: number | null;
}

export interface Comparison {
  lines: {
    id: string;
    lineNo: number;
    itemCode: string;
    description: string;
    qty: string;
    uom: string;
    gstRate: string | null;
    awardedVendorId: string | null;
    lowestVendorId: string | null;
    recommendedVendorId: string | null;
    offers: { vendorId: string; rate: string; discountPct: string; netRate: string; amount: string; leadTimeDays: number | null; remarks: string | null; lowest: boolean; score: number }[];
  }[];
  vendors: {
    rfqVendorId: string;
    vendorId: string;
    name: string;
    code: string;
    respondedAt: string | null;
    quoteRef: string | null;
    validUntil: string | null;
    paymentTerms: string | null;
    creditDays: number | null;
    deliveryTerms: string | null;
    otherCharges: string;
    linesQuoted: number;
    linesLowest: number;
    total: string;
    performance: Omit<VendorPerformance, "vendor"> | null;
  }[];
}

export const piKeys = { list: (f: Record<string, unknown>) => [PI_ROUTE, "list", f] as const, detail: (id: string) => [PI_ROUTE, id] as const };
export const dnKeys = { list: (f: Record<string, unknown>) => [DN_ROUTE, "list", f] as const, detail: (id: string) => [DN_ROUTE, id] as const };
export const lcKeys = { list: (f: Record<string, unknown>) => [LC_ROUTE, "list", f] as const, detail: (id: string) => [LC_ROUTE, id] as const };
export const rfqKeys = { list: (f: Record<string, unknown>) => [RFQ_ROUTE, "list", f] as const, detail: (id: string) => [RFQ_ROUTE, id] as const };
