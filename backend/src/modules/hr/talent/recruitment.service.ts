import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  companies,
  employeeSalaries,
  employees,
  hrCandidates,
  hrChecklists,
  hrDesignations,
  hrInterviews,
  hrOffers,
  hrRequisitions,
  hrTasks,
  letterTemplates,
  payrollSettings,
  salaryComponents,
  salaryTemplates,
  type Transaction,
} from '@nextgen/database';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth-context';
import { todayIST } from '../../../common/fiscal-year';
import type { RequestMeta } from '../../../common/request-meta';
import { DatabaseService } from '../../../database/database.service';
import { applyTemplate } from '../../payroll/salary';
import { createEmployeeSchema, EmployeesService } from '../employees.service';
import { addDays } from '../time/attendance-engine';
import { permissionsOf } from '../time/people';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const money = z
  .union([z.number(), z.string()])
  .transform((v) => Math.round(Number(v) * 100) / 100)
  .pipe(z.number().min(0).max(1e10));
const text = (max: number) => z.string().trim().max(max).nullable().optional();

export const requisitionSchema = z.object({
  title: z.string().trim().min(2).max(120),
  departmentId: z.uuid().nullable().optional(),
  designationId: z.uuid().nullable().optional(),
  locationId: z.uuid().nullable().optional(),
  openings: z.number().int().min(1).max(500).default(1),
  reason: z.enum(['new', 'replacement']).default('new'),
  replacementForId: z.uuid().nullable().optional(),
  maxCtc: money.nullable().optional(),
  neededBy: z.iso.date().nullable().optional(),
  description: text(5000),
});
export const candidateSchema = z.object({
  requisitionId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  email: z.email().nullable().optional(),
  mobile: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'A 10-digit mobile number')
    .nullable()
    .optional(),
  source: text(60),
  currentCtc: money.nullable().optional(),
  expectedCtc: money.nullable().optional(),
  noticeDays: z.number().int().min(0).max(180).nullable().optional(),
  notes: text(2000),
});
export const stageSchema = z.object({
  stage: z.enum(['applied', 'screening', 'interview', 'rejected', 'withdrawn']),
  notes: text(2000),
});
export const interviewSchema = z.object({
  round: z.number().int().min(1).max(10).default(1),
  scheduledAt: z.iso.datetime({ offset: true }),
  interviewerId: z.uuid().nullable().optional(),
  mode: z.enum(['in_person', 'phone', 'video']).default('in_person'),
});
export const feedbackSchema = z.object({
  result: z.enum(['selected', 'rejected', 'hold']),
  score: z.number().int().min(1).max(5).nullable().optional(),
  feedback: z.string().trim().min(3).max(2000),
});
export const offerSchema = z.object({
  candidateId: z.uuid(),
  designationId: z.uuid().nullable().optional(),
  gradeId: z.uuid().nullable().optional(),
  ctcAnnual: money.refine((v) => v > 0, 'Enter the CTC'),
  salaryTemplateId: z.uuid().nullable().optional(),
  joiningDate: z.iso.date(),
  letterTemplateId: z.uuid().nullable().optional(),
});
export const acceptSchema = z.object({
  joiningDate: z.iso.date().optional(),
  employmentType: z.enum(['permanent', 'probation', 'contract', 'trainee', 'apprentice']).default('probation'),
  category: z.enum(['staff', 'worker', 'management']).default('staff'),
  reportsToId: z.uuid().nullable().optional(),
  probationMonths: z.number().int().min(0).max(24).default(6),
});

/**
 * Hiring: manpower requisitions (approved before candidates are added), candidates moving through
 * stages, interview rounds with feedback, offers that need approval, and hiring an accepted offer
 * into the employee master with their salary and onboarding checklist.
 */
