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
    /** Import orders / bills: rates entered in this currency, converted to INR at the exchange rate. */
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1'),
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
    /** Rate in the order's foreign currency (import orders). */
    foreignRate: numeric('foreign_rate', { precision: 18, scale: 4 }),
    discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    ...taxLineColumns(),
    deliveryDate: date('delivery_date', { mode: 'string' }),
    requisitionLineId: uuid('requisition_line_id').references(() => purchaseRequisitionLines.id, { onDelete: 'set null' }),
    /** Accepted into stock by approved GRNs (line unit). */
    receivedQty: numeric('received_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    rejectedQty: numeric('rejected_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    /** Billed on approved purchase invoices (line unit). */
    billedQty: numeric('billed_qty', { precision: 18, scale: 4 }).notNull().default('0'),
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
    /** Accepted quantity billed on approved purchase invoices (line unit). */
    billedQty: numeric('billed_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    remarks: text('remarks'),
  },
  (t) => [index('grn_lines_grn_idx').on(t.grnId), uniqueIndex('grn_lines_no_uq').on(t.grnId, t.lineNo), index('grn_lines_po_line_idx').on(t.poLineId)],
);

// =============================================================================
// Approved vendor list (item ↔ vendor)
// =============================================================================

export const itemVendors = pgTable(
  'item_vendors',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    isApproved: boolean('is_approved').notNull().default(true),
    isPreferred: boolean('is_preferred').notNull().default(false),
    vendorItemCode: text('vendor_item_code'),
    leadTimeDays: integer('lead_time_days'),
    minOrderQty: numeric('min_order_qty', { precision: 18, scale: 4 }),
    /** Net rate per base unit on the last approved PO from this vendor. */
    lastRate: numeric('last_rate', { precision: 18, scale: 4 }),
    lastOrderedAt: date('last_ordered_at', { mode: 'string' }),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('item_vendors_uq').on(t.tenantId, t.itemId, t.vendorId), index('item_vendors_vendor_idx').on(t.tenantId, t.vendorId)],
);

// =============================================================================
// Purchase invoice (document type "purchase_invoice")
// =============================================================================

export const matchType = pgEnum('match_type', ['three_way', 'two_way', 'none']);

export const purchaseInvoices = pgTable(
  'purchase_invoices',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    vendorGstin: char('vendor_gstin', { length: 15 }),
    vendorStateCode: char('vendor_state_code', { length: 2 }),
    vendorRegistration: text('vendor_registration').notNull(),
    /** MSME category at the time of the bill (micro / small bills must be paid within 45 days). */
    vendorMsme: text('vendor_msme'),
    supplierInvoiceNo: text('supplier_invoice_no').notNull(),
    supplierInvoiceDate: date('supplier_invoice_date', { mode: 'string' }).notNull(),
    poId: uuid('po_id').references(() => purchaseOrders.id, { onDelete: 'restrict' }),
    /** Import orders / bills: rates entered in this currency, converted to INR at the exchange rate. */
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1'),
    /** Captured from an uploaded bill (OCR / AI): file name, extractor, confidence, warnings. */
    capture: jsonb('capture').$type<Record<string, unknown>>(),
    matchType: matchType('match_type').notNull().default('none'),
    ...taxHeaderColumns(),
    /** GST we can claim as input tax credit, and what we can't (it becomes part of the cost). */
    itcEligibleTax: money('itc_eligible_tax'),
    itcIneligibleTax: money('itc_ineligible_tax'),
    tdsSection: text('tds_section'),
    tdsRate: numeric('tds_rate', { precision: 5, scale: 3 }).notNull().default('0'),
    tdsAmount: money('tds_amount'),
    /** Grand total less TDS: what is owed to the vendor. */
    netPayable: money('net_payable'),
    dueDate: date('due_date', { mode: 'string' }),
    /** Rate differences against the PO larger than this need an explanation. */
    rateTolerancePct: numeric('rate_tolerance_pct', { precision: 5, scale: 2 }).notNull().default('1'),
    rateVariance: money('rate_variance'),
    varianceNote: text('variance_note'),
    /** Amount settled (payments arrive with accounting in Phase 4). */
    paidAmount: money('paid_amount'),
    notes: text('notes'),
  },
  (t) => [index('pi_vendor_idx').on(t.tenantId, t.vendorId), index('pi_supplier_no_idx').on(t.tenantId, t.vendorId, t.supplierInvoiceNo), index('pi_due_idx').on(t.tenantId, t.dueDate)],
);

