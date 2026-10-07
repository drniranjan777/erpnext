import { boolean, index, integer, numeric, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { users } from './iam';
import { batches } from './inventory';
import { items, warehouses } from './masters';
import { tenantId } from './tenancy';

/** A warehouse run with bins. Its receiving and dispatch bins are created when WMS is switched on. */
export const wmsWarehouses = pgTable(
  'wms_warehouses',
  {
    id: pk(),
    tenantId: tenantId(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    receivingBinId: uuid('receiving_bin_id'),
    dispatchBinId: uuid('dispatch_bin_id'),
    enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
    enabledBy: uuid('enabled_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('wms_warehouses_wh_uq').on(t.warehouseId)],
);

/**
 * Zones group bins by use (storage, receiving, dispatch, staging, quarantine) and storage
 * condition (ambient, cold, frozen, hazardous, quarantine, bonded).
 */
export const wmsZones = pgTable(
  'wms_zones',
  {
    id: pk(),
    tenantId: tenantId(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('storage'),
    condition: text('condition').notNull().default('ambient'),
    sequence: smallint('sequence').notNull().default(10),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('wms_zones_code_uq').on(t.warehouseId, t.code)],
);

export const wmsBins = pgTable(
  'wms_bins',
  {
    id: pk(),
    tenantId: tenantId(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => wmsZones.id, { onDelete: 'restrict' }),
    /** e.g. A-01-03-2 (aisle-rack-shelf-position). Unique in the warehouse; printed as QR. */
    code: citext('code').notNull(),
    aisle: text('aisle'),
    rack: text('rack'),
    shelf: text('shelf'),
    position: text('position'),
    /** pallet | shelf | floor | bulk | staging */
    binType: text('bin_type').notNull().default('shelf'),
    maxWeightKg: numeric('max_weight_kg', { precision: 12, scale: 3 }),
    maxVolumeM3: numeric('max_volume_m3', { precision: 12, scale: 4 }),
    /** Optional cap in base units when only one item is kept here. */
    maxQty: numeric('max_qty', { precision: 18, scale: 4 }),
    /** Walking order; lower is nearer the dock. Drives put-away (nearest) and pick paths. */
    pickSequence: integer('pick_sequence').notNull().default(1000),
    /** Fixed (home) bin of an item. */
    fixedItemId: uuid('fixed_item_id').references(() => items.id, { onDelete: 'set null' }),
    isBlocked: boolean('is_blocked').notNull().default(false),
    blockReason: text('block_reason'),
    isActive: boolean('is_active').notNull().default(true),
    /** Grid position for the heat map. */
    gridX: smallint('grid_x'),
    gridY: smallint('grid_y'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wms_bins_code_uq').on(t.warehouseId, t.code), index('wms_bins_zone_idx').on(t.zoneId), index('wms_bins_fixed_idx').on(t.tenantId, t.fixedItemId)],
);

/** How an item must be stored, and what one base unit weighs and occupies. */
export const wmsItemProfiles = pgTable(
  'wms_item_profiles',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    condition: text('condition').notNull().default('ambient'),
    /** UN hazard class, e.g. 3, 5.1, 8. */
    hazardClass: text('hazard_class'),
    unitWeightKg: numeric('unit_weight_kg', { precision: 12, scale: 4 }),
    unitVolumeM3: numeric('unit_volume_m3', { precision: 12, scale: 6 }),
    /** A / B / C by issue value (set by the ABC analysis or by hand). */
    abcClass: text('abc_class'),
    /** Least remaining shelf life a customer accepts at dispatch, in days. */
    minShelfLifeDays: smallint('min_shelf_life_days'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wms_item_profiles_item_uq').on(t.itemId)],
);

/** Quantity per bin + item + batch (nil UUID = no batch). Sums to stock_balances per warehouse. */
export const wmsBinStock = pgTable(
  'wms_bin_stock',
  {
    tenantId: tenantId(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    binId: uuid('bin_id')
      .notNull()
      .references(() => wmsBins.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    batchKey: uuid('batch_key').notNull(),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.binId, t.itemId, t.batchKey] }), index('wms_bin_stock_item_idx').on(t.tenantId, t.itemId, t.warehouseId)],
);

/** Every bin movement: from stock postings, reversals, moves, put-away and picks. */
export const wmsBinLedger = pgTable(
  'wms_bin_ledger',
  {
    id: pk(),
    tenantId: tenantId(),
    warehouseId: uuid('warehouse_id').notNull(),
    binId: uuid('bin_id')
      .notNull()
      .references(() => wmsBins.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id').notNull(),
    batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'restrict' }),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    /** posting | reversal | move | putaway | pick | replenish | enable */
    kind: text('kind').notNull(),
    voucherType: text('voucher_type'),
    voucherId: uuid('voucher_id'),
    taskId: uuid('task_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('wms_bin_ledger_voucher_idx').on(t.voucherId), index('wms_bin_ledger_bin_idx').on(t.binId, t.createdAt)],
);

/** Work for the floor: put-away, pick, replenish, move. Confirmed by scanning the bin. */
export const wmsTasks = pgTable(
  'wms_tasks',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** open | done | cancelled */
    status: text('status').notNull().default('open'),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'restrict' }),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    fromBinId: uuid('from_bin_id').references(() => wmsBins.id, { onDelete: 'restrict' }),
    toBinId: uuid('to_bin_id').references(() => wmsBins.id, { onDelete: 'restrict' }),
    /** Why this bin was suggested. */
    reason: text('reason'),
    sourceType: text('source_type'),
    sourceId: uuid('source_id'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    doneQty: numeric('done_qty', { precision: 18, scale: 4 }),
    doneBinId: uuid('done_bin_id').references(() => wmsBins.id, { onDelete: 'restrict' }),
    overrideReason: text('override_reason'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wms_tasks_number_uq').on(t.tenantId, t.number), index('wms_tasks_open_idx').on(t.tenantId, t.warehouseId, t.kind, t.status)],
);
