import { boolean, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { crmTerritories } from './crm';
import { attachments, documents } from './documents';
import { users } from './iam';
import { items, parties } from './masters';
import { tenantId } from './tenancy';

const money = (name: string) => numeric(name, { precision: 16, scale: 2 });
const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });

/** A customer who buys from us and resells to retailers. */
export const dmsDistributors = pgTable(
  'dms_distributors',
  {
    id: pk(),
    tenantId: tenantId(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    territoryId: uuid('territory_id').references(() => crmTerritories.id, { onDelete: 'set null' }),
    salespersonId: uuid('salesperson_id').references(() => users.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('dms_distributors_party_uq').on(t.tenantId, t.partyId)],
);

export const dmsBeats = pgTable(
  'dms_beats',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    distributorId: uuid('distributor_id').references(() => dmsDistributors.id, { onDelete: 'set null' }),
    salespersonId: uuid('salesperson_id').references(() => users.id, { onDelete: 'set null' }),
    /** Day of the week the beat is worked, 0 = Sunday; null = any day. */
    weekday: smallint('weekday'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('dms_beats_code_uq').on(t.tenantId, t.code)],
);

export const dmsRetailers = pgTable(
  'dms_retailers',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    ownerName: text('owner_name'),
    phone: text('phone'),
    distributorId: uuid('distributor_id')
      .notNull()
      .references(() => dmsDistributors.id, { onDelete: 'restrict' }),
    beatId: uuid('beat_id').references(() => dmsBeats.id, { onDelete: 'set null' }),
    address: text('address'),
    city: text('city'),
    stateCode: text('state_code'),
    gstin: text('gstin'),
    /** A | B | C outlet class. */
    outletClass: text('outlet_class').notNull().default('C'),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('dms_retailers_code_uq').on(t.tenantId, t.code), index('dms_retailers_beat_idx').on(t.beatId)],
);

export const dmsSchemes = pgTable(
  'dms_schemes',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** qty_slab | value_slab | free_goods */
    kind: text('kind').notNull(),
    /** primary (we → distributor, claimed on invoices) | secondary (distributor → retailer) */
    level: text('level').notNull().default('secondary'),
    itemIds: uuid('item_ids').array().notNull().default([]),
    slabs: jsonb('slabs').$type<{ min: number; discountPct?: number; perUnit?: number; freeQty?: number }[]>().notNull(),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('dms_schemes_code_uq').on(t.tenantId, t.code)],
);

export const dmsVisits = pgTable(
  'dms_visits',
  {
    id: pk(),
    tenantId: tenantId(),
    salespersonId: uuid('salesperson_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => dmsRetailers.id, { onDelete: 'cascade' }),
    beatId: uuid('beat_id').references(() => dmsBeats.id, { onDelete: 'set null' }),
    checkInAt: timestamp('check_in_at', { withTimezone: true }).notNull(),
    checkOutAt: timestamp('check_out_at', { withTimezone: true }),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    /** Distance from the outlet's recorded location. */
    distanceMetres: integer('distance_metres'),
    photoId: uuid('photo_id').references(() => attachments.id, { onDelete: 'set null' }),
    /** order | no_order | closed | not_met */
    outcome: text('outcome'),
    notes: text('notes'),
  },
  (t) => [index('dms_visits_sp_idx').on(t.tenantId, t.salespersonId, t.checkInAt), index('dms_visits_retailer_idx').on(t.retailerId)],
);

/** Sales from a distributor to a retailer, captured in the field or imported from the distributor's system. */
export const dmsSecondarySales = pgTable(
  'dms_secondary_sales',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    distributorId: uuid('distributor_id')
      .notNull()
      .references(() => dmsDistributors.id, { onDelete: 'restrict' }),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => dmsRetailers.id, { onDelete: 'restrict' }),
    date: date('date', { mode: 'string' }).notNull(),
    visitId: uuid('visit_id').references(() => dmsVisits.id, { onDelete: 'set null' }),
    /** field | import | manual */
    source: text('source').notNull().default('manual'),
    gross: money('gross').notNull(),
    discount: money('discount').notNull().default('0'),
    net: money('net').notNull(),
    schemes: jsonb('schemes').$type<{ schemeId: string; code: string; itemId: string | null; discount: number; freeQty: number; basis: string }[]>().notNull().default([]),
    /** recorded | cancelled */
    status: text('status').notNull().default('recorded'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('dms_secondary_sales_number_uq').on(t.tenantId, t.number), index('dms_secondary_sales_dist_idx').on(t.distributorId, t.date)],
);

export const dmsSecondaryLines = pgTable(
  'dms_secondary_lines',
  {
    id: pk(),
    tenantId: tenantId(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => dmsSecondarySales.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    qty: qty('qty').notNull(),
    freeQty: qty('free_qty').notNull().default('0'),
    rate: numeric('rate', { precision: 18, scale: 4 }).notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [index('dms_secondary_lines_sale_idx').on(t.saleId)],
);

/** Opening stock and physical counts at a distributor (primary in and secondary out move it in between). */
export const dmsStockAdjustments = pgTable(
  'dms_stock_adjustments',
  {
    id: pk(),
    tenantId: tenantId(),
    distributorId: uuid('distributor_id')
      .notNull()
      .references(() => dmsDistributors.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    date: date('date', { mode: 'string' }).notNull(),
    qty: qty('qty').notNull(),
    /** opening | count (qty is the difference counted) | damage */
    kind: text('kind').notNull(),
    remarks: text('remarks'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dms_stock_adjustments_idx').on(t.distributorId, t.itemId)],
);

export const dmsClaims = pgTable(
  'dms_claims',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    distributorId: uuid('distributor_id')
      .notNull()
      .references(() => dmsDistributors.id, { onDelete: 'restrict' }),
    /** scheme | damage | price_difference | other */
    kind: text('kind').notNull(),
    schemeId: uuid('scheme_id').references(() => dmsSchemes.id, { onDelete: 'set null' }),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    claimedAmount: money('claimed_amount').notNull(),
    /** What the system works out from the scheme and the sales (null for other kinds). */
    computedAmount: money('computed_amount'),
    approvedAmount: money('approved_amount'),
    /** submitted | approved | rejected | settled */
    status: text('status').notNull().default('submitted'),
    notes: text('notes'),
    decisionNote: text('decision_note'),
    journalId: uuid('journal_id').references(() => documents.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('dms_claims_number_uq').on(t.tenantId, t.number), index('dms_claims_dist_idx').on(t.distributorId, t.status)],
);

export const dmsLoyalty = pgTable(
  'dms_loyalty',
  {
    id: pk(),
    tenantId: tenantId(),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => dmsRetailers.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    points: integer('points').notNull(),
    /** earn | redeem | adjust */
    kind: text('kind').notNull(),
    refKey: text('ref_key'),
    remarks: text('remarks'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('dms_loyalty_ref_uq').on(t.tenantId, t.refKey), index('dms_loyalty_retailer_idx').on(t.retailerId)],
);

export const dmsSettings = pgTable(
  'dms_settings',
  {
    id: pk(),
    tenantId: tenantId(),
    /** Loyalty points a retailer earns per ₹100 of net secondary purchases. */
    pointsPerHundred: numeric('points_per_hundred', { precision: 6, scale: 2 }).notNull().default('1'),
    /** A check-in further than this from the outlet is flagged. */
    visitRadiusMetres: integer('visit_radius_metres').notNull().default(200),
  },
  (t) => [uniqueIndex('dms_settings_tenant_uq').on(t.tenantId)],
);
