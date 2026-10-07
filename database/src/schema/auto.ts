import { date, index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { users } from './iam';
import { items, parties } from './masters';
import { eSignatures } from './quality';
import { tenantId } from './tenancy';

export interface ApqpDeliverable {
  code: string;
  phase: number;
  name: string;
  /** open | in_progress | done | na */
  status: string;
  owner?: string | null;
  due?: string | null;
  notes?: string | null;
}

/** An APQP project for a new or changed part. */
export const apqpProjects = pgTable(
  'apqp_projects',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    customerId: uuid('customer_id').references(() => parties.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    customerPartNo: text('customer_part_no'),
    program: text('program'),
    /** Customer's start of production. */
    sopDate: date('sop_date', { mode: 'string' }),
    deliverables: jsonb('deliverables').$type<ApqpDeliverable[]>().notNull(),
    /** Phase gates passed: phase number → signature id. */
    gates: jsonb('gates').$type<Record<string, string>>().notNull().default({}),
    /** active | completed | cancelled */
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('apqp_projects_code_uq').on(t.tenantId, t.code)],
);

export interface PpapElement {
  no: number;
  name: string;
  /** S submit to customer, R retain and make available, * as the customer specifies */
  requirement: 'S' | 'R' | '*';
  /** not_started | in_progress | complete | na */
  status: string;
  reference?: string | null;
  notes?: string | null;
}

/** A PPAP submission (AIAG PPAP 4th edition): 18 elements, submission level, PSW and the customer's decision. */
export const ppapSubmissions = pgTable(
  'ppap_submissions',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    apqpProjectId: uuid('apqp_project_id').references(() => apqpProjects.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').references(() => parties.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    customerPartNo: text('customer_part_no'),
    drawingRev: text('drawing_rev'),
    level: smallint('level').notNull(),
    /** initial | engineering_change | tooling | correction | other */
    reason: text('reason').notNull(),
    elements: jsonb('elements').$type<PpapElement[]>().notNull(),
    /** draft | submitted | approved | interim | rejected */
    status: text('status').notNull().default('draft'),
    pswSignatureId: uuid('psw_signature_id').references(() => eSignatures.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    customerDecisionAt: timestamp('customer_decision_at', { withTimezone: true }),
    customerComments: text('customer_comments'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ppap_code_uq').on(t.tenantId, t.code), index('ppap_item_idx').on(t.tenantId, t.itemId)],
);

export interface FmeaRow {
  id: string;
  /** Process step (PFMEA) or function (DFMEA). */
  step: string;
  failureMode: string;
  effect: string;
  severity: number;
  /** CC (critical) | SC (significant) | null */
  special?: string | null;
  cause: string;
  prevention?: string | null;
  occurrence: number;
  detectionControl?: string | null;
  detection: number;
  action?: string | null;
  owner?: string | null;
  due?: string | null;
  done?: boolean;
  newSeverity?: number | null;
  newOccurrence?: number | null;
  newDetection?: number | null;
}

/** A design or process FMEA (AIAG-VDA), with action priority per row. */
export const fmeas = pgTable(
  'fmeas',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    /** design | process */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    team: text('team'),
    revision: smallint('revision').notNull().default(1),
    rows: jsonb('rows').$type<FmeaRow[]>().notNull().default([]),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('fmeas_code_uq').on(t.tenantId, t.code)],
);

export interface ControlPlanRow {
  step: string;
  machine?: string | null;
  characteristic: string;
  /** product | process */
  type: string;
  special?: string | null;
  specification: string;
  technique: string;
  sampleSize: string;
  frequency: string;
  method: string;
  reaction: string;
}

/** A control plan (prototype, pre-launch or production) for a part. */
export const controlPlans = pgTable(
  'control_plans',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    fmeaId: uuid('fmea_id').references(() => fmeas.id, { onDelete: 'set null' }),
    /** prototype | pre_launch | production */
    phase: text('phase').notNull(),
    revision: smallint('revision').notNull().default(1),
    rows: jsonb('rows').$type<ControlPlanRow[]>().notNull().default([]),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('control_plans_code_uq').on(t.tenantId, t.code)],
);

/** Layered process audit checklist for an area. */
export const lpaChecklists = pgTable(
  'lpa_checklists',
  {
    id: pk(),
    tenantId: tenantId(),
    area: text('area').notNull(),
    questions: jsonb('questions').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lpa_checklists_idx').on(t.tenantId)],
);

/** One layered process audit: layer 1 (supervisors, daily), 2 (managers, weekly), 3 (plant head, monthly). */
export const lpaAudits = pgTable(
  'lpa_audits',
  {
    id: pk(),
    tenantId: tenantId(),
    checklistId: uuid('checklist_id')
      .notNull()
      .references(() => lpaChecklists.id, { onDelete: 'cascade' }),
    layer: smallint('layer').notNull(),
    auditor: uuid('auditor').references(() => users.id, { onDelete: 'set null' }),
    auditedOn: date('audited_on', { mode: 'string' }).notNull(),
    answers: jsonb('answers').$type<{ question: string; answer: 'yes' | 'no' | 'na'; note?: string | null; fixedOnSpot?: boolean }[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lpa_audits_idx').on(t.tenantId, t.checklistId, t.auditedOn)],
);

/** A customer-specific requirement (IATF 16949 clause 4.3.2) and how it is met. */
export const csrRequirements = pgTable(
  'csr_requirements',
  {
    id: pk(),
    tenantId: tenantId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    reference: text('reference'),
    requirement: text('requirement').notNull(),
    clause: text('clause'),
    howMet: text('how_met'),
    /** open | met | not_applicable */
    status: text('status').notNull().default('open'),
    reviewedOn: date('reviewed_on', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('csr_customer_idx').on(t.tenantId, t.customerId)],
);

/** An EDI trading partner (EDIFACT interchange ids) and its part-number mapping. */
export const ediPartners = pgTable(
  'edi_partners',
  {
    id: pk(),
    tenantId: tenantId(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    ourId: text('our_id').notNull(),
    theirId: text('their_id').notNull(),
    /** Customer part number → item. */
    partMap: jsonb('part_map').$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [uniqueIndex('edi_partners_uq').on(t.tenantId, t.theirId)],
);

/** An EDI message received or sent. */
export const ediMessages = pgTable(
  'edi_messages',
  {
    id: pk(),
    tenantId: tenantId(),
    partnerId: uuid('partner_id').references(() => ediPartners.id, { onDelete: 'set null' }),
    /** in | out */
    direction: text('direction').notNull(),
    /** DELFOR | DELJIT | DESADV | INVOIC */
    type: text('type').notNull(),
    reference: text('reference'),
    raw: text('raw').notNull(),
    parsed: jsonb('parsed').$type<Record<string, unknown>>(),
    /** received | processed | error | sent */
    status: text('status').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('edi_messages_idx').on(t.tenantId, t.createdAt)],
);
