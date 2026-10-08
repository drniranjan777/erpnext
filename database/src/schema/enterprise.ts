import { date, doublePrecision, index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { costCenters } from './accounting';
import { documents } from './documents';
import { users } from './iam';
import { parties } from './masters';
import { companies, tenantId } from './tenancy';

// =============================================================================
// Enterprise finance: inter-company, consolidation, treasury, cost allocation
// =============================================================================

/** The party that stands for a company of the group in the other companies' books. */
export const intercompanyLinks = pgTable(
  'intercompany_links',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
  },
  (t) => [uniqueIndex('intercompany_links_company_uq').on(t.tenantId, t.companyId), uniqueIndex('intercompany_links_party_uq').on(t.tenantId, t.partyId)],
);

/** A charge, sale, loan or other amount between two companies, posted in both sets of books. */
export const intercompanyTransactions = pgTable(
  'intercompany_transactions',
  {
    id: pk(),
    tenantId: tenantId(),
    number: citext('number').notNull(),
    txnDate: date('txn_date', { mode: 'string' }).notNull(),
    fromCompanyId: uuid('from_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    toCompanyId: uuid('to_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    /** charge | sale | loan | repayment | other */
    kind: text('kind').notNull(),
    amount: doublePrecision('amount').notNull(),
    description: text('description').notNull(),
    /** Sender's other side (income, or bank for a loan); receiver's other side (expense, or bank). */
    fromAccountId: uuid('from_account_id'),
    toAccountId: uuid('to_account_id'),
    fromJournalId: uuid('from_journal_id').references(() => documents.id, { onDelete: 'set null' }),
    toJournalId: uuid('to_journal_id').references(() => documents.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('intercompany_txn_number_uq').on(t.tenantId, t.number), index('intercompany_txn_date_idx').on(t.tenantId, t.txnDate)],
);

export interface GroupMember {
  companyId: string;
  /** % held by the parent (100 for a wholly owned subsidiary). */
  ownershipPct: number;
  /** Cost of the parent's investment in this subsidiary. */
  investmentCost: number;
  acquiredOn: string;
}

/** A group for consolidation: the parent and its subsidiaries. */
export const consolidationGroups = pgTable('consolidation_groups', {
  id: pk(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  parentCompanyId: uuid('parent_company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  members: jsonb('members').$type<GroupMember[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Treasury: term loans taken or given, fixed deposits, bank facilities and the letters of credit and
 * bank guarantees issued under them.
 */
export const treasuryInstruments = pgTable(
  'treasury_instruments',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    /** loan | fd | facility | lc | bg */
    kind: text('kind').notNull(),
    number: text('number').notNull(),
    bank: text('bank').notNull(),
    principal: doublePrecision('principal').notNull(),
    ratePct: doublePrecision('rate_pct').notNull().default(0),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    /** Loans: emi | bullet. Deposits: quarterly | monthly | simple. */
    method: text('method'),
    /** LC / BG: the facility they use and the margin kept. */
    facilityId: uuid('facility_id'),
    marginPct: doublePrecision('margin_pct').notNull().default(0),
    beneficiary: text('beneficiary'),
    purpose: text('purpose'),
    /** active | closed | invoked */
    status: text('status').notNull().default('active'),
    /** Months whose interest is posted: YYYY-MM → journal id. */
    accruals: jsonb('accruals').$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('treasury_number_uq').on(t.tenantId, t.companyId, t.kind, t.number), index('treasury_end_idx').on(t.tenantId, t.endDate)],
);

/** Distributes a service cost centre's expenses to the cost centres it serves. */
export const allocationRules = pgTable('allocation_rules', {
  id: pk(),
  tenantId: tenantId(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  sourceCostCenterId: uuid('source_cost_center_id')
    .notNull()
    .references(() => costCenters.id, { onDelete: 'restrict' }),
  /** Expense accounts to allocate; empty = every expense account. */
  accountIds: uuid('account_ids').array().notNull().default([]),
  /** Driver weights (percent, floor area, head count, machine hours…). */
  targets: jsonb('targets').$type<{ costCenterId: string; weight: number }[]>().notNull(),
  basis: text('basis').notNull().default('percent'),
  /** Period (YYYY-MM) → journal id. */
  runs: jsonb('runs').$type<Record<string, string>>().notNull().default({}),
  sequence: smallint('sequence').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