export const purchaseInvoiceLines = pgTable(
  'purchase_invoice_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    piId: uuid('pi_id')
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: 'cascade' }),
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
    rate: numeric('rate', { precision: 18, scale: 4 }).notNull(),
    foreignRate: numeric('foreign_rate', { precision: 18, scale: 4 }),
    discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    ...taxLineColumns(),
    itcEligible: boolean('itc_eligible').notNull().default(true),
    poLineId: uuid('po_line_id').references(() => purchaseOrderLines.id, { onDelete: 'restrict' }),
    grnLineId: uuid('grn_line_id').references(() => goodsReceiptLines.id, { onDelete: 'restrict' }),
    /** Net rate per line unit we expected (PO / GRN). */
    expectedRate: numeric('expected_rate', { precision: 18, scale: 4 }),
    /** Taxable value minus qty × expected rate. */
    rateVariance: money('rate_variance'),
    returnedQty: numeric('returned_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    remarks: text('remarks'),
  },
  (t) => [index('pi_lines_pi_idx').on(t.piId), uniqueIndex('pi_lines_no_uq').on(t.piId, t.lineNo), index('pi_lines_grn_idx').on(t.grnLineId), index('pi_lines_po_idx').on(t.poLineId)],
);

// =============================================================================
// Debit note / purchase return (document type "debit_note")
// =============================================================================

export const debitNoteKind = pgEnum('debit_note_kind', ['return', 'price_adjustment']);

export const debitNotes = pgTable(
  'debit_notes',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    piId: uuid('pi_id')
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: 'restrict' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    kind: debitNoteKind('kind').notNull(),
    /** Goods go out of this warehouse on a return. */
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    vehicleNo: text('vehicle_no'),
    ...taxHeaderColumns(),
    notes: text('notes'),
  },
  (t) => [index('dn_pi_idx').on(t.piId)],
);

export const debitNoteLines = pgTable(
  'debit_note_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    dnId: uuid('dn_id')
      .notNull()
      .references(() => debitNotes.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    piLineId: uuid('pi_line_id')
      .notNull()
      .references(() => purchaseInvoiceLines.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    /** Returned quantity (0 for a pure price adjustment). */
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    conversionFactor: numeric('conversion_factor', { precision: 18, scale: 6 }).notNull().default('1'),
    baseQty: numeric('base_qty', { precision: 18, scale: 4 }).notNull(),
    rate: numeric('rate', { precision: 18, scale: 4 }).notNull(),
    ...taxLineColumns(),
    batchNo: text('batch_no'),
    serialNos: text('serial_nos').array(),
    remarks: text('remarks'),
  },
  (t) => [index('dn_lines_dn_idx').on(t.dnId), uniqueIndex('dn_lines_no_uq').on(t.dnId, t.lineNo)],
);

// =============================================================================
// Landed cost voucher (document type "landed_cost")
// =============================================================================

export const allocationMethod = pgEnum('allocation_method', ['value', 'qty', 'weight']);

export const landedCosts = pgTable('landed_costs', {
  id: uuid('id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  tenantId: tenantId(),
  method: allocationMethod('method').notNull().default('value'),
  totalCharges: money('total_charges'),
  /** Part of the charges on stock that had already been issued (expensed, not added to stock). */
  unabsorbed: money('unabsorbed'),
  notes: text('notes'),
});

export const landedCostReceipts = pgTable(
  'landed_cost_receipts',
  {
    tenantId: tenantId(),
    landedCostId: uuid('landed_cost_id')
      .notNull()
      .references(() => landedCosts.id, { onDelete: 'cascade' }),
    grnId: uuid('grn_id')
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: 'restrict' }),
  },
  (t) => [uniqueIndex('lc_receipts_uq').on(t.landedCostId, t.grnId), index('lc_receipts_grn_idx').on(t.grnId)],
);

