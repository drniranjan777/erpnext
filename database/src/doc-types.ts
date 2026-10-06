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
