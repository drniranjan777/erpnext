import { boolean, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, citext, pk } from './_columns';
import { documents } from './documents';
import { users } from './iam';
import { workOrderOperations, workOrders, jobCards } from './manufacturing';
import { items, parties, warehouses } from './masters';
import { tenantId } from './tenancy';

const qty = (name: string) => numeric(name, { precision: 18, scale: 4 }).notNull().default('0');

// =============================================================================
// Inspection plans: what to check on an item, at which stage, and how many to sample
// =============================================================================

export const inspectionPlans = pgTable(
  'inspection_plans',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    /** incoming | in_process | final */
    stage: text('stage').notNull(),
    /** In-process: after this operation (blank = any operation flagged for inspection). */
    operationSeq: smallint('operation_seq'),
    /** aql | full | fixed */
    sampling: text('sampling').notNull().default('aql'),
    /** ISO 2859-1 inspection level: S-1 … S-4, I, II, III. */
    inspectionLevel: text('inspection_level').notNull().default('II'),
    aql: text('aql').notNull().default('2.5'),
    fixedSampleSize: integer('fixed_sample_size'),
    /** Specification for one vendor (incoming) or customer (final); blank = any. */
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'cascade' }),
    /** Skip-lot: after this many accepted lots in a row, inspect only one lot in `skip_every`. */
    skipLotAfter: smallint('skip_lot_after'),
    skipEvery: smallint('skip_every'),
    isActive: boolean('is_active').notNull().default(true),
    instructions: text('instructions'),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('inspection_plans_code_uq').on(t.tenantId, t.code), index('inspection_plans_item_idx').on(t.tenantId, t.itemId, t.stage)],
);

export const inspectionParameters = pgTable(
  'inspection_parameters',
  {
    id: pk(),
    tenantId: tenantId(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => inspectionPlans.id, { onDelete: 'cascade' }),
    seq: smallint('seq').notNull(),
    name: text('name').notNull(),
    /** numeric (measured against limits) | attribute (pass / fail) */
    kind: text('kind').notNull().default('numeric'),
    unit: text('unit'),
    nominal: numeric('nominal', { precision: 18, scale: 6 }),
    lowerLimit: numeric('lower_limit', { precision: 18, scale: 6 }),
    upperLimit: numeric('upper_limit', { precision: 18, scale: 6 }),
    /** A failure of a critical characteristic rejects the lot regardless of the accept number. */
    isCritical: boolean('is_critical').notNull().default(false),
    /** Instrument / method (vernier, go-no-go gauge, visual…). */
    method: text('method'),
  },
  (t) => [index('inspection_params_plan_idx').on(t.planId), uniqueIndex('inspection_params_seq_uq').on(t.planId, t.seq)],
);

// =============================================================================
// Quality inspection (doc type "quality_inspection")
// =============================================================================

