import { boolean, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, pk } from './_columns';
import { attachments } from './documents';
import { employees, hrDepartments, hrDesignations, hrGrades, hrLocations } from './hr';
import { users } from './iam';
import { tenantId } from './tenancy';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

// =============================================================================
// Recruitment
// =============================================================================

export const hrRequisitions = pgTable(
  'hr_requisitions',
  {
    id: pk(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    title: text('title').notNull(),
    departmentId: uuid('department_id').references(() => hrDepartments.id, { onDelete: 'set null' }),
    designationId: uuid('designation_id').references(() => hrDesignations.id, { onDelete: 'set null' }),
    locationId: uuid('location_id').references(() => hrLocations.id, { onDelete: 'set null' }),
    openings: smallint('openings').notNull().default(1),
    /** new | replacement */
    reason: text('reason').notNull().default('new'),
    replacementForId: uuid('replacement_for_id').references(() => employees.id, { onDelete: 'set null' }),
    maxCtc: money('max_ctc'),
    neededBy: date('needed_by', { mode: 'string' }),
    description: text('description'),
    /** pending | approved | rejected | closed */
    status: text('status').notNull().default('pending'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('hr_requisitions_number_uq').on(t.tenantId, t.number)],
);

export const hrCandidates = pgTable(
  'hr_candidates',
  {
    id: pk(),
    tenantId: tenantId(),
    requisitionId: uuid('requisition_id')
      .notNull()
      .references(() => hrRequisitions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: citext('email'),
    mobile: text('mobile'),
    source: text('source'),
    currentCtc: money('current_ctc'),
    expectedCtc: money('expected_ctc'),
    noticeDays: smallint('notice_days'),
    /** applied | screening | interview | offered | hired | rejected | withdrawn */
    stage: text('stage').notNull().default('applied'),
    resumeId: uuid('resume_id').references(() => attachments.id, { onDelete: 'set null' }),
    notes: text('notes'),
    employeeId: uuid('employee_id').references(() => employees.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('hr_candidates_req_idx').on(t.requisitionId)],
);

export const hrInterviews = pgTable(
  'hr_interviews',
  {
    id: pk(),
    tenantId: tenantId(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => hrCandidates.id, { onDelete: 'cascade' }),
    round: smallint('round').notNull().default(1),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    interviewerId: uuid('interviewer_id').references(() => employees.id, { onDelete: 'set null' }),
    mode: text('mode').notNull().default('in_person'),
    /** pending | selected | rejected | hold */
    result: text('result').notNull().default('pending'),
    score: smallint('score'),
    feedback: text('feedback'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('hr_interviews_candidate_idx').on(t.candidateId)],
);

export const hrOffers = pgTable(
  'hr_offers',
  {
    id: pk(),
    tenantId: tenantId(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => hrCandidates.id, { onDelete: 'cascade' }),
    designationId: uuid('designation_id').references(() => hrDesignations.id, { onDelete: 'set null' }),
    gradeId: uuid('grade_id').references(() => hrGrades.id, { onDelete: 'set null' }),
    ctcAnnual: money('ctc_annual').notNull(),
    salaryTemplateId: uuid('salary_template_id'),
    joiningDate: date('joining_date', { mode: 'string' }).notNull(),
    /** pending | approved | rejected | accepted | declined | withdrawn */
    status: text('status').notNull().default('pending'),
    letterBody: text('letter_body'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('hr_offers_candidate_idx').on(t.candidateId)],
);

// =============================================================================
// Onboarding and exit checklists
// =============================================================================

export interface ChecklistItem {
  title: string;
  /** Who does it: HR, IT, Admin, Finance, the manager... */
  owner: string;
  /** Due this many days after joining / before the last working day. */
  days: number;
}

export const hrChecklists = pgTable(
  'hr_checklists',
  {
    id: pk(),
    tenantId: tenantId(),
    /** onboarding | exit */
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    items: jsonb('items').$type<ChecklistItem[]>().notNull().default([]),
    isDefault: boolean('is_default').notNull().default(false),
  },
  (t) => [index('hr_checklists_kind_idx').on(t.tenantId, t.kind)],
);

export const hrTasks = pgTable(
  'hr_tasks',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    /** onboarding | exit */
    kind: text('kind').notNull(),
    separationId: uuid('separation_id'),
    title: text('title').notNull(),
    owner: text('owner').notNull(),
    dueDate: date('due_date', { mode: 'string' }),
    /** pending | done | not_needed */
    status: text('status').notNull().default('pending'),
    remarks: text('remarks'),
    /** For exit clearance: an amount to recover (e.g. an unreturned asset). */
    recovery: money('recovery'),
    doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (t) => [index('hr_tasks_emp_idx').on(t.employeeId, t.kind)],
);

// =============================================================================
// Performance
// =============================================================================

export const hrReviewCycles = pgTable(
  'hr_review_cycles',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    /** goal_setting | review | closed */
    status: text('status').notNull().default('goal_setting'),
    /** Increment % by final rating 1..5, e.g. {"5": 15, "4": 10}. */
    incrementGuide: jsonb('increment_guide').$type<Record<string, number>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const hrGoals = pgTable(
  'hr_goals',
  {
    id: pk(),
    tenantId: tenantId(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => hrReviewCycles.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    kra: text('kra'),
    title: text('title').notNull(),
    target: text('target'),
    weight: numeric('weight', { precision: 5, scale: 2 }).notNull(),
    selfRating: smallint('self_rating'),
    selfComment: text('self_comment'),
    managerRating: smallint('manager_rating'),
    managerComment: text('manager_comment'),
  },
  (t) => [index('hr_goals_cycle_emp_idx').on(t.cycleId, t.employeeId)],
);

export const hrAppraisals = pgTable(
  'hr_appraisals',
  {
    id: pk(),
    tenantId: tenantId(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => hrReviewCycles.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    /** Weighted scores from the goals, 1–5. */
    selfScore: numeric('self_score', { precision: 4, scale: 2 }),
    managerScore: numeric('manager_score', { precision: 4, scale: 2 }),
    /** After calibration, 1–5. */
    finalRating: smallint('final_rating'),
    incrementPct: numeric('increment_pct', { precision: 5, scale: 2 }),
    newCtc: money('new_ctc'),
    effectiveFrom: date('effective_from', { mode: 'string' }),
    promoteToDesignationId: uuid('promote_to_designation_id').references(() => hrDesignations.id, { onDelete: 'set null' }),
    remarks: text('remarks'),
    /** When the increment went into payroll as a salary revision. */
    appliedAt: timestamp('applied_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('hr_appraisals_uq').on(t.cycleId, t.employeeId)],
);

// =============================================================================
// Training and skills
// =============================================================================

export const hrSkills = pgTable(
  'hr_skills',
  {
    id: pk(),
    tenantId: tenantId(),
    code: citext('code').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    /** Work centre or machine the skill is needed for (free text, e.g. "CNC-01"). */
    appliesTo: text('applies_to'),
    /** Re-assess after this many months; null = no expiry. */
    validityMonths: smallint('validity_months'),
  },
  (t) => [uniqueIndex('hr_skills_code_uq').on(t.tenantId, t.code)],
);

/** Skill levels on the shop-floor ILUO scale: 0 none, 1 learning, 2 with help, 3 alone, 4 can train others. */
export const hrEmployeeSkills = pgTable(
  'hr_employee_skills',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => hrSkills.id, { onDelete: 'cascade' }),
    level: smallint('level').notNull(),
    assessedOn: date('assessed_on', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    assessedBy: uuid('assessed_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('hr_employee_skills_uq').on(t.employeeId, t.skillId)],
);

export const hrTrainings = pgTable(
  'hr_trainings',
  {
    id: pk(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    skillId: uuid('skill_id').references(() => hrSkills.id, { onDelete: 'set null' }),
    /** The level reached by those who pass. */
    skillLevel: smallint('skill_level'),
    trainer: text('trainer'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    hours: numeric('hours', { precision: 5, scale: 1 }).notNull().default('1'),
    venue: text('venue'),
    capacity: smallint('capacity'),
    /** planned | done | cancelled */
    status: text('status').notNull().default('planned'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('hr_trainings_starts_idx').on(t.tenantId, t.startsAt)],
);

export const hrTrainingAttendees = pgTable(
  'hr_training_attendees',
  {
    id: pk(),
    tenantId: tenantId(),
    trainingId: uuid('training_id')
      .notNull()
      .references(() => hrTrainings.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    attended: boolean('attended'),
    passed: boolean('passed'),
    score: smallint('score'),
  },
  (t) => [uniqueIndex('hr_training_attendees_uq').on(t.trainingId, t.employeeId)],
);

// =============================================================================
// Separation and full & final settlement
// =============================================================================

export interface SettlementLine {
  code: string;
  name: string;
  amount: string;
  basis?: string;
}

export const hrSeparations = pgTable(
  'hr_separations',
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    /** resignation | termination | retirement | death | absconding */
    kind: text('kind').notNull(),
    noticeDate: date('notice_date', { mode: 'string' }).notNull(),
    lastWorkingDay: date('last_working_day', { mode: 'string' }).notNull(),
    reason: text('reason').notNull(),
    /** Recover pay for notice not served (resignation), or pay in lieu of notice (termination). */
    noticeShortfallDays: smallint('notice_shortfall_days').notNull().default(0),
    waiveShortfall: boolean('waive_shortfall').notNull().default(false),
    /** requested | accepted | settled | withdrawn */
    status: text('status').notNull().default('requested'),
    settlement: jsonb('settlement').$type<{ earnings: SettlementLine[]; deductions: SettlementLine[]; net: string } | null>(),
    journalId: uuid('journal_id'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [index('hr_separations_emp_idx').on(t.employeeId)],
);
