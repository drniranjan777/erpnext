import { date, doublePrecision, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { documents } from './documents';
import { employees } from './hr';
import { users } from './iam';
import { items, parties } from './masters';
import { companies, tenantId } from './tenancy';

// =============================================================================
// Project systems: projects, WBS, milestones, resources, time, cost links
// =============================================================================

/** An engineer-to-order or EPC project with its contract value. */
export const projects = pgTable(
  'projects',
  {
    id: pk(),
    tenantId: tenantId(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'restrict' }),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    customerId: uuid('customer_id').references(() => parties.id, { onDelete: 'restrict' }),
    contractValue: doublePrecision('contract_value').notNull().default(0),
    /** The service item milestone invoices are raised on. */
    billingItemId: uuid('billing_item_id').references(() => items.id, { onDelete: 'set null' }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    /** planning | active | closed */
    status: text('status').notNull().default('planning'),
    managerId: uuid('manager_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('projects_code_uq').on(t.tenantId, t.code)],
);

/** A work breakdown structure element with its budget by cost type and its progress. */
export const projectWbs = pgTable(
  'project_wbs',
  {
    id: pk(),
    tenantId: tenantId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => projectWbs.id, { onDelete: 'cascade' }),
    /** 1, 1.2, 1.2.3 */
    code: text('code').notNull(),
    name: text('name').notNull(),
    plannedStart: date('planned_start', { mode: 'string' }).notNull(),
    plannedEnd: date('planned_end', { mode: 'string' }).notNull(),
    budgetMaterial: doublePrecision('budget_material').notNull().default(0),
    budgetLabour: doublePrecision('budget_labour').notNull().default(0),
    budgetSubcontract: doublePrecision('budget_subcontract').notNull().default(0),
    budgetOther: doublePrecision('budget_other').notNull().default(0),
    progressPct: doublePrecision('progress_pct').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('project_wbs_code_uq').on(t.projectId, t.code)],
);

/** A billing milestone: a share of the contract value, billed once achieved. */
export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: pk(),
    tenantId: tenantId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    wbsId: uuid('wbs_id').references(() => projectWbs.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    pct: doublePrecision('pct').notNull(),
    /** pending | achieved | billed */
    status: text('status').notNull().default('pending'),
    achievedOn: date('achieved_on', { mode: 'string' }),
    invoiceId: uuid('invoice_id').references(() => documents.id, { onDelete: 'set null' }),
  },
  (t) => [index('project_milestones_idx').on(t.projectId)],
);

/** A purchase order, purchase invoice, stock issue or journal charged to a WBS element. */
export const projectCostLinks = pgTable(
  'project_cost_links',
  {
    id: pk(),
    tenantId: tenantId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    wbsId: uuid('wbs_id')
      .notNull()
      .references(() => projectWbs.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** material | labour | subcontract | other */
    costType: text('cost_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('project_cost_links_doc_uq').on(t.tenantId, t.documentId)],
);

/** A person planned on a WBS element for a date range. */
export const projectResources = pgTable(
  'project_resources',
  {
    id: pk(),
    tenantId: tenantId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    wbsId: uuid('wbs_id').references(() => projectWbs.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    hoursPerWeek: doublePrecision('hours_per_week').notNull(),
    costRate: doublePrecision('cost_rate').notNull().default(0),
  },
  (t) => [index('project_resources_emp_idx').on(t.tenantId, t.employeeId)],
);

/** Hours booked to a WBS element. */
export const projectTime = pgTable(
  'project_time',
  {
    id: pk(),
    tenantId: tenantId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    wbsId: uuid('wbs_id')
      .notNull()
      .references(() => projectWbs.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    workDate: date('work_date', { mode: 'string' }).notNull(),
    hours: doublePrecision('hours').notNull(),
    note: text('note'),
    /** submitted | approved | rejected */
    status: text('status').notNull().default('submitted'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('project_time_idx').on(t.tenantId, t.projectId, t.workDate), index('project_time_emp_idx').on(t.tenantId, t.employeeId, t.workDate)],
);
