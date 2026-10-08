import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { users } from './iam';
import { tenantId } from './tenancy';

// =============================================================================
// App marketplace (connectors) and workflow automation
// =============================================================================

/** A connector installed in a workspace, with its settings and (encrypted) credentials. */
export const appInstallations = pgTable(
  'app_installations',
  {
    id: pk(),
    tenantId: tenantId(),
    connector: text('connector').notNull(),
    /** sandbox | live */
    mode: text('mode').notNull().default('sandbox'),
    config: jsonb('config').$type<Record<string, string>>().notNull().default({}),
    /** AES-GCM sealed JSON of the secret fields. */
    secretsEncrypted: text('secrets_encrypted'),
    /** Secret for inbound webhooks (HMAC). */
    webhookSecretEncrypted: text('webhook_secret_encrypted'),
    enabled: boolean('enabled').notNull().default(true),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastStatus: text('last_status'),
    installedBy: uuid('installed_by').references(() => users.id, { onDelete: 'set null' }),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('app_installations_uq').on(t.tenantId, t.connector)],
);

/** One run of a connector action (or an inbound webhook), with its counts and log. */
export const connectorRuns = pgTable(
  'connector_runs',
  {
    id: pk(),
    tenantId: tenantId(),
    installationId: uuid('installation_id')
      .notNull()
      .references(() => appInstallations.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    /** ok | partial | failed */
    status: text('status').notNull(),
    stats: jsonb('stats').$type<Record<string, number>>().notNull().default({}),
    log: jsonb('log').$type<string[]>().notNull().default([]),
    /** File produced by the run (e.g. a Tally XML export). */
    output: text('output'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('connector_runs_inst_idx').on(t.tenantId, t.installationId, t.startedAt)],
);

/** External record ↔ our record, so imports never duplicate (order id → sales order, lead id → lead…). */
export const connectorRecords = pgTable(
  'connector_records',
  {
    id: pk(),
    tenantId: tenantId(),
    connector: text('connector').notNull(),
    externalId: text('external_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('connector_records_uq').on(t.tenantId, t.connector, t.entityType, t.externalId)],
);

export interface AutomationCondition {
  field: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists';
  value?: unknown;
}

export type AutomationAction =
  | { type: 'notify'; userIds?: string[]; roleIds?: string[]; title: string; body: string }
  | { type: 'email'; to: string; subject: string; body: string }
  | { type: 'webhook'; url: string }
  | { type: 'connector'; connector: string; action: string };

/** When an event happens and the conditions hold, run the actions. */
export const automations = pgTable(
  'automations',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    /** document.approved, document.submitted, member.joined, connector.orders_imported… */
    event: text('event').notNull(),
    conditions: jsonb('conditions').$type<AutomationCondition[]>().notNull().default([]),
    actions: jsonb('actions').$type<AutomationAction[]>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    runCount: integer('run_count').notNull().default(0),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('automations_event_idx').on(t.tenantId, t.event)],
);

export const automationRuns = pgTable(
  'automation_runs',
  {
    id: pk(),
    tenantId: tenantId(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** queued | ok | failed */
    status: text('status').notNull().default('queued'),
    results: jsonb('results').$type<{ action: string; ok: boolean; detail: string }[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('automation_runs_idx').on(t.tenantId, t.automationId, t.createdAt)],
);
