import { boolean, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { documents } from './documents';
import { users } from './iam';
import { workOrders } from './manufacturing';
import { items, parties } from './masters';
import { capas } from './quality';
import { tenantId } from './tenancy';

// =============================================================================
// Deviations (doc type "deviation")
// =============================================================================

/**
 * A departure from an approved procedure, specification or process: planned (approved in
 * advance, for a limited time or quantity) or unplanned (found after the fact). Risk is rated
 * by severity × occurrence × detection; approval is QA's decision.
 */
export const deviations = pgTable(
  'deviations',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    /** planned | unplanned */
    kind: text('kind').notNull(),
    /** process | material | equipment | document | environment | other */
    category: text('category').notNull(),
    description: text('description').notNull(),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    batchNo: text('batch_no'),
    workOrderId: uuid('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
    impact: text('impact'),
    severity: smallint('severity').notNull(),
    occurrence: smallint('occurrence').notNull(),
    detection: smallint('detection').notNull(),
    rpn: smallint('rpn').notNull(),
    /** low | medium | high */
    riskLevel: text('risk_level').notNull(),
    productImpact: boolean('product_impact').notNull().default(false),
    proposedAction: text('proposed_action'),
    /** Planned deviations: until when they apply. */
    validUntil: date('valid_until', { mode: 'string' }),
    capaId: uuid('capa_id').references(() => capas.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closureNotes: text('closure_notes'),
  },
  (t) => [index('deviations_item_idx').on(t.tenantId, t.itemId)],
);

// =============================================================================
// Calibration and MSA
// =============================================================================

export const gauges = pgTable(
  'gauges',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** vernier | micrometer | gauge | balance | thermometer | pressure | other */
    kind: text('kind').notNull().default('other'),
    make: text('make'),
    serialNo: text('serial_no'),
    range: text('range'),
    leastCount: text('least_count'),
    location: text('location'),
    owner: text('owner'),
    /** internal | external (calibrated by an accredited lab) */
    calibrationSource: text('calibration_source').notNull().default('external'),
    intervalDays: integer('interval_days').notNull().default(365),
    acceptance: text('acceptance'),
    lastCalibrated: date('last_calibrated', { mode: 'string' }),
    nextDue: date('next_due', { mode: 'string' }),
    /** in_use | out_of_service | scrapped */
    status: text('status').notNull().default('in_use'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('gauges_code_uq').on(t.tenantId, t.code), index('gauges_due_idx').on(t.tenantId, t.nextDue)],
);

export interface CalibrationPoint {
  nominal: string;
  actual: string;
  error: string;
}

export const calibrations = pgTable(
  'calibrations',
  {
    id: pk(),
    tenantId: tenantId(),
    gaugeId: uuid('gauge_id')
      .notNull()
      .references(() => gauges.id, { onDelete: 'cascade' }),
    calibratedOn: date('calibrated_on', { mode: 'string' }).notNull(),
    calibratedBy: text('calibrated_by').notNull(),
    certificateNo: text('certificate_no'),
    /** pass | adjusted | fail */
    result: text('result').notNull(),
    points: jsonb('points').$type<CalibrationPoint[]>().notNull().default([]),
    nextDue: date('next_due', { mode: 'string' }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('calibrations_gauge_idx').on(t.gaugeId, t.calibratedOn)],
);

export const grrStudies = pgTable(
  'grr_studies',
  {
    id: pk(),
    tenantId: tenantId(),
    gaugeId: uuid('gauge_id')
      .notNull()
      .references(() => gauges.id, { onDelete: 'cascade' }),
    studyDate: date('study_date', { mode: 'string' }).notNull(),
    characteristic: text('characteristic').notNull(),
    tolerance: numeric('tolerance', { precision: 18, scale: 6 }),
    operators: jsonb('operators').$type<string[]>().notNull().default([]),
    /** [operator][part][trial] */
    measurements: jsonb('measurements').$type<number[][][]>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('grr_gauge_idx').on(t.gaugeId)],
);

// =============================================================================
// Internal audits
// =============================================================================

export const internalAudits = pgTable(
  'internal_audits',
  {
    id: pk(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    /** ISO 9001, IATF 16949, GMP, ISO 14001, ISO 45001, FSSC 22000… */
    standard: text('standard').notNull(),
    area: text('area').notNull(),
    plannedDate: date('planned_date', { mode: 'string' }).notNull(),
    auditor: text('auditor').notNull(),
    auditee: text('auditee'),
    /** planned | done */
    status: text('status').notNull().default('planned'),
    doneOn: date('done_on', { mode: 'string' }),
    summary: text('summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('internal_audits_date_idx').on(t.tenantId, t.plannedDate)],
);

export const auditFindings = pgTable(
  'audit_findings',
  {
    id: pk(),
    tenantId: tenantId(),
    auditId: uuid('audit_id')
      .notNull()
      .references(() => internalAudits.id, { onDelete: 'cascade' }),
    /** major_nc | minor_nc | observation | ofi */
    kind: text('kind').notNull(),
    clause: text('clause'),
    description: text('description').notNull(),
    capaId: uuid('capa_id').references(() => capas.id, { onDelete: 'set null' }),
    closedOn: date('closed_on', { mode: 'string' }),
  },
  (t) => [index('audit_findings_audit_idx').on(t.auditId)],
);

// =============================================================================
// SOPs (doc type "sop") and training acknowledgement
// =============================================================================

export const sops = pgTable(
  'sops',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    sopCode: citext('sop_code').notNull(),
    sopVersion: smallint('sop_version').notNull().default(1),
    title: text('title').notNull(),
    department: text('department'),
    purpose: text('purpose'),
    body: text('body'),
    effectiveDate: date('effective_date', { mode: 'string' }),
    reviewDue: date('review_due', { mode: 'string' }),
    previousId: uuid('previous_id').references((): AnyPgColumn => sops.id, { onDelete: 'set null' }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('sops_code_version_uq').on(t.tenantId, t.sopCode, t.sopVersion)],
);

/** Who must be trained on an SOP version, and when they acknowledged reading it. */
export const sopTrainees = pgTable(
  'sop_trainees',
  {
    tenantId: tenantId(),
    sopId: uuid('sop_id')
      .notNull()
      .references(() => sops.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('sop_trainees_uq').on(t.sopId, t.userId), index('sop_trainees_user_idx').on(t.tenantId, t.userId)],
);

// =============================================================================
// HSE: incidents, hazardous waste, EPR, licences and permits
// =============================================================================

export const hseIncidents = pgTable(
  'hse_incidents',
  {
    id: pk(),
    tenantId: tenantId(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** injury | near_miss | property_damage | environmental | fire | other */
    kind: text('kind').notNull(),
    severity: text('severity').notNull().default('minor'),
    location: text('location').notNull(),
    description: text('description').notNull(),
    personInvolved: text('person_involved'),
    lostDays: integer('lost_days').notNull().default(0),
    immediateAction: text('immediate_action'),
    rootCause: text('root_cause'),
    capaId: uuid('capa_id').references(() => capas.id, { onDelete: 'set null' }),
    /** open | closed */
    status: text('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    reportedBy: uuid('reported_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('hse_incidents_date_idx').on(t.tenantId, t.occurredAt)],
);

/** Hazardous waste register (Hazardous and Other Wastes Rules, 2016: Form 3 record, Form 10 manifest). */
export const hazardousWaste = pgTable(
  'hazardous_waste',
  {
    id: pk(),
    tenantId: tenantId(),
    /** Schedule I category, e.g. "5.1 Used or spent oil". */
    category: text('category').notNull(),
    description: text('description'),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull(),
    unit: text('unit').notNull().default('kg'),
    generatedOn: date('generated_on', { mode: 'string' }).notNull(),
    storedAt: text('stored_at'),
    disposedOn: date('disposed_on', { mode: 'string' }),
    disposalAgency: text('disposal_agency'),
    /** Form 10 manifest number. */
    manifestNo: text('manifest_no'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('hazardous_waste_date_idx').on(t.tenantId, t.generatedOn)],
);

/** Extended producer responsibility targets and what was achieved, per category and year. */
export const eprObligations = pgTable(
  'epr_obligations',
  {
    id: pk(),
    tenantId: tenantId(),
    /** plastic_packaging | e_waste | battery | tyre | used_oil */
    category: text('category').notNull(),
    fiscalYear: text('fiscal_year').notNull(),
    targetKg: numeric('target_kg', { precision: 18, scale: 3 }).notNull(),
    achievedKg: numeric('achieved_kg', { precision: 18, scale: 3 }).notNull().default('0'),
    certificates: text('certificates'),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('epr_uq').on(t.tenantId, t.category, t.fiscalYear)],
);

export const licences = pgTable(
  'licences',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    /** factory | pollution_cte | pollution_cto | fire_noc | peso | fssai | drug | boiler | trade | other */
    kind: text('kind').notNull(),
    authority: text('authority').notNull(),
    number: text('number'),
    issuedOn: date('issued_on', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    /** Start renewal this many days before expiry. */
    renewalLeadDays: integer('renewal_lead_days').notNull().default(60),
    owner: text('owner'),
    notes: text('notes'),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('licences_expiry_idx').on(t.tenantId, t.validUntil)],
);
