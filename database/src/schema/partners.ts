import { boolean, doublePrecision, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { users } from './iam';
import { tenantId } from './tenancy';

// =============================================================================
// White-label branding (per workspace) and partners (platform-wide)
// =============================================================================

/** A workspace's own branding: name, logo and colours, sender identities and custom domain. */
export const tenantBranding = pgTable(
  'tenant_branding',
  {
    id: pk(),
    tenantId: tenantId(),
    productName: text('product_name'),
    /** data: URL of a small PNG / SVG / JPEG logo. */
    logo: text('logo'),
    primaryColor: text('primary_color'),
    accentColor: text('accent_color'),
    supportEmail: text('support_email'),
    emailFromName: text('email_from_name'),
    emailFromAddress: text('email_from_address'),
    /** Token to publish as a DNS TXT record on the sending domain. */
    emailDomainToken: text('email_domain_token'),
    emailDomainVerifiedAt: timestamp('email_domain_verified_at', { withTimezone: true }),
    /** TRAI DLT: 6-character header and the principal entity id. */
    smsSenderId: text('sms_sender_id'),
    smsEntityId: text('sms_entity_id'),
    customDomain: citext('custom_domain'),
    domainToken: text('domain_token'),
    domainVerifiedAt: timestamp('domain_verified_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tenant_branding_tenant_uq').on(t.tenantId), uniqueIndex('tenant_branding_domain_uq').on(t.customDomain)],
);

/**
 * A reseller or implementation partner. Platform-wide (no tenant_id): the app reaches these tables
 * only through security-definer functions in rls.sql.
 */
export const partners = pgTable(
  'partners',
  {
    id: pk(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** reseller | implementer | both */
    kind: text('kind').notNull(),
    email: text('email').notNull(),
    gstin: text('gstin'),
    commissionPct: doublePrecision('commission_pct').notNull().default(0),
    certified: boolean('certified').notNull().default(false),
    /** active | suspended */
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('partners_code_uq').on(t.code)],
);

export const partnerMembers = pgTable(
  'partner_members',
  {
    id: pk(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** admin | member */
    role: text('role').notNull().default('member'),
  },
  (t) => [uniqueIndex('partner_members_uq').on(t.partnerId, t.userId), index('partner_members_user_idx').on(t.userId)],
);

/** Commission on a client workspace's paid subscription invoice. */
export const partnerCommissions = pgTable(
  'partner_commissions',
  {
    id: pk(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    /** Not named tenant_id on purpose: this is platform data, outside workspace row-level security. */
    clientTenantId: uuid('client_tenant_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    baseAmount: doublePrecision('base_amount').notNull(),
    ratePct: doublePrecision('rate_pct').notNull(),
    amount: doublePrecision('amount').notNull(),
    /** accrued | paid */
    status: text('status').notNull().default('accrued'),
    payoutRef: text('payout_ref'),
    accruedAt: timestamp('accrued_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('partner_commissions_invoice_uq').on(t.invoiceId), index('partner_commissions_partner_idx').on(t.partnerId)],
);
