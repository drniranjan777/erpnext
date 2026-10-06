import { sql } from 'drizzle-orm';
import { customType, integer, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Case-insensitive text (emails, slugs, codes). Requires the citext extension. */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** UUID v7 primary key (time-ordered; PostgreSQL 18 native uuidv7()). */
export const pk = () => uuid('id').primaryKey().default(sql`uuidv7()`);

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** created/updated timestamps only (platform tables). */
export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Standard audit columns for every business table:
 * who/when created & updated, plus optimistic-lock version.
 */
export const auditColumns = () => ({
  createdAt: createdAt(),
  createdBy: uuid('created_by'),
  updatedAt: updatedAt(),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
});

/** Soft delete - masters only. Transactions are cancelled, never deleted. */
export const softDelete = () => ({
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
