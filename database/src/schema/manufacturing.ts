import { boolean, date, index, integer, numeric, pgTable, smallint, text, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { auditColumns, citext, pk } from './_columns';
import { documents } from './documents';
import { items, parties, uoms, warehouses } from './masters';
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
