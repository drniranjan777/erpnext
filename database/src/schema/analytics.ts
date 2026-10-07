import { boolean, index, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, pk } from './_columns';
import { users } from './iam';
import { tenantId } from './tenancy';

export interface DashboardWidget {
  key: string;
  /** Grid width: 1 (KPI tile), 2 (half), 3 (full row on wide screens). */
  size: 1 | 2 | 3;
}

/**
 * Saved dashboards. Personal ones belong to a user; shared ones (no owner) are visible to the
 * whole workspace. Widgets the viewer has no permission for are hidden, not failed.
 */
export const dashboards = pgTable(
  'dashboards',
  {
    id: pk(),
    tenantId: tenantId(),
    /** Blank = shared with everyone in the workspace. */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Preset it started from (owner, plant, sales…). */
    preset: text('preset'),
    widgets: jsonb('widgets').$type<DashboardWidget[]>().notNull().default([]),
    /** The owner's home dashboard. */
    isDefault: boolean('is_default').notNull().default(false),
    /** TV mode refresh, in seconds. */
    refreshSeconds: smallint('refresh_seconds').notNull().default(60),
    ...auditColumns(),
  },
  (t) => [index('dashboards_owner_idx').on(t.tenantId, t.ownerId)],
);

/** A report built in the report builder: a dataset, fields, filters and grouping. */
export interface BuilderSpec {
  dataset: string;
  fields: string[];
  filters: { field: string; op: string; value?: string | string[] }[];
  /** Relative period on the dataset's date: mtd, last_month, fytd, last_7, last_30, last_90, all, custom. */
  period: { preset: string; from?: string; to?: string };
  group: boolean;
  aggregates: Record<string, 'sum' | 'avg' | 'min' | 'max' | 'count'>;
  sort: { field: string; dir: 'asc' | 'desc' } | null;
  limit: number;
}

export const savedReports = pgTable(
  'saved_reports',
  {
    id: pk(),
    tenantId: tenantId(),
    /** Blank = shared with everyone. */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    spec: jsonb('spec').$type<BuilderSpec>().notNull(),
    ...auditColumns(),
  },
  (t) => [index('saved_reports_owner_idx').on(t.tenantId, t.ownerId)],
);

/**
 * Scheduled delivery of a standard or saved report by email. Runs as its owner, with the
 * owner's permissions at the time it runs.
 */
export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: pk(),
    tenantId: tenantId(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id').notNull(),
    name: text('name').notNull(),
    savedReportId: uuid('saved_report_id').references(() => savedReports.id, { onDelete: 'cascade' }),
    /** A standard report key, when not a saved report. */
    reportKey: text('report_key'),
    /** Standard report parameters; dates may be relative (today, month_start, prev_month_start…). */
    params: jsonb('params').$type<Record<string, string>>().notNull().default({}),
    /** daily | weekly | monthly */
    frequency: text('frequency').notNull(),
    /** Weekly: ISO weekday 1 (Monday) … 7. */
    weekday: smallint('weekday'),
    /** Monthly: day 1 … 28. */
    monthDay: smallint('month_day'),
    /** Hour of the day in India, 0 … 23. */
    hour: smallint('hour').notNull().default(8),
    recipients: text('recipients').array().notNull(),
    /** xlsx | csv */
    format: text('format').notNull().default('xlsx'),
    isActive: boolean('is_active').notNull().default(true),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    /** sent | failed | skipped */
    lastStatus: text('last_status'),
    lastError: text('last_error'),
    ...auditColumns(),
  },
  (t) => [index('report_schedules_owner_idx').on(t.tenantId, t.ownerId)],
);
