import type { PermissionCode } from './permissions';

export interface DocTypeDefinition {
  label: string;
  /** Short code used in default number patterns. */
  code: string;
  module: string;
  /** Frontend route of the document's detail page: `${path}/${id}`. */
  path: string;
  defaultPattern: string;
  readPermission: PermissionCode;
  /** GST invoices/notes: number must be ≤16 chars of [A-Za-z0-9/-] (CGST Rule 46). */
  gstDocument: boolean;
}

/**
 * Registry of document types built on the document framework. Each new
 * transaction type (PO, GRN, invoice...) registers here.
 */
export const DOC_TYPES = {
  purchase_requisition: {
    label: 'Purchase Requisition',
    code: 'PR',
    module: 'purchase',
    path: '/purchase/requisitions',
    defaultPattern: 'PR/{BRANCH}/{FY}/{SEQ}',
    readPermission: 'purchase.requisitions.read',
    gstDocument: false,
  },
  purchase_order: {
    label: 'Purchase Order',
    code: 'PO',
    module: 'purchase',
    path: '/purchase/orders',
    defaultPattern: 'PO/{BRANCH}/{FY}/{SEQ}',
    readPermission: 'purchase.orders.read',
    gstDocument: false,
  },
  goods_receipt: {
    label: 'Goods Receipt',
    code: 'GRN',
    module: 'purchase',
    path: '/purchase/receipts',
    defaultPattern: 'GRN/{BRANCH}/{FY}/{SEQ}',
    readPermission: 'purchase.receipts.read',
    gstDocument: false,
  },
  purchase_invoice: {
    label: 'Purchase Invoice',
    code: 'PINV',
    module: 'purchase',
    path: '/purchase/invoices',
    defaultPattern: 'PINV/{BRANCH}/{FY}/{SEQ}',
    readPermission: 'purchase.invoices.read',
    gstDocument: false,
  },
  debit_note: {
    label: 'Debit Note',
    code: 'DN',
    module: 'purchase',
    path: '/purchase/debit-notes',
    defaultPattern: 'DN/{FY}/{SEQ}',
    readPermission: 'purchase.invoices.read',
    gstDocument: true,
  },
  landed_cost: {
    label: 'Landed Cost',
    code: 'LCV',
    module: 'purchase',
    path: '/purchase/landed-costs',
    defaultPattern: 'LCV/{BRANCH}/{FY}/{SEQ}',
    readPermission: 'purchase.invoices.read',
    gstDocument: false,
  },
  rfq: {
    label: 'Request for Quotation',
    code: 'RFQ',
    module: 'purchase',
    path: '/purchase/rfqs',
    defaultPattern: 'RFQ/{BRANCH}/{FY}/{SEQ}',
    readPermission: 'purchase.rfq.read',
    gstDocument: false,
  },
  sales_quotation: {
    label: 'Quotation',
    code: 'QTN',
    module: 'sales',
    path: '/sales/quotations',
    defaultPattern: 'QTN/{BRANCH}/{FY}/{SEQ}',
    readPermission: 'sales.quotations.read',
    gstDocument: false,
  },
  sales_order: {
    label: 'Sales Order',
    code: 'SO',
    module: 'sales',
    path: '/sales/orders',
    defaultPattern: 'SO/{BRANCH}/{FY}/{SEQ}',
    readPermission: 'sales.orders.read',
    gstDocument: false,
  },
  delivery_note: {
    label: 'Delivery Note',
    code: 'DLV',
    module: 'sales',
    path: '/sales/deliveries',
    defaultPattern: 'DLV/{BRANCH}/{FY}/{SEQ}',
    readPermission: 'sales.deliveries.read',
    gstDocument: false,
  },
  sales_invoice: {
    label: 'Tax Invoice',
    code: 'INV',
    module: 'sales',
    path: '/sales/invoices',
    defaultPattern: 'INV/{FY}/{SEQ}',
    readPermission: 'sales.invoices.read',
    gstDocument: true,
  },
  credit_note: {
    label: 'Credit Note',
    code: 'CN',
    module: 'sales',
    path: '/sales/credit-notes',
    defaultPattern: 'CN/{FY}/{SEQ}',
    readPermission: 'sales.invoices.read',
    gstDocument: true,
  },
  stock_entry: {
    label: 'Stock Entry',
    code: 'SE',
    module: 'inventory',
    path: '/inventory/stock-entries',
    defaultPattern: 'SE/{BRANCH}/{FY}/{SEQ}',
    readPermission: 'inventory.stock.read',
    gstDocument: false,
  },
  stock_count: {
    label: 'Physical Stock Count',
    code: 'PSC',
    module: 'inventory',
    path: '/inventory/stock-counts',
    defaultPattern: 'PSC/{BRANCH}/{FY}/{SEQ}',
    readPermission: 'inventory.stock.read',
    gstDocument: false,
  },
} as const satisfies Record<string, DocTypeDefinition>;

export type DocType = keyof typeof DOC_TYPES;
export const ALL_DOC_TYPES = Object.keys(DOC_TYPES) as DocType[];

export function isDocType(v: string): v is DocType {
  return v in DOC_TYPES;
}
