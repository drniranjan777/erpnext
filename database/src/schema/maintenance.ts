import { boolean, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { documents } from './documents';
import { users } from './iam';
import { machines, tools } from './manufacturing';
import { items, parties, warehouses } from './masters';
import { tenantId } from './tenancy';

const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
const money = (name: string) => numeric(name, { precision: 18, scale: 2 }).notNull().default('0');

// =============================================================================
// Asset hierarchy
// =============================================================================

/** Plant → line → machine → assembly → component; machines can point at the shop-floor machine. */
export const maintAssets = pgTable(
  'maint_assets',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** plant | line | machine | assembly | component | utility */
    level: text('level').notNull().default('machine'),
    parentId: uuid('parent_id').references((): AnyPgColumn => maintAssets.id, { onDelete: 'restrict' }),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    location: text('location'),
    make: text('make'),
    model: text('model'),
    serialNo: text('serial_no'),
    specs: text('specs'),
    installedOn: date('installed_on', { mode: 'string' }),
    warrantyUntil: date('warranty_until', { mode: 'string' }),
    /** A (production stops), B, C */
    criticality: text('criticality').notNull().default('B'),
    /** running | down | standby | retired */
    status: text('status').notNull().default('running'),
    meterUnit: text('meter_unit'),
    meterReading: qty('meter_reading'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('maint_assets_code_uq').on(t.tenantId, t.code), index('maint_assets_parent_idx').on(t.parentId), index('maint_assets_machine_idx').on(t.machineId)],
);

export const meterReadings = pgTable(
  'meter_readings',
  {
    id: pk(),
    tenantId: tenantId(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => maintAssets.id, { onDelete: 'cascade' }),
    reading: qty('reading').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
    readBy: uuid('read_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('meter_readings_asset_idx').on(t.assetId, t.readAt)],
);

/** Spare parts used on an asset; critical ones carry a minimum stock. */
export const assetSpares = pgTable(
  'asset_spares',
  {
    id: pk(),
    tenantId: tenantId(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => maintAssets.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    isCritical: boolean('is_critical').notNull().default(false),
    minQty: qty('min_qty'),
    /** Interchangeable part (another item that can be fitted instead). */
    alternateItemId: uuid('alternate_item_id').references(() => items.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('asset_spares_uq').on(t.assetId, t.itemId)],
);

// =============================================================================
// Preventive maintenance schedules
// =============================================================================

export const pmSchedules = pgTable(
  'pm_schedules',
  {
    id: pk(),
    tenantId: tenantId(),
    assetId: uuid('asset_id').references(() => maintAssets.id, { onDelete: 'cascade' }),
    toolId: uuid('tool_id').references(() => tools.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** time | meter */
    trigger: text('trigger').notNull().default('time'),
    intervalDays: integer('interval_days'),
    intervalMeter: qty('interval_meter'),
    lastDoneOn: date('last_done_on', { mode: 'string' }),
    lastMeter: qty('last_meter'),
    nextDue: date('next_due', { mode: 'string' }),
    nextMeter: qty('next_meter'),
    checklist: jsonb('checklist').$type<string[]>().notNull().default([]),
    estimatedMinutes: integer('estimated_minutes'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [index('pm_schedules_asset_idx').on(t.tenantId, t.assetId), index('pm_schedules_due_idx').on(t.tenantId, t.nextDue)],
);

// =============================================================================
// Maintenance orders (doc type "maintenance_order")
// =============================================================================

export interface ChecklistRow {
  item: string;
  ok: boolean | null;
  note: string | null;
}
export interface LabourRow {
  person: string;
  hours: string;
  rate: string;
}

/**
 * A maintenance job on an asset (or a mould / die): breakdown, preventive, condition-based,
 * shutdown or corrective. Opened as a draft (the request), started, completed with what was
 * found and done, then signed off (approval), which issues the spares and fixes the cost.
 */
export const maintenanceOrders = pgTable(
  'maintenance_orders',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    /** breakdown | preventive | condition | shutdown | corrective */
    kind: text('kind').notNull(),
    assetId: uuid('asset_id').references(() => maintAssets.id, { onDelete: 'restrict' }),
    toolId: uuid('tool_id').references(() => tools.id, { onDelete: 'set null' }),
    scheduleId: uuid('schedule_id').references(() => pmSchedules.id, { onDelete: 'set null' }),
    problem: text('problem').notNull(),
    /** low | normal | high | urgent */
    priority: text('priority').notNull().default('normal'),
    requestedBy: text('requested_by'),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
    plannedDate: date('planned_date', { mode: 'string' }),
    /** Does the job stop the machine? Breakdowns always do. */
    machineDown: boolean('machine_down').notNull().default(false),
    /** open | in_progress | done */
    stage: text('stage').notNull().default('open'),
    assignedTo: text('assigned_to'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Production time lost (machine down), minutes. */
    downtimeMinutes: integer('downtime_minutes'),
    failureCode: text('failure_code'),
    actionTaken: text('action_taken'),
    checklist: jsonb('checklist').$type<ChecklistRow[]>().notNull().default([]),
    labour: jsonb('labour').$type<LabourRow[]>().notNull().default([]),
    meterReading: qty('meter_reading'),
    labourCost: money('labour_cost'),
    sparesCost: money('spares_cost'),
    otherCost: money('other_cost'),
    totalCost: money('total_cost'),
    /** Done under an AMC by the contractor. */
    amcContractId: uuid('amc_contract_id'),
  },
  (t) => [index('mwo_asset_idx').on(t.tenantId, t.assetId), index('mwo_schedule_idx').on(t.scheduleId), index('mwo_stage_idx').on(t.tenantId, t.stage)],
);

export const maintenanceSpares = pgTable(
  'maintenance_spares',
  {
    id: pk(),
    tenantId: tenantId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => maintenanceOrders.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    qty: qty('qty').notNull(),
    batchNo: text('batch_no'),
    value: money('value'),
  },
  (t) => [index('maintenance_spares_order_idx').on(t.orderId)],
);

// =============================================================================
// AMC contracts and visits
// =============================================================================

export const amcContracts = pgTable(
  'amc_contracts',
  {
    id: pk(),
    tenantId: tenantId(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    /** Assets covered. */
    assetIds: jsonb('asset_ids').$type<string[]>().notNull().default([]),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    value: money('value'),
    visitsPerYear: smallint('visits_per_year'),
    /** Breakdown response promised, hours. */
    responseHours: smallint('response_hours'),
    coverage: text('coverage'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('amc_vendor_idx').on(t.tenantId, t.vendorId)],
);

export const amcVisits = pgTable(
  'amc_visits',
  {
    id: pk(),
    tenantId: tenantId(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => amcContracts.id, { onDelete: 'cascade' }),
    /** preventive | breakdown */
    kind: text('kind').notNull(),
    orderId: uuid('order_id').references(() => maintenanceOrders.id, { onDelete: 'set null' }),
    calledAt: timestamp('called_at', { withTimezone: true }),
    attendedAt: timestamp('attended_at', { withTimezone: true }).notNull(),
    engineer: text('engineer'),
    notes: text('notes'),
    /** Breakdown visits: attended within the promised response time. */
    withinSla: boolean('within_sla'),
  },
  (t) => [index('amc_visits_contract_idx').on(t.contractId, t.attendedAt)],
);

// =============================================================================
// TPM: autonomous maintenance, kaizen, 5S
// =============================================================================

export const amChecklists = pgTable(
  'am_checklists',
  {
    id: pk(),
    tenantId: tenantId(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => maintAssets.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** daily | weekly | monthly */
    frequency: text('frequency').notNull().default('daily'),
    items: jsonb('items').$type<string[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [index('am_checklists_asset_idx').on(t.assetId)],
);

export const amChecks = pgTable(
  'am_checks',
  {
    id: pk(),
    tenantId: tenantId(),
    checklistId: uuid('checklist_id')
      .notNull()
      .references(() => amChecklists.id, { onDelete: 'cascade' }),
    doneOn: date('done_on', { mode: 'string' }).notNull(),
    doneBy: text('done_by').notNull(),
    results: jsonb('results').$type<{ ok: boolean; note: string | null }[]>().notNull(),
    abnormalities: smallint('abnormalities').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('am_checks_uq').on(t.checklistId, t.doneOn)],
);

export const kaizens = pgTable(
  'kaizens',
  {
    id: pk(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    area: text('area').notNull(),
    /** quality | cost | delivery | safety | morale | environment */
    category: text('category').notNull().default('cost'),
    before: text('before').notNull(),
    after: text('after').notNull(),
    benefit: text('benefit'),
    annualSavings: money('annual_savings'),
    submittedBy: text('submitted_by').notNull(),
    implementedOn: date('implemented_on', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('kaizens_date_idx').on(t.tenantId, t.createdAt)],
);

export const fiveSAudits = pgTable(
  'five_s_audits',
  {
    id: pk(),
    tenantId: tenantId(),
    area: text('area').notNull(),
    auditDate: date('audit_date', { mode: 'string' }).notNull(),
    auditor: text('auditor').notNull(),
    /** 1–5 each: sort, set in order, shine, standardise, sustain. */
    sort: smallint('sort').notNull(),
    setInOrder: smallint('set_in_order').notNull(),
    shine: smallint('shine').notNull(),
    standardise: smallint('standardise').notNull(),
    sustain: smallint('sustain').notNull(),
    total: smallint('total').notNull(),
    notes: text('notes'),
  },
  (t) => [index('five_s_area_idx').on(t.tenantId, t.area, t.auditDate)],
);
