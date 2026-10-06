import { boolean, char, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { documents } from './documents';
import { items, parties, uoms, warehouses } from './masters';
import { goodsReceipts, purchaseInvoices } from './purchase';
import { type PartyAddressSnapshot } from './sales';
import { companies, tenantId } from './tenancy';

const money = (name: string) => numeric(name, { precision: 18, scale: 2 }).notNull().default('0');
const qty = (name: string) => numeric(name, { precision: 18, scale: 4 }).notNull().default('0');

/** Per-company GST e-compliance settings (`companies.gst_settings`). */
export interface GstSettings {
  /** e-Invoicing applies (aggregate turnover above the notified limit). */
  einvoice?: boolean;
  /** Generate the IRN automatically when an invoice / credit note is approved. */
  autoIrn?: boolean;
  /** e-Way bill needed above this consignment value (₹). */
  ewayThreshold?: number;
}

// =============================================================================
// GSP / IRP / EWB API calls: append-only log of every request and response
// =============================================================================

export const gstApiLogs = pgTable(
  'gst_api_logs',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    /** irn | irn_cancel | ewb | ewb_part_b | ewb_extend | ewb_cancel | ewb_consolidate */
    action: text('action').notNull(),
    provider: text('provider').notNull(),
    ok: boolean('ok').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    request: jsonb('request').$type<Record<string, unknown>>().notNull().default({}),
    response: jsonb('response').$type<Record<string, unknown>>().notNull().default({}),
    attempt: smallint('attempt').notNull().default(1),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('gst_api_logs_doc_idx').on(t.documentId), index('gst_api_logs_tenant_idx').on(t.tenantId, t.createdAt)],
);

// =============================================================================
// e-Way bills (from an invoice, delivery note, job-work challan or credit note)
// =============================================================================

