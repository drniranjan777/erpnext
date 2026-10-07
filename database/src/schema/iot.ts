import { boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { users } from './iam';
import { machines } from './manufacturing';
import { warehouses } from './masters';
import { tenantId } from './tenancy';

/** How the edge agent reads a signal: protocol and address (sent to the agent as its configuration). */
export interface SignalSource {
  /** modbus-tcp | mqtt | http-json | simulator | push (sent by another system through the API) */
  protocol: string;
  /** modbus: register address; mqtt: topic; http-json: URL; simulator: pattern */
  address?: string;
  /** modbus: holding | input | coil */
  table?: string;
  /** uint16 | int16 | uint32 | int32 | float32 */
  dataType?: string;
  unitId?: number;
  /** mqtt / http-json: dotted path into the JSON payload */
  path?: string;
  /** connection: host:port, broker URL… */
  endpoint?: string;
  [k: string]: unknown;
}

/** An edge gateway (industrial PC or container) that reads machines and sends readings. */
export const iotGateways = pgTable(
  'iot_gateways',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    location: text('location'),
    /** sha256 of the device token; the token itself is shown once. */
    tokenHash: text('token_hash'),
    tokenHint: text('token_hint'),
    /** active | disabled */
    status: text('status').notNull().default('active'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastIp: text('last_ip'),
    agentVersion: text('agent_version'),
    /** Readings waiting in the agent's store-and-forward buffer at its last call. */
    buffered: integer('buffered').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('iot_gateways_code_uq').on(t.tenantId, t.code), index('iot_gateways_token_idx').on(t.tokenHash)],
);

/** A signal (tag) from a machine or sensor: what it measures and how the agent reads it. */
export const iotSignals = pgTable(
  'iot_signals',
  {
    id: pk(),
    tenantId: tenantId(),
    gatewayId: uuid('gateway_id').references(() => iotGateways.id, { onDelete: 'set null' }),
    /** Unique tag name the agent sends, e.g. "IMM-01.shots". */
    code: citext('code').notNull(),
    name: text('name').notNull(),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    /** Cold-chain and environment loggers. */
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),
    /** Vehicle number for loggers in trucks. */
    vehicleNo: text('vehicle_no'),
    /**
     * part_count | reject_count | run_state | temperature | humidity | vibration | current |
     * pressure | energy_kwh | power_kw | speed | other
     */
    purpose: text('purpose').notNull().default('other'),
    unit: text('unit'),
    /** Raw value × scale + offset. */
    scale: doublePrecision('scale').notNull().default(1),
    offset: doublePrecision('offset').notNull().default(0),
    /** The agent sends a change only when it moves by more than this (counters always send). */
    deadband: doublePrecision('deadband').notNull().default(0),
    source: jsonb('source').$type<SignalSource>().notNull().default({ protocol: 'push' }),
    lastValue: doublePrecision('last_value'),
    lastAt: timestamp('last_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('iot_signals_code_uq').on(t.tenantId, t.code), index('iot_signals_machine_idx').on(t.tenantId, t.machineId)],
);

/** Time series: one row per signal per timestamp. */
export const iotReadings = pgTable(
  'iot_readings',
  {
    tenantId: tenantId(),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => iotSignals.id, { onDelete: 'cascade' }),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    value: doublePrecision('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.signalId, t.ts] }), index('iot_readings_tenant_ts_idx').on(t.tenantId, t.ts)],
);

/** Batches received from a gateway, so a batch replayed after a network drop is applied once. */
export const iotBatches = pgTable(
  'iot_batches',
  {
    id: pk(),
    tenantId: tenantId(),
    gatewayId: uuid('gateway_id')
      .notNull()
      .references(() => iotGateways.id, { onDelete: 'cascade' }),
    batchId: text('batch_id').notNull(),
    readings: integer('readings').notNull(),
    accepted: integer('accepted').notNull(),
    /** Seconds between the oldest reading and its arrival (store-and-forward catch-up). */
    lagSeconds: integer('lag_seconds'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('iot_batches_uq').on(t.tenantId, t.gatewayId, t.batchId), index('iot_batches_received_idx').on(t.tenantId, t.receivedAt)],
);

/** A threshold on a signal; held for `delaySeconds` before it raises an alarm. */
export const iotAlarmRules = pgTable(
  'iot_alarm_rules',
  {
    id: pk(),
    tenantId: tenantId(),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => iotSignals.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** above | below | outside | equals */
    op: text('op').notNull(),
    threshold: doublePrecision('threshold').notNull(),
    /** Upper limit for "outside" (threshold is the lower one). */
    threshold2: doublePrecision('threshold2'),
    delaySeconds: integer('delay_seconds').notNull().default(0),
    /** info | warning | critical */
    severity: text('severity').notNull().default('warning'),
    notify: boolean('notify').notNull().default(true),
    /** Raise a maintenance request for the machine's asset when the alarm opens. */
    createMaintenance: boolean('create_maintenance').notNull().default(false),
    /** Breach seen but not yet held long enough. */
    pendingSince: timestamp('pending_since', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('iot_alarm_rules_signal_idx').on(t.tenantId, t.signalId)],
);

export const iotAlarms = pgTable(
  'iot_alarms',
  {
    id: pk(),
    tenantId: tenantId(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => iotAlarmRules.id, { onDelete: 'cascade' }),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => iotSignals.id, { onDelete: 'cascade' }),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    severity: text('severity').notNull(),
    message: text('message').notNull(),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull(),
    value: doublePrecision('value').notNull(),
    /** Worst value while open. */
    peakValue: doublePrecision('peak_value').notNull(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    ackedBy: uuid('acked_by').references(() => users.id, { onDelete: 'set null' }),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    note: text('note'),
    maintenanceOrderId: uuid('maintenance_order_id'),
    /** Extra facts (anomaly score, baseline…). */
    details: jsonb('details').$type<Record<string, unknown>>(),
  },
  (t) => [index('iot_alarms_open_idx').on(t.tenantId, t.clearedAt), index('iot_alarms_rule_idx').on(t.ruleId, t.clearedAt)],
);

/** A command for an edge gateway, such as writing a recipe's set-points to a PLC. */
export const iotCommands = pgTable(
  'iot_commands',
  {
    id: pk(),
    tenantId: tenantId(),
    gatewayId: uuid('gateway_id')
      .notNull()
      .references(() => iotGateways.id, { onDelete: 'cascade' }),
    /** write */
    kind: text('kind').notNull().default('write'),
    payload: jsonb('payload').$type<{ writes: (SignalSource & { name: string; value: number })[] }>().notNull(),
    /** pending | sent | done | failed */
    status: text('status').notNull().default('pending'),
    result: text('result'),
    /** What asked for it (e.g. an MES execution). */
    ref: uuid('ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (t) => [index('iot_commands_gateway_idx').on(t.tenantId, t.gatewayId, t.status)],
);
