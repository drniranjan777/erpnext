import { boolean, date, index, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { documents } from './documents';
import { users } from './iam';
import { items, parties } from './masters';
import { tenantId } from './tenancy';

/** Response and resolution targets per priority, and whether the clock runs only in business hours. */
export const svcSettings = pgTable(
  'svc_settings',
  {
    id: pk(),
    tenantId: tenantId(),
    targets: jsonb('targets').$type<Record<string, { response: number; resolution: number }>>().notNull(),
    businessHours: jsonb('business_hours').$type<{ start: string; end: string; days: number[] } | null>(),
    /** Who escalations go to beyond the assignee. */
    escalateToId: uuid('escalate_to_id').references(() => users.id, { onDelete: 'set null' }),
    /** Months of warranty when the item has none set. */
    defaultWarrantyMonths: smallint('default_warranty_months').notNull().default(12),
  },
  (t) => [uniqueIndex('svc_settings_tenant_uq').on(t.tenantId)],
);

export const svcContracts = pgTable(
  'svc_contracts',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    /** amc_labour | amc_comprehensive | warranty_extension */
    kind: text('kind').notNull(),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    value: numeric('value', { precision: 16, scale: 2 }).notNull().default('0'),
    visitsPerYear: smallint('visits_per_year').notNull().default(0),
    /** Serial numbers covered; empty = every machine of the customer. */
    serials: text('serials').array().notNull().default([]),
    /** Resolution target overriding the default, in minutes. */
    resolutionMinutes: smallint('resolution_minutes'),
    /** active | cancelled */
    status: text('status').notNull().default('active'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('svc_contracts_number_uq').on(t.tenantId, t.number), index('svc_contracts_party_idx').on(t.partyId)],
);

export const svcWarranties = pgTable(
  'svc_warranties',
  {
    id: pk(),
    tenantId: tenantId(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    serialNo: citext('serial_no').notNull(),
    invoiceId: uuid('invoice_id').references(() => documents.id, { onDelete: 'set null' }),
    saleDate: date('sale_date', { mode: 'string' }),
    /** Starts at installation when there is one, else at the sale. */
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    /** active | void */
    status: text('status').notNull().default('active'),
    registeredBy: uuid('registered_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('svc_warranties_serial_uq').on(t.tenantId, t.itemId, t.serialNo)],
);

export const svcTickets = pgTable(
  'svc_tickets',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'set null' }),
    contactName: text('contact_name'),
    contactEmail: citext('contact_email'),
    contactPhone: text('contact_phone'),
    /** email | phone | portal | whatsapp | walk_in | field */
    channel: text('channel').notNull().default('phone'),
    subject: text('subject').notNull(),
    description: text('description'),
    /** query | complaint | breakdown | installation | warranty | other */
    category: text('category').notNull().default('query'),
    /** low | medium | high | urgent */
    priority: text('priority').notNull().default('medium'),
    /** open | in_progress | waiting_customer | resolved | closed */
    status: text('status').notNull().default('open'),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    serialNo: text('serial_no'),
    warrantyId: uuid('warranty_id').references(() => svcWarranties.id, { onDelete: 'set null' }),
    contractId: uuid('contract_id').references(() => svcContracts.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    responseDueAt: timestamp('response_due_at', { withTimezone: true }),
    resolutionDueAt: timestamp('resolution_due_at', { withTimezone: true }),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    escalationLevel: smallint('escalation_level').notNull().default(0),
    resolution: text('resolution'),
    /** 1–5 from the customer. */
    rating: smallint('rating'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('svc_tickets_number_uq').on(t.tenantId, t.number), index('svc_tickets_status_idx').on(t.tenantId, t.status), index('svc_tickets_party_idx').on(t.partyId)],
);

export const svcTicketEvents = pgTable(
  'svc_ticket_events',
  {
    id: pk(),
    tenantId: tenantId(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => svcTickets.id, { onDelete: 'cascade' }),
    /** note | reply | status | assign | escalation | customer */
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('svc_ticket_events_idx').on(t.ticketId, t.createdAt)],
);

export const svcArticles = pgTable(
  'svc_articles',
  {
    id: pk(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    category: text('category'),
    tags: text('tags').array().notNull().default([]),
    /** Shown to customers on the portal. */
    isPublic: boolean('is_public').notNull().default(false),
    views: smallint('views').notNull().default(0),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('svc_articles_search_idx').using('gin', t.tags)],
);

/** Installation, commissioning, preventive (contract) or breakdown visits by a technician. */
export const svcVisits = pgTable(
  'svc_visits',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    /** installation | preventive | breakdown */
    kind: text('kind').notNull(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    ticketId: uuid('ticket_id').references(() => svcTickets.id, { onDelete: 'set null' }),
    contractId: uuid('contract_id').references(() => svcContracts.id, { onDelete: 'set null' }),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    serialNo: text('serial_no'),
    technicianId: uuid('technician_id').references(() => users.id, { onDelete: 'set null' }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** scheduled | in_progress | done | cancelled */
    status: text('status').notNull().default('scheduled'),
    workDone: text('work_done'),
    checklist: jsonb('checklist').$type<{ item: string; ok: boolean }[]>().notNull().default([]),
    spares: jsonb('spares').$type<{ itemId: string; qty: string; batchNo?: string | null }[]>().notNull().default([]),
    /** The stock entry that issued the spares. */
    stockEntryId: uuid('stock_entry_id').references(() => documents.id, { onDelete: 'set null' }),
    /** Spares and labour billable (out of warranty / contract). */
    chargeable: boolean('chargeable').notNull().default(false),
    signedBy: text('signed_by'),
    /** PNG data URL of the customer's signature. */
    signature: text('signature'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('svc_visits_number_uq').on(t.tenantId, t.number), index('svc_visits_tech_idx').on(t.tenantId, t.technicianId, t.scheduledAt)],
);

export const svcRmas = pgTable(
  'svc_rmas',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    serialNo: text('serial_no'),
    ticketId: uuid('ticket_id').references(() => svcTickets.id, { onDelete: 'set null' }),
    reason: text('reason').notNull(),
    underWarranty: boolean('under_warranty').notNull().default(false),
    /** authorised | received | repairing | repaired | replaced | returned | rejected */
    status: text('status').notNull().default('authorised'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    diagnosis: text('diagnosis'),
    repairNotes: text('repair_notes'),
    replacementSerial: text('replacement_serial'),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    dispatchRef: text('dispatch_ref'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('svc_rmas_number_uq').on(t.tenantId, t.number)],
);
