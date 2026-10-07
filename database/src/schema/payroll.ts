import { boolean, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { employees } from './hr';
import { users } from './iam';
import { workCenters } from './manufacturing';
import { companies, tenantId } from './tenancy';

const amount = (name: string) => numeric(name, { precision: 14, scale: 2 }).notNull().default('0');

export interface PayLine {
  code: string;
  name: string;
  amount: string;
  /** The loan a recovery belongs to. */
  ref?: string;
}

/** One row per workspace. */
export const payrollSettings = pgTable(
  'payroll_settings',
  {
    id: pk(),
    tenantId: tenantId(),
    /** The company whose books payroll posts to (the first company when unset). */
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    pfRestrictToCeiling: boolean('pf_restrict_to_ceiling').notNull().default(true),
    pfEstablishmentCode: text('pf_establishment_code'),
    esiEmployerCode: text('esi_employer_code'),
    /** Overtime is paid at this multiple of the ordinary hourly rate (Factories Act s.59: 2). */
    otMultiplier: numeric('ot_multiplier', { precision: 4, scale: 2 }).notNull().default('2'),
    /** Ordinary hourly rate = (basic + DA) ÷ (days × hours). */
    otDivisorDays: smallint('ot_divisor_days').notNull().default(26),
    otHoursPerDay: smallint('ot_hours_per_day').notNull().default(8),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payroll_settings_tenant_uq').on(t.tenantId)],
);

export const salaryComponents = pgTable(
  'salary_components',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** earning | deduction */
    kind: text('kind').notNull(),
    /** Part of PF wages (basic, DA, retaining allowance). */
    isPfWage: boolean('is_pf_wage').notNull().default(false),
    /** Part of ESI wages (most earnings except reimbursements and annual bonus). */
    isEsiWage: boolean('is_esi_wage').notNull().default(true),
    isTaxable: boolean('is_taxable').notNull().default(true),
    /** Paid in proportion to payable days. */
    prorate: boolean('prorate').notNull().default(true),
    /** Built in and computed by payroll (OT, piece rate). */
    isSystem: boolean('is_system').notNull().default(false),
    sequence: smallint('sequence').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('salary_components_code_uq').on(t.tenantId, t.code)],
);

export interface TemplateLine {
  code: string;
  /** percent_ctc: % of monthly CTC; percent_basic: % of BASIC; fixed: rupees a month; balance: what is left of the CTC. */
  calc: 'percent_ctc' | 'percent_basic' | 'fixed' | 'balance';
  value: number;
}

export const salaryTemplates = pgTable(
  'salary_templates',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    lines: jsonb('lines').$type<TemplateLine[]>().notNull().default([]),
    /** The employer's PF is part of the CTC and comes out of it before the balance. */
    employerPfInCtc: boolean('employer_pf_in_ctc').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('salary_templates_code_uq').on(t.tenantId, t.code)],
);

/** An employee's salary from a date: monthly amounts per earning component. */
export const employeeSalaries = pgTable(
  'employee_salaries',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    ctcAnnual: amount('ctc_annual'),
    templateId: uuid('template_id').references(() => salaryTemplates.id, { onDelete: 'set null' }),
    lines: jsonb('lines').$type<{ code: string; monthly: string }[]>().notNull().default([]),
    remarks: text('remarks'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('employee_salaries_uq').on(t.tenantId, t.employeeId, t.effectiveFrom)],
);

export const employeeLoans = pgTable(
  'employee_loans',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    /** loan | advance */
    kind: text('kind').notNull().default('loan'),
    issuedOn: date('issued_on', { mode: 'string' }).notNull(),
    principal: amount('principal'),
    emi: amount('emi'),
    /** First month recovered, YYYY-MM. */
    startMonth: text('start_month').notNull(),
    recovered: amount('recovered'),
    /** active | closed */
    status: text('status').notNull().default('active'),
    remarks: text('remarks'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('employee_loans_emp_idx').on(t.employeeId)],
);

/** One-off amounts for a month: arrears, bonus, reimbursements, other deductions. */
export const payrollInputs = pgTable(
  'payroll_inputs',
  {
    id: pk(),
    tenantId: tenantId(),
    month: text('month').notNull(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    code: citext('code').notNull(),
    amount: amount('amount'),
    remarks: text('remarks'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payroll_inputs_month_idx').on(t.tenantId, t.month)],
);

/** Rate per good unit on job cards at a work centre, for piece-rated workers. */
export const pieceRates = pgTable(
  'payroll_piece_rates',
  {
    id: pk(),
    tenantId: tenantId(),
    workCenterId: uuid('work_center_id')
      .notNull()
      .references(() => workCenters.id, { onDelete: 'cascade' }),
    ratePerUnit: numeric('rate_per_unit', { precision: 12, scale: 4 }).notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  },
  (t) => [uniqueIndex('payroll_piece_rates_uq').on(t.tenantId, t.workCenterId, t.effectiveFrom)],
);

export const taxDeclarations = pgTable(
  'tax_declarations',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    /** "2026-27" */
    fy: text('fy').notNull(),
    data: jsonb('data').$type<Record<string, number>>().notNull().default({}),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tax_declarations_uq').on(t.tenantId, t.employeeId, t.fy)],
);

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: pk(),
    tenantId: tenantId(),
    month: text('month').notNull(),
    /** draft | approved | paid */
    status: text('status').notNull().default('draft'),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    totals: jsonb('totals').$type<Record<string, string | number>>().notNull().default({}),
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
    computedAt: timestamp('computed_at', { withTimezone: true }),
    computedBy: uuid('computed_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    paidOn: date('paid_on', { mode: 'string' }),
    /** The GL voucher of the current approval (a new one each time it is approved). */
    glVoucherId: uuid('gl_voucher_id'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payroll_runs_month_uq').on(t.tenantId, t.month)],
);

export const payslips = pgTable(
  'payslips',
  {
    id: pk(),
    tenantId: tenantId(),
    runId: uuid('run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    monthDays: smallint('month_days').notNull(),
    payableDays: numeric('payable_days', { precision: 5, scale: 1 }).notNull(),
    lopDays: numeric('lop_days', { precision: 5, scale: 1 }).notNull().default('0'),
    otHours: numeric('ot_hours', { precision: 7, scale: 2 }).notNull().default('0'),
    earnings: jsonb('earnings').$type<PayLine[]>().notNull().default([]),
    deductions: jsonb('deductions').$type<PayLine[]>().notNull().default([]),
    employer: jsonb('employer').$type<PayLine[]>().notNull().default([]),
    gross: amount('gross'),
    totalDeductions: amount('total_deductions'),
    net: amount('net'),
    taxableGross: amount('taxable_gross'),
    pfWages: amount('pf_wages'),
    epsWages: amount('eps_wages'),
    esiWages: amount('esi_wages'),
    tds: amount('tds'),
    /** GST state code of the work location, for PT and LWF. */
    stateCode: text('state_code'),
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
  },
  (t) => [uniqueIndex('payslips_run_emp_uq').on(t.runId, t.employeeId), index('payslips_emp_idx').on(t.employeeId, t.month)],
);