export const qualityInspections = pgTable(
  'quality_inspections',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    /** incoming | in_process | final */
    stage: text('stage').notNull(),
    planId: uuid('plan_id').references(() => inspectionPlans.id, { onDelete: 'set null' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    /** The document the lot came from (goods receipt, production entry). */
    sourceDocId: uuid('source_doc_id').references(() => documents.id, { onDelete: 'set null' }),
    workOrderId: uuid('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
    operationId: uuid('operation_id').references(() => workOrderOperations.id, { onDelete: 'set null' }),
    jobCardId: uuid('job_card_id').references(() => jobCards.id, { onDelete: 'set null' }),
    /** Where the lot sits (blank for in-process lots on the line). */
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    batchNo: text('batch_no'),
    lotQty: numeric('lot_qty', { precision: 18, scale: 4 }).notNull(),
    sampleSize: integer('sample_size').notNull(),
    acceptNo: integer('accept_no').notNull().default(0),
    rejectNo: integer('reject_no').notNull().default(1),
    codeLetter: text('code_letter'),
    defectives: integer('defectives').notNull().default(0),
    /** What the readings say: accept | reject (blank until readings are in). */
    suggestion: text('suggestion'),
    /** pending | accepted | rejected | partial */
    result: text('result').notNull().default('pending'),
    acceptedQty: qty('accepted_qty'),
    rejectedQty: qty('rejected_qty'),
    reworkQty: qty('rework_qty'),
    /** Accepted goods move here (e.g. out of quarantine into the store). */
    releaseWarehouseId: uuid('release_warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    /** Rejected and rework goods move here. */
    rejectWarehouseId: uuid('reject_warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    reworkOrderId: uuid('rework_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
    inspectedBy: uuid('inspected_by').references(() => users.id, { onDelete: 'set null' }),
    /** Incoming: the vendor's certificate of analysis and whether it was checked against the spec. */
    vendorCoaRef: text('vendor_coa_ref'),
    coaVerified: boolean('coa_verified').notNull().default(false),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'set null' }),
    remarks: text('remarks'),
  },
  (t) => [index('qi_item_idx').on(t.tenantId, t.itemId), index('qi_source_idx').on(t.sourceDocId), index('qi_wo_idx').on(t.workOrderId), index('qi_result_idx').on(t.tenantId, t.result)],
);

export const inspectionReadings = pgTable(
  'inspection_readings',
  {
    id: pk(),
    tenantId: tenantId(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => qualityInspections.id, { onDelete: 'cascade' }),
    parameterId: uuid('parameter_id')
      .notNull()
      .references(() => inspectionParameters.id, { onDelete: 'cascade' }),
    sampleNo: smallint('sample_no').notNull(),
    value: numeric('value', { precision: 18, scale: 6 }),
    passed: boolean('passed'),
    note: text('note'),
  },
  (t) => [index('readings_insp_idx').on(t.inspectionId), uniqueIndex('readings_uq').on(t.inspectionId, t.parameterId, t.sampleNo)],
);

// =============================================================================
// Electronic signatures (QA release, MRB decisions…)
// =============================================================================

/**
 * A signature: who signed what, with which meaning, after re-entering their password. The row
 * is never updated or deleted.
 */
export const eSignatures = pgTable(
  'e_signatures',
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** batch | ncr | … */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    /** What the signature means: "QA release", "Rejected", "MRB disposition approved"… */
    meaning: text('meaning').notNull(),
    reason: text('reason'),
    /** What was signed (e.g. the new status), as it was. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('e_signatures_entity_idx').on(t.tenantId, t.entityType, t.entityId)],
);

// =============================================================================
// Skip-lot log and retain samples
// =============================================================================

/** Lots that skipped inspection under a skip-lot plan (inspected lots are inspections). */
export const skipLots = pgTable(
  'skip_lots',
  {
    id: pk(),
    tenantId: tenantId(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => inspectionPlans.id, { onDelete: 'cascade' }),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'set null' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    sourceDocId: uuid('source_doc_id').references(() => documents.id, { onDelete: 'set null' }),
    batchNo: text('batch_no'),
    lotQty: numeric('lot_qty', { precision: 18, scale: 4 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('skip_lots_plan_idx').on(t.planId, t.createdAt)],
);

export const retainSamples = pgTable(
  'retain_samples',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    batchNo: text('batch_no').notNull(),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    location: text('location').notNull(),
    drawnOn: date('drawn_on', { mode: 'string' }).notNull(),
    retainUntil: date('retain_until', { mode: 'string' }).notNull(),
    inspectionId: uuid('inspection_id').references(() => qualityInspections.id, { onDelete: 'set null' }),
    disposedOn: date('disposed_on', { mode: 'string' }),
    disposedBy: uuid('disposed_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('retain_samples_item_idx').on(t.tenantId, t.itemId), index('retain_samples_due_idx').on(t.tenantId, t.retainUntil)],
);

// =============================================================================
// Non-conformance report (doc type "ncr")
// =============================================================================

/**
 * A non-conformance: what was wrong, how much, and what the material review board decided to
 * do with it. Approval is the MRB decision; the cost of poor quality is fixed then.
 */
export const ncrs = pgTable(
  'ncrs',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    /** incoming | in_process | final | customer | supplier | internal */
    source: text('source').notNull(),
    /** minor | major | critical */
    severity: text('severity').notNull().default('major'),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    batchNo: text('batch_no'),
    qtyAffected: numeric('qty_affected', { precision: 18, scale: 4 }).notNull(),
    defectCategory: text('defect_category').notNull(),
    description: text('description').notNull(),
    /** The vendor (incoming / supplier) or customer (customer complaints). */
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'set null' }),
    inspectionId: uuid('inspection_id').references(() => qualityInspections.id, { onDelete: 'set null' }),
    workOrderId: uuid('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
    containment: text('containment'),
    // MRB disposition (base unit)
    useAsIsQty: numeric('use_as_is_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    reworkQty: numeric('rework_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    scrapQty: numeric('scrap_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    returnQty: numeric('return_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    sortQty: numeric('sort_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    dispositionNotes: text('disposition_notes'),
    // Cost of poor quality
    scrapCost: numeric('scrap_cost', { precision: 18, scale: 2 }).notNull().default('0'),
    reworkCost: numeric('rework_cost', { precision: 18, scale: 2 }).notNull().default('0'),
    sortingCost: numeric('sorting_cost', { precision: 18, scale: 2 }).notNull().default('0'),
    otherCost: numeric('other_cost', { precision: 18, scale: 2 }).notNull().default('0'),
    /** Recovered from the vendor (debit note) or insurer. */
    recovered: numeric('recovered', { precision: 18, scale: 2 }).notNull().default('0'),
    copq: numeric('copq', { precision: 18, scale: 2 }).notNull().default('0'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [index('ncrs_item_idx').on(t.tenantId, t.itemId), index('ncrs_party_idx').on(t.tenantId, t.partyId)],
);
