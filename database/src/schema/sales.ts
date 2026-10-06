import { boolean, char, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { documents } from './documents';
import { items, parties, priceLists, uoms, warehouses } from './masters';
import { taxHeaderColumns, taxLineColumns } from './purchase';
import { type Address, tenantId } from './tenancy';

const money = (name: string) => numeric(name, { precision: 18, scale: 2 }).notNull().default('0');
const qty = (name: string) => numeric(name, { precision: 18, scale: 4 }).notNull().default('0');

export type PartyAddressSnapshot = Address & { line2?: string; name?: string; gstin?: string | null };

/** Customer details as at the document (prints the same after the master changes). */
const customerSnapshot = () => ({
  customerId: uuid('customer_id')
    .notNull()
    .references(() => parties.id, { onDelete: 'restrict' }),
  customerGstin: char('customer_gstin', { length: 15 }),
  customerStateCode: char('customer_state_code', { length: 2 }),
  customerRegistration: text('customer_registration').notNull(),
  billingAddress: jsonb('billing_address').$type<PartyAddressSnapshot>().notNull().default({}),
  shippingAddress: jsonb('shipping_address').$type<PartyAddressSnapshot>().notNull().default({}),
  /** Exports / SEZ under LUT or bond: zero-rated. */
  withLut: boolean('with_lut').notNull().default(false),
});

/** e-Invoice (IRN) registration of an invoice or credit note. */
const einvoiceColumns = () => ({
  irn: text('irn'),
  ackNo: text('ack_no'),
  ackDate: timestamp('ack_date', { withTimezone: true }),
  signedQr: text('signed_qr'),
  /** pending (auto-generation queued / failed) | generated | cancelled */
  irnStatus: text('irn_status'),
  irnError: text('irn_error'),
  irnCancelledAt: timestamp('irn_cancelled_at', { withTimezone: true }),
});

/** Selling line: list price, the price given, discount, cost at the time (for margin). */
const sellingLine = () => ({
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
  /** Price list rate per line unit (before discount). */
  listRate: numeric('list_rate', { precision: 18, scale: 4 }),
  rate: numeric('rate', { precision: 18, scale: 4 }).notNull(),
  discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  ...taxLineColumns(),
  /** Cost per line unit when priced (valuation rate or standard cost). */
  unitCost: numeric('unit_cost', { precision: 18, scale: 4 }),
  remarks: text('remarks'),
});

/** Commercial summary kept on quotations and orders. */
const commercial = () => ({
  priceListId: uuid('price_list_id').references(() => priceLists.id, { onDelete: 'set null' }),
  paymentTerms: text('payment_terms'),
  creditDays: integer('credit_days'),
  terms: text('terms'),
  notes: text('notes'),
  costTotal: money('cost_total'),
  marginPct: numeric('margin_pct', { precision: 7, scale: 2 }),
  /** Largest discount below list price on any line, %. Approval rules can use it. */
  maxDiscountPct: numeric('max_discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
});

// =============================================================================
// Quotation (document type "sales_quotation")
// =============================================================================

export const salesQuotations = pgTable(
  'sales_quotations',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    ...customerSnapshot(),
    validUntil: date('valid_until', { mode: 'string' }),
    customerEnquiryRef: text('customer_enquiry_ref'),
    ...commercial(),
    ...taxHeaderColumns(),
  },
  (t) => [index('sq_customer_idx').on(t.tenantId, t.customerId)],
);

export const salesQuotationLines = pgTable(
  'sales_quotation_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => salesQuotations.id, { onDelete: 'cascade' }),
    ...sellingLine(),
  },
  (t) => [index('sq_lines_q_idx').on(t.quotationId), uniqueIndex('sq_lines_no_uq').on(t.quotationId, t.lineNo)],
);

// =============================================================================
// Sales order (document type "sales_order")
// =============================================================================

export const salesOrders = pgTable(
  'sales_orders',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    ...customerSnapshot(),
    quotationId: uuid('quotation_id').references(() => salesQuotations.id, { onDelete: 'set null' }),
    customerPoNo: text('customer_po_no'),
    customerPoDate: date('customer_po_date', { mode: 'string' }),
    /** Dispatch from. */
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    expectedDate: date('expected_date', { mode: 'string' }),
    ...commercial(),
    ...taxHeaderColumns(),
    /** Exposure at submission: outstanding, open orders, limit, overdue. */
    creditCheck: jsonb('credit_check').$type<Record<string, unknown>>(),
    creditOverrideReason: text('credit_override_reason'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closeReason: text('close_reason'),
  },
  (t) => [index('so_customer_idx').on(t.tenantId, t.customerId)],
);

export const salesOrderLines = pgTable(
  'sales_order_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => salesOrders.id, { onDelete: 'cascade' }),
    ...sellingLine(),
    deliveryDate: date('delivery_date', { mode: 'string' }),
    quotationLineId: uuid('quotation_line_id').references(() => salesQuotationLines.id, { onDelete: 'set null' }),
    /** Line unit. */
    deliveredQty: qty('delivered_qty'),
    invoicedQty: qty('invoiced_qty'),
  },
  (t) => [index('so_lines_o_idx').on(t.orderId), uniqueIndex('so_lines_no_uq').on(t.orderId, t.lineNo), index('so_lines_item_idx').on(t.tenantId, t.itemId)],
);