@Injectable()
export class RecruitmentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly employees: EmployeesService,
  ) {}

  requisitions(auth: AuthContext, status?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select r.id, r.number, r.title, r.department_id as "departmentId", r.designation_id as "designationId", r.location_id as "locationId", r.openings, r.reason, r.replacement_for_id as "replacementForId", r.max_ctc as "maxCtc", r.needed_by::text as "neededBy", r.description, r.status, r.requested_by as "requestedBy", r.decided_at as "decidedAt", r.created_at as "createdAt", d.name as department, g.name as designation, l.name as location,
                   (select count(*)::int from hr_candidates c where c.requisition_id = r.id) as candidates,
                   (select count(*)::int from hr_candidates c where c.requisition_id = r.id and c.stage = 'hired') as hired
            from hr_requisitions r left join hr_departments d on d.id = r.department_id left join hr_designations g on g.id = r.designation_id left join hr_locations l on l.id = r.location_id
            where true ${status ? sql`and r.status = ${status}` : sql``} order by r.created_at desc limit 500`,
      ),
    );
  }

  requisition(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [r] = await many(
        tx,
        sql`select r.id, r.number, r.title, r.department_id as "departmentId", r.designation_id as "designationId", r.location_id as "locationId", r.openings, r.reason, r.replacement_for_id as "replacementForId", r.max_ctc as "maxCtc", r.needed_by::text as "neededBy", r.description, r.status, r.requested_by as "requestedBy", r.decided_at as "decidedAt", r.created_at as "createdAt", d.name as department, g.name as designation, l.name as location from hr_requisitions r left join hr_departments d on d.id = r.department_id left join hr_designations g on g.id = r.designation_id left join hr_locations l on l.id = r.location_id where r.id = ${id}`,
      );
      if (!r) throw new NotFoundException('Requisition not found');
      const candidates = await many(
        tx,
        sql`select c.id, c.name, c.email, c.mobile, c.source, c.current_ctc as "currentCtc", c.expected_ctc as "expectedCtc", c.notice_days as "noticeDays", c.stage, c.notes, c.employee_id as "employeeId", c.created_at as "createdAt", (select json_agg(json_build_object('id', i.id, 'round', i.round, 'scheduledAt', i.scheduled_at, 'result', i.result, 'score', i.score, 'feedback', i.feedback, 'mode', i.mode, 'interviewer', e.full_name) order by i.round)
                         from hr_interviews i left join employees e on e.id = i.interviewer_id where i.candidate_id = c.id) as interviews,
                   (select row_to_json(o) from (select id, status, ctc_annual as "ctcAnnual", joining_date as "joiningDate", letter_body is not null as "hasLetter" from hr_offers where candidate_id = c.id order by created_at desc limit 1) o) as offer
            from hr_candidates c where c.requisition_id = ${id} order by c.created_at`,
      );
      return { ...r, candidates };
    });
  }

  createRequisition(auth: AuthContext, input: z.infer<typeof requisitionSchema>) {
    return this.database.run(auth, async (tx) => {
      const [{ n }] = await many<{ n: number }>(tx, sql`select count(*)::int + 1 as n from hr_requisitions`);
      const number = `MRF-${String(n).padStart(4, '0')}`;
      return (
        await tx
          .insert(hrRequisitions)
          .values({
            tenantId: auth.tenantId,
            number,
            ...input,
            maxCtc: input.maxCtc === null || input.maxCtc === undefined ? null : input.maxCtc.toFixed(2),
            description: input.description ?? null,
            requestedBy: auth.userId,
          })
          .returning()
      )[0];
    });
  }

  decideRequisition(auth: AuthContext, id: string, approve: boolean) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(hrRequisitions).where(eq(hrRequisitions.id, id)).for('update');
      if (!r) throw new NotFoundException('Requisition not found');
      if (r.status !== 'pending') throw new ConflictException(`This requisition is already ${r.status}`);
      if (r.requestedBy === auth.userId) throw new ForbiddenException('Someone else must approve your own requisition');
      return (
        await tx
          .update(hrRequisitions)
          .set({
            status: approve ? 'approved' : 'rejected',
            decidedBy: auth.userId,
            decidedAt: new Date(),
          })
          .where(eq(hrRequisitions.id, id))
          .returning()
      )[0];
    });
  }

  closeRequisition(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.update(hrRequisitions).set({ status: 'closed' }).where(eq(hrRequisitions.id, id)).returning();
      if (!r) throw new NotFoundException('Requisition not found');
      return r;
    });
  }

  // ---- candidates and interviews ----------------------------------------------------------

  addCandidate(auth: AuthContext, input: z.infer<typeof candidateSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.select({ status: hrRequisitions.status }).from(hrRequisitions).where(eq(hrRequisitions.id, input.requisitionId));
      if (!r) throw new NotFoundException('Requisition not found');
      if (r.status !== 'approved') throw new BadRequestException('Candidates can be added only to an approved, open requisition');
      if (input.email) {
        const [dup] = await tx
          .select({ id: hrCandidates.id })
          .from(hrCandidates)
          .where(and(eq(hrCandidates.requisitionId, input.requisitionId), eq(hrCandidates.email, input.email)));
        if (dup) throw new ConflictException('This candidate is already on the requisition');
      }
      const m = (v: number | null | undefined) => (v === null || v === undefined ? null : v.toFixed(2));
      return (
        await tx
          .insert(hrCandidates)
          .values({
            tenantId: auth.tenantId,
            ...input,
            currentCtc: m(input.currentCtc),
            expectedCtc: m(input.expectedCtc),
          })
          .returning()
      )[0];
    });
  }

  setStage(auth: AuthContext, id: string, input: z.infer<typeof stageSchema>) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(hrCandidates).where(eq(hrCandidates.id, id)).for('update');
      if (!c) throw new NotFoundException('Candidate not found');
      if (c.stage === 'hired') throw new ConflictException('The candidate is already hired');
      return (
        await tx
          .update(hrCandidates)
          .set({ stage: input.stage, notes: input.notes ?? c.notes })
          .where(eq(hrCandidates.id, id))
          .returning()
      )[0];
    });
  }

  scheduleInterview(auth: AuthContext, candidateId: string, input: z.infer<typeof interviewSchema>) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(hrCandidates).where(eq(hrCandidates.id, candidateId));
      if (!c) throw new NotFoundException('Candidate not found');
      if (['hired', 'rejected', 'withdrawn'].includes(c.stage)) throw new ConflictException(`The candidate is ${c.stage}`);
      if (c.stage === 'applied' || c.stage === 'screening') await tx.update(hrCandidates).set({ stage: 'interview' }).where(eq(hrCandidates.id, candidateId));
      return (
        await tx
          .insert(hrInterviews)
          .values({
            tenantId: auth.tenantId,
            candidateId,
            ...input,
            scheduledAt: new Date(input.scheduledAt),
            interviewerId: input.interviewerId ?? null,
          })
          .returning()
      )[0];
    });
  }

  /** Feedback from the interviewer (their employee record) or recruiters. */
  feedback(auth: AuthContext, interviewId: string, input: z.infer<typeof feedbackSchema>) {
    return this.database.run(auth, async (tx) => {
      const [i] = await tx.select().from(hrInterviews).where(eq(hrInterviews.id, interviewId));
      if (!i) throw new NotFoundException('Interview not found');
      const perms = await permissionsOf(this.database, auth);
      if (!perms.has('hr.recruitment.manage')) {
        const [me] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, auth.userId));
        if (!me || me.id !== i.interviewerId) throw new ForbiddenException('Only the interviewer or a recruiter can give feedback');
      }
      const [r] = await tx
        .update(hrInterviews)
        .set({
          result: input.result,
          score: input.score ?? null,
          feedback: input.feedback,
        })
        .where(eq(hrInterviews.id, interviewId))
        .returning();
      if (input.result === 'rejected') await tx.update(hrCandidates).set({ stage: 'rejected' }).where(eq(hrCandidates.id, i.candidateId));
      return r;
    });
  }

  /** Interviews assigned to the signed-in employee. */
  myInterviews(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select i.id, i.round, i.scheduled_at as "scheduledAt", i.mode, i.result, i.score, i.feedback, c.name as candidate, r.title as position from hr_interviews i join hr_candidates c on c.id = i.candidate_id join hr_requisitions r on r.id = c.requisition_id
            join employees e on e.id = i.interviewer_id where e.user_id = ${auth.userId} order by i.scheduled_at desc limit 100`,
      ),
    );
  }

  // ---- offers -----------------------------------------------------------------------------

  createOffer(auth: AuthContext, input: z.infer<typeof offerSchema>) {
    return this.database.run(auth, async (tx) => {
      const [c] = await many<{
        id: string;
        stage: string;
        name: string;
        reqStatus: string;
        maxCtc: string | null;
        designationId: string | null;
      }>(tx, sql`select c.id, c.stage, c.name, r.status as "reqStatus", r.max_ctc as "maxCtc", r.designation_id as "designationId" from hr_candidates c join hr_requisitions r on r.id = c.requisition_id where c.id = ${input.candidateId}`);
      if (!c) throw new NotFoundException('Candidate not found');
      if (['hired', 'rejected', 'withdrawn'].includes(c.stage)) throw new ConflictException(`The candidate is ${c.stage}`);
      if (c.reqStatus !== 'approved') throw new BadRequestException('The requisition is not open');
      const [open] = await tx
        .select({ id: hrOffers.id })
        .from(hrOffers)
        .where(and(eq(hrOffers.candidateId, c.id), sql`${hrOffers.status} in ('pending', 'approved', 'accepted')`));
      if (open) throw new ConflictException('This candidate already has an open offer; withdraw it first');
      const designationId = input.designationId ?? c.designationId;
      let letterBody: string | null = null;
      if (input.letterTemplateId) {
        const [t] = await tx.select().from(letterTemplates).where(eq(letterTemplates.id, input.letterTemplateId));
        if (!t) throw new NotFoundException('Letter template not found');
        const [co] = await tx.select({ name: companies.name }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
        const [d] = designationId ? await tx.select({ name: hrDesignations.name }).from(hrDesignations).where(eq(hrDesignations.id, designationId)) : [];
        const values: Record<string, string> = {
          'candidate.name': c.name,
          'employee.name': c.name,
          'employee.first_name': c.name.split(' ')[0],
          designation: d?.name ?? '',
          ctc: `₹${input.ctcAnnual.toLocaleString('en-IN')}`,
          doj: input.joiningDate,
          company: co?.name ?? '',
          today: todayIST(),
          date: todayIST(),
        };
        letterBody = t.body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => values[k] ?? m);
      }
      // An offer within the requisition's budget is approved by whoever makes it, if they may approve.
      const perms = await permissionsOf(this.database, auth);
      const withinBudget = c.maxCtc !== null && input.ctcAnnual <= Number(c.maxCtc);
      const autoApprove = withinBudget && perms.has('hr.recruitment.approve');
      const [o] = await tx
        .insert(hrOffers)
        .values({
          tenantId: auth.tenantId,
          candidateId: c.id,
          designationId,
          gradeId: input.gradeId ?? null,
          ctcAnnual: input.ctcAnnual.toFixed(2),
          salaryTemplateId: input.salaryTemplateId ?? null,
          joiningDate: input.joiningDate,
          letterBody,
          status: autoApprove ? 'approved' : 'pending',
          approvedBy: autoApprove ? auth.userId : null,
          approvedAt: autoApprove ? new Date() : null,
          createdBy: auth.userId,
        })
        .returning();
      await tx.update(hrCandidates).set({ stage: 'offered' }).where(eq(hrCandidates.id, c.id));
      return o;
    });
  }

  decideOffer(auth: AuthContext, id: string, approve: boolean) {
    return this.database.run(auth, async (tx) => {
      const [o] = await tx.select().from(hrOffers).where(eq(hrOffers.id, id)).for('update');
      if (!o) throw new NotFoundException('Offer not found');
      if (o.status !== 'pending') throw new ConflictException(`This offer is already ${o.status}`);
      if (o.createdBy === auth.userId) throw new ForbiddenException('Someone else must approve an offer you made');
      return (
        await tx
          .update(hrOffers)
          .set({
            status: approve ? 'approved' : 'rejected',
            approvedBy: auth.userId,
            approvedAt: new Date(),
          })
          .where(eq(hrOffers.id, id))
          .returning()
      )[0];
    });
  }

  /** The candidate's answer: declined / withdrawn closes it; accepted hires them. */
  respond(auth: AuthContext, id: string, answer: 'declined' | 'withdrawn') {
    return this.database.run(auth, async (tx) => {
      const [o] = await tx.select().from(hrOffers).where(eq(hrOffers.id, id)).for('update');
      if (!o) throw new NotFoundException('Offer not found');
      if (!['pending', 'approved'].includes(o.status)) throw new ConflictException(`This offer is already ${o.status}`);
      await tx.update(hrOffers).set({ status: answer }).where(eq(hrOffers.id, id));
      await tx
        .update(hrCandidates)
        .set({ stage: answer === 'declined' ? 'withdrawn' : 'interview' })
        .where(eq(hrCandidates.id, o.candidateId));
      return { status: answer };
    });
  }

  accept(auth: AuthContext, id: string, input: z.infer<typeof acceptSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [o] = await tx.select().from(hrOffers).where(eq(hrOffers.id, id)).for('update');
      if (!o) throw new NotFoundException('Offer not found');
      if (o.status !== 'approved') throw new ConflictException(o.status === 'pending' ? 'The offer is not approved yet' : `This offer is ${o.status}`);
      const [c] = await tx.select().from(hrCandidates).where(eq(hrCandidates.id, o.candidateId));
      const [r] = await tx.select().from(hrRequisitions).where(eq(hrRequisitions.id, c.requisitionId));
      const doj = input.joiningDate ?? o.joiningDate;
      const [first, ...rest] = c.name.split(/\s+/);
      const parsed = createEmployeeSchema.safeParse({
        firstName: first,
        lastName: rest.join(' ') || null,
        personalEmail: c.email ? String(c.email) : null,
        mobile: c.mobile,
        dateOfJoining: doj,
        probationEnd: input.employmentType === 'probation' && input.probationMonths ? addMonths(doj, input.probationMonths) : null,
        employmentType: input.employmentType,
        category: input.category,
        departmentId: r.departmentId,
        designationId: o.designationId ?? r.designationId,
        gradeId: o.gradeId,
        locationId: r.locationId,
        reportsToId: input.reportsToId ?? null,
      });
      if (!parsed.success) throw new BadRequestException(`The candidate's details need fixing first: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      const emp = await this.employees.createTx(tx, auth, parsed.data, meta);
      await this.salaryFromOffer(tx, auth, emp.id, doj, Number(o.ctcAnnual), o.salaryTemplateId);
      const tasks = await this.onboardingTasks(tx, auth.tenantId, emp.id, doj);
      await tx.update(hrOffers).set({ status: 'accepted' }).where(eq(hrOffers.id, id));
      await tx.update(hrCandidates).set({ stage: 'hired', employeeId: emp.id }).where(eq(hrCandidates.id, c.id));
      const [{ n }] = await many<{ n: number }>(tx, sql`select count(*)::int as n from hr_candidates where requisition_id = ${r.id} and stage = 'hired'`);
      if (n >= r.openings) await tx.update(hrRequisitions).set({ status: 'closed' }).where(eq(hrRequisitions.id, r.id));
      return { employeeId: emp.id, code: emp.code, onboardingTasks: tasks };
    });
  }

  /** The offered CTC as the first salary, split with the offer's template when it has one. */
  private async salaryFromOffer(tx: Transaction, auth: AuthContext, employeeId: string, from: string, ctc: number, templateId: string | null) {
    if (!templateId) return;
    const [t] = await tx.select().from(salaryTemplates).where(eq(salaryTemplates.id, templateId));
    if (!t) return;
    const pf = (await tx.select({ code: salaryComponents.code }).from(salaryComponents).where(eq(salaryComponents.isPfWage, true))).map((c) => String(c.code));
    const [s] = await tx.select({ restrict: payrollSettings.pfRestrictToCeiling }).from(payrollSettings);
    const split = applyTemplate(ctc, t.lines, {
      pfWageCodes: new Set(pf.length ? pf : ['BASIC', 'DA']),
      employerPfInCtc: t.employerPfInCtc,
      restrictToCeiling: s?.restrict ?? true,
    });
    await tx.insert(employeeSalaries).values({
      tenantId: auth.tenantId,
      employeeId,
      effectiveFrom: from,
      ctcAnnual: ctc.toFixed(2),
      templateId,
      lines: split.lines,
      remarks: 'From the offer',
      createdBy: auth.userId,
    });
  }

  /** Tasks from the default onboarding checklist, due N days after joining. */
  async onboardingTasks(tx: Transaction, tenantId: string, employeeId: string, doj: string) {
    const [cl] = await tx
      .select()
      .from(hrChecklists)
      .where(and(eq(hrChecklists.kind, 'onboarding'), eq(hrChecklists.isDefault, true)))
      .orderBy(desc(hrChecklists.id))
      .limit(1);
    if (!cl?.items.length) return 0;
    await tx.insert(hrTasks).values(
      cl.items.map((i) => ({
        tenantId,
        employeeId,
        kind: 'onboarding',
        title: i.title,
        owner: i.owner,
        dueDate: addDays(doj, i.days),
      })),
    );
    return cl.items.length;
  }
}

function addMonths(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
