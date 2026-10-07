import { index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_columns';
import { users } from './iam';
import { eSignatures } from './quality';
import { tenantId } from './tenancy';

/** A computer system validation project: the scope validated for one release of the system. */
export const valProjects = pgTable(
  'val_projects',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    /** System release validated (application version). */
    systemVersion: text('system_version').notNull(),
    /** Module codes in scope. */
    modules: jsonb('modules').$type<string[]>().notNull(),
    /** GAMP 5 software category of the configured system (4 configured product, 5 custom). */
    gampCategory: smallint('gamp_category').notNull().default(4),
    intendedUse: text('intended_use'),
    /** draft | executing | approved */
    status: text('status').notNull().default('draft'),
    /** Risk ratings per requirement: severity, probability, detectability (1 low – 3 high). */
    risks: jsonb('risks').$type<Record<string, { severity: number; probability: number; detectability: number; note?: string | null }>>().notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('val_projects_idx').on(t.tenantId)],
);

/** One test of an IQ, OQ or PQ protocol, with its execution. */
export const valTests = pgTable(
  'val_tests',
  {
    id: pk(),
    tenantId: tenantId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => valProjects.id, { onDelete: 'cascade' }),
    /** IQ | OQ | PQ */
    protocol: text('protocol').notNull(),
    ref: text('ref').notNull(),
    title: text('title').notNull(),
    requirementIds: jsonb('requirement_ids').$type<string[]>().notNull().default([]),
    steps: jsonb('steps').$type<string[]>().notNull().default([]),
    expected: text('expected').notNull(),
    /** Run by the system itself (IQ checks). */
    automated: text('automated'),
    actual: text('actual'),
    /** pending | pass | fail | na */
    result: text('result').notNull().default('pending'),
    evidence: text('evidence'),
    deviationId: uuid('deviation_id'),
    executedBy: uuid('executed_by').references(() => users.id, { onDelete: 'set null' }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('val_tests_ref_uq').on(t.tenantId, t.projectId, t.ref), index('val_tests_project_idx').on(t.tenantId, t.projectId, t.protocol)],
);

/** Signatures on a validation document (protocol approval, execution review, summary report approval). */
export const valApprovals = pgTable(
  'val_approvals',
  {
    id: pk(),
    tenantId: tenantId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => valProjects.id, { onDelete: 'cascade' }),
    /** URS | RA | IQ | OQ | PQ | VSR */
    document: text('document').notNull(),
    /** author | reviewer | approver */
    role: text('role').notNull(),
    signatureId: uuid('signature_id')
      .notNull()
      .references(() => eSignatures.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('val_approvals_idx').on(t.tenantId, t.projectId, t.document)],
);
