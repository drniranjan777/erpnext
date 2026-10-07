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
    /** AI features switched off for the workspace (feature code → false). Missing means on. */
    features: jsonb('features').$type<Record<string, boolean>>().notNull().default({}),
    /** Consent to send workspace data to the external model provider; no model calls without it. */
    externalConsentAt: timestamp('external_consent_at', { withTimezone: true }),
    externalConsentBy: uuid('external_consent_by').references(() => users.id, { onDelete: 'set null' }),
    /** Mask emails, phone numbers, PAN, Aadhaar and bank account numbers before they leave. */
    maskPii: boolean('mask_pii').notNull().default(true),
    /** Monthly model spend cap in ₹; null uses the plan's budget. */
    monthlyBudgetInr: numeric('monthly_budget_inr', { precision: 12, scale: 2 }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
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

/** A document read by Document AI, kept for review and, where it applies, for applying to records. */
export const aiDocCaptures = pgTable(
  'ai_doc_captures',
  {
    id: pk(),
    tenantId: tenantId(),
    kind: text('kind').notNull(),
    fileName: text('file_name'),
    /** text (read directly) | ai (transcribed by the model) */
    source: text('source').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 2 }),
    fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
    lines: jsonb('lines').$type<Record<string, unknown>[]>().notNull().default([]),
    matches: jsonb('matches').$type<Record<string, unknown>>().notNull().default({}),
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
    /** review | applied | discarded */
    status: text('status').notNull().default('review'),
    result: jsonb('result').$type<Record<string, unknown> | null>(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    appliedBy: uuid('applied_by').references(() => users.id, { onDelete: 'set null' }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
  },
  (t) => [index('ai_doc_captures_idx').on(t.tenantId, t.status, t.createdAt)],
);

/** Model chosen for an AI feature; every change is a new row, the latest is in force. */
export const aiModelChanges = pgTable(
  'ai_model_changes',
  {
    id: pk(),
    tenantId: tenantId(),
    feature: text('feature').notNull(),
    model: text('model').notNull(),
    note: text('note'),
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_model_changes_idx').on(t.tenantId, t.feature, t.createdAt)],
);

/** One model call (or a call that was blocked by policy), with tokens and cost. */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: pk(),
    tenantId: tenantId(),
    feature: text('feature').notNull(),
    model: text('model'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costInr: numeric('cost_inr', { precision: 12, scale: 4 }).notNull().default('0'),
    latencyMs: integer('latency_ms'),
    /** ok | error | blocked */
    status: text('status').notNull(),
    /** Why a call was blocked or failed (off, no_consent, budget, http_429, …). */
    reason: text('reason'),
    piiMasked: integer('pii_masked').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_usage_idx').on(t.tenantId, t.createdAt)],
);

/** A run of an evaluation set against the AI features, kept to track quality over time. */
export const aiEvalRuns = pgTable(
  'ai_eval_runs',
  {
    id: pk(),
    tenantId: tenantId(),
    suite: text('suite').notNull(),
    cases: integer('cases').notNull(),
    passed: integer('passed').notNull(),
    scorePct: numeric('score_pct', { precision: 5, scale: 1 }).notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    runBy: uuid('run_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_eval_runs_idx').on(t.tenantId, t.suite, t.createdAt)],
);
