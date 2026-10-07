import { boolean, doublePrecision, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { users } from './iam';
import { iotSignals } from './iot';
import { jobCards, machines } from './manufacturing';
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
