import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { employeeSalaries, hrAppraisals, hrGoals, hrReviewCycles, type Transaction } from '@nextgen/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth-context';
import { DatabaseService } from '../../../database/database.service';
import { EmployeesService } from '../employees.service';
import { isManagerOf, permissionsOf, selfEmployee, subjectOf } from '../time/people';
import { many } from '../../../common/sql';

export const cycleSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    fromDate: z.iso.date(),
    toDate: z.iso.date(),
    incrementGuide: z.partialRecord(z.enum(['1', '2', '3', '4', '5']), z.number().min(0).max(100)).default({}),
  })
  .refine((c) => c.toDate > c.fromDate, {
    message: 'The cycle must end after it starts',
    path: ['toDate'],
  });
export const goalSchema = z.object({
  employeeId: z.uuid().optional(),
  kra: z.string().trim().max(80).nullable().optional(),
  title: z.string().trim().min(3).max(300),
  target: z.string().trim().max(300).nullable().optional(),
  weight: z.number().min(1).max(100),
});
export const rateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).nullable().optional(),
});
export const calibrateSchema = z.object({
  employeeId: z.uuid(),
  finalRating: z.number().int().min(1).max(5),
  incrementPct: z.number().min(0).max(100).nullable().optional(),
  effectiveFrom: z.iso.date(),
  promoteToDesignationId: z.uuid().nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
});

