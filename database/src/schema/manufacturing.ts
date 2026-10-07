import { boolean, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { auditColumns, citext, pk } from './_columns';
import { jobWorkChallans } from './compliance';
import { documents } from './documents';
import { items, parties, uoms, warehouses } from './masters';
import { users } from './iam';
import { salesOrderLines, salesOrders } from './sales';
import { companies, tenantId } from './tenancy';

const rate = (name: string) => numeric(name, { precision: 18, scale: 4 }).notNull().default('0');

// =============================================================================
// Work centres, machines, tools
// =============================================================================

/** Where operations run: a machine group, a line, a manual station or an outside processor. */
export const workCenters = pgTable(
  'work_centers',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** machine | line | manual | subcontract */
    kind: text('kind').notNull().default('machine'),
    /** Shop-floor store where work in progress sits. */
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    hoursPerDay: numeric('hours_per_day', { precision: 5, scale: 2 }).notNull().default('8'),
    /** Parallel capacity (machines / people). */
    units: smallint('units').notNull().default(1),
    efficiencyPct: numeric('efficiency_pct', { precision: 5, scale: 2 }).notNull().default('100'),
    /** Cost per hour. */
    labourRate: rate('labour_rate'),
    machineRate: rate('machine_rate'),
    overheadRate: rate('overhead_rate'),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('work_centers_code_uq').on(t.tenantId, t.code)],
);

export const machines = pgTable(
  'machines',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    workCenterId: uuid('work_center_id')
      .notNull()
      .references(() => workCenters.id, { onDelete: 'restrict' }),
    make: text('make'),
    model: text('model'),
    serialNo: text('serial_no'),
    /** Tonnage, spindle speed, bed size… */
    capacity: text('capacity'),
    /** Process equipment: must be cleaned (and verified) before the next batch can start on it. */
    requiresCleaning: boolean('requires_cleaning').notNull().default(false),
    /** clean | in_use | dirty */
    cleanStatus: text('clean_status').notNull().default('clean'),
    /** The product last made on it (for product-change cleaning). */
    lastItemId: uuid('last_item_id').references(() => items.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('machines_code_uq').on(t.tenantId, t.code)],
);

/** Moulds, dies, fixtures and gauges, with life counted in shots / strokes. */
export const tools = pgTable(
  'tools',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** mould | die | fixture | gauge | tool */
    kind: text('kind').notNull().default('mould'),
    cavities: smallint('cavities').notNull().default(1),
    /** Expected life in shots / strokes (blank = not tracked). */
    lifeShots: integer('life_shots'),
    shotsUsed: integer('shots_used').notNull().default(0),
    /** Shots after which preventive maintenance is due. */
    maintenanceEvery: integer('maintenance_every'),
    lastMaintenanceAt: integer('last_maintenance_at').notNull().default(0),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    /** available | in_use | maintenance | retired */
    status: text('status').notNull().default('available'),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('tools_code_uq').on(t.tenantId, t.code)],
);

// =============================================================================
// Bill of materials (doc type "bom") with its routing
// =============================================================================

export const boms = pgTable(
  'boms',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    version: smallint('version').notNull().default(1),
    /** Quantity the lines are for (e.g. per 100 pieces), in the item's base unit. */
    quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull().default('1'),
    /** The BOM used when nothing else is chosen (one per item). */
    isDefault: boolean('is_default').notNull().default(false),
    effectiveFrom: date('effective_from', { mode: 'string' }),
    effectiveTo: date('effective_to', { mode: 'string' }),
    previousVersionId: uuid('previous_version_id').references((): AnyPgColumn => boms.id, { onDelete: 'set null' }),
    /** Rolled-up cost per unit (material, operations, sub-contract, less by-products). */
    materialCost: rate('material_cost'),
    operationCost: rate('operation_cost'),
    subcontractCost: rate('subcontract_cost'),
    byproductCredit: rate('byproduct_credit'),
    unitCost: rate('unit_cost'),
    drawingNo: text('drawing_no'),
    drawingRevision: text('drawing_revision'),
    notes: text('notes'),
  },
  (t) => [index('boms_item_idx').on(t.tenantId, t.itemId)],
);

