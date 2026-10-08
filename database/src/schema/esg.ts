import { boolean, date, doublePrecision, index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { users } from './iam';
import { items, parties } from './masters';
import { tenantId } from './tenancy';

// =============================================================================
// Electronics materials compliance, EPR certificates, carbon footprint and BRSR-lite
// =============================================================================

export interface SvhcEntry {
  substance: string;
  cas: string;
  /** % w/w of the article */
  pct: number;
}

export interface Smelter {
  /** tin | tantalum | tungsten | gold */
  metal: string;
  name: string;
  /** RMI smelter id, e.g. CID001234 */
  smelterId: string | null;
  country: string | null;
  /** RMAP conformant */
  conformant: boolean;
}

/**
 * What a supplier declared for a part: RoHS (EU 2011/65 + 2015/863, India E-Waste Rules
 * reduction of hazardous substances), REACH SVHCs above 0.1 % w/w, conflict minerals (CMRT
 * smelters), and whether the part needs BIS registration under the Compulsory Registration Scheme.
 */
export const partDeclarations = pgTable(
  'part_declarations',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => parties.id, { onDelete: 'set null' }),
    /** compliant | exempt | non_compliant | unknown */
    rohs: text('rohs').notNull().default('unknown'),
    rohsExemptions: text('rohs_exemptions').array().notNull().default([]),
    svhc: jsonb('svhc').$type<SvhcEntry[]>().notNull().default([]),
    reachCandidateListVersion: text('reach_candidate_list_version'),
    /** CMRT: 3TG used at all */
    uses3tg: boolean('uses_3tg').notNull().default(false),
    smelters: jsonb('smelters').$type<Smelter[]>().notNull().default([]),
    cmrtVersion: text('cmrt_version'),
    bisRequired: boolean('bis_required').notNull().default(false),
    declaredOn: date('declared_on', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    documentUrl: text('document_url'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('part_declarations_item_uq').on(t.tenantId, t.itemId)],
);

/** An EPR certificate bought or generated against an obligation (CPCB EPR portal). */
export const eprCertificates = pgTable(
  'epr_certificates',
  {
    id: pk(),
    tenantId: tenantId(),
    /** plastic_packaging | e_waste | battery | tyre | used_oil */
    category: text('category').notNull(),
    fiscalYear: text('fiscal_year').notNull(),
    /** Plastic packaging category I–IV, e-waste EEE code, battery type… */
    subCategory: text('sub_category'),
    /** recycling | end_of_life | reuse | refurbishment */
    kind: text('kind').notNull().default('recycling'),
    number: text('number').notNull(),
    /** PWP, recycler or refurbisher that issued it. */
    issuerId: uuid('issuer_id').references(() => parties.id, { onDelete: 'set null' }),
    issuerName: text('issuer_name'),
    qtyKg: doublePrecision('qty_kg').notNull(),
    issuedOn: date('issued_on', { mode: 'string' }).notNull(),
    amount: doublePrecision('amount'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('epr_certificates_number_uq').on(t.tenantId, t.category, t.number), index('epr_certificates_year_idx').on(t.tenantId, t.fiscalYear)],
);

/** Emission factors used by this workspace (defaults are copied in and can be edited). */
export const emissionFactors = pgTable(
  'emission_factors',
  {
    id: pk(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    scope: smallint('scope').notNull(),
    /** GHG Protocol category, e.g. stationary_combustion, purchased_electricity, cat1_purchased_goods */
    category: text('category').notNull(),
    unit: text('unit').notNull(),
    kgCo2ePerUnit: doublePrecision('kg_co2e_per_unit').notNull(),
    source: text('source'),
  },
  (t) => [uniqueIndex('emission_factors_key_uq').on(t.tenantId, t.key)],
);

/** An activity in a month: fuel burnt, electricity bought, refrigerant topped up, spend, freight… */
export const emissionEntries = pgTable(
  'emission_entries',
  {
    id: pk(),
    tenantId: tenantId(),
    /** First day of the month. */
    period: date('period', { mode: 'string' }).notNull(),
    factorId: uuid('factor_id')
      .notNull()
      .references(() => emissionFactors.id, { onDelete: 'restrict' }),
    quantity: doublePrecision('quantity').notNull(),
    site: text('site'),
    note: text('note'),
    /** manual | energy_meters | tms_trips | purchase_spend */
    source: text('source').notNull().default('manual'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('emission_entries_period_idx').on(t.tenantId, t.period)],
);

/** Other BRSR figures entered by hand for a fiscal year: water, waste, person-hours, CSR spend… */
export const esgMetrics = pgTable(
  'esg_metrics',
  {
    id: pk(),
    tenantId: tenantId(),
    fiscalYear: text('fiscal_year').notNull(),
    key: text('key').notNull(),
    value: doublePrecision('value').notNull(),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('esg_metrics_uq').on(t.tenantId, t.fiscalYear, t.key)],
);
