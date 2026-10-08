import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { roles, users } from './iam';
import { tenantId } from './tenancy';

// =============================================================================
// Enterprise identity: single sign-on and SCIM provisioning
// =============================================================================

/** A workspace's identity provider. OIDC is supported end to end; SAML settings feed the SP metadata. */
export const ssoSettings = pgTable(
  'sso_settings',
  {
    id: pk(),
    tenantId: tenantId(),
    /** oidc | saml */
    protocol: text('protocol').notNull().default('oidc'),
    enabled: boolean('enabled').notNull().default(false),
    // OIDC
    issuer: text('issuer'),
    clientId: text('client_id'),
    clientSecretEncrypted: text('client_secret_encrypted'),
    // SAML
    idpEntityId: text('idp_entity_id'),
    idpSsoUrl: text('idp_sso_url'),
    idpCertificate: text('idp_certificate'),
    /** Email domains that may sign in this way, e.g. {acme.in}. */
    allowedDomains: text('allowed_domains').array().notNull().default([]),
    /** Create the user and membership on first sign-in. */
    autoProvision: boolean('auto_provision').notNull().default(false),
    defaultRoleId: uuid('default_role_id').references(() => roles.id, { onDelete: 'set null' }),
    /** Members (except owners) must sign in through the identity provider. */
    requireSso: boolean('require_sso').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sso_settings_tenant_uq').on(t.tenantId)],
);

/** Bearer tokens an identity provider uses to call the SCIM 2.0 API. Only a hash is kept. */
export const scimTokens = pgTable(
  'scim_tokens',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    defaultRoleId: uuid('default_role_id').references(() => roles.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('scim_tokens_hash_uq').on(t.tokenHash), index('scim_tokens_tenant_idx').on(t.tenantId)],
);
