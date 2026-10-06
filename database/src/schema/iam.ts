import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  inet,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext, createdAt, pk, timestamps } from './_columns';
import { tenantId } from './tenancy';

export const userStatus = pgEnum('user_status', ['active', 'locked', 'disabled']);
export const membershipStatus = pgEnum('membership_status', ['invited', 'active', 'disabled']);

/**
 * Global identity. One person can belong to many tenants (e.g. a CA or
 * implementation consultant) through memberships.
 */
export const users = pgTable('users', {
  id: pk(),
  email: citext('email').notNull().unique(),
  mobile: text('mobile').unique(),
  fullName: text('full_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  status: userStatus('status').notNull().default('active'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  /** AES-256-GCM encrypted TOTP secret (set on setup, active once mfa_enabled). */
  mfaSecret: text('mfa_secret'),
  /** SHA-256 hashes of unused recovery codes. */
  mfaRecoveryCodes: text('mfa_recovery_codes').array(),
  /** Last accepted TOTP time-step (prevents code replay). */
  mfaLastStep: integer('mfa_last_step'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  locale: text('locale').notNull().default('en-IN'),
  ...timestamps(),
});

/** A user's access to one tenant. */
export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: membershipStatus('status').notNull().default('active'),
    isOwner: boolean('is_owner').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_uq').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

/** Global permission catalog: `module.resource.action`, seeded from code. */
export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
  module: text('module').notNull(),
  resource: text('resource').notNull(),
  action: text('action').notNull(),
  description: text('description').notNull(),
});

export const roles = pgTable(
  'roles',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex('roles_tenant_name_uq').on(t.tenantId, t.name)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    tenantId: tenantId(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] }), index('role_permissions_tenant_idx').on(t.tenantId)],
);

export const membershipRoles = pgTable(
  'membership_roles',
  {
    tenantId: tenantId(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.roleId] }), index('membership_roles_tenant_idx').on(t.tenantId)],
);

/** Refresh-token sessions (rotating). One row per signed-in device. */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('auth_sessions_tenant_user_idx').on(t.tenantId, t.userId)],
);

/** Pending invitation to join a tenant. Token is stored hashed (sha256). */
export const invitations = pgTable(
  'invitations',
  {
    id: pk(),
    tenantId: tenantId(),
    email: citext('email').notNull(),
    fullName: text('full_name'),
    roleIds: uuid('role_ids').array().notNull().default(sql`'{}'::uuid[]`),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index('invitations_tenant_idx').on(t.tenantId),
    uniqueIndex('invitations_tenant_email_pending_uq')
      .on(t.tenantId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
  ],
);
