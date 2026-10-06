import { sql } from 'drizzle-orm';
import { date, index, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { accounts, glEntries } from './accounting';
import { documents } from './documents';
import { parties } from './masters';
import { companies, tenantId } from './tenancy';

const money = (name: string) => numeric(name, { precision: 18, scale: 2 }).notNull().default('0');

/**
 * Receipt (doc type "receipt"), payment ("payment") or contra ("contra") voucher.
 * Receipts and payments settle bills through allocations; what is not allocated stays on
 * account (an advance) until it is adjusted against a bill.
 */
export const moneyVouchers = pgTable(
  'money_vouchers',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    /** receipt | payment | contra */
    kind: text('kind').notNull(),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'restrict' }),
    /** The bank / cash account money comes into (receipt) or leaves from (payment, contra). */
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    /** Payments to an expense / other account without a party, and the other side of a contra. */
    counterAccountId: uuid('counter_account_id').references(() => accounts.id, { onDelete: 'restrict' }),
    /** cash | cheque | neft | rtgs | imps | upi | card | dd | write_off */
    mode: text('mode').notNull().default('neft'),
    instrumentNo: text('instrument_no'),
    instrumentDate: date('instrument_date', { mode: 'string' }),
    /** cheque status: pending | cleared | bounced */
    chequeStatus: text('cheque_status'),
    amount: money('amount'),
    bankCharges: money('bank_charges'),
    /** TDS the customer deducted from what they paid us. */
    tdsDeducted: money('tds_deducted'),
    /** Amount settled with the party (receipts: amount + TDS + bank charges). */
    settledAmount: money('settled_amount'),
    onAccount: money('on_account'),
    reference: text('reference'),
    narration: text('narration'),
  },
  (t) => [index('mv_party_idx').on(t.tenantId, t.partyId), index('mv_account_idx').on(t.tenantId, t.accountId)],
);

/** Which bills a receipt / payment settles. Adjustments made later point to their journal. */
export const moneyAllocations = pgTable(
  'money_allocations',
  {
    id: pk(),
    tenantId: tenantId(),
    voucherId: uuid('voucher_id')
      .notNull()
      .references(() => moneyVouchers.id, { onDelete: 'cascade' }),
    /** The sales invoice / purchase invoice settled. */
    againstDocId: uuid('against_doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    amount: money('amount'),
    /** Set when an advance was adjusted against the bill after the voucher was posted. */
    adjustmentId: uuid('adjustment_id').references(() => documents.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ma_voucher_idx').on(t.voucherId), index('ma_against_idx').on(t.againstDocId)],
);

/** Imported bank statement lines, matched to ledger entries of the bank account. */
export const bankStatementLines = pgTable(
  'bank_statement_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    importId: uuid('import_id').notNull(),
    lineNo: smallint('line_no').notNull(),
    txnDate: date('txn_date', { mode: 'string' }).notNull(),
    valueDate: date('value_date', { mode: 'string' }),
    description: text('description').notNull(),
    reference: text('reference'),
    /** Money out of the account. */
    withdrawal: money('withdrawal'),
    /** Money into the account. */
    deposit: money('deposit'),
    balance: numeric('balance', { precision: 18, scale: 2 }),
    /** unmatched | matched | ignored */
    status: text('status').notNull().default('unmatched'),
    /** How it was matched: auto rule name, or manual. */
    matchedBy: text('matched_by'),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bsl_account_idx').on(t.tenantId, t.accountId, t.txnDate), uniqueIndex('bsl_import_line_uq').on(t.importId, t.lineNo)],
);

/** Ledger entries of a bank account reconciled with statement lines (the ledger itself is append-only). */
export const bankReconciliations = pgTable(
  'bank_reconciliations',
  {
    glEntryId: uuid('gl_entry_id')
      .primaryKey()
      .references(() => glEntries.id, { onDelete: 'restrict' }),
    tenantId: tenantId(),
    statementLineId: uuid('statement_line_id')
      .notNull()
      .references(() => bankStatementLines.id, { onDelete: 'cascade' }),
    clearedOn: date('cleared_on', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('br_line_idx').on(t.statementLineId), index('br_tenant_idx').on(t.tenantId).where(sql`true`)],
);
