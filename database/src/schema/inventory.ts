import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext, createdAt, pk } from './_columns';
import { users } from './iam';
import { itemGroups, items, uoms, warehouses } from './masters';
import { documents } from './documents';
import { companies, tenantId } from './tenancy';

// =============================================================================
// Batches & serials
// =============================================================================

export const batches = pgTable(
  'batches',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    batchNo: citext('batch_no').notNull(),
    mfgDate: date('mfg_date', { mode: 'string' }),
    expiryDate: date('expiry_date', { mode: 'string' }),
    /** Supplier's own lot number, for traceability back to the vendor. */
    supplierBatchNo: text('supplier_batch_no'),
    notes: text('notes'),
    /** QC status: quarantine | under_test | released | conditional | rejected. Held lots cannot be issued or sold. */
    qcStatus: text('qc_status').notNull().default('released'),
    qcNote: text('qc_note'),
    qcUpdatedAt: timestamp('qc_updated_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('batches_item_no_uq').on(t.tenantId, t.itemId, t.batchNo), index('batches_expiry_idx').on(t.tenantId, t.expiryDate)],
);

export const serialStatus = pgEnum('serial_status', ['in_stock', 'consumed', 'delivered', 'scrapped']);

export const serialNumbers = pgTable(
  'serial_numbers',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    serialNo: citext('serial_no').notNull(),
    status: serialStatus('status').notNull(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    lastVoucherId: uuid('last_voucher_id'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('serials_item_no_uq').on(t.tenantId, t.itemId, t.serialNo), index('serials_wh_idx').on(t.tenantId, t.itemId, t.warehouseId, t.status)],
);

// =============================================================================
// Valuation & balances
// =============================================================================

export type CostLayer = { qty: string; rate: string };

/**
 * Valuation pool per item + warehouse (locked FOR UPDATE while posting).
 * Weighted average uses qty/value; FIFO also keeps cost layers (oldest first).
 */
export const stockValuation = pgTable(
  'stock_valuation',
  {
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull().default('0'),
    value: numeric('value', { precision: 18, scale: 2 }).notNull().default('0'),
    layers: jsonb('layers').$type<CostLayer[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.warehouseId] }), index('stock_valuation_tenant_idx').on(t.tenantId)],
);

/** Quantity per item + warehouse + batch (batch_key = batch id or the nil UUID). */
export const stockBalances = pgTable(
  'stock_balances',
  {
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    batchKey: uuid('batch_key').notNull(),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.warehouseId, t.batchKey] }), index('stock_balances_tenant_item_idx').on(t.tenantId, t.itemId)],
);

// =============================================================================
// Stock ledger (append-only)
// =============================================================================

/** One row per item movement. Never updated: corrections are reversal rows. */
export const stockLedger = pgTable(
  'stock_ledger',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    postingDate: date('posting_date', { mode: 'string' }).notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'restrict' }),
    serialNos: text('serial_nos').array(),
    /** Signed, in the item's base unit (+ in, − out). */
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    /** Rate per base unit used for this movement. */
    rate: numeric('rate', { precision: 18, scale: 6 }).notNull(),
    /** Signed value of this movement. */
    value: numeric('value', { precision: 18, scale: 2 }).notNull(),
    /** Item + warehouse position after this movement. */
    balanceQty: numeric('balance_qty', { precision: 18, scale: 4 }).notNull(),
    balanceValue: numeric('balance_value', { precision: 18, scale: 2 }).notNull(),
    valuationRate: numeric('valuation_rate', { precision: 18, scale: 6 }).notNull(),
    voucherType: text('voucher_type').notNull(),
    voucherId: uuid('voucher_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    voucherNumber: text('voucher_number'),
    isReversal: boolean('is_reversal').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_ledger_item_wh_idx').on(t.tenantId, t.itemId, t.warehouseId, t.id),
    index('stock_ledger_voucher_idx').on(t.voucherId),
    index('stock_ledger_date_idx').on(t.tenantId, t.postingDate),
    index('stock_ledger_batch_idx').on(t.batchId).where(sql`${t.batchId} is not null`),
  ],
);

// =============================================================================
// Stock entries (document type "stock_entry")
// =============================================================================

export const stockEntryPurpose = pgEnum('stock_entry_purpose', ['opening_stock', 'material_receipt', 'material_issue', 'transfer', 'adjustment']);

export const stockEntries = pgTable('stock_entries', {
  id: uuid('id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  tenantId: tenantId(),
  purpose: stockEntryPurpose('purpose').notNull(),
  fromWarehouseId: uuid('from_warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
  toWarehouseId: uuid('to_warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
  reason: text('reason'),
  reference: text('reference'),
  notes: text('notes'),
});

export const stockEntryLines = pgTable(
  'stock_entry_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => stockEntries.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    /** Quantity in the line's unit (signed for adjustments). */
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    conversionFactor: numeric('conversion_factor', { precision: 18, scale: 6 }).notNull().default('1'),
    baseQty: numeric('base_qty', { precision: 18, scale: 4 }).notNull(),
    /** Rate per line unit for receipts / opening stock / positive adjustments. */
    rate: numeric('rate', { precision: 18, scale: 4 }),
    amount: numeric('amount', { precision: 18, scale: 2 }),
    batchNo: text('batch_no'),
    mfgDate: date('mfg_date', { mode: 'string' }),
    expiryDate: date('expiry_date', { mode: 'string' }),
    serialNos: text('serial_nos').array(),
    remarks: text('remarks'),
    /** Bin, in a warehouse run with bins (counts and dip adjustments post to the exact bin). */
    binId: uuid('bin_id'),
  },
  (t) => [index('stock_entry_lines_entry_idx').on(t.entryId), uniqueIndex('stock_entry_lines_no_uq').on(t.entryId, t.lineNo)],
);

// =============================================================================
// Physical stock count (document type "stock_count")
// =============================================================================

/**
 * A count of one warehouse (optionally one item group). Lines are snapshotted from
 * stock_balances when the count is created; on approval each counted line posts the
 * difference between the counted quantity and the book quantity *at that moment*.
 */
export const stockCounts = pgTable('stock_counts', {
  id: uuid('id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  tenantId: tenantId(),
  warehouseId: uuid('warehouse_id')
    .notNull()
    .references(() => warehouses.id, { onDelete: 'restrict' }),
  itemGroupId: uuid('item_group_id').references(() => itemGroups.id, { onDelete: 'restrict' }),
  /** Hide book quantities from counters until the count is submitted. */
  blind: boolean('blind').notNull().default(false),
  snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
});

export const stockCountLines = pgTable(
  'stock_count_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    countId: uuid('count_id')
      .notNull()
      .references(() => stockCounts.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    batchNo: text('batch_no'),
    mfgDate: date('mfg_date', { mode: 'string' }),
    expiryDate: date('expiry_date', { mode: 'string' }),
    /** Book quantity when the count was created (base unit). */
    systemQty: numeric('system_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    /** Null = not counted yet (ignored when posting). */
    countedQty: numeric('counted_qty', { precision: 18, scale: 4 }),
    /** Filled when posted: book qty at posting, the adjustment and its value. */
    bookQtyAtPosting: numeric('book_qty_at_posting', { precision: 18, scale: 4 }),
    difference: numeric('difference', { precision: 18, scale: 4 }),
    rate: numeric('rate', { precision: 18, scale: 6 }),
    varianceValue: numeric('variance_value', { precision: 18, scale: 2 }),
    remarks: text('remarks'),
  },
  (t) => [index('stock_count_lines_count_idx').on(t.countId), uniqueIndex('stock_count_lines_no_uq').on(t.countId, t.lineNo)],
);