export const bomLines = pgTable(
  'bom_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    bomId: uuid('bom_id')
      .notNull()
      .references(() => boms.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    /** component | byproduct | scrap */
    kind: text('kind').notNull().default('component'),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    /** Per BOM quantity, in the component's base unit. */
    qty: numeric('qty', { precision: 18, scale: 6 }).notNull(),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    scrapPct: numeric('scrap_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    /** Phantom: an assembly that is never stocked; its own BOM is exploded in place. */
    isPhantom: boolean('is_phantom').notNull().default(false),
    /** Lines sharing a group are alternates; the lowest priority number is used first. */
    alternateGroup: text('alternate_group'),
    priority: smallint('priority').notNull().default(1),
    /** Issued at this operation (for backflushing); blank = at the start. */
    operationSeq: smallint('operation_seq'),
    /** By-products: share of cost they carry away (credit), as a value per unit. */
    recoveryRate: numeric('recovery_rate', { precision: 18, scale: 4 }),
    remarks: text('remarks'),
  },
  (t) => [index('bom_lines_bom_idx').on(t.bomId), uniqueIndex('bom_lines_no_uq').on(t.bomId, t.lineNo)],
);

export const bomOperations = pgTable(
  'bom_operations',
  {
    id: pk(),
    tenantId: tenantId(),
    bomId: uuid('bom_id')
      .notNull()
      .references(() => boms.id, { onDelete: 'cascade' }),
    seq: smallint('seq').notNull(),
    name: text('name').notNull(),
    workCenterId: uuid('work_center_id')
      .notNull()
      .references(() => workCenters.id, { onDelete: 'restrict' }),
    toolId: uuid('tool_id').references(() => tools.id, { onDelete: 'set null' }),
    /** Once per batch. */
    setupMinutes: numeric('setup_minutes', { precision: 10, scale: 2 }).notNull().default('0'),
    /** Per unit of the parent item. */
    runMinutes: numeric('run_minutes', { precision: 10, scale: 4 }).notNull().default('0'),
    /** Done outside by a job worker. */
    isSubcontract: boolean('is_subcontract').notNull().default(false),
    vendorId: uuid('vendor_id').references(() => parties.id, { onDelete: 'restrict' }),
    /** Job-work charge per unit. */
    subcontractRate: numeric('subcontract_rate', { precision: 18, scale: 4 }),
    /** In-process inspection after this operation. */
    inspection: boolean('inspection').notNull().default(false),
    instructions: text('instructions'),
  },
  (t) => [index('bom_ops_bom_idx').on(t.bomId), uniqueIndex('bom_ops_seq_uq').on(t.bomId, t.seq)],
);

// =============================================================================
// Work orders (doc type "work_order"), shop floor and production entries
// =============================================================================

const qty = (name: string) => numeric(name, { precision: 18, scale: 4 }).notNull().default('0');
const money = (name: string) => numeric(name, { precision: 18, scale: 2 }).notNull().default('0');

/**
 * A work order makes `qty` of an item from a BOM. Approval releases it (materials are checked
 * and reserved); production entries move materials and output through work in progress; closing
 * writes what is left in WIP off as a production variance.
 */
export const workOrders = pgTable(
  'work_orders',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    /** mts (make to stock) | mto (make to order) | rework */
    kind: text('kind').notNull().default('mts'),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    bomId: uuid('bom_id').references(() => boms.id, { onDelete: 'restrict' }),
    /** Process batches: the formula (instead of a BOM). */
    formulaId: uuid('formula_id'),
    /** Process batches: the lot number the output will carry. */
    batchNo: text('batch_no'),
    salesOrderId: uuid('sales_order_id').references(() => salesOrders.id, { onDelete: 'restrict' }),
    salesOrderLineId: uuid('sales_order_line_id').references(() => salesOrderLines.id, { onDelete: 'set null' }),
    /** Rework: the order whose rejects are being reworked. */
    parentWorkOrderId: uuid('parent_work_order_id').references((): AnyPgColumn => workOrders.id, { onDelete: 'set null' }),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    producedQty: qty('produced_qty'),
    rejectedQty: qty('rejected_qty'),
    /** Materials are issued from here. */
    sourceWarehouseId: uuid('source_warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    /** Finished goods are received here. */
    targetWarehouseId: uuid('target_warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    plannedStart: date('planned_start', { mode: 'string' }),
    plannedEnd: date('planned_end', { mode: 'string' }),
    priority: smallint('priority').notNull().default(3),
    /** Issue materials automatically (at standard quantities) when output is received. */
    backflush: boolean('backflush').notNull().default(false),
    /** planned | released | in_progress | completed | closed */
    stage: text('stage').notNull().default('planned'),
    /** Standard cost per unit, fixed at release. */
    stdMaterial: rate('std_material'),
    stdOperation: rate('std_operation'),
    stdSubcontract: rate('std_subcontract'),
    stdByproduct: rate('std_byproduct'),
    stdUnitCost: rate('std_unit_cost'),
    /** Actuals, maintained by production entries. */
    materialCost: money('material_cost'),
    conversionCost: money('conversion_cost'),
    subcontractCost: money('subcontract_cost'),
    byproductValue: money('byproduct_value'),
    outputValue: money('output_value'),
    varianceValue: money('variance_value'),
    /** Shortages accepted at release. */
    releaseCheck: jsonb('release_check').$type<{ itemId: string; code: string; required: string; available: string; short: string }[]>(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (t) => [index('wo_item_idx').on(t.tenantId, t.itemId), index('wo_so_idx').on(t.salesOrderId), index('wo_stage_idx').on(t.tenantId, t.stage)],
);

/** Materials to issue (components) and expected by-products / scrap, from the BOM explosion. */
export const workOrderMaterials = pgTable(
  'work_order_materials',
  {
    id: pk(),
    tenantId: tenantId(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    /** component | byproduct | scrap */
    kind: text('kind').notNull().default('component'),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    requiredQty: numeric('required_qty', { precision: 18, scale: 4 }).notNull(),
    /** Net of returns. */
    issuedQty: qty('issued_qty'),
    /** By-products / scrap received. */
    receivedQty: qty('received_qty'),
    operationSeq: smallint('operation_seq'),
    recoveryRate: numeric('recovery_rate', { precision: 18, scale: 4 }),
    /** Standard cost per base unit at release. */
    stdRate: rate('std_rate'),
    /** Process batches: how the quantity is stated (percent | fixed | potency). */
    basis: text('basis'),
    stdPotency: numeric('std_potency', { precision: 6, scale: 2 }),
    tolerancePct: numeric('tolerance_pct', { precision: 5, scale: 2 }),
    /** Co-products: share of the batch cost they take at receipt. */
    costSharePct: numeric('cost_share_pct', { precision: 5, scale: 2 }),
  },
  (t) => [index('wo_mat_wo_idx').on(t.workOrderId), index('wo_mat_item_idx').on(t.tenantId, t.itemId), uniqueIndex('wo_mat_no_uq').on(t.workOrderId, t.lineNo)],
);

export const workOrderOperations = pgTable(
  'work_order_operations',
  {
    id: pk(),
    tenantId: tenantId(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    seq: smallint('seq').notNull(),
    name: text('name').notNull(),
    workCenterId: uuid('work_center_id')
      .notNull()
      .references(() => workCenters.id, { onDelete: 'restrict' }),
    toolId: uuid('tool_id').references(() => tools.id, { onDelete: 'set null' }),
    setupMinutes: numeric('setup_minutes', { precision: 10, scale: 2 }).notNull().default('0'),
    runMinutes: numeric('run_minutes', { precision: 10, scale: 4 }).notNull().default('0'),
    plannedMinutes: numeric('planned_minutes', { precision: 12, scale: 2 }).notNull().default('0'),
    isSubcontract: boolean('is_subcontract').notNull().default(false),
    vendorId: uuid('vendor_id').references(() => parties.id, { onDelete: 'restrict' }),
    subcontractRate: numeric('subcontract_rate', { precision: 18, scale: 4 }),
    inspection: boolean('inspection').notNull().default(false),
    instructions: text('instructions'),
    /** Process stages: in-process parameters to record, with limits. */
    parameters: jsonb('parameters').$type<{ name: string; unit: string | null; min: string | null; max: string | null }[]>(),
    /** pending | in_progress | done */
    status: text('status').notNull().default('pending'),
    goodQty: qty('good_qty'),
    rejectQty: qty('reject_qty'),
    actualMinutes: numeric('actual_minutes', { precision: 12, scale: 2 }).notNull().default('0'),
  },
  (t) => [index('wo_ops_wo_idx').on(t.workOrderId), uniqueIndex('wo_ops_seq_uq').on(t.workOrderId, t.seq)],
);

/**
 * A job card is one sitting at an operation: who ran it, on which machine, for how long, and
 * how many came out good or rejected. Its cost is absorbed into WIP by the next production
 * receipt (or the close).
 */
export const jobCards = pgTable(
  'job_cards',
  {
    id: pk(),
    tenantId: tenantId(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => workOrderOperations.id, { onDelete: 'cascade' }),
    operatorId: uuid('operator_id').references(() => users.id, { onDelete: 'set null' }),
    operatorName: text('operator_name'),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    toolId: uuid('tool_id').references(() => tools.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    minutes: numeric('minutes', { precision: 10, scale: 2 }).notNull().default('0'),
    goodQty: qty('good_qty'),
    rejectQty: qty('reject_qty'),
    shots: integer('shots').notNull().default(0),
    /** running | done */
    status: text('status').notNull().default('running'),
    labourCost: money('labour_cost'),
    machineCost: money('machine_cost'),
    overheadCost: money('overhead_cost'),
    subcontractCost: money('subcontract_cost'),
    /** Production entry that absorbed this card's cost into WIP. */
    absorbedIn: uuid('absorbed_in').references(() => documents.id, { onDelete: 'set null' }),
    /** Sub-contract operations: the challan the goods went out on. */
    jobWorkChallanId: uuid('job_work_challan_id').references(() => jobWorkChallans.id, { onDelete: 'set null' }),
    rejectReason: text('reject_reason'),
    notes: text('notes'),
    /** Process stages: parameter readings, and whether each was within limits. */
    readings: jsonb('readings').$type<{ name: string; value: string; ok: boolean }[]>(),
    /** Set by the shop-floor kiosk so events replayed after a network drop are applied once. */
    clientRef: text('client_ref'),
    ...auditColumns(),
  },
  (t) => [index('job_cards_wo_idx').on(t.workOrderId), index('job_cards_status_idx').on(t.tenantId, t.status), index('job_cards_ended_idx').on(t.tenantId, t.endedAt), uniqueIndex('job_cards_client_ref_uq').on(t.tenantId, t.clientRef)],
);

/** Material issue / return, production receipt and close of a work order (doc type "production_entry"). */
export const productionEntries = pgTable(
  'production_entries',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'restrict' }),
    /** issue | return | receipt | close */
    kind: text('kind').notNull(),
    goodQty: qty('good_qty'),
    rejectQty: qty('reject_qty'),
    /** Values posted: materials into WIP (net), conversion absorbed, sub-contract accrued, output out of WIP, variance. */
    materialValue: money('material_value'),
    conversionValue: money('conversion_value'),
    subcontractValue: money('subcontract_value'),
    outputValue: money('output_value'),
    varianceValue: money('variance_value'),
    notes: text('notes'),
  },
  (t) => [index('prod_entries_wo_idx').on(t.workOrderId)],
);

export const productionEntryLines = pgTable(
  'production_entry_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => productionEntries.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    /** material | output | byproduct | scrap */
    kind: text('kind').notNull(),
    materialId: uuid('material_id').references(() => workOrderMaterials.id, { onDelete: 'set null' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    /** Base unit, always positive; direction comes from the kind and the entry. */
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    rate: rate('rate'),
    amount: money('amount'),
    batchNo: text('batch_no'),
    serialNos: jsonb('serial_nos').$type<string[]>(),
    backflushed: boolean('backflushed').notNull().default(false),
  },
  (t) => [index('prod_lines_entry_idx').on(t.entryId), uniqueIndex('prod_lines_no_uq').on(t.entryId, t.lineNo)],
);
