import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, citext, pk, softDelete, timestamps } from './_columns';
import { branches, companies, tenantId, type Address } from './tenancy';

/** Per-tenant running counters for auto codes (ITM00001, CUS00001…). */
export const tenantCounters = pgTable(
  'tenant_counters',
  {
    tenantId: tenantId(),
    key: text('key').notNull(),
    value: integer('value').notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

// =============================================================================
// Units of measure
// =============================================================================

export const uoms = pgTable(
  'uoms',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** Decimal places allowed in quantities (0 for NOS/PCS). */
    decimals: smallint('decimals').notNull().default(3),
    /** GST Unique Quantity Code for e-invoice / GSTR-1. */
    uqc: text('uqc').notNull().default('OTH'),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uoms_code_uq').on(t.tenantId, t.code)],
);

// =============================================================================
// Items
// =============================================================================

export const itemGroups = pgTable(
  'item_groups',
  {
    id: pk(),
    tenantId: tenantId(),
    parentId: uuid('parent_id'),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('item_groups_code_uq').on(t.tenantId, t.code), index('item_groups_parent_idx').on(t.parentId)],
);

export const itemType = pgEnum('item_type', [
  'raw_material',
  'packing_material',
  'semi_finished',
  'finished_good',
  'trading',
  'consumable',
  'spare',
  'service',
  'asset',
  'scrap',
  'by_product',
]);

export const valuationMethod = pgEnum('valuation_method', ['weighted_average', 'fifo']);

export type ItemAttributes = Record<string, string | number | boolean | null>;

export const items = pgTable(
  'items',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    type: itemType('type').notNull(),
    groupId: uuid('group_id').references(() => itemGroups.id, { onDelete: 'restrict' }),
    baseUomId: uuid('base_uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    purchaseUomId: uuid('purchase_uom_id').references(() => uoms.id, { onDelete: 'restrict' }),
    salesUomId: uuid('sales_uom_id').references(() => uoms.id, { onDelete: 'restrict' }),
    // Tax
    hsnCode: text('hsn_code'),
    gstRate: numeric('gst_rate', { precision: 5, scale: 2 }),
    cessRate: numeric('cess_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    isNilRatedOrExempt: boolean('is_nil_rated_or_exempt').notNull().default(false),
    // Inventory behaviour
    isStockItem: boolean('is_stock_item').notNull().default(true),
    trackBatch: boolean('track_batch').notNull().default(false),
    trackSerial: boolean('track_serial').notNull().default(false),
    hasExpiry: boolean('has_expiry').notNull().default(false),
    shelfLifeDays: integer('shelf_life_days'),
    minRemainingShelfLifeDays: integer('min_remaining_shelf_life_days'),
    valuationMethod: valuationMethod('valuation_method').notNull().default('weighted_average'),
    reorderLevel: numeric('reorder_level', { precision: 18, scale: 4 }),
    reorderQty: numeric('reorder_qty', { precision: 18, scale: 4 }),
    safetyStock: numeric('safety_stock', { precision: 18, scale: 4 }),
    minOrderQty: numeric('min_order_qty', { precision: 18, scale: 4 }),
    leadTimeDays: integer('lead_time_days'),
    // Commercial
    standardCost: numeric('standard_cost', { precision: 18, scale: 4 }),
    lastPurchaseRate: numeric('last_purchase_rate', { precision: 18, scale: 4 }),
    sellingRate: numeric('selling_rate', { precision: 18, scale: 4 }),
    mrp: numeric('mrp', { precision: 18, scale: 2 }),
    brand: text('brand'),
    // Physical
    netWeightKg: numeric('net_weight_kg', { precision: 18, scale: 4 }),
    grossWeightKg: numeric('gross_weight_kg', { precision: 18, scale: 4 }),
    /** Industry attributes: grade, GSM, count, density, colour, potency… */
    attributes: jsonb('attributes').$type<ItemAttributes>().notNull().default({}),
    abcClass: char('abc_class', { length: 1 }),
    isActive: boolean('is_active').notNull().default(true),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex('items_code_uq').on(t.tenantId, t.code),
    index('items_type_idx').on(t.tenantId, t.type),
    index('items_group_idx').on(t.groupId),
    index('items_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
);

/** 1 <uom> = factor × base UoM (e.g. 1 BAG = 25 KG). */
export const itemUomConversions = pgTable(
  'item_uom_conversions',
  {
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    factor: numeric('factor', { precision: 18, scale: 6 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.uomId] })],
);

export const itemBarcodes = pgTable(
  'item_barcodes',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    barcode: text('barcode').notNull(),
    /** Pack-level barcode: scanning it means 1 of this UoM. */
    uomId: uuid('uom_id').references(() => uoms.id, { onDelete: 'restrict' }),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [uniqueIndex('item_barcodes_uq').on(t.tenantId, t.barcode), index('item_barcodes_item_idx').on(t.itemId)],
);

// =============================================================================
// Parties: customers & vendors (one record can be both)
// =============================================================================

export const gstRegistrationType = pgEnum('gst_registration_type', ['regular', 'composition', 'unregistered', 'consumer', 'overseas', 'sez']);
export const msmeCategory = pgEnum('msme_category', ['micro', 'small', 'medium']);

export const parties = pgTable(
  'parties',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    isCustomer: boolean('is_customer').notNull().default(false),
    isVendor: boolean('is_vendor').notNull().default(false),
    gstRegistrationType: gstRegistrationType('gst_registration_type').notNull().default('regular'),
    gstin: char('gstin', { length: 15 }),
    pan: char('pan', { length: 10 }),
    /** Place of supply default; from GSTIN or billing address. */
    stateCode: char('state_code', { length: 2 }),
    msmeUdyamNo: text('msme_udyam_no'),
    msmeCategory: msmeCategory('msme_category'),
    email: citext('email'),
    phone: text('phone'),
    website: text('website'),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    creditLimit: numeric('credit_limit', { precision: 18, scale: 2 }),
    creditDays: integer('credit_days'),
    paymentTerms: text('payment_terms'),
    tdsSection: text('tds_section'),
    tcsApplicable: boolean('tcs_applicable').notNull().default(false),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex('parties_code_uq').on(t.tenantId, t.code),
    uniqueIndex('parties_gstin_uq').on(t.tenantId, t.gstin).where(sql`${t.gstin} is not null and ${t.deletedAt} is null`),
    index('parties_roles_idx').on(t.tenantId, t.isCustomer, t.isVendor),
    index('parties_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
);

export const addressType = pgEnum('address_type', ['billing', 'shipping', 'both']);

export const partyAddresses = pgTable(
  'party_addresses',
  {
    id: pk(),
    tenantId: tenantId(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    type: addressType('type').notNull().default('both'),
    label: text('label'),
    line1: text('line1').notNull(),
    line2: text('line2'),
    city: text('city').notNull(),
    district: text('district'),
    stateCode: char('state_code', { length: 2 }).notNull(),
    pincode: char('pincode', { length: 6 }),
    country: char('country', { length: 2 }).notNull().default('IN'),
    /** GSTIN of this place of business when different from the party's main GSTIN. */
    gstin: char('gstin', { length: 15 }),
    isDefault: boolean('is_default').notNull().default(false),
  },
  (t) => [index('party_addresses_party_idx').on(t.partyId)],
);

export const partyContacts = pgTable(
  'party_contacts',
  {
    id: pk(),
    tenantId: tenantId(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    designation: text('designation'),
    email: citext('email'),
    phone: text('phone'),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [index('party_contacts_party_idx').on(t.partyId)],
);

/** Bank details; account number encrypted at rest (AES-256-GCM), last 4 kept for display. */
export const partyBankAccounts = pgTable(
  'party_bank_accounts',
  {
    id: pk(),
    tenantId: tenantId(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    accountName: text('account_name').notNull(),
    accountNumberEncrypted: text('account_number_encrypted').notNull(),
    accountLast4: char('account_last4', { length: 4 }).notNull(),
    ifsc: char('ifsc', { length: 11 }).notNull(),
    bankName: text('bank_name'),
    branchName: text('branch_name'),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [index('party_bank_party_idx').on(t.partyId)],
);

// =============================================================================
// Warehouses
// =============================================================================

export const warehouseType = pgEnum('warehouse_type', [
  'store',
  'production',
  'finished_goods',
  'quarantine',
  'rejected',
  'scrap',
  'transit',
  'job_work',
]);

export const warehouses = pgTable(
  'warehouses',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    type: warehouseType('type').notNull().default('store'),
    address: jsonb('address').$type<Address>().notNull().default({}),
    /** Stock here is not available for issue/sale (quarantine, rejected, transit). */
    isNettable: boolean('is_nettable').notNull().default(true),
    allowNegativeStock: boolean('allow_negative_stock').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('warehouses_code_uq').on(t.tenantId, t.code), index('warehouses_company_idx').on(t.companyId)],
);

// =============================================================================
// Price lists
// =============================================================================

export const priceListType = pgEnum('price_list_type', ['selling', 'buying']);

export const priceLists = pgTable(
  'price_lists',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    type: priceListType('type').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    /** Rates include GST (MRP-style retail lists) or exclude it (B2B). */
    taxInclusive: boolean('tax_inclusive').notNull().default(false),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('price_lists_name_uq').on(t.tenantId, t.name)],
);

export const priceListItems = pgTable(
  'price_list_items',
  {
    id: pk(),
    tenantId: tenantId(),
    priceListId: uuid('price_list_id')
      .notNull()
      .references(() => priceLists.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    /** Quantity break: this rate applies from this quantity upwards. */
    minQty: numeric('min_qty', { precision: 18, scale: 4 }).notNull().default('0'),
    rate: numeric('rate', { precision: 18, scale: 4 }).notNull(),
  },
  (t) => [
    uniqueIndex('price_list_items_uq').on(t.priceListId, t.itemId, t.uomId, t.minQty),
    index('price_list_items_item_idx').on(t.itemId),
  ],
);
