import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { users } from './iam';
import { iotCommands, iotSignals, type SignalSource } from './iot';
import { jobCards, machines, workCenters } from './manufacturing';
import { items } from './masters';
import { tenantId } from './tenancy';

/** A production shift (IST). A shift that ends before it starts runs past midnight. */
export const mesShifts = pgTable(
  'mes_shifts',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** Minutes after midnight, India time. */
    startMinute: smallint('start_minute').notNull(),
    endMinute: smallint('end_minute').notNull(),
    /** Planned breaks inside the shift (minutes), not counted as planned production time. */
    breakMinutes: smallint('break_minutes').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('mes_shifts_code_uq').on(t.tenantId, t.code)],
);

/**
 * Why a machine stopped. `loss` places it in the six big losses: breakdown (equipment failure),
 * setup (setup and adjustments), minor_stop, speed, defects, startup (reduced yield), or planned
 * (not a loss: breaks, no orders, maintenance windows).
 */
export const mesDowntimeReasons = pgTable(
  'mes_downtime_reasons',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    loss: text('loss').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('mes_reasons_code_uq').on(t.tenantId, t.code)],
);

/** How a machine is monitored: ideal speed and when a pause counts as a stop. */
export const mesMachineSettings = pgTable(
  'mes_machine_settings',
  {
    id: pk(),
    tenantId: tenantId(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    /** Ideal time per part when no job card says otherwise. */
    idealCycleSeconds: doublePrecision('ideal_cycle_seconds'),
    /** No part counted for this long means the machine has stopped. */
    stopAfterSeconds: integer('stop_after_seconds').notNull().default(120),
    /** Stops shorter than this are minor stops (a performance loss), longer ones downtime. */
    minorStopSeconds: integer('minor_stop_seconds').notNull().default(300),
    targetOeePct: smallint('target_oee_pct').notNull().default(65),
    /** Last time a part was counted (for stop detection). */
    lastPartAt: timestamp('last_part_at', { withTimezone: true }),
    lastSignalAt: timestamp('last_signal_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('mes_machine_settings_uq').on(t.tenantId, t.machineId)],
);

/** What a machine was doing, as intervals: running, stopped, setup or planned stop. */
export const mesMachineStates = pgTable(
  'mes_machine_states',
  {
    id: pk(),
    tenantId: tenantId(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    /** running | stopped | setup | planned_stop */
    state: text('state').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    reasonId: uuid('reason_id').references(() => mesDowntimeReasons.id, { onDelete: 'set null' }),
    note: text('note'),
    /** auto (from signals) | manual (set by a person) */
    source: text('source').notNull().default('auto'),
    setBy: uuid('set_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('mes_states_machine_idx').on(t.tenantId, t.machineId, t.startedAt), index('mes_states_open_idx').on(t.tenantId, t.endedAt)],
);

/** Last value of each counter signal, to turn counter readings into counts (handles resets). */
export const mesCounters = pgTable(
  'mes_counters',
  {
    id: pk(),
    tenantId: tenantId(),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => iotSignals.id, { onDelete: 'cascade' }),
    lastValue: doublePrecision('last_value').notNull(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('mes_counters_uq').on(t.tenantId, t.signalId)],
);

/** Parts counted per machine per minute, with the ideal time they should have taken. */
export const mesCounts = pgTable(
  'mes_counts',
  {
    id: pk(),
    tenantId: tenantId(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    minute: timestamp('minute', { withTimezone: true }).notNull(),
    good: doublePrecision('good').notNull().default(0),
    reject: doublePrecision('reject').notNull().default(0),
    idealSeconds: doublePrecision('ideal_seconds').notNull().default(0),
    jobCardId: uuid('job_card_id').references(() => jobCards.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('mes_counts_uq').on(t.tenantId, t.machineId, t.minute)],
);

/** A call for help from the line (Andon): maintenance, quality, material or supervisor. */
export const mesAndonCalls = pgTable(
  'mes_andon_calls',
  {
    id: pk(),
    tenantId: tenantId(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    /** maintenance | quality | material | supervisor */
    kind: text('kind').notNull(),
    note: text('note'),
    raisedBy: uuid('raised_by').references(() => users.id, { onDelete: 'set null' }),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
    ackedBy: uuid('acked_by').references(() => users.id, { onDelete: 'set null' }),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
  },
  (t) => [index('mes_andon_open_idx').on(t.tenantId, t.resolvedAt)],
);

// =============================================================================
// MES execution (13.4)
// =============================================================================

export interface InstructionStep {
  title: string;
  body: string;
  /** Picture or drawing (a link or an attachment URL). */
  imageUrl?: string | null;
  /** The operator must tick it before starting. */
  confirm?: boolean;
  /** Shown as a safety or quality warning. */
  caution?: boolean;
}

export interface Characteristic {
  name: string;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
  /** In-line checks: how often (minutes) while running; null = first-off only. */
  everyMinutes?: number | null;
}

/** Electronic work instructions for an item's operation, versioned; the latest released one is used. */
export const mesInstructions = pgTable(
  'mes_instructions',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    operationSeq: smallint('operation_seq').notNull(),
    version: integer('version').notNull(),
    /** draft | released | retired */
    status: text('status').notNull().default('draft'),
    title: text('title').notNull(),
    steps: jsonb('steps').$type<InstructionStep[]>().notNull().default([]),
    characteristics: jsonb('characteristics').$type<Characteristic[]>().notNull().default([]),
    /** QC must approve the first piece before the run counts. */
    firstOffRequired: boolean('first_off_required').notNull().default(false),
    /** Materials must be scanned at start. */
    scanMaterials: boolean('scan_materials').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    releasedBy: uuid('released_by').references(() => users.id, { onDelete: 'set null' }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('mes_instructions_uq').on(t.tenantId, t.itemId, t.operationSeq, t.version)],
);

/** Who may run a work centre's machines, and until when. */
export const mesSkills = pgTable(
  'mes_skills',
  {
    id: pk(),
    tenantId: tenantId(),
    operatorName: text('operator_name').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    workCenterId: uuid('work_center_id')
      .notNull()
      .references(() => workCenters.id, { onDelete: 'cascade' }),
    /** 1 trainee (supervised), 2 qualified, 3 expert, 4 trainer */
    level: smallint('level').notNull().default(2),
    validUntil: date('valid_until', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mes_skills_wc_idx').on(t.tenantId, t.workCenterId)],
);

/** An operator logged in at a machine. */
export const mesMachineSessions = pgTable(
  'mes_machine_sessions',
  {
    id: pk(),
    tenantId: tenantId(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    operatorName: text('operator_name').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    loginAt: timestamp('login_at', { withTimezone: true }).notNull().defaultNow(),
    logoutAt: timestamp('logout_at', { withTimezone: true }),
  },
  (t) => [index('mes_sessions_machine_idx').on(t.tenantId, t.machineId, t.logoutAt)],
);

/** A set-point for making an item on a machine. */
export interface RecipeParameter {
  name: string;
  unit?: string | null;
  value: number;
  min?: number | null;
  max?: number | null;
  /** A signal that measures it, for the batch record. */
  signalCode?: string | null;
  /** Where to write it (Modbus register or MQTT topic); none = set by hand. */
  target?: SignalSource | null;
}

/** Set-points for an item on a machine, versioned; downloaded to the PLC through the gateway. */
export const mesRecipes = pgTable(
  'mes_recipes',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** Blank = any machine. */
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** draft | released | retired */
    status: text('status').notNull().default('draft'),
    parameters: jsonb('parameters').$type<RecipeParameter[]>().notNull().default([]),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    releasedBy: uuid('released_by').references(() => users.id, { onDelete: 'set null' }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [index('mes_recipes_item_idx').on(t.tenantId, t.itemId)],
);

export interface StartCheck {
  code: string;
  label: string;
  ok: boolean;
  /** A failed blocking check stops the start. */
  blocking: boolean;
  detail?: string | null;
}

/** A job card run through the MES: instructions, start checks, first-off, recipe and batch record. */
export const mesExecutions = pgTable(
  'mes_executions',
  {
    id: pk(),
    tenantId: tenantId(),
    jobCardId: uuid('job_card_id')
      .notNull()
      .references(() => jobCards.id, { onDelete: 'cascade' }),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    operatorName: text('operator_name'),
    instructionId: uuid('instruction_id').references(() => mesInstructions.id, { onDelete: 'set null' }),
    stepsAcked: jsonb('steps_acked').$type<number[]>().notNull().default([]),
    checks: jsonb('checks').$type<StartCheck[]>().notNull().default([]),
    scans: jsonb('scans').$type<Record<string, unknown>>().notNull().default({}),
    /** not_required | pending | approved | rejected */
    firstOff: text('first_off').notNull().default('not_required'),
    firstOffReadings: jsonb('first_off_readings').$type<{ name: string; value: number; ok: boolean }[]>(),
    firstOffNote: text('first_off_note'),
    firstOffBy: uuid('first_off_by').references(() => users.id, { onDelete: 'set null' }),
    firstOffAt: timestamp('first_off_at', { withTimezone: true }),
    recipeId: uuid('recipe_id').references(() => mesRecipes.id, { onDelete: 'set null' }),
    commandId: uuid('command_id').references(() => iotCommands.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('mes_executions_card_uq').on(t.tenantId, t.jobCardId)],
);

/** In-line quality readings taken while a job runs. */
export const mesInlineChecks = pgTable(
  'mes_inline_checks',
  {
    id: pk(),
    tenantId: tenantId(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => mesExecutions.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    readings: jsonb('readings').$type<{ name: string; value: number; ok: boolean }[]>().notNull(),
    allOk: boolean('all_ok').notNull(),
    by: uuid('by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('mes_inline_exec_idx').on(t.tenantId, t.executionId, t.at)],
);
