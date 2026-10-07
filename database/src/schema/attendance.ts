import { boolean, date, index, integer, numeric, pgTable, smallint, text, time, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { attachments } from './documents';
import { employees, hrLocations } from './hr';
import { users } from './iam';
import { tenantId } from './tenancy';

// =============================================================================
// Shifts, rosters and holidays
// =============================================================================

export const hrShifts = pgTable(
  'hr_shifts',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** IST wall-clock times; an end at or before the start means the shift runs past midnight. */
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    breakMinutes: smallint('break_minutes').notNull().default(30),
    graceMinutes: smallint('grace_minutes').notNull().default(10),
    halfDayMinutes: smallint('half_day_minutes').notNull().default(240),
    fullDayMinutes: smallint('full_day_minutes').notNull().default(450),
    /** Worked minutes after which overtime starts; null = 9 hours (Factories Act s.51/s.59). */
    otAfterMinutes: smallint('ot_after_minutes'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('hr_shifts_code_uq').on(t.tenantId, t.code)],
);

/** Which shift an employee works from a date: one shift, or a rotation changing every N days. */
export const hrShiftAssignments = pgTable(
  'hr_shift_assignments',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    shiftIds: uuid('shift_ids').array().notNull(),
    rotateEveryDays: smallint('rotate_every_days').notNull().default(7),
    /** Days of the week off, 0 = Sunday. */
    weeklyOffs: smallint('weekly_offs').array().notNull().default([0]),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('hr_shift_assignments_emp_idx').on(t.employeeId, t.fromDate)],
);

export const hrHolidays = pgTable(
  'hr_holidays',
  {
    id: pk(),
    tenantId: tenantId(),
    /** Null = every location. */
    locationId: uuid('location_id').references(() => hrLocations.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
    /** A restricted holiday: the employee takes it as leave if they choose to. */
    isOptional: boolean('is_optional').notNull().default(false),
  },
  (t) => [index('hr_holidays_date_idx').on(t.tenantId, t.date)],
);

// =============================================================================
// Punches and daily attendance
// =============================================================================

export const attendancePunches = pgTable(
  'attendance_punches',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    punchedAt: timestamp('punched_at', { withTimezone: true }).notNull(),
    /** device | import | mobile | regularisation */
    source: text('source').notNull(),
    deviceId: text('device_id'),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    distanceMetres: integer('distance_metres'),
    /** Null when the location has no geofence or the punch did not come from a phone. */
    insideFence: boolean('inside_fence'),
    selfieId: uuid('selfie_id').references(() => attachments.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // A device that sends the same punch twice must not double it.
  (t) => [uniqueIndex('attendance_punches_uq').on(t.tenantId, t.employeeId, t.punchedAt)],
);

export const attendanceDays = pgTable(
  'attendance_days',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    shiftId: uuid('shift_id').references(() => hrShifts.id, { onDelete: 'set null' }),
    /** present | half_day | absent | missed_punch | weekly_off | holiday | leave */
    status: text('status').notNull(),
    firstIn: timestamp('first_in', { withTimezone: true }),
    lastOut: timestamp('last_out', { withTimezone: true }),
    workedMinutes: integer('worked_minutes').notNull().default(0),
    lateMinutes: integer('late_minutes').notNull().default(0),
    earlyMinutes: integer('early_minutes').notNull().default(0),
    otMinutes: integer('ot_minutes').notNull().default(0),
    leaveTypeId: uuid('leave_type_id'),
    leaveDays: numeric('leave_days', { precision: 3, scale: 1 }).notNull().default('0'),
    payableDays: numeric('payable_days', { precision: 3, scale: 1 }).notNull().default('0'),
    /** Set by payroll (9.3) so a paid month is not reprocessed. */
    isLocked: boolean('is_locked').notNull().default(false),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('attendance_days_uq').on(t.tenantId, t.employeeId, t.date), index('attendance_days_date_idx').on(t.tenantId, t.date)],
);

export const attendanceRegularisations = pgTable(
  'attendance_regularisations',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    inAt: timestamp('in_at', { withTimezone: true }),
    outAt: timestamp('out_at', { withTimezone: true }),
    reason: text('reason').notNull(),
    /** pending | approved | rejected */
    status: text('status').notNull().default('pending'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('attendance_regularisations_status_idx').on(t.tenantId, t.status)],
);

// =============================================================================
// Leave
// =============================================================================

export const leaveTypes = pgTable(
  'leave_types',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    isPaid: boolean('is_paid').notNull().default(true),
    /** none | monthly | yearly | per_days_worked */
    accrual: text('accrual').notNull().default('monthly'),
    annualQuota: numeric('annual_quota', { precision: 5, scale: 2 }).notNull().default('0'),
    /** For per_days_worked: one day of leave per this many days worked (Factories Act s.79: 20). */
    daysWorkedPerLeave: smallint('days_worked_per_leave'),
    carryForwardMax: numeric('carry_forward_max', { precision: 5, scale: 2 }).notNull().default('0'),
    encashable: boolean('encashable').notNull().default(false),
    encashMax: numeric('encash_max', { precision: 5, scale: 2 }),
    allowHalfDay: boolean('allow_half_day').notNull().default(true),
    allowNegative: boolean('allow_negative').notNull().default(false),
    /** Count weekly offs and holidays inside the leave (sandwich rule). */
    countHolidays: boolean('count_holidays').notNull().default(false),
    /** Credited for work on a weekly off or holiday. */
    isCompOff: boolean('is_comp_off').notNull().default(false),
    gender: text('gender'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('leave_types_code_uq').on(t.tenantId, t.code)],
);

/** Every credit and debit of leave; the balance is the sum. */
export const leaveLedger = pgTable(
  'leave_ledger',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'cascade' }),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    days: numeric('days', { precision: 6, scale: 2 }).notNull(),
    /** opening | accrual | comp_off | availed | reversal | encashment | lapse | adjustment */
    kind: text('kind').notNull(),
    /** Makes accrual runs and postings idempotent. */
    refKey: text('ref_key'),
    remarks: text('remarks'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('leave_ledger_ref_uq').on(t.tenantId, t.refKey), index('leave_ledger_emp_idx').on(t.employeeId, t.leaveTypeId)],
);

export const leaveApplications = pgTable(
  'leave_applications',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    /** Leave starts after lunch on the first day. */
    fromHalf: boolean('from_half').notNull().default(false),
    /** Leave ends at lunch on the last day. */
    toHalf: boolean('to_half').notNull().default(false),
    days: numeric('days', { precision: 5, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    /** pending | approved | rejected | cancelled */
    status: text('status').notNull().default('pending'),
    appliedBy: uuid('applied_by').references(() => users.id, { onDelete: 'set null' }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('leave_applications_emp_idx').on(t.employeeId, t.fromDate), index('leave_applications_status_idx').on(t.tenantId, t.status)],
);
