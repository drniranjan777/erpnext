import { index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { documents } from './documents';
import { users } from './iam';
import { parties } from './masters';
import { tenantId } from './tenancy';

/**
 * Customer and dealer portal logins. Separate from staff users: a portal user belongs to one party
 * of one workspace, signs in with that workspace's code, and only ever sees that party's records.
 */
export const portalUsers = pgTable(
  'portal_users',
  {
    id: pk(),
    tenantId: tenantId(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    /** customer | dealer (a dealer also sees schemes, claims and their stock). */
    kind: text('kind').notNull().default('customer'),
    name: text('name').notNull(),
    email: citext('email').notNull(),
    passwordHash: text('password_hash'),
    /** invited | active | disabled */
    status: text('status').notNull().default('invited'),
    inviteTokenHash: text('invite_token_hash'),
    inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
    failedLogins: smallint('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('portal_users_email_uq').on(t.tenantId, t.email), index('portal_users_party_idx').on(t.tenantId, t.partyId), uniqueIndex('portal_users_invite_uq').on(t.inviteTokenHash)],
);

/** Opaque session tokens (only the hash is stored). */
export const portalSessions = pgTable(
  'portal_sessions',
  {
    id: pk(),
    tenantId: tenantId(),
    portalUserId: uuid('portal_user_id')
      .notNull()
      .references(() => portalUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('portal_sessions_token_uq').on(t.tokenHash)],
);

/** An order placed on the portal; staff accept it into a draft sales order or reject it. */
export const portalOrders = pgTable(
  'portal_orders',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    portalUserId: uuid('portal_user_id').references(() => portalUsers.id, { onDelete: 'set null' }),
    customerPoNo: text('customer_po_no'),
    expectedDate: text('expected_date'),
    notes: text('notes'),
    lines: jsonb('lines').$type<{ itemId: string; qty: string; remarks?: string | null }[]>().notNull(),
    /** submitted | accepted | rejected | withdrawn */
    status: text('status').notNull().default('submitted'),
    salesOrderId: uuid('sales_order_id').references(() => documents.id, { onDelete: 'set null' }),
    rejectReason: text('reject_reason'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('portal_orders_number_uq').on(t.tenantId, t.number), index('portal_orders_party_idx').on(t.tenantId, t.partyId, t.status)],
);
