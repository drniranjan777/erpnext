import { boolean, char, date, index, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { attachments } from './documents';
import { users } from './iam';
import { type Address, tenantId } from './tenancy';

// =============================================================================
// Organisation masters
// =============================================================================

export const hrDepartments = pgTable(
  'hr_departments',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => hrDepartments.id, { onDelete: 'set null' }),
    costCentre: text('cost_centre'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('hr_departments_code_uq').on(t.tenantId, t.code)],
);

export const hrGrades = pgTable(
  'hr_grades',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** Monthly gross band. */
    minSalary: numeric('min_salary', { precision: 18, scale: 2 }),
    maxSalary: numeric('max_salary', { precision: 18, scale: 2 }),
    level: smallint('level').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('hr_grades_code_uq').on(t.tenantId, t.code)],
);

export const hrDesignations = pgTable(
  'hr_designations',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    gradeId: uuid('grade_id').references(() => hrGrades.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('hr_designations_code_uq').on(t.tenantId, t.code)],
);

/** Where people work. The state decides professional tax and LWF; the geofence is for mobile attendance. */
export const hrLocations = pgTable(
  'hr_locations',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    stateCode: char('state_code', { length: 2 }).notNull(),
    address: jsonb('address').$type<Address>().notNull().default({}),
    isFactory: boolean('is_factory').notNull().default(true),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    radiusMetres: smallint('radius_metres'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('hr_locations_code_uq').on(t.tenantId, t.code)],
);

// =============================================================================
// Employees
// =============================================================================

export const employees = pgTable(
  'employees',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    fullName: text('full_name').notNull(),
    /** male | female | other */
    gender: text('gender'),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    bloodGroup: text('blood_group'),
    maritalStatus: text('marital_status'),
    fatherOrSpouseName: text('father_or_spouse_name'),
    personalEmail: text('personal_email'),
    mobile: text('mobile'),
    currentAddress: jsonb('current_address').$type<Address>().notNull().default({}),
    permanentAddress: jsonb('permanent_address').$type<Address>().notNull().default({}),
    emergencyContact: text('emergency_contact'),
    emergencyPhone: text('emergency_phone'),
    // Job
    dateOfJoining: date('date_of_joining', { mode: 'string' }).notNull(),
    probationEnd: date('probation_end', { mode: 'string' }),
    confirmedOn: date('confirmed_on', { mode: 'string' }),
    /** permanent | probation | contract | trainee | apprentice | consultant */
    employmentType: text('employment_type').notNull().default('probation'),
    /** staff | worker | management */
    category: text('category').notNull().default('staff'),
    departmentId: uuid('department_id').references(() => hrDepartments.id, { onDelete: 'restrict' }),
    designationId: uuid('designation_id').references(() => hrDesignations.id, { onDelete: 'restrict' }),
    gradeId: uuid('grade_id').references(() => hrGrades.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').references(() => hrLocations.id, { onDelete: 'restrict' }),
    reportsToId: uuid('reports_to_id').references((): AnyPgColumn => employees.id, { onDelete: 'set null' }),
    /** The workspace login used for self-service. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    workEmail: text('work_email'),
    noticeDays: smallint('notice_days').notNull().default(30),
    /** active | notice | exited */
    status: text('status').notNull().default('active'),
    exitDate: date('exit_date', { mode: 'string' }),
    exitReason: text('exit_reason'),
    // Statutory: identity numbers are encrypted at rest; only the masked form is shown.
    panEnc: text('pan_enc'),
    panMasked: text('pan_masked'),
    aadhaarEnc: text('aadhaar_enc'),
    aadhaarLast4: char('aadhaar_last4', { length: 4 }),
    uan: text('uan'),
    pfNumber: text('pf_number'),
    esicNumber: text('esic_number'),
    // Bank
    bankName: text('bank_name'),
    bankAccountEnc: text('bank_account_enc'),
    bankAccountLast4: text('bank_account_last4'),
    ifsc: char('ifsc', { length: 11 }),
    // Payroll applicability
    pfApplicable: boolean('pf_applicable').notNull().default(true),
    esiApplicable: boolean('esi_applicable').notNull().default(true),
    ptApplicable: boolean('pt_applicable').notNull().default(true),
    lwfApplicable: boolean('lwf_applicable').notNull().default(true),
    /** new | old (income-tax regime for TDS) */
    taxRegime: text('tax_regime').notNull().default('new'),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: smallint('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('employees_code_uq').on(t.tenantId, t.code),
    uniqueIndex('employees_user_uq').on(t.tenantId, t.userId),
    index('employees_dept_idx').on(t.tenantId, t.departmentId),
    index('employees_manager_idx').on(t.reportsToId),
    index('employees_status_idx').on(t.tenantId, t.status),
  ],
);

export const employeeFamily = pgTable(
  'employee_family',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** spouse | father | mother | son | daughter | brother | sister | other */
    relation: text('relation').notNull(),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    isDependent: boolean('is_dependent').notNull().default(false),
    /** Nominee for PF / gratuity / insurance, with the share. */
    nomineeFor: jsonb('nominee_for').$type<string[]>().notNull().default([]),
    nomineeSharePct: numeric('nominee_share_pct', { precision: 5, scale: 2 }),
  },
  (t) => [index('employee_family_emp_idx').on(t.employeeId)],
);

/** Joining, transfers, promotions, confirmation, increments, exit: the employee's service record. */
export const employeeEvents = pgTable(
  'employee_events',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    /** joined | transfer | promotion | redesignation | confirmation | increment | exit */
    kind: text('kind').notNull(),
    effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
    from: jsonb('from').$type<Record<string, string | null>>().notNull().default({}),
    to: jsonb('to').$type<Record<string, string | null>>().notNull().default({}),
    remarks: text('remarks'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('employee_events_emp_idx').on(t.employeeId, t.effectiveDate)],
);

/** Files about the employee (ID proofs, certificates, signed letters), stored as attachments of entity type "employee". */
export const employeeDocuments = pgTable(
  'employee_documents',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    /** id_proof | address_proof | education | experience | offer | appointment | medical | other */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    expiryDate: date('expiry_date', { mode: 'string' }),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('employee_documents_emp_idx').on(t.employeeId)],
);

// =============================================================================
// Letters
// =============================================================================

export const letterTemplates = pgTable(
  'letter_templates',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    /** offer | appointment | confirmation | promotion | transfer | increment | experience | relieving | warning | other */
    kind: text('kind').notNull(),
    /** Text with {{placeholders}}. */
    body: text('body').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('letter_templates_code_uq').on(t.tenantId, t.code)],
);

export const employeeLetters = pgTable(
  'employee_letters',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id').references(() => letterTemplates.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    issuedOn: date('issued_on', { mode: 'string' }).notNull(),
    issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('employee_letters_emp_idx').on(t.employeeId)],
);
