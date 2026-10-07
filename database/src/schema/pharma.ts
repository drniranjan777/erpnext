import { date, doublePrecision, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { users } from './iam';
import { items } from './masters';
import { workOrders } from './manufacturing';
import { tenantId } from './tenancy';

/** Pharma settings: licence numbers printed on labels. */
export const pharmaSettings = pgTable(
  'pharma_settings',
  {
    id: pk(),
    tenantId: tenantId(),
    manufacturingLicenceNo: text('manufacturing_licence_no'),
    importLicenceNo: text('import_licence_no'),
  },
  (t) => [uniqueIndex('pharma_settings_uq').on(t.tenantId)],
);

export interface StabilityTest {
  name: string;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
}

/** A stability study of a batch at one storage condition, with its protocol. */
export const stabilityStudies = pgTable(
  'stability_studies',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    batchNo: text('batch_no').notNull(),
    protocolNo: text('protocol_no'),
    /** long_term | intermediate | accelerated | ongoing | photostability */
    kind: text('kind').notNull(),
    /** e.g. 25 °C / 60 % RH (ICH zone II), 30 / 75 (zone IVb), 40 / 75 accelerated */
    temperatureC: doublePrecision('temperature_c').notNull(),
    humidityPct: doublePrecision('humidity_pct'),
    packing: text('packing'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    /** Months at which samples are pulled and tested. */
    timePoints: jsonb('time_points').$type<number[]>().notNull(),
    tests: jsonb('tests').$type<StabilityTest[]>().notNull(),
    /** Shelf life claimed (months), checked against the data. */
    claimedShelfLifeMonths: smallint('claimed_shelf_life_months'),
    /** active | completed | cancelled */
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('stability_studies_code_uq').on(t.tenantId, t.code), index('stability_studies_item_idx').on(t.tenantId, t.itemId)],
);

export const stabilityResults = pgTable(
  'stability_results',
  {
    id: pk(),
    tenantId: tenantId(),
    studyId: uuid('study_id')
      .notNull()
      .references(() => stabilityStudies.id, { onDelete: 'cascade' }),
    timePoint: doublePrecision('time_point').notNull(),
    test: text('test').notNull(),
    value: doublePrecision('value').notNull(),
    /** Within the test's specification. */
    ok: integer('ok').notNull(),
    testedOn: date('tested_on', { mode: 'string' }).notNull(),
    testedBy: uuid('tested_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    deviationId: uuid('deviation_id'),
  },
  (t) => [uniqueIndex('stability_results_uq').on(t.tenantId, t.studyId, t.timePoint, t.test)],
);

/** A serialised saleable unit (GS1 SGTIN: GTIN + serial number). */
export const serialUnits = pgTable(
  'serial_units',
  {
    id: pk(),
    tenantId: tenantId(),
    gtin: text('gtin').notNull(),
    serial: text('serial').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    batchNo: text('batch_no').notNull(),
    expiryDate: date('expiry_date', { mode: 'string' }).notNull(),
    workOrderId: uuid('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
    /** commissioned | packed | shipped | decommissioned */
    status: text('status').notNull().default('commissioned'),
    containerId: uuid('container_id'),
    decommissionReason: text('decommission_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('serial_units_uq').on(t.tenantId, t.gtin, t.serial), index('serial_units_batch_idx').on(t.tenantId, t.itemId, t.batchNo), index('serial_units_container_idx').on(t.containerId)],
);

/** A container in the packing hierarchy: carton, shipper or pallet (SSCC for shippers and pallets). */
export const serialContainers = pgTable(
  'serial_containers',
  {
    id: pk(),
    tenantId: tenantId(),
    /** SSCC (18 digits) or an internal carton code. */
    code: text('code').notNull(),
    /** carton | shipper | pallet */
    level: text('level').notNull(),
    parentId: uuid('parent_id'),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    batchNo: text('batch_no'),
    /** open | closed | shipped */
    status: text('status').notNull().default('closed'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('serial_containers_code_uq').on(t.tenantId, t.code), index('serial_containers_parent_idx').on(t.parentId)],
);

/** DPCO ceiling price of a scheduled formulation (per unit, before GST). */
export const dpcoCeilings = pgTable(
  'dpco_ceilings',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    ceilingPrice: doublePrecision('ceiling_price').notNull(),
    /** NPPA notification (S.O.) number. */
    notification: text('notification'),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dpco_item_idx').on(t.tenantId, t.itemId, t.effectiveFrom)],
);
