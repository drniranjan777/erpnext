import { boolean, date, index, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { attachments } from './documents';
import { employees, hrLocations } from './hr';
import { users } from './iam';
import { tenantId } from './tenancy';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

// =============================================================================
// Contract labour (CLRA Act)
// =============================================================================

export const contractors = pgTable(
  'hr_contractors',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** Contractor's licence under the CLRA Act and how many workers it allows. */
    licenceNo: text('licence_no'),
    licenceValidUntil: date('licence_valid_until', { mode: 'string' }),
    maxWorkers: smallint('max_workers'),
    work: text('work'),
    locationId: uuid('location_id').references(() => hrLocations.id, { onDelete: 'set null' }),
    pfCode: text('pf_code'),
    esiCode: text('esi_code'),
    contactName: text('contact_name'),
    mobile: text('mobile'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('hr_contractors_code_uq').on(t.tenantId, t.code)],
);

export const contractWorkers = pgTable(
  'hr_contract_workers',
  {
    id: pk(),
    tenantId: tenantId(),
    contractorId: uuid('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    gender: text('gender'),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    fatherName: text('father_name'),
    /** unskilled | semi_skilled | skilled | highly_skilled (minimum-wage categories). */
    skill: text('skill').notNull().default('unskilled'),
    dailyWage: money('daily_wage').notNull(),
    uan: text('uan'),
    esicNumber: text('esic_number'),
    aadhaarLast4: text('aadhaar_last4'),
    mobile: text('mobile'),
    locationId: uuid('location_id').references(() => hrLocations.id, { onDelete: 'set null' }),
    joinedOn: date('joined_on', { mode: 'string' }).notNull(),
    leftOn: date('left_on', { mode: 'string' }),
  },
  (t) => [uniqueIndex('hr_contract_workers_code_uq').on(t.tenantId, t.code), index('hr_contract_workers_contractor_idx').on(t.contractorId)],
);

/** Daily attendance of contract workers kept by the principal employer (gate register). */
export const contractAttendance = pgTable(
  'hr_contract_attendance',
  {
    id: pk(),
    tenantId: tenantId(),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => contractWorkers.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    /** P | A | HD */
    status: text('status').notNull(),
    otHours: numeric('ot_hours', { precision: 5, scale: 2 }).notNull().default('0'),
  },
  (t) => [uniqueIndex('hr_contract_attendance_uq').on(t.workerId, t.date)],
);

/** What the contractor says they paid each worker for a month, checked against attendance and minimum wages. */
export const contractWages = pgTable(
  'hr_contract_wages',
  {
    id: pk(),
    tenantId: tenantId(),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => contractWorkers.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    daysPaid: numeric('days_paid', { precision: 5, scale: 1 }).notNull(),
    grossPaid: money('gross_paid').notNull(),
    pfDeducted: money('pf_deducted').notNull().default('0'),
    esiDeducted: money('esi_deducted').notNull().default('0'),
    paidOn: date('paid_on', { mode: 'string' }),
  },
  (t) => [uniqueIndex('hr_contract_wages_uq').on(t.workerId, t.month)],
);

/** Minimum daily wages by state and skill category (basic + VDA), as notified. */
export const minimumWages = pgTable(
  'hr_minimum_wages',
  {
    id: pk(),
    tenantId: tenantId(),
    stateCode: text('state_code').notNull(),
    skill: text('skill').notNull(),
    dailyRate: money('daily_rate').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  },
  (t) => [uniqueIndex('hr_minimum_wages_uq').on(t.tenantId, t.stateCode, t.skill, t.effectiveFrom)],
);

// =============================================================================
// Expense claims (employee self-service)
// =============================================================================

export const expenseClaims = pgTable(
  'hr_claims',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    /** travel | conveyance | food | medical | phone | other */
    kind: text('kind').notNull(),
    spentOn: date('spent_on', { mode: 'string' }).notNull(),
    amount: money('amount').notNull(),
    description: text('description').notNull(),
    receiptId: uuid('receipt_id').references(() => attachments.id, { onDelete: 'set null' }),
    /** pending | approved | rejected */
    status: text('status').notNull().default('pending'),
    approvedAmount: money('approved_amount'),
    /** The payroll month the approved amount is paid in. */
    payMonth: text('pay_month'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('hr_claims_emp_idx').on(t.employeeId), index('hr_claims_status_idx').on(t.tenantId, t.status)],
);