export const landedCostCharges = pgTable(
  'landed_cost_charges',
  {
    id: pk(),
    tenantId: tenantId(),
    landedCostId: uuid('landed_cost_id')
      .notNull()
      .references(() => landedCosts.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    chargeType: text('charge_type').notNull(),
    description: text('description'),
    /** Who billed the charge (transporter, CHA...). */
    vendorId: uuid('vendor_id').references(() => parties.id, { onDelete: 'restrict' }),
    billRef: text('bill_ref'),
    amount: money('amount'),
  },
  (t) => [index('lc_charges_lc_idx').on(t.landedCostId)],
);

export const landedCostAllocations = pgTable(
  'landed_cost_allocations',
  {
    id: pk(),
    tenantId: tenantId(),
    landedCostId: uuid('landed_cost_id')
      .notNull()
      .references(() => landedCosts.id, { onDelete: 'cascade' }),
    grnLineId: uuid('grn_line_id')
      .notNull()
      .references(() => goodsReceiptLines.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    /** Value, quantity or weight the share was based on. */
    basis: numeric('basis', { precision: 18, scale: 4 }).notNull(),
    amount: money('amount'),
    absorbed: money('absorbed'),
    unabsorbed: money('unabsorbed'),
  },
  (t) => [index('lc_alloc_lc_idx').on(t.landedCostId)],
);

// =============================================================================
// Request for quotation (document type "rfq")
// =============================================================================

export const rfqs = pgTable('rfqs', {
  id: uuid('id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  tenantId: tenantId(),
  responseDueDate: date('response_due_date', { mode: 'string' }),
  deliveryWarehouseId: uuid('delivery_warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
  terms: text('terms'),
  notes: text('notes'),
  awardedAt: timestamp('awarded_at', { withTimezone: true }),
});

export const rfqLines = pgTable(
  'rfq_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    rfqId: uuid('rfq_id')
      .notNull()
      .references(() => rfqs.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    requiredBy: date('required_by', { mode: 'string' }),
    requisitionLineId: uuid('requisition_line_id').references(() => purchaseRequisitionLines.id, { onDelete: 'set null' }),
    awardedVendorId: uuid('awarded_vendor_id').references(() => parties.id, { onDelete: 'restrict' }),
    /** PO created from the award. */
    poId: uuid('po_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
  },
  (t) => [index('rfq_lines_rfq_idx').on(t.rfqId), uniqueIndex('rfq_lines_no_uq').on(t.rfqId, t.lineNo)],
);

export const rfqVendors = pgTable(
  'rfq_vendors',
  {
    id: pk(),
    tenantId: tenantId(),
    rfqId: uuid('rfq_id')
      .notNull()
      .references(() => rfqs.id, { onDelete: 'cascade' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    quoteRef: text('quote_ref'),
    quoteDate: date('quote_date', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    paymentTerms: text('payment_terms'),
    creditDays: integer('credit_days'),
    deliveryTerms: text('delivery_terms'),
    /** Freight etc. quoted on top of the item rates. */
    otherCharges: numeric('other_charges', { precision: 18, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('rfq_vendors_uq').on(t.rfqId, t.vendorId)],
);

export const rfqQuotes = pgTable(
  'rfq_quotes',
  {
    id: pk(),
    tenantId: tenantId(),
    rfqVendorId: uuid('rfq_vendor_id')
      .notNull()
      .references(() => rfqVendors.id, { onDelete: 'cascade' }),
    rfqLineId: uuid('rfq_line_id')
      .notNull()
      .references(() => rfqLines.id, { onDelete: 'cascade' }),
    rate: numeric('rate', { precision: 18, scale: 4 }).notNull(),
    discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    gstRate: numeric('gst_rate', { precision: 5, scale: 2 }),
    leadTimeDays: integer('lead_time_days'),
    remarks: text('remarks'),
  },
  (t) => [uniqueIndex('rfq_quotes_uq').on(t.rfqVendorId, t.rfqLineId)],
);