// =============================================================================
// Delivery note / challan (document type "delivery_note")
// =============================================================================

export const deliveryNotes = pgTable(
  'delivery_notes',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => salesOrders.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    shippingAddress: jsonb('shipping_address').$type<PartyAddressSnapshot>().notNull().default({}),
    transporter: text('transporter'),
    transporterGstin: char('transporter_gstin', { length: 15 }),
    vehicleNo: text('vehicle_no'),
    lrNo: text('lr_no'),
    lrDate: date('lr_date', { mode: 'string' }),
    distanceKm: integer('distance_km'),
    packages: integer('packages'),
    grossWeightKg: numeric('gross_weight_kg', { precision: 12, scale: 3 }),
    netWeightKg: numeric('net_weight_kg', { precision: 12, scale: 3 }),
    /** Proof of delivery. */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    podNote: text('pod_note'),
    notes: text('notes'),
  },
  (t) => [index('dlv_order_idx').on(t.orderId)],
);

export const deliveryNoteLines = pgTable(
  'delivery_note_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveryNotes.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    soLineId: uuid('so_line_id')
      .notNull()
      .references(() => salesOrderLines.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    conversionFactor: numeric('conversion_factor', { precision: 18, scale: 6 }).notNull().default('1'),
    baseQty: numeric('base_qty', { precision: 18, scale: 4 }).notNull(),
    batchNo: text('batch_no'),
    serialNos: text('serial_nos').array(),
    /** Stock value that left (cost of goods), set on posting. */
    costValue: money('cost_value'),
    invoicedQty: qty('invoiced_qty'),
    remarks: text('remarks'),
  },
  (t) => [index('dlv_lines_d_idx').on(t.deliveryId), uniqueIndex('dlv_lines_no_uq').on(t.deliveryId, t.lineNo), index('dlv_lines_so_idx').on(t.soLineId)],
);

// =============================================================================
// Sales invoice (document type "sales_invoice")
// =============================================================================

export const salesInvoices = pgTable(
  'sales_invoices',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    ...customerSnapshot(),
    orderId: uuid('order_id').references(() => salesOrders.id, { onDelete: 'restrict' }),
    customerPoNo: text('customer_po_no'),
    customerPoDate: date('customer_po_date', { mode: 'string' }),
    /** For lines invoiced without a delivery note, stock leaves from here. */
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    paymentTerms: text('payment_terms'),
    creditDays: integer('credit_days'),
    dueDate: date('due_date', { mode: 'string' }),
    ...taxHeaderColumns(),
    costTotal: money('cost_total'),
    receivedAmount: money('received_amount'),
    /** Approved credit notes against this invoice. */
    creditedAmount: money('credited_amount'),
    // Dispatch details (invoice-cum-challan)
    transporter: text('transporter'),
    vehicleNo: text('vehicle_no'),
    lrNo: text('lr_no'),
    // e-Invoice / e-Way Bill
    ...einvoiceColumns(),
    ewayBillNo: text('eway_bill_no'),
    ewayBillDate: timestamp('eway_bill_date', { withTimezone: true }),
    ewayValidUntil: timestamp('eway_valid_until', { withTimezone: true }),
    terms: text('terms'),
    notes: text('notes'),
  },
  (t) => [index('si_customer_idx').on(t.tenantId, t.customerId), index('si_due_idx').on(t.tenantId, t.dueDate)],
);

export const salesInvoiceLines = pgTable(
  'sales_invoice_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => salesInvoices.id, { onDelete: 'cascade' }),
    ...sellingLine(),
    soLineId: uuid('so_line_id').references(() => salesOrderLines.id, { onDelete: 'restrict' }),
    dlvLineId: uuid('dlv_line_id').references(() => deliveryNoteLines.id, { onDelete: 'restrict' }),
    batchNo: text('batch_no'),
    serialNos: text('serial_nos').array(),
    costValue: money('cost_value'),
    returnedQty: qty('returned_qty'),
  },
  (t) => [index('si_lines_i_idx').on(t.invoiceId), uniqueIndex('si_lines_no_uq').on(t.invoiceId, t.lineNo), index('si_lines_dlv_idx').on(t.dlvLineId)],
);

// =============================================================================
// Credit note / sales return (document type "credit_note")
// =============================================================================

export const creditNotes = pgTable(
  'credit_notes',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => salesInvoices.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    /** return | price_adjustment (same enum values as debit notes). */
    kind: text('kind').notNull(),
    /** Returned goods come into this warehouse (quarantine for inspection, scrap...). */
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    ...taxHeaderColumns(),
    ...einvoiceColumns(),
    notes: text('notes'),
  },
  (t) => [index('cn_invoice_idx').on(t.invoiceId)],
);

export const creditNoteLines = pgTable(
  'credit_note_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    creditNoteId: uuid('credit_note_id')
      .notNull()
      .references(() => creditNotes.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    invoiceLineId: uuid('invoice_line_id')
      .notNull()
      .references(() => salesInvoiceLines.id, { onDelete: 'restrict' }),
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
    ...taxLineColumns(),
    batchNo: text('batch_no'),
    serialNos: text('serial_nos').array(),
    remarks: text('remarks'),
  },
  (t) => [index('cn_lines_cn_idx').on(t.creditNoteId), uniqueIndex('cn_lines_no_uq').on(t.creditNoteId, t.lineNo)],
);
