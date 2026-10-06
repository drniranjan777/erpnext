import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, createdAt, pk, timestamps } from './_columns';
import { users } from './iam';
import { tenantId } from './tenancy';

// =============================================================================
// Background jobs (PostgreSQL queue, ADR-013)
// =============================================================================

export const jobStatus = pgEnum('job_status', ['queued', 'running', 'done', 'failed', 'dead']);

/**
 * Transactional job queue: jobs are inserted in the same transaction as the
 * business change (outbox pattern) and claimed with FOR UPDATE SKIP LOCKED via
 * the security-definer functions in sql/rls.sql.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: pk(),
    tenantId: tenantId(),
    queue: text('queue').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: jobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    /** Idempotency: a second enqueue with the same key is ignored. */
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('jobs_ready_idx').on(t.status, t.runAt).where(sql`${t.status} in ('queued', 'running')`),
    uniqueIndex('jobs_dedupe_uq').on(t.tenantId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
  ],
);

// =============================================================================
// Notifications
// =============================================================================

/** In-app notification (bell). One row per recipient. */
export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.tenantId, t.userId, t.createdAt)],
);

export const notificationChannel = pgEnum('notification_channel', ['in_app', 'email', 'whatsapp', 'sms']);

/** Per-user opt-outs. Absence of a row = channel default from the event catalog. */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    channel: notificationChannel('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('notification_prefs_uq').on(t.tenantId, t.userId, t.event, t.channel)],
);

export const deliveryStatus = pgEnum('delivery_status', ['queued', 'sent', 'failed', 'skipped']);

/** Outbound message log (email / WhatsApp / SMS): what was sent to whom, provider id, errors. */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: pk(),
    tenantId: tenantId(),
    event: text('event').notNull(),
    channel: notificationChannel('channel').notNull(),
    recipient: text('recipient').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    subject: text('subject'),
    status: deliveryStatus('status').notNull().default('queued'),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    jobId: uuid('job_id'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [index('notification_deliveries_tenant_idx').on(t.tenantId, t.createdAt)],
);

// =============================================================================
// Customisation
// =============================================================================

export const customFieldType = pgEnum('custom_field_type', ['text', 'textarea', 'number', 'date', 'select', 'checkbox']);

/** Tenant-defined extra fields on an entity (stored in the entity's custom_fields jsonb). */
export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: pk(),
    tenantId: tenantId(),
    entity: text('entity').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: customFieldType('type').notNull(),
    options: jsonb('options').$type<string[]>(),
    required: boolean('required').notNull().default(false),
    helpText: text('help_text'),
    showInPrint: boolean('show_in_print').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('custom_fields_key_uq').on(t.tenantId, t.entity, t.key)],
);

/** Tenant print templates (Handlebars HTML) per document type. */
export const printFormats = pgTable(
  'print_formats',
  {
    id: pk(),
    tenantId: tenantId(),
    docType: text('doc_type').notNull(),
    name: text('name').notNull(),
    template: text('template').notNull(),
    css: text('css').notNull().default(''),
    paperSize: text('paper_size').notNull().default('A4'),
    isDefault: boolean('is_default').notNull().default(false),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('print_formats_name_uq').on(t.tenantId, t.docType, t.name)],
);

/** Saved list filters ("My urgent PRs"). Personal unless shared. */
export const savedViews = pgTable(
  'saved_views',
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    name: text('name').notNull(),
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull(),
    isShared: boolean('is_shared').notNull().default(false),
    ...timestamps(),
  },
  (t) => [index('saved_views_lookup_idx').on(t.tenantId, t.entity)],
);
