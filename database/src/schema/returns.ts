import { boolean, char, date, index, integer, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, citext, pk } from './_columns';
import { accounts } from './accounting';
import { documents } from './documents';
import { warehouses } from './masters';
import { purchaseInvoices } from './purchase';
import { branches, companies, tenantId } from './tenancy';

const money = (name: string) => numeric(name, { precision: 18, scale: 2 }).notNull().default('0');

// =============================================================================
// GSTR-2B (auto-drafted ITC statement) imported from the GST portal, matched to bills
// =============================================================================

export const gstr2bImports = pgTable(
  'gstr2b_imports',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    gstin: char('gstin', { length: 15 }).notNull(),
    /** Return period YYYY-MM. */
    period: char('period', { length: 7 }).notNull(),
    fileName: text('file_name'),
    lines: integer('lines').notNull().default(0),
    importedBy: uuid('imported_by'),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('g2b_imports_idx').on(t.tenantId, t.companyId, t.period)],
);

export const gstr2bLines = pgTable(
  'gstr2b_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    importId: uuid('import_id')
      .notNull()
      .references(() => gstr2bImports.id, { onDelete: 'cascade' }),
    period: char('period', { length: 7 }).notNull(),
    /** b2b | cdnr | impg */
    section: text('section').notNull(),
    ctin: char('ctin', { length: 15 }),
    tradeName: text('trade_name'),
    /** INV | CRN | DBN | BOE */
    docType: text('doc_type').notNull(),
    docNo: text('doc_no').notNull(),
    docDate: date('doc_date', { mode: 'string' }).notNull(),
    pos: char('pos', { length: 2 }),
    reverseCharge: boolean('reverse_charge').notNull().default(false),
    itcAvailable: boolean('itc_available').notNull().default(true),
    itcReason: text('itc_reason'),
    taxable: money('taxable'),
    igst: money('igst'),
    cgst: money('cgst'),
    sgst: money('sgst'),
    cess: money('cess'),
    total: money('total'),
    /** matched | mismatch | missing_in_books */
    status: text('status').notNull().default('missing_in_books'),
    purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id, { onDelete: 'set null' }),
    difference: text('difference'),
    /** What the accountant decided: accept | follow_up | defer */
    action: text('action'),
    note: text('note'),
  },
  (t) => [index('g2b_lines_import_idx').on(t.importId), index('g2b_lines_period_idx').on(t.tenantId, t.period, t.ctin)],
);

// =============================================================================
// TDS deposited (challan ITNS 281) — links a payment voucher to a section and quarter
// =============================================================================

export const tdsChallans = pgTable(
  'tds_challans',
  {
    voucherId: uuid('voucher_id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    section: text('section').notNull(),
    /** Financial year quarter, e.g. 2026-27 Q2 */
    quarter: text('quarter').notNull(),
    bsrCode: char('bsr_code', { length: 7 }).notNull(),
    challanSerial: text('challan_serial').notNull(),
    depositDate: date('deposit_date', { mode: 'string' }).notNull(),
    amount: money('amount'),
    interest: money('interest'),
    lateFee: money('late_fee'),
  },
  (t) => [index('tds_challans_q_idx').on(t.tenantId, t.quarter)],
);

// =============================================================================
// Fixed assets
// =============================================================================

export const assetCategories = pgTable(
  'asset_categories',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** Cost is carried in this account; accumulated depreciation in the company's contra account. */
    assetAccountId: uuid('asset_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    /** slm | wdv (Companies Act book) */
    method: text('method').notNull().default('slm'),
    /** Useful life per Schedule II, in years. */
    usefulLifeYears: numeric('useful_life_years', { precision: 5, scale: 2 }).notNull(),
    residualPct: numeric('residual_pct', { precision: 5, scale: 2 }).notNull().default('5'),
    /** Income-tax block rate (WDV). */
    itRatePct: numeric('it_rate_pct', { precision: 5, scale: 2 }).notNull(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('asset_categories_name_uq').on(t.companyId, t.name)],
);

export const fixedAssets = pgTable(
  'fixed_assets',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => assetCategories.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    custodian: text('custodian'),
    serialNo: text('serial_no'),
    purchaseDate: date('purchase_date', { mode: 'string' }).notNull(),
    /** Put to use: depreciation runs from here. */
    capitalisedOn: date('capitalised_on', { mode: 'string' }).notNull(),
    cost: money('cost'),
    residualValue: money('residual_value'),
    method: text('method').notNull(),
    usefulLifeYears: numeric('useful_life_years', { precision: 5, scale: 2 }).notNull(),
    itRatePct: numeric('it_rate_pct', { precision: 5, scale: 2 }).notNull(),
    /** Book (Companies Act) depreciation charged so far. */
    accumulatedDepreciation: money('accumulated_depreciation'),
    /** Last day depreciation has been charged up to. */
    depreciatedUntil: date('depreciated_until', { mode: 'string' }),
    sourceInvoiceId: uuid('source_invoice_id').references(() => documents.id, { onDelete: 'set null' }),
    /** Journal that capitalised it (from CWIP / expense), if any. */
    capitalisationJournalId: uuid('capitalisation_journal_id').references(() => documents.id, { onDelete: 'set null' }),
    /** active | disposed */
    status: text('status').notNull().default('active'),
    disposedOn: date('disposed_on', { mode: 'string' }),
    disposalAmount: money('disposal_amount'),
    disposalJournalId: uuid('disposal_journal_id').references(() => documents.id, { onDelete: 'set null' }),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('fixed_assets_code_uq').on(t.tenantId, t.code), index('fixed_assets_cat_idx').on(t.categoryId)],
);

/** Depreciation charged per asset per run (the run's journal posts the total). */
export const assetDepreciation = pgTable(
  'asset_depreciation',
  {
    id: pk(),
    tenantId: tenantId(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => fixedAssets.id, { onDelete: 'cascade' }),
    journalId: uuid('journal_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    days: smallint('days').notNull(),
    amount: money('amount'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('asset_dep_asset_idx').on(t.assetId), index('asset_dep_journal_idx').on(t.journalId)],
);