/**
 * Review cycles: goals (KRAs) with weights set by the employee, their manager or HR; self and
 * manager ratings; HR calibration into a final rating and increment; applying increments as salary
 * revisions (and promotions as service-record moves).
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly employees: EmployeesService,
  ) {}

  cycles(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(hrReviewCycles).orderBy(desc(hrReviewCycles.fromDate)));
  }

  createCycle(auth: AuthContext, input: z.infer<typeof cycleSchema>) {
    return this.database.run(
      auth,
      async (tx) =>
        (
          await tx
            .insert(hrReviewCycles)
            .values({
              tenantId: auth.tenantId,
              ...input,
              incrementGuide: input.incrementGuide as Record<string, number>,
            })
            .returning()
        )[0],
    );
  }

  setStatus(auth: AuthContext, id: string, status: 'goal_setting' | 'review' | 'closed') {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(hrReviewCycles).where(eq(hrReviewCycles.id, id));
      if (!c) throw new NotFoundException('Review cycle not found');
      if (status === 'review') {
        // Every employee's goals must add up to 100 % before the review opens.
        const off = await many<{ name: string; total: number }>(
          tx,
          sql`select e.full_name as name, sum(g.weight)::float8 as total from hr_goals g join employees e on e.id = g.employee_id where g.cycle_id = ${id} group by e.full_name having sum(g.weight) <> 100`,
        );
        if (off.length) throw new BadRequestException(`Goal weights must total 100 %: ${off.map((o) => `${o.name} ${o.total} %`).join(', ')}`);
      }
      return (await tx.update(hrReviewCycles).set({ status }).where(eq(hrReviewCycles.id, id)).returning())[0];
    });
  }

  private async cycle(tx: Transaction, id: string) {
    const [c] = await tx.select().from(hrReviewCycles).where(eq(hrReviewCycles.id, id));
    if (!c) throw new NotFoundException('Review cycle not found');
    return c;
  }

  /** Goals of one employee (yourself by default); HR and managers may look at others. */
  goals(auth: AuthContext, cycleId: string, employeeId?: string) {
    return this.database.run(auth, async (tx) => {
      const perms = await permissionsOf(this.database, auth);
      const self = await selfEmployee(tx, auth);
      const id = employeeId ?? self?.id;
      if (!id) throw new ForbiddenException('Your login is not linked to an employee record');
      if (id !== self?.id && !perms.has('hr.performance.read') && !(await isManagerOf(tx, auth, id))) throw new ForbiddenException('You can only see your own or your team’s goals');
      const goals = await tx
        .select()
        .from(hrGoals)
        .where(and(eq(hrGoals.cycleId, cycleId), eq(hrGoals.employeeId, id)))
        .orderBy(hrGoals.kra, hrGoals.title);
      const [appraisal] = await tx
        .select()
        .from(hrAppraisals)
        .where(and(eq(hrAppraisals.cycleId, cycleId), eq(hrAppraisals.employeeId, id)));
      return {
        employeeId: id,
        isSelf: id === self?.id,
        goals,
        appraisal: appraisal ?? null,
        cycle: await this.cycle(tx, cycleId),
      };
    });
  }

  addGoal(auth: AuthContext, cycleId: string, input: z.infer<typeof goalSchema>) {
    return this.database.run(auth, async (tx) => {
      const c = await this.cycle(tx, cycleId);
      if (c.status !== 'goal_setting') throw new ConflictException('Goals are set only while the cycle is in goal setting');
      const perms = await permissionsOf(this.database, auth);
      const who = await subjectOf(tx, auth, perms, 'hr.performance.manage', input.employeeId);
      const [{ total }] = await many<{ total: number }>(tx, sql`select coalesce(sum(weight), 0)::float8 as total from hr_goals where cycle_id = ${cycleId} and employee_id = ${who.employeeId}`);
      if (total + input.weight > 100) throw new BadRequestException(`Weights would total ${total + input.weight} %; the most is 100 %`);
      return (
        await tx
          .insert(hrGoals)
          .values({
            tenantId: auth.tenantId,
            cycleId,
            employeeId: who.employeeId,
            kra: input.kra ?? null,
            title: input.title,
            target: input.target ?? null,
            weight: String(input.weight),
          })
          .returning()
      )[0];
    });
  }

  removeGoal(auth: AuthContext, goalId: string) {
    return this.database.run(auth, async (tx) => {
      const [g] = await tx.select().from(hrGoals).where(eq(hrGoals.id, goalId));
      if (!g) throw new NotFoundException('Goal not found');
      if ((await this.cycle(tx, g.cycleId)).status !== 'goal_setting') throw new ConflictException('Goals are fixed once the review starts');
      const perms = await permissionsOf(this.database, auth);
      await subjectOf(tx, auth, perms, 'hr.performance.manage', g.employeeId);
      await tx.delete(hrGoals).where(eq(hrGoals.id, goalId));
      return { ok: true };
    });
  }

  /** The employee rates themselves; their manager (or HR) gives the manager rating. */
  rate(auth: AuthContext, goalId: string, input: z.infer<typeof rateSchema>) {
    return this.database.run(auth, async (tx) => {
      const [g] = await tx.select().from(hrGoals).where(eq(hrGoals.id, goalId));
      if (!g) throw new NotFoundException('Goal not found');
      if ((await this.cycle(tx, g.cycleId)).status !== 'review') throw new ConflictException('Ratings are given while the cycle is in review');
      const self = await selfEmployee(tx, auth);
      if (self?.id === g.employeeId) {
        const perms = await permissionsOf(this.database, auth);
        if (!perms.has('hr.self.use') && !perms.has('hr.performance.manage')) throw new ForbiddenException('You do not have self-service access');
        return (
          await tx
            .update(hrGoals)
            .set({
              selfRating: input.rating,
              selfComment: input.comment ?? null,
            })
            .where(eq(hrGoals.id, goalId))
            .returning()
        )[0];
      }
      const perms = await permissionsOf(this.database, auth);
      if (!perms.has('hr.performance.manage') && !(await isManagerOf(tx, auth, g.employeeId))) throw new ForbiddenException('Only the reporting manager or HR can rate this');
      return (
        await tx
          .update(hrGoals)
          .set({
            managerRating: input.rating,
            managerComment: input.comment ?? null,
          })
          .where(eq(hrGoals.id, goalId))
          .returning()
      )[0];
    });
  }

  /** Everyone in the cycle with weighted self and manager scores and the calibration so far. */
  appraisals(auth: AuthContext, cycleId: string) {
    return this.database.run(auth, async (tx) => {
      await this.cycle(tx, cycleId);
      return many(
        tx,
        sql`select e.id as "employeeId", e.code, e.full_name as "fullName", d.name as department, g.name as designation,
                   round(sum(x.weight * x.self_rating) filter (where x.self_rating is not null) / nullif(sum(x.weight) filter (where x.self_rating is not null), 0), 2)::float8 as "selfScore",
                   round(sum(x.weight * x.manager_rating) filter (where x.manager_rating is not null) / nullif(sum(x.weight) filter (where x.manager_rating is not null), 0), 2)::float8 as "managerScore",
                   count(*)::int as goals, count(x.manager_rating)::int as rated,
                   a.final_rating as "finalRating", a.increment_pct as "incrementPct", a.new_ctc as "newCtc", a.effective_from::text as "effectiveFrom", a.applied_at as "appliedAt",
                   (select ctc_annual from employee_salaries s where s.employee_id = e.id order by effective_from desc limit 1) as "currentCtc"
            from hr_goals x join employees e on e.id = x.employee_id left join hr_departments d on d.id = e.department_id left join hr_designations g on g.id = e.designation_id
            left join hr_appraisals a on a.cycle_id = x.cycle_id and a.employee_id = e.id
            where x.cycle_id = ${cycleId}
            group by e.id, e.code, e.full_name, d.name, g.name, a.final_rating, a.increment_pct, a.new_ctc, a.effective_from, a.applied_at
            order by e.code`,
      );
    });
  }

  calibrate(auth: AuthContext, cycleId: string, input: z.infer<typeof calibrateSchema>) {
    return this.database.run(auth, async (tx) => {
      const c = await this.cycle(tx, cycleId);
      if (c.status === 'goal_setting') throw new ConflictException('Calibrate once the review has started');
      const [existing] = await tx
        .select()
        .from(hrAppraisals)
        .where(and(eq(hrAppraisals.cycleId, cycleId), eq(hrAppraisals.employeeId, input.employeeId)));
      if (existing?.appliedAt) throw new ConflictException('The increment is already applied');
      const [score] = await many<{
        selfScore: number | null;
        managerScore: number | null;
      }>(
        tx,
        sql`select round(sum(weight * self_rating) / nullif(sum(weight) filter (where self_rating is not null), 0), 2)::float8 as "selfScore",
                   round(sum(weight * manager_rating) / nullif(sum(weight) filter (where manager_rating is not null), 0), 2)::float8 as "managerScore"
            from hr_goals where cycle_id = ${cycleId} and employee_id = ${input.employeeId}`,
      );
      const pct = input.incrementPct ?? c.incrementGuide[String(input.finalRating)] ?? 0;
      const [sal] = await tx.select({ ctc: employeeSalaries.ctcAnnual }).from(employeeSalaries).where(eq(employeeSalaries.employeeId, input.employeeId)).orderBy(desc(employeeSalaries.effectiveFrom)).limit(1);
      const newCtc = sal ? Math.round(Number(sal.ctc) * (1 + pct / 100)) : null;
      const values = {
        selfScore: score?.selfScore?.toString() ?? null,
        managerScore: score?.managerScore?.toString() ?? null,
        finalRating: input.finalRating,
        incrementPct: String(pct),
        newCtc: newCtc === null ? null : newCtc.toFixed(2),
        effectiveFrom: input.effectiveFrom,
        promoteToDesignationId: input.promoteToDesignationId ?? null,
        remarks: input.remarks ?? null,
      };
      if (existing) return (await tx.update(hrAppraisals).set(values).where(eq(hrAppraisals.id, existing.id)).returning())[0];
      return (
        await tx
          .insert(hrAppraisals)
          .values({
            tenantId: auth.tenantId,
            cycleId,
            employeeId: input.employeeId,
            ...values,
          })
          .returning()
      )[0];
    });
  }

  /** Writes calibrated increments into salaries (every component scaled) and records promotions. */
  apply(auth: AuthContext, cycleId: string) {
    return this.database.run(auth, async (tx) => {
      await this.cycle(tx, cycleId);
      const rows = await tx
        .select()
        .from(hrAppraisals)
        .where(and(eq(hrAppraisals.cycleId, cycleId), sql`${hrAppraisals.appliedAt} is null`, sql`${hrAppraisals.finalRating} is not null`));
      let increments = 0;
      let promotions = 0;
      const skipped: string[] = [];
      for (const a of rows) {
        const pct = Number(a.incrementPct ?? 0);
        const [sal] = await tx.select().from(employeeSalaries).where(eq(employeeSalaries.employeeId, a.employeeId)).orderBy(desc(employeeSalaries.effectiveFrom)).limit(1);
        if (pct > 0) {
          if (!sal) {
            skipped.push(`${a.employeeId}: no salary to increase`);
            continue;
          }
          const [paid] = await many<{ n: number }>(
            tx,
            sql`select count(*)::int as n from payslips p join payroll_runs r on r.id = p.run_id where p.employee_id = ${a.employeeId} and r.status <> 'draft' and r.month >= ${a.effectiveFrom!.slice(0, 7)}`,
          );
          if (paid.n) {
            skipped.push(`${a.employeeId}: payroll already approved from ${a.effectiveFrom}`);
            continue;
          }
          const f = 1 + pct / 100;
          const lines = sal.lines.map((l) => ({
            code: l.code,
            monthly: Math.round(Number(l.monthly) * f).toFixed(2),
          }));
          await tx
            .insert(employeeSalaries)
            .values({
              tenantId: auth.tenantId,
              employeeId: a.employeeId,
              effectiveFrom: a.effectiveFrom!,
              ctcAnnual: (a.newCtc ?? (Number(sal.ctcAnnual) * f).toFixed(2)) as string,
              templateId: sal.templateId,
              lines,
              remarks: `Increment ${pct} % (appraisal)`,
              createdBy: auth.userId,
            })
            .onConflictDoUpdate({
              target: [employeeSalaries.tenantId, employeeSalaries.employeeId, employeeSalaries.effectiveFrom],
              set: {
                lines,
                ctcAnnual: (a.newCtc ?? (Number(sal.ctcAnnual) * f).toFixed(2)) as string,
                remarks: `Increment ${pct} % (appraisal)`,
              },
            });
          increments++;
        }
        if (a.promoteToDesignationId) {
          await this.employees.moveTx(tx, auth, a.employeeId, {
            kind: 'promotion',
            effectiveDate: a.effectiveFrom!,
            designationId: a.promoteToDesignationId,
            remarks: 'Appraisal',
          } as Parameters<EmployeesService['moveTx']>[3]);
          promotions++;
        }
        await tx.update(hrAppraisals).set({ appliedAt: new Date() }).where(eq(hrAppraisals.id, a.id));
      }
      return { increments, promotions, skipped };
    });
  }
}
