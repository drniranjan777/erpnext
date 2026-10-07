import { boolean, char, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { documents } from './documents';
import { users } from './iam';
import { items } from './masters';
import { tenantId } from './tenancy';

const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });

// =============================================================================
// Item planning parameters (beyond the lead time, safety stock and MOQ on the item)
// =============================================================================

/**
 * How MRP plans an item: make or buy, and the lot-sizing rule.
 *  - l4l: lot for lot (exactly the net requirement);
 *  - fixed: multiples of `lot_qty`;
 *  - eoq: at least the economic order quantity (from annual demand, `order_cost`, `holding_pct`);
 *  - min_max: order up to `lot_qty` (the max level) when stock falls below safety stock (the min);
 *  - period: cover the net requirements of the next `period_days`.
 */
export const itemPlanning = pgTable(
  'item_planning',
  {
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .primaryKey()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** auto (make when there is a BOM or formula) | make | buy */
    source: text('source').notNull().default('auto'),
    lotSizing: text('lot_sizing').notNull().default('l4l'),
    lotQty: qty('lot_qty'),
    periodDays: integer('period_days'),
    orderCost: qty('order_cost'),
    holdingPct: numeric('holding_pct', { precision: 6, scale: 2 }),
    /** Left out of MRP altogether. */
    excluded: boolean('excluded').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('item_planning_tenant_idx').on(t.tenantId)],
);

// =============================================================================
// Demand forecast (per item and month)
// =============================================================================

export const demandForecasts = pgTable(
  'demand_forecasts',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** YYYY-MM */
    period: char('period', { length: 7 }).notNull(),
    qty: qty('qty').notNull(),
    /** The statistical figure; `qty` differs from it when a planner has overridden it. */
    statQty: qty('stat_qty'),
    method: text('method'),
    mae: qty('mae'),
    mapePct: numeric('mape_pct', { precision: 8, scale: 1 }),
    isOverride: boolean('is_override').notNull().default(false),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('demand_forecasts_uq').on(t.tenantId, t.itemId, t.period), index('demand_forecasts_period_idx').on(t.tenantId, t.period)],
);

// =============================================================================
// MRP runs, planned orders, exceptions
// =============================================================================

export const mrpRuns = pgTable(
  'mrp_runs',
  {
    id: pk(),
    tenantId: tenantId(),
    /** running | done | failed */
    status: text('status').notNull().default('running'),
    horizonDays: smallint('horizon_days').notNull(),
    useForecast: boolean('use_forecast').notNull().default(true),
    stats: jsonb('stats').$type<Record<string, number>>().notNull().default({}),
    error: text('error'),
    startedBy: uuid('started_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('mrp_runs_tenant_idx').on(t.tenantId, t.startedAt)],
);

export interface PegRow {
  kind: string;
  id?: string | null;
  number?: string | null;
  date: string;
  qty: number;
}

/**
 * A planned order proposed by MRP. Planned ones are replaced by the next run; firmed ones are
 * kept (and count as receipts); converted ones point at the requisition or work order made.
 */
export const plannedOrders = pgTable(
  'planned_orders',
  {
    id: pk(),
    tenantId: tenantId(),
    runId: uuid('run_id').references(() => mrpRuns.id, { onDelete: 'set null' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** make | buy | batch */
    source: text('source').notNull(),
    qty: qty('qty').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    releaseDate: date('release_date', { mode: 'string' }).notNull(),
    level: smallint('level').notNull().default(0),
    /** planned | firmed | converted */
    status: text('status').notNull().default('planned'),
    /** What this order covers: sales orders, forecast, parent planned orders, safety stock. */
    pegs: jsonb('pegs').$type<PegRow[]>().notNull().default([]),
    /** Parent planned orders reference this one by `ref_key` inside a run. */
    refKey: integer('ref_key'),
    convertedDocId: uuid('converted_doc_id').references(() => documents.id, { onDelete: 'set null' }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
  },
  (t) => [index('planned_orders_tenant_idx').on(t.tenantId, t.status, t.releaseDate), index('planned_orders_item_idx').on(t.tenantId, t.itemId), index('planned_orders_run_idx').on(t.runId)],
);

export const mrpExceptions = pgTable(
  'mrp_exceptions',
  {
    id: pk(),
    tenantId: tenantId(),
    runId: uuid('run_id')
      .notNull()
      .references(() => mrpRuns.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    date: date('date', { mode: 'string' }),
    toDate: date('to_date', { mode: 'string' }),
    qty: qty('qty'),
    refKind: text('ref_kind'),
    refId: uuid('ref_id'),
    refNumber: text('ref_number'),
    message: text('message').notNull(),
  },
  (t) => [index('mrp_exceptions_run_idx').on(t.runId, t.kind)],
);

export interface TimelineRowData {
  date: string;
  kind: string;
  qty: number;
  ref: { kind: string; id?: string | null; number?: string | null } | null;
  balance: number;
}

/** The time-phased record of each planned item in a run (the MRP grid). */
export const mrpItemPlans = pgTable(
  'mrp_item_plans',
  {
    tenantId: tenantId(),
    runId: uuid('run_id')
      .notNull()
      .references(() => mrpRuns.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    level: smallint('level').notNull(),
    onHand: qty('on_hand').notNull(),
    safetyStock: qty('safety_stock').notNull(),
    demand: qty('demand').notNull(),
    receipts: qty('receipts').notNull(),
    planned: qty('planned').notNull(),
    endBalance: qty('end_balance').notNull(),
    firstShortage: date('first_shortage', { mode: 'string' }),
    timeline: jsonb('timeline').$type<TimelineRowData[]>().notNull().default([]),
  },
  (t) => [uniqueIndex('mrp_item_plans_uq').on(t.runId, t.itemId)],
);
