import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, citext, pk, softDelete, timestamps } from './_columns';

export const tenantStatus = pgEnum('tenant_status', ['trial', 'active', 'suspended', 'archived']);

/** A subscribing customer (workspace). Root of all tenant-scoped data. */
export const tenants = pgTable('tenants', {
  id: pk(),
  slug: citext('slug').notNull().unique(),
  name: text('name').notNull(),
  status: tenantStatus('status').notNull().default('trial'),
  industry: text('industry'),
  planCode: text('plan_code').notNull().default('trial'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
});

/** Every tenant-scoped table uses this column; RLS policies key off it. */
export const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

export type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  district?: string;
  stateCode?: string;
  pincode?: string;
  country?: string;
};

/** Legal entity. Additional state GST registrations are modelled at branch level. */
export const companies = pgTable(
  'companies',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    pan: char('pan', { length: 10 }),
    gstin: char('gstin', { length: 15 }),
    stateCode: char('state_code', { length: 2 }),
    address: jsonb('address').$type<Address>().notNull().default({}),
    baseCurrency: char('base_currency', { length: 3 }).notNull().default('INR'),
    fyStartMonth: smallint('fy_start_month').notNull().default(4),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    index('companies_tenant_idx').on(t.tenantId),
    uniqueIndex('companies_tenant_gstin_uq').on(t.tenantId, t.gstin).where(sql`${t.gstin} is not null`),
  ],
);

/** Branch / plant / location under a company. */
export const branches = pgTable(
  'branches',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    gstin: char('gstin', { length: 15 }),
    stateCode: char('state_code', { length: 2 }),
    address: jsonb('address').$type<Address>().notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    index('branches_tenant_company_idx').on(t.tenantId, t.companyId),
    uniqueIndex('branches_tenant_company_code_uq').on(t.tenantId, t.companyId, t.code),
  ],
);
