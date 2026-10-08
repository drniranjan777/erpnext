import { bigint, boolean, char, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { documents } from './documents';
import { users } from './iam';
import { items } from './masters';
import { eSignatures } from './quality';
import { tenantId } from './tenancy';

// =============================================================================
// PLM-lite: lifecycle, engineering BOM, CAD vault
// =============================================================================

/** Lifecycle stage of an item: concept → design → prototype → released → phase-out → obsolete. */
export const plmItemStates = pgTable(
  'plm_item_states',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull().default('concept'),
    history: jsonb('history').$type<{ from: string | null; to: string; at: string; by: string; note: string | null; signatureId?: string | null }[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('plm_item_states_item_uq').on(t.tenantId, t.itemId)],
);

export interface EbomLine {
  findNo: number;
  itemId: string;
  qty: number;
  refDes?: string | null;
  note?: string | null;
}

/** Engineering (design) BOM as released by design; the manufacturing BOM is derived from it. */
export const plmEboms = pgTable(
  'plm_eboms',
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    revision: text('revision').notNull(),
    lines: jsonb('lines').$type<EbomLine[]>().notNull().default([]),
    /** draft | released | superseded */
    status: text('status').notNull().default('draft'),
    releaseSignatureId: uuid('release_signature_id').references(() => eSignatures.id, { onDelete: 'set null' }),
    mbomId: uuid('mbom_id').references(() => documents.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('plm_eboms_rev_uq').on(t.tenantId, t.itemId, t.revision)],
);

/** A CAD model or drawing in the vault, with its metadata and who has it checked out. */
export const cadFiles = pgTable(
  'cad_files',
  {
    id: pk(),
    tenantId: tenantId(),
    number: citext('number').notNull(),
    title: text('title').notNull(),
    /** sldprt | sldasm | slddrw | dwg | dxf | step | iges | stl | pdf | other */
    format: text('format').notNull(),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    /** Material, mass, configuration, author… */
    metadata: jsonb('metadata').$type<Record<string, string>>().notNull().default({}),
    /** Files this one uses (assembly → parts, drawing → model). */
    references: uuid('references').array().notNull().default([]),
    revision: text('revision').notNull().default('A'),
    /** in_work | released | obsolete */
    status: text('status').notNull().default('in_work'),
    checkedOutBy: uuid('checked_out_by').references(() => users.id, { onDelete: 'set null' }),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
    releaseSignatureId: uuid('release_signature_id').references(() => eSignatures.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cad_files_number_uq').on(t.tenantId, t.number)],
);

export const cadFileVersions = pgTable(
  'cad_file_versions',
  {
    id: pk(),
    tenantId: tenantId(),
    cadFileId: uuid('cad_file_id')
      .notNull()
      .references(() => cadFiles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    revision: text('revision').notNull(),
    fileName: text('file_name').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    storageKey: text('storage_key').notNull(),
    note: text('note'),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cad_file_versions_uq').on(t.cadFileId, t.version)],
);

// =============================================================================
// Document management
// =============================================================================

export const dmsFolders = pgTable(
  'dms_folders',
  {
    id: pk(),
    tenantId: tenantId(),
    parentId: uuid('parent_id').references((): AnyPgColumn => dmsFolders.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** Keep files this many years after they are added; null = keep for ever. */
    retentionYears: integer('retention_years'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('dms_folders_name_uq').on(t.tenantId, t.parentId, t.name)],
);

export const dmsFiles = pgTable(
  'dms_files',
  {
    id: pk(),
    tenantId: tenantId(),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => dmsFolders.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    docNo: text('doc_no'),
    tags: text('tags').array().notNull().default([]),
    currentVersion: integer('current_version').notNull().default(0),
    /** Text of the current version, for full-text search. */
    content: text('content'),
    retentionUntil: date('retention_until', { mode: 'string' }),
    legalHold: boolean('legal_hold').notNull().default(false),
    /** active | disposed */
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    disposedAt: timestamp('disposed_at', { withTimezone: true }),
  },
  (t) => [index('dms_files_folder_idx').on(t.tenantId, t.folderId), index('dms_files_retention_idx').on(t.tenantId, t.retentionUntil)],
);

export const dmsVersions = pgTable(
  'dms_versions',
  {
    id: pk(),
    tenantId: tenantId(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => dmsFiles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    /** Emptied when the file is disposed of. */
    storageKey: text('storage_key'),
    note: text('note'),
    textExtracted: boolean('text_extracted').notNull().default(false),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('dms_versions_uq').on(t.fileId, t.version)],
);

/** A digital signature on a file version, from a signing provider. */
export const dmsSignatures = pgTable(
  'dms_signatures',
  {
    id: pk(),
    tenantId: tenantId(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => dmsVersions.id, { onDelete: 'cascade' }),
    /** sandbox | aadhaar_esign | dsc */
    provider: text('provider').notNull(),
    signerId: uuid('signer_id').references(() => users.id, { onDelete: 'set null' }),
    signerName: text('signer_name').notNull(),
    reason: text('reason'),
    sha256: char('sha256', { length: 64 }).notNull(),
    certificate: jsonb('certificate').$type<Record<string, string>>().notNull(),
    signature: text('signature').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dms_signatures_version_idx').on(t.versionId)],
);
