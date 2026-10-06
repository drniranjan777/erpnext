import { boolean, char, date, index, integer, jsonb, numeric, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { documents } from './documents';
import { items, parties, uoms, warehouses } from './masters';
import { type Address, tenantId } from './tenancy';

export const requisitionPriority = pgEnum('requisition_priority', ['low', 'normal', 'high', 'urgent']);

/**
 * Purchase Requisition: internal request to buy. Shares its id with `documents`
 * (number, status, approvals...). Lines link to the item master when an item is picked;
 * free-text lines remain allowed for one-off purchases.
 */
export const purchaseRequisitions = pgTable('purchase_requisitions', {
  id: uuid('id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  tenantId: tenantId(),
  requiredBy: date('required_by', { mode: 'string' }),
  department: text('department'),
  purpose: text('purpose'),
  priority: requisitionPriority('priority').notNull().default('normal'),
  notes: text('notes'),
});

export const purchaseRequisitionLines = pgTable(
  'purchase_requisition_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    requisitionId: uuid('requisition_id')
      .notNull()
      .references(() => purchaseRequisitions.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'restrict' }),
    uomId: uuid('uom_id').references(() => uoms.id, { onDelete: 'restrict' }),
    itemCode: text('item_code'),
    description: text('description').notNull(),
    uom: text('uom').notNull(),
    quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
    estimatedRate: numeric('estimated_rate', { precision: 18, scale: 4 }),
    estimatedAmount: numeric('estimated_amount', { precision: 18, scale: 2 }),
    /** Quantity (in the line's unit) already put on approved purchase orders. */
    orderedQty: numeric('ordered_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    requiredBy: date('required_by', { mode: 'string' }),
    remarks: text('remarks'),
  },
  (t) => [
    index('pr_lines_requisition_idx').on(t.requisitionId),
    index('pr_lines_item_idx').on(t.itemId),
    uniqueIndex('pr_lines_line_no_uq').on(t.requisitionId, t.lineNo),
  ],
);

// =============================================================================
// GST columns shared by every taxable document
// =============================================================================

const money = (name: string) => numeric(name, { precision: 18, scale: 2 }).notNull().default('0');

/** Per-line tax columns (rates in %, amounts in rupees), filled by the GST engine. */
export const taxLineColumns = () => ({
  hsnCode: text('hsn_code'),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  cessRate: numeric('cess_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  taxability: text('taxability').notNull().default('taxable'),
  taxableValue: money('taxable_value'),
  cgstAmount: money('cgst_amount'),
  sgstAmount: money('sgst_amount'),
  igstAmount: money('igst_amount'),
  cessAmount: money('cess_amount'),
  lineTotal: money('line_total'),
});

/** Document-level GST summary columns. */
export const taxHeaderColumns = () => ({
  placeOfSupply: char('place_of_supply', { length: 2 }),
  interState: boolean('inter_state').notNull().default(false),
  reverseCharge: boolean('reverse_charge').notNull().default(false),
  taxKind: text('tax_kind').notNull().default('tax_invoice'),
  taxableTotal: money('taxable_total'),
  cgstTotal: money('cgst_total'),
  sgstTotal: money('sgst_total'),
  igstTotal: money('igst_total'),
  cessTotal: money('cess_total'),
  taxTotal: money('tax_total'),
  reverseChargeTax: money('reverse_charge_tax'),
  roundOff: money('round_off'),
  grandTotal: money('grand_total'),
  taxNotes: jsonb('tax_notes').$type<string[]>().notNull().default([]),
});

// =============================================================================
// Purchase order (document type "purchase_order")
// =============================================================================

export const poType = pgEnum('po_type', ['standard', 'service']);

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    poType: poType('po_type').notNull().default('standard'),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    /** Vendor details as at the order, so the PO prints the same after the master changes. */
    vendorGstin: char('vendor_gstin', { length: 15 }),
    vendorStateCode: char('vendor_state_code', { length: 2 }),
    vendorRegistration: text('vendor_registration').notNull(),
    vendorAddress: jsonb('vendor_address').$type<Address & { line2?: string }>().notNull().default({}),
    deliveryWarehouseId: uuid('delivery_warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    expectedDate: date('expected_date', { mode: 'string' }),
    vendorQuoteRef: text('vendor_quote_ref'),
    paymentTerms: text('payment_terms'),
    creditDays: integer('credit_days'),
    /** Over-receipt allowed per line, as a % of the ordered quantity. */
    tolerancePct: numeric('tolerance_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    terms: text('terms'),
    notes: text('notes'),
    ...taxHeaderColumns(),
    /** Set when the order is short-closed: the remaining quantity will not be received. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closeReason: text('close_reason'),
  },
  (t) => [index('purchase_orders_vendor_idx').on(t.tenantId, t.vendorId)],
);

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    poId: uuid('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    conversionFactor: numeric('conversion_factor', { precision: 18, scale: 6 }).notNull().default('1'),
    baseQty: numeric('base_qty', { precision: 18, scale: 4 }).notNull(),
    /** Price per line unit, before discount and GST. */
    rate: numeric('rate', { precision: 18, scale: 4 }).notNull(),
    discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    ...taxLineColumns(),
    deliveryDate: date('delivery_date', { mode: 'string' }),
    requisitionLineId: uuid('requisition_line_id').references(() => purchaseRequisitionLines.id, { onDelete: 'set null' }),
    /** Accepted into stock by approved GRNs (line unit). */
    receivedQty: numeric('received_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    rejectedQty: numeric('rejected_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    remarks: text('remarks'),
  },
  (t) => [index('po_lines_po_idx').on(t.poId), uniqueIndex('po_lines_no_uq').on(t.poId, t.lineNo), index('po_lines_item_idx').on(t.tenantId, t.itemId)],
);

// =============================================================================
// Goods receipt note (document type "goods_receipt")
// =============================================================================

export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    poId: uuid('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'restrict' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    supplierInvoiceNo: text('supplier_invoice_no'),
    supplierInvoiceDate: date('supplier_invoice_date', { mode: 'string' }),
    challanNo: text('challan_no'),
    gateEntryNo: text('gate_entry_no'),
    vehicleNo: text('vehicle_no'),
    transporter: text('transporter'),
    lrNo: text('lr_no'),
    notes: text('notes'),
  },
  (t) => [index('grn_po_idx').on(t.poId), index('grn_vendor_idx').on(t.tenantId, t.vendorId)],
);

export const goodsReceiptLines = pgTable(
  'goods_receipt_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    grnId: uuid('grn_id')
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    poLineId: uuid('po_line_id')
      .notNull()
      .references(() => purchaseOrderLines.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    conversionFactor: numeric('conversion_factor', { precision: 18, scale: 6 }).notNull().default('1'),
    /** Quantities in the PO line's unit. */
    receivedQty: numeric('received_qty', { precision: 18, scale: 4 }).notNull(),
    rejectedQty: numeric('rejected_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    acceptedQty: numeric('accepted_qty', { precision: 18, scale: 4 }).notNull(),
    acceptedBaseQty: numeric('accepted_base_qty', { precision: 18, scale: 4 }).notNull(),
    /** Net rate per line unit from the PO (after discount, before GST). */
    rate: numeric('rate', { precision: 18, scale: 4 }).notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    batchNo: text('batch_no'),
    mfgDate: date('mfg_date', { mode: 'string' }),
    expiryDate: date('expiry_date', { mode: 'string' }),
    serialNos: text('serial_nos').array(),
    rejectionReason: text('rejection_reason'),
    remarks: text('remarks'),
  },
  (t) => [index('grn_lines_grn_idx').on(t.grnId), uniqueIndex('grn_lines_no_uq').on(t.grnId, t.lineNo), index('grn_lines_po_line_idx').on(t.poLineId)],
);
