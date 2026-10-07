import { boolean, doublePrecision, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { users } from './iam';
import { iotSignals } from './iot';
import { machines } from './manufacturing';
import { tenantId } from './tenancy';

/** Electricity contract and reporting factors for a workspace. */
export const energySettings = pgTable(
  'energy_settings',
  {
    id: pk(),
    tenantId: tenantId(),
    /** Contract (sanctioned) maximum demand, kW. */
    contractDemandKw: doublePrecision('contract_demand_kw'),
    /** The utility's demand interval (15 or 30 minutes). */
    demandIntervalMinutes: smallint('demand_interval_minutes').notNull().default(30),
    /** Alert when the projected demand of an interval reaches this % of the contract demand. */
    alertPct: smallint('alert_pct').notNull().default(90),
    /** kg CO2 per kWh of grid electricity (Scope 2, location-based). */
    gridFactor: doublePrecision('grid_factor').notNull().default(0.716),
    /** Average cost per kWh, ₹. */
    tariffPerKwh: doublePrecision('tariff_per_kwh').notNull().default(8),
    /** Incoming (main) meters; when empty, all energy meters are added up for demand. */
    mainSignalIds: jsonb('main_signal_ids').$type<string[]>().notNull().default([]),
    /** Start of the last interval an alert was sent for (one alert per interval). */
    lastAlertInterval: timestamp('last_alert_interval', { withTimezone: true }),
  },
  (t) => [uniqueIndex('energy_settings_uq').on(t.tenantId)],
);

/** kWh used per meter per minute (from the meter's kWh counter). */
export const energyMinutes = pgTable(
  'energy_minutes',
  {
    id: pk(),
    tenantId: tenantId(),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => iotSignals.id, { onDelete: 'cascade' }),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    minute: timestamp('minute', { withTimezone: true }).notNull(),
    kwh: doublePrecision('kwh').notNull().default(0),
  },
  (t) => [uniqueIndex('energy_minutes_uq').on(t.tenantId, t.signalId, t.minute), index('energy_minutes_machine_idx').on(t.tenantId, t.machineId, t.minute)],
);

/** Condition monitoring on a signal: a learned baseline and the anomaly rules. */
export const cmModels = pgTable(
  'cm_models',
  {
    id: pk(),
    tenantId: tenantId(),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => iotSignals.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    /** Readings needed before anomalies are reported. */
    minSamples: integer('min_samples').notNull().default(200),
    /** Spike: |z| above this for `consecutive` readings. */
    zThreshold: doublePrecision('z_threshold').notNull().default(4),
    consecutive: smallint('consecutive').notNull().default(3),
    /** Drift: the recent average this many standard deviations away from the baseline. */
    driftThreshold: doublePrecision('drift_threshold').notNull().default(2.5),
    createMaintenance: boolean('create_maintenance').notNull().default(true),
    // Learned state
    n: integer('n').notNull().default(0),
    mean: doublePrecision('mean').notNull().default(0),
    variance: doublePrecision('variance').notNull().default(0),
    recent: doublePrecision('recent'),
    streak: smallint('streak').notNull().default(0),
    lastScore: doublePrecision('last_score'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cm_models_signal_uq').on(t.tenantId, t.signalId)],
);

/** An anomaly found by condition monitoring, with what was done and whether it was real. */
export const cmAnomalies = pgTable(
  'cm_anomalies',
  {
    id: pk(),
    tenantId: tenantId(),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => iotSignals.id, { onDelete: 'cascade' }),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    /** spike | drift */
    kind: text('kind').notNull(),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull(),
    value: doublePrecision('value').notNull(),
    score: doublePrecision('score').notNull(),
    baselineMean: doublePrecision('baseline_mean').notNull(),
    baselineStd: doublePrecision('baseline_std').notNull(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    maintenanceOrderId: uuid('maintenance_order_id'),
    /** confirmed (a real problem was found) | false_alarm */
    feedback: text('feedback'),
    feedbackNote: text('feedback_note'),
    feedbackBy: uuid('feedback_by').references(() => users.id, { onDelete: 'set null' }),
    feedbackAt: timestamp('feedback_at', { withTimezone: true }),
  },
  (t) => [index('cm_anomalies_idx').on(t.tenantId, t.raisedAt), index('cm_anomalies_open_idx').on(t.tenantId, t.signalId, t.clearedAt)],
);
