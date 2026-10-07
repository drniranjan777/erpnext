import { boolean, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { users } from './iam';
import { tenantId } from './tenancy';

/** Guardrails a workspace sets on an agent. */
export interface AgentGuardrails {
  /** Recommendations whose amount is above this are never executed automatically. */
  maxAmount?: number | null;
  /** Execute actions without waiting for approval (within the limits), as `actorUserId`. */
  autoExecute?: boolean;
  /** Auto-execute only actions at or below this amount. */
  autoExecuteBelow?: number | null;
  /** Agent-specific thresholds (e.g. days of cover, % price variance). */
  params?: Record<string, number>;
}

/** Workspace-wide switch: when killed, no agent runs and nothing is executed. */
export const aiSettings = pgTable(
  'ai_settings',
  {
    id: pk(),
    tenantId: tenantId(),
    killed: boolean('killed').notNull().default(false),
    killedBy: uuid('killed_by').references(() => users.id, { onDelete: 'set null' }),
    killedAt: timestamp('killed_at', { withTimezone: true }),
    killReason: text('kill_reason'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ai_settings_tenant_uq').on(t.tenantId)],
);

/** An agent switched on for a workspace, with its schedule and guardrails. */
export const aiAgents = pgTable(
  'ai_agents',
  {
    id: pk(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    /** hourly | daily | weekly */
    schedule: text('schedule').notNull().default('daily'),
    /** IST hour for daily / weekly runs. */
    runHour: smallint('run_hour').notNull().default(7),
    guardrails: jsonb('guardrails').$type<AgentGuardrails>().notNull().default({}),
    /** The person whose permissions automatic actions run with (who switched auto-execution on). */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastStatus: text('last_status'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ai_agents_code_uq').on(t.tenantId, t.code)],
);

export const aiRuns = pgTable(
  'ai_runs',
  {
    id: pk(),
    tenantId: tenantId(),
    agentCode: text('agent_code').notNull(),
    /** schedule | manual | event */
    trigger: text('trigger').notNull(),
    /** running | ok | failed | skipped */
    status: text('status').notNull().default('running'),
    findings: integer('findings').notNull().default(0),
    created: integer('created').notNull().default(0),
    executed: integer('executed').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('ai_runs_agent_idx').on(t.tenantId, t.agentCode, t.startedAt)],
);

/** Proposed action, executed through the same permission-checked services a person would use. */
export interface ProposedAction {
  type: string;
  label: string;
  params: Record<string, unknown>;
  /** Money involved, for guardrails. */
  amount?: number | null;
}

/** One recommendation in the AI Inbox. */
export const aiRecommendations = pgTable(
  'ai_recommendations',
  {
    id: pk(),
    tenantId: tenantId(),
    agentCode: text('agent_code').notNull(),
    runId: uuid('run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    /** info | warning | critical */
    severity: text('severity').notNull().default('info'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** The facts behind it, shown as "why". */
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    link: text('link'),
    /** Same finding is not raised again while one is open (or was dismissed recently). */
    dedupeKey: text('dedupe_key').notNull(),
    action: jsonb('action').$type<ProposedAction | null>(),
    confidence: numeric('confidence', { precision: 4, scale: 2 }),
    /** Who may see and decide it. */
    permission: text('permission'),
    /** open | accepted | dismissed | executed | failed | expired */
    status: text('status').notNull().default('open'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    autoExecuted: boolean('auto_executed').notNull().default(false),
    result: jsonb('result').$type<Record<string, unknown> | null>(),
    error: text('error'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_recs_status_idx').on(t.tenantId, t.status, t.createdAt), index('ai_recs_dedupe_idx').on(t.tenantId, t.dedupeKey)],
);

/** Every action an agent took or proposed that was executed: who, what, with what result. */
export const aiActionLog = pgTable(
  'ai_action_log',
  {
    id: pk(),
    tenantId: tenantId(),
    recommendationId: uuid('recommendation_id').references(() => aiRecommendations.id, { onDelete: 'set null' }),
    agentCode: text('agent_code').notNull(),
    actionType: text('action_type').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull(),
    /** approved | auto */
    mode: text('mode').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: text('status').notNull(),
    result: jsonb('result').$type<Record<string, unknown> | null>(),
    error: text('error'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_action_log_idx').on(t.tenantId, t.at)],
);

/** Voice commands: what was heard, what was understood, and what happened (feeds the accuracy figure). */
export const aiVoiceLogs = pgTable(
  'ai_voice_logs',
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    lang: text('lang').notNull(),
    text: text('text').notNull(),
    normalised: text('normalised'),
    command: text('command'),
    parsed: jsonb('parsed').$type<Record<string, unknown>>(),
    /** understood | executed | cancelled | corrected | fallback | failed */
    outcome: text('outcome').notNull(),
    documentId: uuid('document_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_voice_logs_idx').on(t.tenantId, t.createdAt)],
);
