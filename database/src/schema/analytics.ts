import { boolean, index, jsonb, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';
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
