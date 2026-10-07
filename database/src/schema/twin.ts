import { boolean, doublePrecision, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { users } from './iam';
import { iotGateways } from './iot';
import { jobCards, machines, workCenters } from './manufacturing';
import { tenantId } from './tenancy';

/** A floor plan of a plant or line: the canvas for the digital twin. */
export const twinLayouts = pgTable(
  'twin_layouts',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    /** Canvas size in grid units (1 unit ≈ 1 metre). */
    width: smallint('width').notNull().default(60),
    height: smallint('height').notNull().default(30),
    isDefault: boolean('is_default').notNull().default(false),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('twin_layouts_idx').on(t.tenantId)],
);

/** Something placed on a layout: a machine (shown live), an area or a label. */
export const twinNodes = pgTable(
  'twin_nodes',
  {
    id: pk(),
    tenantId: tenantId(),
    layoutId: uuid('layout_id')
      .notNull()
      .references(() => twinLayouts.id, { onDelete: 'cascade' }),
    /** machine | area | label */
    kind: text('kind').notNull(),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'cascade' }),
    workCenterId: uuid('work_center_id').references(() => workCenters.id, { onDelete: 'set null' }),
    label: text('label'),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    w: doublePrecision('w').notNull().default(4),
    h: doublePrecision('h').notNull().default(3),
  },
  (t) => [index('twin_nodes_layout_idx').on(t.tenantId, t.layoutId)],
);

/** A vision inspection model version run on edge gateways. */
export const visionModels = pgTable(
  'vision_models',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    version: text('version').notNull(),
    /** What it decides: defect classes it reports, besides "ok". */
    classes: jsonb('classes').$type<string[]>().notNull().default([]),
    /** Below this confidence a result is treated as uncertain (sent for review). */
    minConfidence: doublePrecision('min_confidence').notNull().default(0.6),
    /** Where the model file is (artifact store / URL the gateway downloads). */
    artifactUrl: text('artifact_url'),
    /** Validation results from training. */
    validation: jsonb('validation').$type<{ precision?: number; recall?: number; samples?: number }>(),
    /** draft | deployed | retired */
    status: text('status').notNull().default('draft'),
    deployedAt: timestamp('deployed_at', { withTimezone: true }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('vision_models_uq').on(t.tenantId, t.name, t.version)],
);

/** Which gateway runs which model version, and whether it confirmed loading it. */
export const visionDeployments = pgTable(
  'vision_deployments',
  {
    id: pk(),
    tenantId: tenantId(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => visionModels.id, { onDelete: 'cascade' }),
    gatewayId: uuid('gateway_id')
      .notNull()
      .references(() => iotGateways.id, { onDelete: 'cascade' }),
    commandId: uuid('command_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('vision_deployments_uq').on(t.tenantId, t.modelId, t.gatewayId)],
);

/** One inspected part: the model's decision, and a person's review when there is one. */
export const visionInspections = pgTable(
  'vision_inspections',
  {
    id: pk(),
    tenantId: tenantId(),
    gatewayId: uuid('gateway_id').references(() => iotGateways.id, { onDelete: 'set null' }),
    modelId: uuid('model_id').references(() => visionModels.id, { onDelete: 'set null' }),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    jobCardId: uuid('job_card_id').references(() => jobCards.id, { onDelete: 'set null' }),
    /** Unique per gateway, so a replayed result is stored once. */
    ref: text('ref').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    /** ok | defect */
    result: text('result').notNull(),
    defectClass: text('defect_class'),
    confidence: doublePrecision('confidence').notNull(),
    imageUrl: text('image_url'),
    latencyMs: integer('latency_ms'),
    /** correct | wrong (a person checked the part) */
    review: text('review'),
    actualClass: text('actual_class'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('vision_inspections_ref_uq').on(t.tenantId, t.gatewayId, t.ref), index('vision_inspections_idx').on(t.tenantId, t.ts), index('vision_inspections_model_idx').on(t.tenantId, t.modelId, t.ts)],
);
