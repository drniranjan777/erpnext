import { boolean, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { crmOpportunities } from './crm';
import { documents } from './documents';
import { users } from './iam';
import { items, parties } from './masters';
import { tenantId } from './tenancy';

const money = (name: string) => numeric(name, { precision: 16, scale: 2 });

// =============================================================================
// Configure-price-quote
// =============================================================================

export const cpqEstimates = pgTable(
  'cpq_estimates',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    /** box | fabrication | furniture | configured */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'set null' }),
    opportunityId: uuid('opportunity_id').references(() => crmOpportunities.id, { onDelete: 'set null' }),
    /** The item the quotation line uses (often a generic "made to order" item). */
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    unitCost: money('unit_cost').notNull(),
    unitPrice: money('unit_price').notNull(),
    marginPct: numeric('margin_pct', { precision: 5, scale: 2 }).notNull(),
    /** draft | quoted */
    status: text('status').notNull().default('draft'),
    quotationId: uuid('quotation_id').references(() => documents.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cpq_estimates_number_uq').on(t.tenantId, t.number), index('cpq_estimates_party_idx').on(t.partyId)],
);

/** Configurable options of an item: groups of choices with price deltas and excludes / requires rules. */
export const cpqOptionGroups = pgTable(
  'cpq_option_groups',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    required: boolean('required').notNull().default(false),
    multi: boolean('multi').notNull().default(false),
    sequence: smallint('sequence').notNull().default(1),
    options: jsonb('options').$type<{ code: string; label: string; priceDelta: number; excludes?: string[]; requires?: string[] }[]>().notNull().default([]),
  },
  (t) => [uniqueIndex('cpq_option_groups_uq').on(t.itemId, t.code)],
);

export const cpqQuoteTemplates = pgTable('cpq_quote_templates', {
  id: pk(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  terms: text('terms').notNull(),
  validityDays: smallint('validity_days').notNull().default(30),
  isDefault: boolean('is_default').notNull().default(false),
});

// =============================================================================
// Customer delivery schedules (OEM releases) and advance shipping notices
// =============================================================================

export const customerSchedules = pgTable(
  'customer_schedules',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    customerPartNo: text('customer_part_no'),
    /** YYYY-MM the schedule covers. */
    month: text('month').notNull(),
    revision: smallint('revision').notNull().default(0),
    /** active | superseded */
    status: text('status').notNull().default('active'),
    reference: text('reference'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('customer_schedules_rev_uq').on(t.tenantId, t.customerId, t.itemId, t.month, t.revision), index('customer_schedules_month_idx').on(t.tenantId, t.month)],
);

export const customerScheduleLines = pgTable(
  'customer_schedule_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => customerSchedules.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
  },
  (t) => [index('customer_schedule_lines_idx').on(t.scheduleId, t.date)],
);

export const asns = pgTable(
  'asns',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }).notNull(),
    expectedAt: timestamp('expected_at', { withTimezone: true }),
    transporter: text('transporter'),
    vehicleNo: text('vehicle_no'),
    lrNo: text('lr_no'),
    packages: integer('packages'),
    lines: jsonb('lines').$type<{ itemCode: string; itemName: string; customerPartNo: string | null; qty: string; uom: string; batchNo: string | null }[]>().notNull(),
    /** sent | received */
    status: text('status').notNull().default('sent'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('asns_number_uq').on(t.tenantId, t.number), uniqueIndex('asns_delivery_uq').on(t.deliveryId)],
);
