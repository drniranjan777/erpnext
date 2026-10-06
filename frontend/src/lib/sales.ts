import type { DocumentHeader, DocumentStatus } from "./documents";
import type { TaxTotals } from "./purchase";

export const S = {
  quotations: "/sales/quotations",
  orders: "/sales/orders",
  deliveries: "/sales/deliveries",
  invoices: "/sales/invoices",
  credits: "/sales/credit-notes",
} as const;

export interface AddressSnapshot {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  stateCode?: string;
  pincode?: string;
  gstin?: string | null;
}

export interface SellingLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  description: string;
  uomId: string;
  uomCode: string;
  qty: string;
  conversionFactor: string;
  baseQty: string;
  listRate: string | null;
  rate: string;
  discountPct: string;
  hsnCode: string | null;
  gstRate: string;
  taxableValue: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
  unitCost: string | null;
  remarks: string | null;
}

interface CustomerRef {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  stateCode: string | null;
  registration: string;
}

interface Commercial extends TaxTotals {
  customer: CustomerRef;
  billingAddress: AddressSnapshot;
  shippingAddress: AddressSnapshot;
  withLut: boolean;
  paymentTerms: string | null;
  creditDays: number | null;
  terms: string | null;
  notes: string | null;
  stateTaxLabel: "SGST" | "UTGST";
}

export interface Quotation extends DocumentHeader, Commercial {
  validUntil: string | null;
  customerEnquiryRef: string | null;
  costTotal: string;
  marginPct: string | null;
  maxDiscountPct: string;
  lines: (SellingLine & { marginPct: string | null })[];
  order: { id: string; number: string | null; status: DocumentStatus } | null;
  expired: boolean;
  canOrder: boolean;
}

export interface SalesOrderLine extends SellingLine {
  itemName: string;
  isStockItem: boolean;
  trackBatch: boolean;
  trackSerial: boolean;
  deliveryDate: string | null;
  quotationLineId: string | null;
  deliveredQty: string;
  invoicedQty: string;
  pendingQty: string;
  toInvoiceQty: string;
}

export interface SalesOrder extends DocumentHeader, Commercial {
  customerPoNo: string | null;
  customerPoDate: string | null;
  expectedDate: string | null;
  quotationId: string | null;
  costTotal: string;
  marginPct: string | null;
  maxDiscountPct: string;
  creditCheck: { limit: string | null; outstanding: string; overdue: string; openOrders: string; exposure: string; exceeded: boolean; reasons: string[] } | null;
  creditOverrideReason: string | null;
  closedAt: string | null;
  closeReason: string | null;
  warehouse: { id: string; code: string; name: string } | null;
  lines: SalesOrderLine[];
  deliveries: { id: string; number: string | null; status: DocumentStatus; docDate: string }[];
  invoices: { id: string; number: string | null; status: DocumentStatus; docDate: string; amount: string }[];
  canDeliver: boolean;
  canInvoice: boolean;
  canShortClose: boolean;
}

export interface Delivery extends DocumentHeader {
  order: { id: string; number: string | null; customerPoNo: string | null };
  customer: { id: string; code: string; name: string; gstin: string | null };
  warehouse: { id: string; code: string; name: string };
  shippingAddress: AddressSnapshot;
  transporter: string | null;
  vehicleNo: string | null;
  lrNo: string | null;
  lrDate: string | null;
  packages: number | null;
  grossWeightKg: string | null;
  deliveredAt: string | null;
  podNote: string | null;
  notes: string | null;
  lines: { id: string; lineNo: number; soLineId: string; soLineNo: number; itemId: string; itemCode: string; itemName: string; uomCode: string; qty: string; batchNo: string | null; serialNos: string[] | null; costValue: string; invoicedQty: string; orderedQty: string }[];
  canInvoice: boolean;
}

export interface InvoiceLine extends SellingLine {
  soLineId: string | null;
  dlvLineId: string | null;
  deliveryNumber: string | null;
  batchNo: string | null;
  serialNos: string[] | null;
  costValue: string;
  returnedQty: string;
  isStockItem: boolean;
}

export interface SalesInvoice extends DocumentHeader, Commercial {
  order: { id: string; number: string | null } | null;
  warehouse: { id: string; code: string; name: string } | null;
  customerPoNo: string | null;
  dueDate: string | null;
  daysToDue: number | null;
  costTotal: string;
  marginPct: string | null;
  receivedAmount: string;
  creditedAmount: string;
  outstanding: string;
  placeOfSupplyName: string | null;
  ourGstin: string | null;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  ewayBillNo: string | null;
  ewayBillDate: string | null;
  ewayValidUntil: string | null;
  vehicleNo: string | null;
  transporter: string | null;
  lrNo: string | null;
  lines: InvoiceLine[];
  creditNotes: { id: string; number: string | null; status: DocumentStatus; docDate: string; amount: string; kind: string }[];
  canCreditNote: boolean;
}

export interface CreditNote extends DocumentHeader, TaxTotals {
  kind: "return" | "price_adjustment";
  reason: string;
  notes: string | null;
  invoice: { id: string; number: string | null; docDate: string | null; irn: string | null };
  customer: { id: string; code: string; name: string; gstin: string | null };
  warehouse: { id: string; code: string; name: string } | null;
  stateTaxLabel: "SGST" | "UTGST";
  lines: { id: string; lineNo: number; invoiceLineId: string; itemCode: string; description: string; uomCode: string; qty: string; rate: string; taxableValue: string; gstRate: string; lineTotal: string }[];
}

export interface SalesPreview {
  header: TaxTotals & { costTotal: string; marginPct: string | null; maxDiscountPct: string };
  stateTaxLabel: string;
  lines: { listRate: string | null; rate: string; taxableValue: string; gstRate: string; lineTotal: string; unitCost: string | null; uomId: string }[];
}

export const keys = {
  list: (base: string, f: Record<string, unknown>) => [base, "list", f] as const,
  detail: (base: string, id: string) => [base, id] as const,
};
