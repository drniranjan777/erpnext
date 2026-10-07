import { boolean, date, index, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { documents } from './documents';
import { users } from './iam';
import { parties } from './masters';
import { tenantId } from './tenancy';

const money = (name: string) => numeric(name, { precision: 16, scale: 2 });

export const crmTerritories = pgTable(
  'crm_territories',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => crmTerritories.id, { onDelete: 'set null' }),
    /** GST state codes covered; leads from these states are assigned here. */
    stateCodes: text('state_codes').array().notNull().default([]),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('crm_territories_code_uq').on(t.tenantId, t.code)],
);

export const crmStages = pgTable(
  'crm_stages',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    probability: smallint('probability').notNull(),
    sequence: smallint('sequence').notNull(),
    /** open | won | lost */
    kind: text('kind').notNull().default('open'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [index('crm_stages_seq_idx').on(t.tenantId, t.sequence)],
);

export const crmLeads = pgTable(
  'crm_leads',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    name: text('name').notNull(),
    company: text('company'),
    email: citext('email'),
    phone: text('phone'),
    city: text('city'),
    stateCode: text('state_code'),
    /** web | indiamart | tradeindia | justdial | whatsapp | email | referral | walk_in | exhibition | other */
    source: text('source').notNull().default('other'),
    /** The portal's enquiry id, so an import does not duplicate. */
    sourceRef: text('source_ref'),
    requirement: text('requirement'),
    product: text('product'),
    estimatedValue: money('estimated_value'),
    /** new | contacted | qualified | unqualified | converted | lost */
    status: text('status').notNull().default('new'),
    score: smallint('score').notNull().default(0),
    scoreReasons: jsonb('score_reasons').$type<string[]>().notNull().default([]),
    duplicateOfId: uuid('duplicate_of_id'),
    territoryId: uuid('territory_id').references(() => crmTerritories.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'set null' }),
    opportunityId: uuid('opportunity_id'),
    lostReason: text('lost_reason'),
    nextFollowUp: date('next_follow_up', { mode: 'string' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('crm_leads_number_uq').on(t.tenantId, t.number), uniqueIndex('crm_leads_source_ref_uq').on(t.tenantId, t.source, t.sourceRef), index('crm_leads_status_idx').on(t.tenantId, t.status), index('crm_leads_phone_idx').on(t.tenantId, t.phone)],
);

export const crmOpportunities = pgTable(
  'crm_opportunities',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    title: text('title').notNull(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    leadId: uuid('lead_id').references(() => crmLeads.id, { onDelete: 'set null' }),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => crmStages.id, { onDelete: 'restrict' }),
    amount: money('amount').notNull().default('0'),
    closeDate: date('close_date', { mode: 'string' }),
    /** Overrides the stage's probability when set. */
    probability: smallint('probability'),
    /** open | won | lost */
    status: text('status').notNull().default('open'),
    lostReason: text('lost_reason'),
    competitor: text('competitor'),
    quotationId: uuid('quotation_id').references(() => documents.id, { onDelete: 'set null' }),
    territoryId: uuid('territory_id').references(() => crmTerritories.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('crm_opportunities_number_uq').on(t.tenantId, t.number), index('crm_opportunities_stage_idx').on(t.tenantId, t.status, t.stageId)],
);

export const crmActivities = pgTable(
  'crm_activities',
  {
    id: pk(),
    tenantId: tenantId(),
    /** call | meeting | task | note | email | whatsapp */
    kind: text('kind').notNull(),
    subject: text('subject').notNull(),
    notes: text('notes'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    outcome: text('outcome'),
    leadId: uuid('lead_id').references(() => crmLeads.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id').references(() => crmOpportunities.id, { onDelete: 'cascade' }),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('crm_activities_owner_idx').on(t.tenantId, t.ownerId, t.doneAt), index('crm_activities_lead_idx').on(t.leadId), index('crm_activities_opp_idx').on(t.opportunityId)],
);

/** A web enquiry form: its key (tenant id + secret) lets a public website post leads. */
export const crmWebForms = pgTable(
  'crm_web_forms',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    key: text('key').notNull(),
    source: text('source').notNull().default('web'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    submissions: smallint('submissions').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('crm_web_forms_key_uq').on(t.key)],
);

export const crmTargets = pgTable(
  'crm_targets',
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [uniqueIndex('crm_targets_uq').on(t.tenantId, t.userId, t.month)],
);
