import { boolean, date, index, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { documents } from './documents';
import { users } from './iam';
import { machines, workCenters, workOrderMaterials, workOrders } from './manufacturing';
import { items, uoms, warehouses } from './masters';
import { tenantId } from './tenancy';

const rate = (name: string) => numeric(name, { precision: 18, scale: 4 }).notNull().default('0');

export interface StageParameter {
  name: string;
  unit: string | null;
  min: string | null;
  max: string | null;
}

// =============================================================================
// Formula / recipe (doc type "formula")
// =============================================================================

/**
 * A master formula: ingredients by percent, fixed quantity or potency, with stages and their
 * in-process parameters. Versioned and approved like a BOM; the approved default is what
 * batches are made from.
 */
export const formulas = pgTable(
  'formulas',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    version: smallint('version').notNull().default(1),
    /** bulk (makes the product) | packing (packs a bulk item into this pack size) */
    kind: text('kind').notNull().default('bulk'),
    /** Standard batch, in the product's base unit. */
    batchSize: numeric('batch_size', { precision: 18, scale: 4 }).notNull(),
    /** Batches are made in multiples of this (blank = any size). */
    batchMultiple: numeric('batch_multiple', { precision: 18, scale: 4 }),
    /** Expected output as % of the batch size. */
    yieldPct: numeric('yield_pct', { precision: 6, scale: 2 }).notNull().default('100'),
    isDefault: boolean('is_default').notNull().default(true),
    effectiveFrom: date('effective_from', { mode: 'string' }),
    effectiveTo: date('effective_to', { mode: 'string' }),
    previousVersionId: uuid('previous_version_id').references((): AnyPgColumn => formulas.id, { onDelete: 'set null' }),
    materialCost: rate('material_cost'),
    conversionCost: rate('conversion_cost'),
    unitCost: rate('unit_cost'),
    /** Regulatory text: INCI / ingredient declaration, nutrition, SDS reference. */
    declaration: text('declaration'),
    notes: text('notes'),
  },
  (t) => [index('formulas_item_idx').on(t.tenantId, t.itemId)],
);

export const formulaLines = pgTable(
  'formula_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    formulaId: uuid('formula_id')
      .notNull()
      .references(() => formulas.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    /** ingredient | coproduct | byproduct */
    kind: text('kind').notNull().default('ingredient'),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    /** percent | fixed | potency */
    basis: text('basis').notNull().default('fixed'),
    qty: numeric('qty', { precision: 18, scale: 6 }).notNull(),
    /** potency basis: assay the quantity assumes (%). */
    stdPotency: numeric('std_potency', { precision: 6, scale: 2 }),
    /** Dispensing tolerance, ± % of the target. */
    tolerancePct: numeric('tolerance_pct', { precision: 5, scale: 2 }),
    /** Co-products: share of the batch cost they carry. */
    costSharePct: numeric('cost_share_pct', { precision: 5, scale: 2 }),
    /** By-products: value per unit credited to the batch. */
    recoveryRate: numeric('recovery_rate', { precision: 18, scale: 4 }),
    stageSeq: smallint('stage_seq'),
    remarks: text('remarks'),
  },
  (t) => [index('formula_lines_f_idx').on(t.formulaId), uniqueIndex('formula_lines_no_uq').on(t.formulaId, t.lineNo)],
);

export const formulaStages = pgTable(
  'formula_stages',
  {
    id: pk(),
    tenantId: tenantId(),
    formulaId: uuid('formula_id')
      .notNull()
      .references(() => formulas.id, { onDelete: 'cascade' }),
    seq: smallint('seq').notNull(),
    name: text('name').notNull(),
    workCenterId: uuid('work_center_id')
      .notNull()
      .references(() => workCenters.id, { onDelete: 'restrict' }),
    /** Per standard batch. */
    minutes: numeric('minutes', { precision: 10, scale: 2 }).notNull().default('0'),
    parameters: jsonb('parameters').$type<StageParameter[]>().notNull().default([]),
    instructions: text('instructions'),
  },
  (t) => [index('formula_stages_f_idx').on(t.formulaId), uniqueIndex('formula_stages_seq_uq').on(t.formulaId, t.seq)],
);

/** Every weighing at the dispensing booth: lot, assay, target, what was weighed, who checked it. */
export const dispensings = pgTable(
  'dispensings',
  {
    id: pk(),
    tenantId: tenantId(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    materialId: uuid('material_id')
      .notNull()
      .references(() => workOrderMaterials.id, { onDelete: 'cascade' }),
    /** The production entry that issued it. */
    entryId: uuid('entry_id').references(() => documents.id, { onDelete: 'set null' }),
    batchNo: text('batch_no'),
    assayPct: numeric('assay_pct', { precision: 6, scale: 2 }),
    targetQty: numeric('target_qty', { precision: 18, scale: 4 }).notNull(),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    withinTolerance: boolean('within_tolerance').notNull(),
    overrideReason: text('override_reason'),
    dispensedBy: uuid('dispensed_by').references(() => users.id, { onDelete: 'set null' }),
    checkedBy: text('checked_by'),
    dispensedAt: timestamp('dispensed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dispensings_wo_idx').on(t.workOrderId)],
);

/** Cleaning of process equipment: who cleaned, who verified, after which product. */
export const machineCleanings = pgTable(
  'machine_cleanings',
  {
    id: pk(),
    tenantId: tenantId(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    /** minor (same product) | major | product_change */
    kind: text('kind').notNull().default('minor'),
    previousItemId: uuid('previous_item_id').references(() => items.id, { onDelete: 'set null' }),
    cleanedBy: text('cleaned_by').notNull(),
    verifiedBy: text('verified_by'),
    /** Swab / rinse result for cleaning validation. */
    result: text('result'),
    notes: text('notes'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    cleanedAt: timestamp('cleaned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('machine_cleanings_m_idx').on(t.machineId, t.cleanedAt)],
);

/** Blending lots of one item into a new lot (doc type "blend"). */
export const blends = pgTable('blends', {
  id: uuid('id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  tenantId: tenantId(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'restrict' }),
  warehouseId: uuid('warehouse_id')
    .notNull()
    .references(() => warehouses.id, { onDelete: 'restrict' }),
  newBatchNo: text('new_batch_no').notNull(),
  expiryDate: date('expiry_date', { mode: 'string' }),
  totalQty: numeric('total_qty', { precision: 18, scale: 4 }).notNull().default('0'),
  value: numeric('value', { precision: 18, scale: 2 }).notNull().default('0'),
  notes: text('notes'),
});

export const blendLines = pgTable(
  'blend_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    blendId: uuid('blend_id')
      .notNull()
      .references(() => blends.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    batchNo: text('batch_no').notNull(),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    value: numeric('value', { precision: 18, scale: 2 }).notNull().default('0'),
  },
  (t) => [index('blend_lines_b_idx').on(t.blendId), uniqueIndex('blend_lines_no_uq').on(t.blendId, t.lineNo)],
);
