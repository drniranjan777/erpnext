import { sql } from 'drizzle-orm';
import {
  bigint,
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
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, createdAt, pk, timestamps } from './_columns';
import { roles, users } from './iam';
import { branches, companies, tenantId } from './tenancy';

// =============================================================================
// Number series
// =============================================================================

export const seriesReset = pgEnum('series_reset', ['yearly', 'monthly', 'never']);

/**
 * Document numbering pattern, e.g. "PO/{BRANCH}/{FY}/{SEQ}" → PO/HO/26-27/0001.
 * Tokens: {FY} 26-27 · {FY4} 2026-27 · {YYYY} · {YY} · {MM} · {BRANCH} · {SEQ}
 */
export const numberSeries = pgTable(
  'number_series',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    /** null = applies to every branch of the company. */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    docType: text('doc_type').notNull(),
    name: text('name').notNull(),
    pattern: text('pattern').notNull(),
    padding: smallint('padding').notNull().default(4),
    reset: seriesReset('reset').notNull().default('yearly'),
    startAt: integer('start_at').notNull().default(1),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [
    index('number_series_lookup_idx').on(t.tenantId, t.companyId, t.docType),
    uniqueIndex('number_series_name_uq').on(t.tenantId, t.companyId, t.docType, t.name),
  ],
);

/** Next value per series and period (FY / month / "all"). Incremented atomically in the caller's transaction (gapless). */
export const numberSeriesCounters = pgTable(
  'number_series_counters',
  {
    tenantId: tenantId(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => numberSeries.id, { onDelete: 'cascade' }),
    periodKey: text('period_key').notNull(),
    nextValue: bigint('next_value', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.periodKey] })],
);

// =============================================================================
// Documents (shared header for every transaction type)
// =============================================================================

export const documentStatus = pgEnum('document_status', [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'cancelled',
  'completed',
]);

/**
 * One row per business document of any type. Type-specific tables
 * (e.g. purchase_requisitions) share this id 1:1. Approvals, attachments,
 * activity, revisions and links all hang off this table.
 */
export const documents = pgTable(
  'documents',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    docType: text('doc_type').notNull(),
    seriesId: uuid('series_id').references(() => numberSeries.id, { onDelete: 'restrict' }),
    /** Assigned on first submit (gapless). Drafts have no number. */
    number: text('number'),
    fiscalYear: text('fiscal_year'),
    docDate: date('doc_date', { mode: 'string' }).notNull(),
    status: documentStatus('status').notNull().default('draft'),
    revision: integer('revision').notNull().default(0),
    title: text('title'),
    amount: numeric('amount', { precision: 18, scale: 2 }),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    /** Current approval step while pending_approval. */
    currentStep: smallint('current_step'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    /** Values of tenant-defined custom fields (custom_field_definitions). */
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns(),
  },
  (t) => [
    index('documents_type_status_idx').on(t.tenantId, t.docType, t.status),
    index('documents_date_idx').on(t.tenantId, t.docDate),
    uniqueIndex('documents_number_uq')
      .on(t.tenantId, t.companyId, t.docType, t.number)
      .where(sql`${t.number} is not null`),
    index('documents_number_trgm_idx').using('gin', sql`${t.number} gin_trgm_ops`),
  ],
);

/** Timeline: status changes, approvals, comments, attachments, revisions. */
export const documentActivity = pgTable(
  'document_activity',
  {
    id: pk(),
    tenantId: tenantId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    message: text('message'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('document_activity_doc_idx').on(t.documentId, t.createdAt)],
);

/** Full snapshot of a document before it was amended. */
export const documentRevisions = pgTable(
  'document_revisions',
  {
    tenantId: tenantId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.revision] })],
);

/** Directed link between documents, e.g. PR → PO, PO → GRN. */
export const documentLinks = pgTable(
  'document_links',
  {
    tenantId: tenantId(),
    fromDocumentId: uuid('from_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    toDocumentId: uuid('to_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    linkType: text('link_type').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.fromDocumentId, t.toDocumentId, t.linkType] }),
    index('document_links_to_idx').on(t.toDocumentId),
  ],
);

// =============================================================================
// Approval workflow
// =============================================================================

/** Which documents need approval, by type, scope and amount slab. */
export const approvalRules = pgTable(
  'approval_rules',
  {
    id: pk(),
    tenantId: tenantId(),
    docType: text('doc_type').notNull(),
    name: text('name').notNull(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    minAmount: numeric('min_amount', { precision: 18, scale: 2 }),
    maxAmount: numeric('max_amount', { precision: 18, scale: 2 }),
    /**
     * Extra condition on facts the module supplies at submission:
     * discount_above (max line discount % > value), margin_below (margin % < value),
     * credit_exceeded (customer credit limit or overdue breached).
     */
    condition: text('condition'),
    conditionValue: numeric('condition_value', { precision: 10, scale: 2 }),
    /** Lower runs first; the first matching rule wins. */
    priority: integer('priority').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [index('approval_rules_lookup_idx').on(t.tenantId, t.docType, t.isActive)],
);

/** Ordered approval levels. Each level is approved by any holder of the role (or the named user). */
export const approvalRuleSteps = pgTable(
  'approval_rule_steps',
  {
    tenantId: tenantId(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => approvalRules.id, { onDelete: 'cascade' }),
    stepNo: smallint('step_no').notNull(),
    name: text('name').notNull(),
    approverRoleId: uuid('approver_role_id').references(() => roles.id, { onDelete: 'restrict' }),
    approverUserId: uuid('approver_user_id').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.stepNo] })],
);

export const approvalStatus = pgEnum('approval_status', ['waiting', 'pending', 'approved', 'rejected', 'skipped']);

/** Approval steps snapshotted onto a document at submit time (rule edits don't affect in-flight documents). */
export const documentApprovals = pgTable(
  'document_approvals',
  {
    id: pk(),
    tenantId: tenantId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** Submission round: increments on each resubmission after rejection/amendment. */
    round: integer('round').notNull(),
    stepNo: smallint('step_no').notNull(),
    name: text('name').notNull(),
    approverRoleId: uuid('approver_role_id').references(() => roles.id, { onDelete: 'set null' }),
    approverUserId: uuid('approver_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: approvalStatus('status').notNull(),
    actedBy: uuid('acted_by').references(() => users.id, { onDelete: 'set null' }),
    actedAt: timestamp('acted_at', { withTimezone: true }),
    comment: text('comment'),
    ...timestamps(),
  },
  (t) => [
    index('document_approvals_doc_idx').on(t.documentId, t.round, t.stepNo),
    index('document_approvals_pending_idx').on(t.tenantId, t.status),
  ],
);

// =============================================================================
// Attachments (documents and, later, masters)
// =============================================================================

export const attachments = pgTable(
  'attachments',
  {
    id: pk(),
    tenantId: tenantId(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    storageKey: text('storage_key').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('attachments_entity_idx').on(t.tenantId, t.entityType, t.entityId)],
);
