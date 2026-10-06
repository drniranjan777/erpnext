import type { DocumentHeader } from "./documents";

export const ACC = "/accounting";

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  isGroup: boolean;
  nature: "asset" | "liability" | "equity" | "income" | "expense";
  systemKey: string | null;
  level: number;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
}

export interface BookSettings {
  companyId: string;
  booksFrom: string;
  lockedUntil: string | null;
  initialisedAt: string | null;
  unposted: number;
}

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
}

export interface LedgerEntry {
  id: string;
  postingDate: string;
  voucherType: string;
  voucherId: string;
  voucherNumber: string | null;
  accountCode: string;
  accountName: string;
  party: string | null;
  debit: string;
  credit: string;
  narration: string | null;
  against: string | null;
  isReversal: boolean;
  balance: string;
}

export interface Journal extends DocumentHeader {
  kind: "journal" | "opening" | "reversing";
  narration: string | null;
  reverseOn: string | null;
  reversalOfId: string | null;
  recurrence: "monthly" | "quarterly" | "yearly" | null;
  recurUntil: string | null;
  recurredFromId: string | null;
  totalDebit: string;
  lines: { id: string; lineNo: number; accountId: string; accountCode: string; accountName: string; partyId: string | null; partyName: string | null; costCenterId: string | null; costCenter: string | null; debit: string; credit: string; narration: string | null }[];
  related: { id: string; number: string | null; status: string; docDate: string }[];
}

/** Dr / Cr display of a signed balance (debit positive). */
export function drCr(v: string | number) {
  const n = Number(v);
  if (!n) return "—";
  const abs = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${abs} ${n > 0 ? "Dr" : "Cr"}`;
}

/** Where a voucher lives in the app, by document type. */
export const VOUCHER_PATH: Record<string, string> = {
  sales_invoice: "/sales/invoices",
  credit_note: "/sales/credit-notes",
  delivery_note: "/sales/deliveries",
  purchase_invoice: "/purchase/invoices",
  debit_note: "/purchase/debit-notes",
  goods_receipt: "/purchase/receipts",
  landed_cost: "/purchase/landed-costs",
  bill_of_entry: "/purchase/bills-of-entry",
  stock_entry: "/inventory/stock-entries",
  stock_count: "/inventory/stock-counts",
  job_work_challan: "/job-work/challans",
  job_work_receipt: "/job-work/receipts",
  journal_entry: "/accounting/journals",
};

export const VOUCHER_LABEL: Record<string, string> = {
  sales_invoice: "Invoice",
  credit_note: "Credit note",
  delivery_note: "Delivery",
  purchase_invoice: "Bill",
  debit_note: "Debit note",
  goods_receipt: "GRN",
  landed_cost: "Landed cost",
  bill_of_entry: "Bill of Entry",
  stock_entry: "Stock entry",
  stock_count: "Stock count",
  job_work_challan: "JW challan",
  job_work_receipt: "JW receipt",
  journal_entry: "Journal",
};
