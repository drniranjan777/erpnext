import { doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { users } from './iam';
import { items, parties, warehouses } from './masters';
import { licences } from './qms';
import { eSignatures } from './quality';
import { tenantId } from './tenancy';

// =============================================================================
// Chemical HSE pack: safety data sheets, GHS labels, hazardous inventory limits, permits to work
// =============================================================================

/** GHS classification printed on the label and in SDS section 2. */
export interface GhsClassification {
  /** GHS01..GHS09 */
  pictograms: string[];
  signalWord: 'Danger' | 'Warning' | null;
  /** H-codes, e.g. H225, H319. */
  hazardStatements: string[];
  /** P-codes, e.g. P210, P280. */
  precautionaryStatements: string[];
}

/**
 * A safety data sheet in the 16 sections of GHS Rev. 10 / ISO 11014 (MSIHC Rules, 1989 schedule
 * 9 in India). Every issue is a new version; customers who received the item get the current one.
 */
export const sdsDocuments = pgTable(
  'sds_documents',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    language: text('language').notNull().default('en'),
    /** Section number (1–16) → text. */
    sections: jsonb('sections').$type<Record<string, string>>().notNull().default({}),
    ghs: jsonb('ghs').$type<GhsClassification>().notNull(),
    /** Transport (section 14). */
    unNumber: text('un_number'),
    hazardClass: text('hazard_class'),
    packingGroup: text('packing_group'),
    /** Petroleum class under the Petroleum Rules (A, B, C) when it applies. */
    petroleumClass: text('petroleum_class'),
    flashPointC: doublePrecision('flash_point_c'),
    /** draft | issued | superseded */
    status: text('status').notNull().default('draft'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sds_item_version_uq').on(t.tenantId, t.itemId, t.language, t.version)],
);

/** An SDS version sent to a customer. */
export const sdsDistributions = pgTable(
  'sds_distributions',
  {
    id: pk(),
    tenantId: tenantId(),
    sdsId: uuid('sds_id')
      .notNull()
      .references(() => sdsDocuments.id, { onDelete: 'cascade' }),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    /** email | portal | with_goods */
    via: text('via').notNull().default('email'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    sentBy: uuid('sent_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('sds_distributions_party_idx').on(t.tenantId, t.partyId)],
);

/**
 * The most of a hazard class that may be stored in a warehouse: from a PESO licence, the factory
 * licence or MSIHC threshold quantities.
 */
export const hazmatLimits = pgTable(
  'hazmat_limits',
  {
    id: pk(),
    tenantId: tenantId(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    /** UN class (3, 5.1, 8…) or petroleum class (petroleum_a, petroleum_b, petroleum_c). */
    hazardClass: text('hazard_class').notNull(),
    maxKg: doublePrecision('max_kg').notNull(),
    licenceId: uuid('licence_id').references(() => licences.id, { onDelete: 'set null' }),
    note: text('note'),
  },
  (t) => [uniqueIndex('hazmat_limits_uq').on(t.tenantId, t.warehouseId, t.hazardClass)],
);

export interface PermitCheck {
  key: string;
  label: string;
  done: boolean;
}

export interface GasTest {
  at: string;
  o2Pct: number;
  lelPct: number;
  h2sPpm: number;
  coPpm: number;
  by: string;
}

/** A permit to work for non-routine hazardous work (OISD-STD-105, IS 17893). */
export const workPermits = pgTable(
  'work_permits',
  {
    id: pk(),
    tenantId: tenantId(),
    number: citext('number').notNull(),
    /** hot_work | cold_work | confined_space | height | electrical | excavation | line_break */
    type: text('type').notNull(),
    location: text('location').notNull(),
    equipment: text('equipment'),
    description: text('description').notNull(),
    contractor: text('contractor'),
    workers: integer('workers').notNull().default(1),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }).notNull(),
    checklist: jsonb('checklist').$type<PermitCheck[]>().notNull().default([]),
    /** Energy isolations with lock / tag numbers. */
    isolations: jsonb('isolations').$type<{ point: string; lockNo: string }[]>().notNull().default([]),
    gasTests: jsonb('gas_tests').$type<GasTest[]>().notNull().default([]),
    /** requested | approved | active | closed | cancelled */
    status: text('status').notNull().default('requested'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    approvalSignatureId: uuid('approval_signature_id').references(() => eSignatures.id, { onDelete: 'set null' }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closeNote: text('close_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('work_permits_number_uq').on(t.tenantId, t.number), index('work_permits_valid_idx').on(t.tenantId, t.validFrom)],
);
