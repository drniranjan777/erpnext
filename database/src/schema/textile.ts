import { date, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { users } from './iam';
import { items, parties } from './masters';
import { salesOrders } from './sales';
import { tenantId } from './tenancy';

// =============================================================================
// Textile and apparel export pack: buyer orders, tech packs, samples, social audits
// =============================================================================

export interface TechPackMaterial {
  component: string;
  description: string;
  itemId?: string | null;
  consumption: number;
  unit: string;
  supplier?: string | null;
}

/** A point of measure with its value per size and the tolerance (±). */
export interface MeasurementPoint {
  code: string;
  description: string;
  tolerance: number;
  /** size → value (cm) */
  sizes: Record<string, number>;
}

/** The buyer's specification of a style: materials, measurements, construction, artwork. */
export const techPacks = pgTable(
  'tech_packs',
  {
    id: pk(),
    tenantId: tenantId(),
    styleNo: citext('style_no').notNull(),
    buyerId: uuid('buyer_id').references(() => parties.id, { onDelete: 'set null' }),
    season: text('season'),
    description: text('description').notNull(),
    version: integer('version').notNull().default(1),
    sizes: text('sizes').array().notNull().default([]),
    colours: text('colours').array().notNull().default([]),
    materials: jsonb('materials').$type<TechPackMaterial[]>().notNull().default([]),
    measurements: jsonb('measurements').$type<MeasurementPoint[]>().notNull().default([]),
    construction: text('construction'),
    /** Certificates the buyer requires for this style (gots, oekotex, …). */
    requiredCertificates: text('required_certificates').array().notNull().default([]),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    /** draft | approved */
    status: text('status').notNull().default('draft'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tech_packs_style_uq').on(t.tenantId, t.styleNo)],
);

/** A buyer's purchase order for a style, with the size × colour breakdown and the ex-factory date. */
export const buyerOrders = pgTable(
  'buyer_orders',
  {
    id: pk(),
    tenantId: tenantId(),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    poNo: text('po_no').notNull(),
    techPackId: uuid('tech_pack_id')
      .notNull()
      .references(() => techPacks.id, { onDelete: 'restrict' }),
    /** colour → size → quantity */
    breakdown: jsonb('breakdown').$type<Record<string, Record<string, number>>>().notNull(),
    price: doublePrecision('price').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    poDate: date('po_date', { mode: 'string' }).notNull(),
    exFactory: date('ex_factory', { mode: 'string' }).notNull(),
    /** FOB | CIF | … */
    incoterm: text('incoterm'),
    salesOrderId: uuid('sales_order_id').references(() => salesOrders.id, { onDelete: 'set null' }),
    /** Milestones done: key → date. */
    milestones: jsonb('milestones').$type<Record<string, string>>().notNull().default({}),
    /** open | shipped | cancelled */
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('buyer_orders_po_uq').on(t.tenantId, t.buyerId, t.poNo), index('buyer_orders_exf_idx').on(t.tenantId, t.exFactory)],
);

/** A sample sent to the buyer: proto, fit, size set, pre-production, top of production, shipment. */
export const styleSamples = pgTable(
  'style_samples',
  {
    id: pk(),
    tenantId: tenantId(),
    techPackId: uuid('tech_pack_id')
      .notNull()
      .references(() => techPacks.id, { onDelete: 'cascade' }),
    /** lab_dip | proto | fit | size_set | pp | top | shipment */
    type: text('type').notNull(),
    round: integer('round').notNull().default(1),
    colour: text('colour'),
    size: text('size'),
    sentOn: date('sent_on', { mode: 'string' }),
    courierRef: text('courier_ref'),
    /** Measured values: point code → value. */
    measured: jsonb('measured').$type<Record<string, number>>().notNull().default({}),
    /** pending | approved | approved_with_comments | rejected */
    status: text('status').notNull().default('pending'),
    buyerComments: text('buyer_comments'),
    decidedOn: date('decided_on', { mode: 'string' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('style_samples_pack_idx').on(t.tenantId, t.techPackId)],
);

/** A social or environmental compliance audit (BSCI, SMETA, WRAP, SA8000, Higg FEM…) of us or a supplier. */
export const socialAudits = pgTable(
  'social_audits',
  {
    id: pk(),
    tenantId: tenantId(),
    /** null = our own factory */
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'cascade' }),
    standard: text('standard').notNull(),
    auditedOn: date('audited_on', { mode: 'string' }).notNull(),
    auditor: text('auditor'),
    /** A–E for BSCI, score for Higg, pass / fail otherwise. */
    rating: text('rating'),
    criticalFindings: integer('critical_findings').notNull().default(0),
    majorFindings: integer('major_findings').notNull().default(0),
    minorFindings: integer('minor_findings').notNull().default(0),
    validUntil: date('valid_until', { mode: 'string' }),
    capDueOn: date('cap_due_on', { mode: 'string' }),
    /** open | closed */
    capStatus: text('cap_status').notNull().default('open'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('social_audits_party_idx').on(t.tenantId, t.partyId)],
);
