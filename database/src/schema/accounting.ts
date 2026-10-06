import { sql } from 'drizzle-orm';
import { boolean, char, date, index, numeric, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { auditColumns, citext, pk } from './_columns';
import { documents } from './documents';
import { parties } from './masters';
import { branches, companies, tenantId } from './tenancy';

const money = (name: string) => numeric(name, { precision: 18, scale: 2 }).notNull().default('0');

export const accountNature = pgEnum('account_nature', ['asset', 'liability', 'equity', 'income', 'expense']);

/**
 * Chart of accounts per company: a tree of groups and posting accounts. `systemKey` marks the
 * accounts the posting rules use (receivables, output CGST…); `reportLine` maps to the
 * Schedule III line the account rolls up to.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => accounts.id, { onDelete: 'restrict' }),
    isGroup: boolean('is_group').notNull().default(false),
    nature: accountNature('nature').notNull(),
    systemKey: text('system_key'),
    reportLine: text('report_line'),
    /** Receivables / payables: every entry names the party (sub-ledger). */
    isControl: boolean('is_control').notNull().default(false),
    /** Bank / cash accounts (Phase 4.2 uses them for receipts and payments). */
    accountType: text('account_type'),
    allowManual: boolean('allow_manual').notNull().default(true),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('accounts_code_uq').on(t.companyId, t.code),
    uniqueIndex('accounts_key_uq').on(t.companyId, t.systemKey).where(sql`${t.systemKey} is not null`),
    index('accounts_parent_idx').on(t.parentId),
    index('accounts_tenant_idx').on(t.tenantId, t.companyId),
  ],
);

export const costCenters = pgTable(
  'cost_centers',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => costCenters.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('cost_centers_code_uq').on(t.companyId, t.code)],
);

/** Books per company: from when, and up to when they are locked. */
export const accountingSettings = pgTable('accounting_settings', {
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => companies.id, { onDelete: 'cascade' }),
  tenantId: tenantId(),
  booksFrom: date('books_from', { mode: 'string' }).notNull(),
  /** No posting on or before this date. */
  lockedUntil: date('locked_until', { mode: 'string' }),
  /** When posted documents before setup were brought into the books. */
  initialisedAt: timestamp('initialised_at', { withTimezone: true }),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * General ledger: one row per account line of a posted voucher. Append-only; cancelling a
 * voucher writes reversal rows. Amounts in the company's base currency.
 */
export const glEntries = pgTable(
  'gl_entries',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    postingDate: date('posting_date', { mode: 'string' }).notNull(),
    voucherType: text('voucher_type').notNull(),
    voucherId: uuid('voucher_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    voucherNumber: text('voucher_number'),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'restrict' }),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id, { onDelete: 'restrict' }),
    debit: money('debit'),
    credit: money('credit'),
    narration: text('narration'),
    /** Bill-wise reference for receivables / payables (the invoice this line belongs to). */
    againstVoucherId: uuid('against_voucher_id').references(() => documents.id, { onDelete: 'restrict' }),
    isReversal: boolean('is_reversal').notNull().default(false),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('gl_account_date_idx').on(t.tenantId, t.accountId, t.postingDate),
    index('gl_voucher_idx').on(t.voucherId),
    index('gl_party_idx').on(t.tenantId, t.partyId).where(sql`${t.partyId} is not null`),
    index('gl_against_idx').on(t.againstVoucherId).where(sql`${t.againstVoucherId} is not null`),
    index('gl_company_date_idx').on(t.tenantId, t.companyId, t.postingDate),
  ],
);

/** Journal voucher (doc type "journal_entry"). */
export const journals = pgTable('journals', {
  id: uuid('id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  tenantId: tenantId(),
  /** journal | opening | reversing */
  kind: text('kind').notNull().default('journal'),
  narration: text('narration'),
  /** Reversing journals: a mirror journal is posted on this date. */
  reverseOn: date('reverse_on', { mode: 'string' }),
  reversalOfId: uuid('reversal_of_id').references((): AnyPgColumn => journals.id, { onDelete: 'set null' }),
  /** monthly | quarterly | yearly: a copy is posted on each next date. */
  recurrence: text('recurrence'),
  recurUntil: date('recur_until', { mode: 'string' }),
  recurredFromId: uuid('recurred_from_id').references((): AnyPgColumn => journals.id, { onDelete: 'set null' }),
  totalDebit: money('total_debit'),
});

export const journalLines = pgTable(
  'journal_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    journalId: uuid('journal_id')
      .notNull()
      .references(() => journals.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'restrict' }),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id, { onDelete: 'restrict' }),
    debit: money('debit'),
    credit: money('credit'),
    narration: text('narration'),
    againstVoucherId: uuid('against_voucher_id').references(() => documents.id, { onDelete: 'restrict' }),
  },
  (t) => [index('journal_lines_j_idx').on(t.journalId), uniqueIndex('journal_lines_no_uq').on(t.journalId, t.lineNo)],
);
