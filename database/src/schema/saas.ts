import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, createdAt, pk, timestamps } from './_columns';
import { memberships, users } from './iam';
import { tenantId } from './tenancy';

// =============================================================================
// Billing
// =============================================================================

export const subscriptionStatus = pgEnum('subscription_status', ['trialing', 'active', 'past_due', 'cancelled', 'expired']);
export const billingCycle = pgEnum('billing_cycle', ['monthly', 'yearly']);

/** One row per tenant: current plan and billing state. */
export const subscriptions = pgTable('subscriptions', {
  id: pk(),
  tenantId: tenantId().unique(),
  planCode: text('plan_code').notNull(),
  cycle: billingCycle('cycle').notNull().default('monthly'),
  status: subscriptionStatus('status').notNull(),
  provider: text('provider').notNull(),
  providerSubscriptionId: text('provider_subscription_id'),
  /** Pending checkout (plan/cycle the customer is paying for). */
  pendingPlanCode: text('pending_plan_code'),
  pendingCycle: billingCycle('pending_cycle'),
  pendingCheckoutId: text('pending_checkout_id'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  ...auditColumns(),
});

/** GST tax invoices we (the SaaS vendor) issue to the tenant. */
export const saasInvoices = pgTable(
  'saas_invoices',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull().unique(),
    invoiceDate: text('invoice_date').notNull(),
    description: text('description').notNull(),
    planCode: text('plan_code').notNull(),
    cycle: billingCycle('cycle').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    sacCode: text('sac_code').notNull().default('998314'),
    taxableAmount: numeric('taxable_amount', { precision: 18, scale: 2 }).notNull(),
    cgst: numeric('cgst', { precision: 18, scale: 2 }).notNull().default('0'),
    sgst: numeric('sgst', { precision: 18, scale: 2 }).notNull().default('0'),
    igst: numeric('igst', { precision: 18, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 18, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    buyerName: text('buyer_name').notNull(),
    buyerGstin: text('buyer_gstin'),
    buyerStateCode: char('buyer_state_code', { length: 2 }),
    sellerGstin: text('seller_gstin').notNull(),
    sellerStateCode: char('seller_state_code', { length: 2 }).notNull(),
    placeOfSupply: char('place_of_supply', { length: 2 }),
    status: text('status').notNull().default('paid'),
    provider: text('provider').notNull(),
    providerPaymentId: text('provider_payment_id'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('saas_invoices_tenant_idx').on(t.tenantId, t.createdAt)],
);

/** Raw payment-provider events (idempotency + audit). */
export const billingEvents = pgTable(
  'billing_events',
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('billing_events_provider_event_uq').on(t.provider, t.eventId)],
);

/** Platform-wide counters (e.g. our own GST invoice series). No tenant; app access only via functions. */
export const platformCounters = pgTable('platform_counters', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
  ...timestamps(),
});

// =============================================================================
// Integrations
// =============================================================================

/** Machine access for integrations. The secret is shown once; only its hash is stored. */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    prefix: text('prefix').notNull().unique(),
    keyHash: text('key_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('api_keys_tenant_idx').on(t.tenantId)],
);

/** Outgoing webhook subscriptions. The signing secret is stored encrypted (AES-256-GCM). */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: pk(),
    tenantId: tenantId(),
    url: text('url').notNull(),
    description: text('description'),
    events: text('events').array().notNull(),
    secretEncrypted: text('secret_encrypted').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [index('webhook_endpoints_tenant_idx').on(t.tenantId)],
);

export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', ['pending', 'succeeded', 'failed']);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: pk(),
    tenantId: tenantId(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: webhookDeliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    error: text('error'),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  },
  (t) => [index('webhook_deliveries_endpoint_idx').on(t.endpointId, t.createdAt)],
);

// =============================================================================
// DPDP Act: data principal requests
// =============================================================================

export const dataRequestType = pgEnum('data_request_type', ['correction', 'erasure', 'grievance']);
export const dataRequestStatus = pgEnum('data_request_status', ['open', 'completed', 'rejected']);

export const dataRequests = pgTable(
  'data_requests',
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: dataRequestType('type').notNull(),
    details: text('details').notNull(),
    status: dataRequestStatus('status').notNull().default('open'),
    resolution: text('resolution'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index('data_requests_tenant_idx').on(t.tenantId, t.status)],
);