export const ewayBills = pgTable(
  'eway_bills',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    ewbNo: text('ewb_no').notNull(),
    ewbDate: timestamp('ewb_date', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    /** active | cancelled */
    status: text('status').notNull().default('active'),
    /** O = outward, I = inward */
    supplyType: char('supply_type', { length: 1 }).notNull(),
    /** NIC sub-supply type: 1 supply, 2 import, 3 export, 4 job work, 5 for own use, 6 job work returns, 7 sales return, 8 others… */
    subSupplyType: text('sub_supply_type').notNull(),
    /** INV | BIL | BOE | CHL | CNT | OTH */
    docType: text('doc_type').notNull(),
    docNo: text('doc_no').notNull(),
    docDate: date('doc_date', { mode: 'string' }).notNull(),
    fromGstin: text('from_gstin').notNull(),
    fromPincode: text('from_pincode'),
    fromStateCode: char('from_state_code', { length: 2 }),
    toGstin: text('to_gstin').notNull(),
    toPincode: text('to_pincode'),
    toStateCode: char('to_state_code', { length: 2 }),
    totalValue: money('total_value'),
    distanceKm: integer('distance_km').notNull(),
    /** road | rail | air | ship */
    transportMode: text('transport_mode').notNull().default('road'),
    /** R = regular, O = over-dimensional cargo */
    vehicleType: char('vehicle_type', { length: 1 }).notNull().default('R'),
    vehicleNo: text('vehicle_no'),
    transporterId: text('transporter_id'),
    transporterName: text('transporter_name'),
    transDocNo: text('trans_doc_no'),
    transDocDate: date('trans_doc_date', { mode: 'string' }),
    /** Part-B (vehicle) updates: [{vehicleNo, fromPlace, reason, at}] */
    vehicleHistory: jsonb('vehicle_history').$type<{ vehicleNo: string; fromPlace: string; reason: string; at: string }[]>().notNull().default([]),
    extensions: smallint('extensions').notNull().default(0),
    consolidatedNo: text('consolidated_no'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('eway_bills_no_uq').on(t.tenantId, t.ewbNo), index('eway_bills_doc_idx').on(t.documentId), index('eway_bills_date_idx').on(t.tenantId, t.ewbDate)],
);

// =============================================================================
// Job work (sub-contracting) — GST s.143, ITC-04
// =============================================================================

/** Outward challan: material sent to a job worker (doc type "job_work_challan"). */
export const jobWorkChallans = pgTable(
  'job_work_challans',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    jobWorkerId: uuid('job_worker_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    jobWorkerGstin: char('job_worker_gstin', { length: 15 }),
    jobWorkerStateCode: char('job_worker_state_code', { length: 2 }),
    jobWorkerAddress: jsonb('job_worker_address').$type<PartyAddressSnapshot>().notNull().default({}),
    /** Material leaves from here… */
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    /** …and is held (still our stock) at the job worker's virtual warehouse. */
    jobWorkWarehouseId: uuid('job_work_warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    process: text('process').notNull(),
    expectedReturnDate: date('expected_return_date', { mode: 'string' }),
    transporter: text('transporter'),
    vehicleNo: text('vehicle_no'),
    totalValue: money('total_value'),
    ewayBillNo: text('eway_bill_no'),
    notes: text('notes'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [index('jwc_worker_idx').on(t.tenantId, t.jobWorkerId)],
);

export const jobWorkChallanLines = pgTable(
  'job_work_challan_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    challanId: uuid('challan_id')
      .notNull()
      .references(() => jobWorkChallans.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    /** Value per unit declared on the challan (defaults to stock cost). */
    rate: numeric('rate', { precision: 18, scale: 4 }).notNull(),
    value: money('value'),
    hsnCode: text('hsn_code'),
    gstRate: numeric('gst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    /** inputs (back within 1 year) | capital_goods (3 years) */
    goodsType: text('goods_type').notNull().default('inputs'),
    batchNo: text('batch_no'),
    /** Stock value that left, set on posting. */
    costValue: money('cost_value'),
    consumedQty: qty('consumed_qty'),
    returnedQty: qty('returned_qty'),
    lossQty: qty('loss_qty'),
  },
  (t) => [index('jwc_lines_c_idx').on(t.challanId), uniqueIndex('jwc_lines_no_uq').on(t.challanId, t.lineNo)],
);

/** Goods back from the job worker against a challan (doc type "job_work_receipt"). */
export const jobWorkReceipts = pgTable(
  'job_work_receipts',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    challanId: uuid('challan_id')
      .notNull()
      .references(() => jobWorkChallans.id, { onDelete: 'restrict' }),
    jobWorkerId: uuid('job_worker_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    /** The job worker's own challan / invoice reference (ITC-04 table 5A). */
    jwChallanNo: text('jw_challan_no'),
    jwChallanDate: date('jw_challan_date', { mode: 'string' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    natureOfJob: text('nature_of_job'),
    /** Processing charges, added to the value of what comes back. */
    jobCharges: money('job_charges'),
    notes: text('notes'),
  },
  (t) => [index('jwr_challan_idx').on(t.challanId)],
);

export const jobWorkReceiptLines = pgTable(
  'job_work_receipt_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => jobWorkReceipts.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    /** output = processed goods received; material = settlement of a challan line */
    kind: text('kind').notNull(),
    challanLineId: uuid('challan_line_id').references(() => jobWorkChallanLines.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    /** output: quantity received. */
    qty: qty('qty'),
    /** material: consumed in processing / returned unprocessed / lost (process loss, scrap). */
    consumedQty: qty('consumed_qty'),
    returnedQty: qty('returned_qty'),
    lossQty: qty('loss_qty'),
    batchNo: text('batch_no'),
    value: money('value'),
  },
  (t) => [index('jwr_lines_r_idx').on(t.receiptId), uniqueIndex('jwr_lines_no_uq').on(t.receiptId, t.lineNo)],
);

// =============================================================================
// Bill of Entry (imports): customs duty and import IGST (doc type "bill_of_entry")
// =============================================================================

export const billsOfEntry = pgTable(
  'bills_of_entry',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    boeNo: text('boe_no').notNull(),
    boeDate: date('boe_date', { mode: 'string' }).notNull(),
    portCode: text('port_code').notNull(),
    /** home (home consumption) | warehouse | ex_bond */
    boeType: text('boe_type').notNull().default('home'),
    purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'restrict' }),
    /** GRN of the goods: duty (BCD + SWS) is added to their stock value. */
    goodsReceiptId: uuid('goods_receipt_id').references(() => goodsReceipts.id, { onDelete: 'restrict' }),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull(),
    assessableTotal: money('assessable_total'),
    bcdTotal: money('bcd_total'),
    swsTotal: money('sws_total'),
    igstTotal: money('igst_total'),
    cessTotal: money('cess_total'),
    dutyTotal: money('duty_total'),
    /** Part of the duty absorbed into stock on hand (the rest was already consumed). */
    capitalised: money('capitalised'),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('boe_no_uq').on(t.tenantId, t.portCode, t.boeNo), index('boe_vendor_idx').on(t.tenantId, t.vendorId)],
);

export const billOfEntryLines = pgTable(
  'bill_of_entry_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    boeId: uuid('boe_id')
      .notNull()
      .references(() => billsOfEntry.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    hsnCode: text('hsn_code'),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    /** Invoice value in the foreign currency. */
    foreignValue: numeric('foreign_value', { precision: 18, scale: 2 }).notNull().default('0'),
    assessableValue: money('assessable_value'),
    bcdRate: numeric('bcd_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    bcdAmount: money('bcd_amount'),
    swsRate: numeric('sws_rate', { precision: 5, scale: 2 }).notNull().default('10'),
    swsAmount: money('sws_amount'),
    igstRate: numeric('igst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    igstAmount: money('igst_amount'),
    cessRate: numeric('cess_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    cessAmount: money('cess_amount'),
  },
  (t) => [index('boe_lines_b_idx').on(t.boeId), uniqueIndex('boe_lines_no_uq').on(t.boeId, t.lineNo)],
);
