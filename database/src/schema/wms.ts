import { boolean, index, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { users } from './iam';
import { batches } from './inventory';
import { documents } from './documents';
import { items, parties, warehouses } from './masters';
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
    /** Pick face of its fixed item: topped up from reserve below min, up to max. */
    replenMin: numeric('replen_min', { precision: 18, scale: 4 }),
    replenMax: numeric('replen_max', { precision: 18, scale: 4 }),
    lastCountedAt: timestamp('last_counted_at', { withTimezone: true }),
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
    /** Moisture sensitivity level (J-STD-033): 1, 2, 2a, 3, 4, 5, 5a, 6. */
    mslLevel: text('msl_level'),
    /** 3PL: the client who owns this item (goods we store for them, kept at no value in our books). */
    ownerPartyId: uuid('owner_party_id').references(() => parties.id, { onDelete: 'set null' }),
    /** Base units on one pallet, for pallet-day storage billing. */
    unitsPerPallet: numeric('units_per_pallet', { precision: 12, scale: 3 }),
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
    /** Picks: the wave and sales order they serve, and the walking order within the wave. */
    waveId: uuid('wave_id'),
    orderId: uuid('order_id').references(() => documents.id, { onDelete: 'set null' }),
    pathSeq: integer('path_seq'),
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

/** Workspace-level WMS settings: the GS1 company prefix used for SSCC carton numbers. */
export const wmsSettings = pgTable(
  'wms_settings',
  {
    id: pk(),
    tenantId: tenantId(),
    gs1Prefix: text('gs1_prefix'),
    ssccExtension: smallint('sscc_extension').notNull().default(0),
    /** Days between counts of a bin holding A, B or C items. */
    countDaysA: smallint('count_days_a').notNull().default(30),
    countDaysB: smallint('count_days_b').notNull().default(90),
    countDaysC: smallint('count_days_c').notNull().default(180),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wms_settings_tenant_uq').on(t.tenantId)],
);

export const wmsDockDoors = pgTable(
  'wms_dock_doors',
  {
    id: pk(),
    tenantId: tenantId(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** inbound | outbound | both */
    direction: text('direction').notNull().default('both'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('wms_dock_doors_code_uq').on(t.warehouseId, t.code)],
);

/** A booked slot at a dock door for a vehicle to unload or load. */
export const wmsAppointments = pgTable(
  'wms_appointments',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    doorId: uuid('door_id')
      .notNull()
      .references(() => wmsDockDoors.id, { onDelete: 'restrict' }),
    direction: text('direction').notNull(),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'set null' }),
    /** Purchase order (inbound) or sales order / delivery (outbound). */
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    reference: text('reference'),
    vehicleNo: text('vehicle_no'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** booked | arrived | in_progress | done | no_show | cancelled */
    status: text('status').notNull().default('booked'),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wms_appointments_number_uq').on(t.tenantId, t.number), index('wms_appointments_door_idx').on(t.doorId, t.startsAt)],
);

/** A group of sales orders picked together (by order, as a batch, or by zone). */
export const wmsWaves = pgTable(
  'wms_waves',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    /** order | batch | zone */
    mode: text('mode').notNull().default('order'),
    /** open | picked | cancelled */
    status: text('status').notNull().default('open'),
    orderIds: uuid('order_ids').array().notNull(),
    /** Quantities that could not be allocated: [{orderId, soLineId, itemId, short, why}]. */
    shortages: jsonb('shortages').$type<{ orderId: string; soLineId: string; itemId: string; short: string; why: string }[]>().notNull().default([]),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wms_waves_number_uq').on(t.tenantId, t.number)],
);

/** A carton or pallet packed for one sales order, numbered with a GS1 SSCC. */
export const wmsPackages = pgTable(
  'wms_packages',
  {
    id: pk(),
    tenantId: tenantId(),
    sscc: text('sscc').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    waveId: uuid('wave_id').references(() => wmsWaves.id, { onDelete: 'set null' }),
    deliveryId: uuid('delivery_id').references(() => documents.id, { onDelete: 'set null' }),
    /** carton | pallet */
    kind: text('kind').notNull().default('carton'),
    contents: jsonb('contents').$type<{ itemId: string; batchId: string | null; qty: string }[]>().notNull().default([]),
    grossWeightKg: numeric('gross_weight_kg', { precision: 12, scale: 3 }),
    /** open | closed | loaded */
    status: text('status').notNull().default('open'),
    vehicleNo: text('vehicle_no'),
    loadedAt: timestamp('loaded_at', { withTimezone: true }),
    loadedBy: uuid('loaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('wms_packages_sscc_uq').on(t.tenantId, t.sscc), index('wms_packages_order_idx').on(t.tenantId, t.orderId)],
);

/** A count of chosen bins (cycle count by ABC, or ad hoc). Differences post as an adjustment to those bins. */
export const wmsBinCounts = pgTable(
  'wms_bin_counts',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    /** cycle | adhoc */
    kind: text('kind').notNull().default('cycle'),
    /** open | posted | cancelled */
    status: text('status').notNull().default('open'),
    blind: boolean('blind').notNull().default(true),
    entryId: uuid('entry_id').references(() => documents.id, { onDelete: 'set null' }),
    accuracyPct: numeric('accuracy_pct', { precision: 5, scale: 2 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('wms_bin_counts_number_uq').on(t.tenantId, t.number)],
);

export const wmsBinCountLines = pgTable(
  'wms_bin_count_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    countId: uuid('count_id')
      .notNull()
      .references(() => wmsBinCounts.id, { onDelete: 'cascade' }),
    binId: uuid('bin_id')
      .notNull()
      .references(() => wmsBins.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    batchKey: uuid('batch_key').notNull(),
    /** Batch number found in the bin but not in the books. */
    newBatchNo: text('new_batch_no'),
    systemQty: numeric('system_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    countedQty: numeric('counted_qty', { precision: 18, scale: 4 }),
    countedBy: uuid('counted_by').references(() => users.id, { onDelete: 'set null' }),
    countedAt: timestamp('counted_at', { withTimezone: true }),
  },
  (t) => [index('wms_bin_count_lines_count_idx').on(t.countId)],
);

/** A tank or silo: a bin holding one bulk item, measured by dipping against a calibration chart. */
export const wmsTanks = pgTable(
  'wms_tanks',
  {
    id: pk(),
    tenantId: tenantId(),
    binId: uuid('bin_id')
      .notNull()
      .references(() => wmsBins.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    capacityLitres: numeric('capacity_litres', { precision: 14, scale: 2 }).notNull(),
    /** Stock is kept in litres, or in kg converted with the density. */
    stockUnit: text('stock_unit').notNull().default('litre'),
    densityKgPerL: numeric('density_kg_per_l', { precision: 8, scale: 4 }),
    /** Dip (mm) to volume (litres) points, ascending. */
    calibration: jsonb('calibration').$type<{ mm: number; litres: number }[]>().notNull(),
    tolerancePct: numeric('tolerance_pct', { precision: 5, scale: 2 }).notNull().default('0.5'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wms_tanks_bin_uq').on(t.binId)],
);

export const wmsDips = pgTable(
  'wms_dips',
  {
    id: pk(),
    tenantId: tenantId(),
    tankId: uuid('tank_id')
      .notNull()
      .references(() => wmsTanks.id, { onDelete: 'cascade' }),
    dipMm: numeric('dip_mm', { precision: 10, scale: 1 }).notNull(),
    temperatureC: numeric('temperature_c', { precision: 5, scale: 1 }),
    litres: numeric('litres', { precision: 14, scale: 2 }).notNull(),
    measuredQty: numeric('measured_qty', { precision: 18, scale: 4 }).notNull(),
    bookQty: numeric('book_qty', { precision: 18, scale: 4 }).notNull(),
    variance: numeric('variance', { precision: 18, scale: 4 }).notNull(),
    withinTolerance: boolean('within_tolerance').notNull(),
    entryId: uuid('entry_id').references(() => documents.id, { onDelete: 'set null' }),
    readBy: uuid('read_by').references(() => users.id, { onDelete: 'set null' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('wms_dips_tank_idx').on(t.tankId, t.readAt)],
);

/** Drums, pallets, crates and bins that go out with goods and should come back. */
export const wmsReturnableTypes = pgTable(
  'wms_returnable_types',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    depositAmount: numeric('deposit_amount', { precision: 12, scale: 2 }),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('wms_returnable_types_code_uq').on(t.tenantId, t.code)],
);

/** Positive: sent to the party; negative: returned by the party. */
export const wmsReturnableMoves = pgTable(
  'wms_returnable_moves',
  {
    id: pk(),
    tenantId: tenantId(),
    typeId: uuid('type_id')
      .notNull()
      .references(() => wmsReturnableTypes.id, { onDelete: 'restrict' }),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    date: text('date').notNull(),
    reference: text('reference'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('wms_returnable_moves_party_idx').on(t.tenantId, t.partyId, t.typeId)],
);

/** A reel (or tray / tube) of moisture-sensitive parts, with its floor-life clock. */
export const wmsReels = pgTable(
  'wms_reels',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),
    binId: uuid('bin_id').references(() => wmsBins.id, { onDelete: 'set null' }),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    mslLevel: text('msl_level'),
    /** Floor life used, in minutes, up to the last time the reel was sealed. */
    exposedMinutes: integer('exposed_minutes').notNull().default(0),
    /** Set while the reel is out of dry pack. */
    openedAt: timestamp('opened_at', { withTimezone: true }),
    /** sealed | open | expired | empty */
    status: text('status').notNull().default('sealed'),
    bakeCount: smallint('bake_count').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wms_reels_code_uq').on(t.tenantId, t.code), index('wms_reels_item_idx').on(t.tenantId, t.itemId)],
);

export const wmsReelEvents = pgTable(
  'wms_reel_events',
  {
    id: pk(),
    tenantId: tenantId(),
    reelId: uuid('reel_id')
      .notNull()
      .references(() => wmsReels.id, { onDelete: 'cascade' }),
    /** open | seal | bake | use | move */
    kind: text('kind').notNull(),
    qty: numeric('qty', { precision: 18, scale: 4 }),
    note: text('note'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    by: uuid('by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('wms_reel_events_reel_idx').on(t.reelId, t.at)],
);

/** Consignment: a vendor's stock held at our site, or our stock held at a customer. */
export const wmsConsignments = pgTable(
  'wms_consignments',
  {
    id: pk(),
    tenantId: tenantId(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    /** vendor_stock (theirs, at our site) | customer_stock (ours, at their site) */
    direction: text('direction').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wms_consignments_wh_uq').on(t.warehouseId)],
);

/** A warehousing client (3PL): their tariff for storage and handling in a warehouse. */
export const wms3plClients = pgTable(
  'wms_3pl_clients',
  {
    id: pk(),
    tenantId: tenantId(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    storagePerPalletDay: numeric('storage_per_pallet_day', { precision: 10, scale: 2 }).notNull(),
    inboundPerUnit: numeric('inbound_per_unit', { precision: 10, scale: 4 }).notNull().default('0'),
    outboundPerUnit: numeric('outbound_per_unit', { precision: 10, scale: 4 }).notNull().default('0'),
    minimumMonthly: numeric('minimum_monthly', { precision: 12, scale: 2 }),
    /** Units on a pallet when the item's storage profile does not say. */
    defaultUnitsPerPallet: numeric('default_units_per_pallet', { precision: 12, scale: 3 }).notNull().default('1'),
    /** Service item the invoice lines use (with its SAC and GST rate). */
    serviceItemId: uuid('service_item_id').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wms_3pl_clients_uq').on(t.partyId, t.warehouseId)],
);

export const wms3plBills = pgTable(
  'wms_3pl_bills',
  {
    id: pk(),
    tenantId: tenantId(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => wms3plClients.id, { onDelete: 'restrict' }),
    fromDate: text('from_date').notNull(),
    toDate: text('to_date').notNull(),
    palletDays: numeric('pallet_days', { precision: 14, scale: 2 }).notNull(),
    unitsIn: numeric('units_in', { precision: 18, scale: 4 }).notNull(),
    unitsOut: numeric('units_out', { precision: 18, scale: 4 }).notNull(),
    storageAmount: numeric('storage_amount', { precision: 12, scale: 2 }).notNull(),
    handlingAmount: numeric('handling_amount', { precision: 12, scale: 2 }).notNull(),
    minimumTopUp: numeric('minimum_top_up', { precision: 12, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 12, scale: 2 }).notNull(),
    invoiceId: uuid('invoice_id').references(() => documents.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wms_3pl_bills_period_uq').on(t.clientId, t.fromDate)],
);

/** Client references of scans replayed from a handheld's offline queue (each applied once). */
export const wmsClientRefs = pgTable(
  'wms_client_refs',
  {
    tenantId: tenantId(),
    ref: text('ref').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.ref] })],
);

/** Tags encoded for our items and serials (EPCs not in GS1 SGTIN form, or to pin a serial). */
export const wmsRfidTags = pgTable(
  'wms_rfid_tags',
  {
    id: pk(),
    tenantId: tenantId(),
    epc: text('epc').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    serialNo: text('serial_no'),
    batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wms_rfid_tags_epc_uq').on(t.tenantId, t.epc)],
);

/** Reads from RFID gates and handhelds. */
export const wmsRfidReads = pgTable(
  'wms_rfid_reads',
  {
    id: pk(),
    tenantId: tenantId(),
    gate: text('gate').notNull(),
    epc: text('epc').notNull(),
    gtin: text('gtin'),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    serialNo: text('serial_no'),
    deliveryId: uuid('delivery_id').references(() => documents.id, { onDelete: 'set null' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('wms_rfid_reads_gate_idx').on(t.tenantId, t.gate, t.readAt), index('wms_rfid_reads_delivery_idx').on(t.deliveryId)],
);
