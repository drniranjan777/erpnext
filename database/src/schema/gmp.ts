import { boolean, doublePrecision, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { users } from './iam';
import { iotSignals } from './iot';
import { items } from './masters';
import { machines, workOrders } from './manufacturing';
import { eSignatures } from './quality';
import { tenantId } from './tenancy';

/** GMP settings of a workspace. */
export const gmpSettings = pgTable(
  'gmp_settings',
  {
    id: pk(),
    tenantId: tenantId(),
    /** Jobs cannot start at a machine without a line clearance signed in the last `lineClearanceHours`. */
    requireLineClearance: boolean('require_line_clearance').notNull().default(false),
    lineClearanceHours: doublePrecision('line_clearance_hours').notNull().default(12),
    lineClearanceChecklist: jsonb('line_clearance_checklist').$type<string[]>().notNull().default([]),
  },
  (t) => [uniqueIndex('gmp_settings_uq').on(t.tenantId)],
);

/** Line clearance before a batch: the area is free of the previous product, documents and labels. */
export const lineClearances = pgTable(
  'line_clearances',
  {
    id: pk(),
    tenantId: tenantId(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    area: text('area'),
    previousItemId: uuid('previous_item_id').references(() => items.id, { onDelete: 'set null' }),
    previousBatch: text('previous_batch'),
    checklist: jsonb('checklist').$type<{ item: string; ok: boolean; note?: string | null }[]>().notNull(),
    /** pending (production signed) | cleared (QA signed) | failed */
    status: text('status').notNull().default('pending'),
    productionSignatureId: uuid('production_signature_id').references(() => eSignatures.id, { onDelete: 'restrict' }),
    qaSignatureId: uuid('qa_signature_id').references(() => eSignatures.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
  },
  (t) => [index('line_clearances_wo_idx').on(t.tenantId, t.workOrderId), index('line_clearances_machine_idx').on(t.tenantId, t.machineId, t.clearedAt)],
);

export interface BatchException {
  key: string;
  /** checks | first_off | inline | recipe | rejects | alarm | deviation | clearance | inspection | cleaning */
  kind: string;
  severity: 'major' | 'minor';
  text: string;
  /** Link to the record. */
  link?: string | null;
}

/** QA review of an electronic batch record, by exception, ending in a signed decision. */
export const batchReviews = pgTable(
  'batch_reviews',
  {
    id: pk(),
    tenantId: tenantId(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    /** open | approved | rejected */
    status: text('status').notNull().default('open'),
    /** Exceptions found when the review was opened or last refreshed. */
    exceptions: jsonb('exceptions').$type<BatchException[]>().notNull().default([]),
    /** Reviewer comments per exception key. */
    comments: jsonb('comments').$type<Record<string, { text: string; by: string; at: string }>>().notNull().default({}),
    signatureId: uuid('signature_id').references(() => eSignatures.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('batch_reviews_wo_uq').on(t.tenantId, t.workOrderId)],
);

export interface EmParameter {
  /** viable_settle | viable_active | viable_contact | particles_0_5 | particles_5_0 | temperature | humidity | diff_pressure */
  param: string;
  unit: string;
  alertLimit?: number | null;
  actionLimit?: number | null;
  /** above (most) or below (pressure differentials) */
  direction: 'above' | 'below';
  /** Sensor that measures it, if any. */
  signalId?: string | null;
}

/** A sampling location of environmental monitoring (clean room, room, area). */
export const emLocations = pgTable(
  'em_locations',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    room: text('room'),
    /** A | B | C | D (EU GMP) or ISO 5–8 or CNC (controlled, not classified) */
    grade: text('grade').notNull(),
    parameters: jsonb('parameters').$type<EmParameter[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('em_locations_code_uq').on(t.tenantId, t.code)],
);

/** One environmental monitoring result. */
export const emSamples = pgTable(
  'em_samples',
  {
    id: pk(),
    tenantId: tenantId(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => emLocations.id, { onDelete: 'cascade' }),
    param: text('param').notNull(),
    value: doublePrecision('value').notNull(),
    sampledAt: timestamp('sampled_at', { withTimezone: true }).notNull(),
    /** manual | sensor */
    method: text('method').notNull().default('manual'),
    /** ok | alert | action */
    status: text('status').notNull(),
    /** at_rest | in_operation */
    condition: text('condition').notNull().default('in_operation'),
    workOrderId: uuid('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
    deviationId: uuid('deviation_id'),
    signalId: uuid('signal_id').references(() => iotSignals.id, { onDelete: 'set null' }),
    notes: text('notes'),
    sampledBy: uuid('sampled_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('em_samples_loc_idx').on(t.tenantId, t.locationId, t.sampledAt), index('em_samples_status_idx').on(t.tenantId, t.status, t.sampledAt)],
);
