import { doublePrecision, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { documents } from './documents';
import { users } from './iam';
import { parties, warehouses } from './masters';
import { tenantId } from './tenancy';

// =============================================================================
// Point of sale (showroom / factory outlet)
// =============================================================================

/** A till: sells from one warehouse, billed to its walk-in customer unless a customer is given. */
export const posTerminals = pgTable(
  'pos_terminals',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id').references(() => parties.id, { onDelete: 'restrict' }),
    receiptFooter: text('receipt_footer'),
    /** active | inactive */
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('pos_terminals_code_uq').on(t.tenantId, t.code)],
);

export interface ZReport {
  sales: number;
  salesAmount: number;
  returns: number;
  returnsAmount: number;
  byTender: Record<string, { in: number; out: number }>;
  byRate: Record<string, { taxable: number; tax: number }>;
  expectedCash: number;
  countedCash: number;
  difference: number;
}

/** A cashier's shift on a till, from opening float to the day-close (Z) report. */
export const posSessions = pgTable(
  'pos_sessions',
  {
    id: pk(),
    tenantId: tenantId(),
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => posTerminals.id, { onDelete: 'restrict' }),
    openedBy: uuid('opened_by').references(() => users.id, { onDelete: 'set null' }),
    openingCash: doublePrecision('opening_cash').notNull().default(0),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    /** open | closed */
    status: text('status').notNull().default('open'),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    zReport: jsonb('z_report').$type<ZReport>(),
  },
  (t) => [index('pos_sessions_terminal_idx').on(t.tenantId, t.terminalId, t.openedAt)],
);

export interface PosLine {
  itemId: string;
  code: string;
  name: string;
  qty: number;
  /** Price including GST, per unit. */
  price: number;
  discountPct: number;
  gstRate: number;
  taxable: number;
  tax: number;
  total: number;
}

/** A sale or a return at the till; each becomes a sales invoice or a credit note. */
export const posSales = pgTable(
  'pos_sales',
  {
    id: pk(),
    tenantId: tenantId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => posSessions.id, { onDelete: 'restrict' }),
    /** sale | return */
    kind: text('kind').notNull().default('sale'),
    number: text('number').notNull(),
    /** Set by the till so a sale retried after a network drop is recorded once. */
    clientRef: text('client_ref').notNull(),
    buyerName: text('buyer_name'),
    buyerMobile: text('buyer_mobile'),
    buyerGstin: text('buyer_gstin'),
    lines: jsonb('lines').$type<PosLine[]>().notNull(),
    taxable: doublePrecision('taxable').notNull(),
    tax: doublePrecision('tax').notNull(),
    total: doublePrecision('total').notNull(),
    tenders: jsonb('tenders').$type<{ mode: string; amount: number; ref?: string | null }[]>().notNull(),
    change: doublePrecision('change').notNull().default(0),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    returnOfId: uuid('return_of_id'),
    soldBy: uuid('sold_by').references(() => users.id, { onDelete: 'set null' }),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('pos_sales_ref_uq').on(t.tenantId, t.clientRef), index('pos_sales_session_idx').on(t.tenantId, t.sessionId)],
);
