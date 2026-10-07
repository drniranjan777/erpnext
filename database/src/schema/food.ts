import { boolean, date, doublePrecision, index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { users } from './iam';
import { iotSignals } from './iot';
import { items } from './masters';
import { eSignatures } from './quality';
import { tenantId } from './tenancy';

export interface HaccpHazard {
  id: string;
  step: number;
  /** biological | chemical | physical | allergen */
  type: string;
  description: string;
  /** 1 low – 3 high */
  severity: number;
  likelihood: number;
  controls?: string | null;
  /** Codex decision tree answers: Q1 control measures exist, Q2 step designed to eliminate / reduce, Q3 contamination could exceed acceptable levels, Q4 a later step will eliminate / reduce. */
  q1?: boolean | null;
  q2?: boolean | null;
  q3?: boolean | null;
  q4?: boolean | null;
}

export interface HaccpCcp {
  id: string;
  hazardId: string;
  name: string;
  limitMin?: number | null;
  limitMax?: number | null;
  unit?: string | null;
  monitoring: string;
  frequency: string;
  responsibility: string;
  correctiveAction: string;
  verification: string;
  /** Sensor that measures it continuously, if any. */
  signalId?: string | null;
}

/** A HACCP plan for a product or process (Codex Alimentarius principles). */
export const haccpPlans = pgTable(
  'haccp_plans',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    title: text('title').notNull(),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    scope: text('scope'),
    team: text('team'),
    version: smallint('version').notNull().default(1),
    /** draft | approved */
    status: text('status').notNull().default('draft'),
    steps: jsonb('steps').$type<{ no: number; name: string }[]>().notNull().default([]),
    hazards: jsonb('hazards').$type<HaccpHazard[]>().notNull().default([]),
    ccps: jsonb('ccps').$type<HaccpCcp[]>().notNull().default([]),
    approvalSignatureId: uuid('approval_signature_id').references(() => eSignatures.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('haccp_plans_code_uq').on(t.tenantId, t.code)],
);

/** One monitoring record of a critical control point. */
export const ccpRecords = pgTable(
  'ccp_records',
  {
    id: pk(),
    tenantId: tenantId(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => haccpPlans.id, { onDelete: 'cascade' }),
    ccpId: text('ccp_id').notNull(),
    value: doublePrecision('value').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    /** manual | sensor */
    method: text('method').notNull().default('manual'),
    ok: boolean('ok').notNull(),
    batchNo: text('batch_no'),
    correctiveAction: text('corrective_action'),
    productHeld: boolean('product_held').notNull().default(false),
    signalId: uuid('signal_id').references(() => iotSignals.id, { onDelete: 'set null' }),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('ccp_records_idx').on(t.tenantId, t.planId, t.recordedAt)],
);

/** Allergens an item contains, and may contain through cross-contact. */
export const itemAllergens = pgTable(
  'item_allergens',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    contains: jsonb('contains').$type<string[]>().notNull().default([]),
    mayContain: jsonb('may_contain').$type<string[]>().notNull().default([]),
  },
  (t) => [uniqueIndex('item_allergens_uq').on(t.tenantId, t.itemId)],
);

export interface RecallTrace {
  customers: { party: string; documents: string[]; qty: number }[];
  lotsMadeFrom: { item: string; batchNo: string | null }[];
  usedIn: { item: string; batchNo: string | null }[];
  onHand: { warehouse: string; qty: number }[];
  dispatchedQty: number;
}

/** A product recall, real or a mock-recall drill, with how fast and how completely it was traced. */
export const recalls = pgTable(
  'recalls',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    /** mock | real */
    kind: text('kind').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    batchNo: text('batch_no').notNull(),
    reason: text('reason').notNull(),
    /** I (serious risk) | II | III */
    recallClass: text('recall_class'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    traceCompletedAt: timestamp('trace_completed_at', { withTimezone: true }),
    trace: jsonb('trace').$type<RecallTrace>(),
    recovered: jsonb('recovered').$type<{ party: string; qty: number; note?: string | null; at: string }[]>().notNull().default([]),
    /** open | closed */
    status: text('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    conclusion: text('conclusion'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('recalls_code_uq').on(t.tenantId, t.code)],
);

/**
 * A certificate or registration with an expiry: supplier food-safety certificates (FSSC 22000,
 * BRCGS, ISO 22000, FSSAI licence), textile (GOTS, OEKO-TEX), BIS registrations, and so on.
 */
export const complianceCertificates = pgTable(
  'compliance_certificates',
  {
    id: pk(),
    tenantId: tenantId(),
    /** party | item | company */
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    /** fssc22000 | brcgs | iso22000 | fssai | halal | organic | gots | oekotex | bis | iso9001 | iatf16949 | other */
    type: text('type').notNull(),
    number: text('number').notNull(),
    issuer: text('issuer'),
    scope: text('scope'),
    validFrom: date('valid_from', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    url: text('url'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('compliance_certificates_idx').on(t.tenantId, t.subjectType, t.subjectId), index('compliance_certificates_expiry_idx').on(t.tenantId, t.validUntil)],
);

export interface Nutrition {
  energyKcal: number;
  protein: number;
  carbohydrate: number;
  totalSugars: number;
  addedSugars: number;
  totalFat: number;
  saturatedFat: number;
  transFat: number;
  cholesterolMg?: number | null;
  sodiumMg: number;
}

/** What goes on a pre-packaged food label (FSS Labelling and Display Regulations, 2020). */
export const foodLabels = pgTable(
  'food_labels',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** veg | non_veg */
    vegMark: text('veg_mark').notNull(),
    ingredients: text('ingredients').notNull(),
    /** Per 100 g (or 100 ml). */
    nutrition: jsonb('nutrition').$type<Nutrition>().notNull(),
    servingSizeG: doublePrecision('serving_size_g'),
    netQuantity: text('net_quantity'),
    storage: text('storage'),
    fssaiLicenceNo: text('fssai_licence_no'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('food_labels_item_uq').on(t.tenantId, t.itemId)],
);
