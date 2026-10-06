import { boolean, index, integer, numeric, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, citext, pk } from './_columns';
import { documents } from './documents';
import { users } from './iam';
import { workOrderOperations, workOrders, jobCards } from './manufacturing';
import { items, warehouses } from './masters';
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
