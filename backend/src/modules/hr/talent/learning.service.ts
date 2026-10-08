import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { employees, hrEmployeeSkills, hrSkills, hrTrainingAttendees, hrTrainings, type Transaction } from '@nextgen/database';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth-context';
import { todayIST } from '../../../common/fiscal-year';
import { DatabaseService } from '../../../database/database.service';
import { requireSelf } from '../time/people';
import { many } from '../../../common/sql';

export const skillSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(80),
  category: z.string().trim().max(40).nullable().optional(),
  appliesTo: z.string().trim().max(80).nullable().optional(),
  validityMonths: z.number().int().min(1).max(120).nullable().optional(),
});
export const assessSchema = z.object({
  employeeId: z.uuid(),
  skillId: z.uuid(),
  level: z.number().int().min(0).max(4),
  assessedOn: z.iso.date().optional(),
});
export const trainingSchema = z.object({
  title: z.string().trim().min(2).max(160),
  skillId: z.uuid().nullable().optional(),
  skillLevel: z.number().int().min(1).max(4).nullable().optional(),
  trainer: z.string().trim().max(120).nullable().optional(),
  startsAt: z.iso.datetime({ offset: true }),
  hours: z.number().min(0.5).max(500).default(1),
  venue: z.string().trim().max(120).nullable().optional(),
  capacity: z.number().int().min(1).max(1000).nullable().optional(),
});
export const attendeesSchema = z.object({
  employeeIds: z.array(z.uuid()).min(1).max(500),
});
export const resultSchema = z.object({
  results: z
    .array(
      z.object({
        employeeId: z.uuid(),
        attended: z.boolean(),
        passed: z.boolean().nullable().optional(),
        score: z.number().int().min(0).max(100).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

const addMonths = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Skills on the ILUO scale (0 none, 1 learning, 2 with help, 3 alone, 4 can train), the skill
 * matrix with expiring assessments, and the training calendar whose passes raise skill levels.
 */
@Injectable()
export class LearningService {
  constructor(private readonly database: DatabaseService) {}

  skills(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(hrSkills).orderBy(asc(hrSkills.category), asc(hrSkills.code)));
  }

  saveSkill(auth: AuthContext, id: string | null, input: z.infer<typeof skillSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = {
        ...input,
        code: input.code.toUpperCase(),
        category: input.category ?? null,
        appliesTo: input.appliesTo ?? null,
        validityMonths: input.validityMonths ?? null,
      };
      const [dup] = await tx
        .select({ id: hrSkills.id })
        .from(hrSkills)
        .where(and(eq(hrSkills.code, values.code), id ? ne(hrSkills.id, id) : undefined));
      if (dup) throw new ConflictException(`Skill ${values.code} already exists`);
      if (id) {
        const [r] = await tx.update(hrSkills).set(values).where(eq(hrSkills.id, id)).returning();
        if (!r) throw new NotFoundException('Skill not found');
        return r;
      }
      return (
        await tx
          .insert(hrSkills)
          .values({ tenantId: auth.tenantId, ...values })
          .returning()
      )[0];
    });
  }

  /** Current employees × skills; an assessment past its validity shows as expired. */
  matrix(auth: AuthContext, q: { departmentId?: string; skillCategory?: string }) {
    return this.database.run(auth, async (tx) => {
      const skills = await tx
        .select()
        .from(hrSkills)
        .where(q.skillCategory ? eq(hrSkills.category, q.skillCategory) : undefined)
        .orderBy(asc(hrSkills.code));
      const rows = await many<{
        id: string;
        code: string;
        fullName: string;
        department: string | null;
      }>(
        tx,
        sql`select e.id, e.code, e.full_name as "fullName", d.name as department from employees e left join hr_departments d on d.id = e.department_id
            where e.status <> 'exited' ${q.departmentId ? sql`and e.department_id = ${q.departmentId}` : sql``} order by e.code limit 2000`,
      );
      const levels =
        rows.length && skills.length
          ? await tx
              .select()
              .from(hrEmployeeSkills)
              .where(
                and(
                  inArray(
                    hrEmployeeSkills.employeeId,
                    rows.map((r) => r.id),
                  ),
                  inArray(
                    hrEmployeeSkills.skillId,
                    skills.map((s) => s.id),
                  ),
                ),
              )
          : [];
      const today = todayIST();
      const by = new Map(levels.map((l) => [`${l.employeeId}|${l.skillId}`, l]));
      return {
        skills,
        rows: rows.map((r) => ({
          ...r,
          levels: Object.fromEntries(
            skills.flatMap((s) => {
              const l = by.get(`${r.id}|${s.id}`);
              return l
                ? [
                    [
                      s.id,
                      {
                        level: l.level,
                        assessedOn: l.assessedOn,
                        expired: !!l.validUntil && l.validUntil < today,
                      },
                    ],
                  ]
                : [];
            }),
          ),
        })),
        // People who can do each skill on their own (level 3+, not expired): the cover for the work centre.
        cover: Object.fromEntries(skills.map((s) => [s.id, levels.filter((l) => l.skillId === s.id && l.level >= 3 && !(l.validUntil && l.validUntil < today)).length])),
      };
    });
  }

  assess(auth: AuthContext, input: z.infer<typeof assessSchema>) {
    return this.database.run(auth, (tx) => this.setLevel(tx, auth, input.employeeId, input.skillId, input.level, input.assessedOn ?? todayIST(), true));
  }

  private async setLevel(tx: Transaction, auth: AuthContext, employeeId: string, skillId: string, level: number, assessedOn: string, overwrite: boolean) {
    const [s] = await tx.select().from(hrSkills).where(eq(hrSkills.id, skillId));
    if (!s) throw new NotFoundException('Skill not found');
    const [e] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId));
    if (!e) throw new NotFoundException('Employee not found');
    const validUntil = s.validityMonths ? addMonths(assessedOn, s.validityMonths) : null;
    const [r] = await tx
      .insert(hrEmployeeSkills)
      .values({
        tenantId: auth.tenantId,
        employeeId,
        skillId,
        level,
        assessedOn,
        validUntil,
        assessedBy: auth.userId,
      })
      .onConflictDoUpdate({
        target: [hrEmployeeSkills.employeeId, hrEmployeeSkills.skillId],
        // A training pass only raises a level; an assessment sets it.
        set: overwrite
          ? { level, assessedOn, validUntil, assessedBy: auth.userId }
          : {
              level: sql`greatest(${hrEmployeeSkills.level}, ${level})`,
              assessedOn,
              validUntil,
              assessedBy: auth.userId,
            },
      })
      .returning();
    return r;
  }

  // ---- trainings --------------------------------------------------------------------------

  trainings(auth: AuthContext, q: { from?: string; to?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select t.id, t.title, t.skill_id as "skillId", t.skill_level as "skillLevel", t.trainer, t.starts_at as "startsAt", t.hours, t.venue, t.capacity, t.status, s.name as skill, (select count(*)::int from hr_training_attendees a where a.training_id = t.id) as nominated,
                   (select count(*)::int from hr_training_attendees a where a.training_id = t.id and a.attended) as attended
            from hr_trainings t left join hr_skills s on s.id = t.skill_id
            where true ${q.from ? sql`and t.starts_at >= ${q.from}::date` : sql``} ${q.to ? sql`and t.starts_at < (${q.to}::date + 1)` : sql``}
            order by t.starts_at desc limit 500`,
      ),
    );
  }

  training(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(hrTrainings).where(eq(hrTrainings.id, id));
      if (!t) throw new NotFoundException('Training not found');
      const attendees = await many(tx, sql`select a.id, a.employee_id as "employeeId", a.attended, a.passed, a.score, e.code, e.full_name as "fullName" from hr_training_attendees a join employees e on e.id = a.employee_id where a.training_id = ${id} order by e.code`);
      return { ...t, attendees };
    });
  }

  createTraining(auth: AuthContext, input: z.infer<typeof trainingSchema>) {
    if (input.skillLevel && !input.skillId) throw new BadRequestException('Choose the skill the level is for');
    return this.database.run(
      auth,
      async (tx) =>
        (
          await tx
            .insert(hrTrainings)
            .values({
              tenantId: auth.tenantId,
              ...input,
              startsAt: new Date(input.startsAt),
              hours: String(input.hours),
              skillId: input.skillId ?? null,
              skillLevel: input.skillLevel ?? null,
            })
            .returning()
        )[0],
    );
  }

  nominate(auth: AuthContext, id: string, input: z.infer<typeof attendeesSchema>) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(hrTrainings).where(eq(hrTrainings.id, id));
      if (!t) throw new NotFoundException('Training not found');
      if (t.status !== 'planned') throw new ConflictException(`The training is ${t.status}`);
      const [{ n }] = await many<{ n: number }>(tx, sql`select count(*)::int as n from hr_training_attendees where training_id = ${id}`);
      const ids = [...new Set(input.employeeIds)];
      if (t.capacity && n + ids.length > t.capacity) throw new BadRequestException(`Only ${t.capacity - n} place(s) left`);
      const added = await tx
        .insert(hrTrainingAttendees)
        .values(
          ids.map((employeeId) => ({
            tenantId: auth.tenantId,
            trainingId: id,
            employeeId,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: hrTrainingAttendees.id });
      return { added: added.length };
    });
  }

  /** Attendance and results; a pass raises the employee to the training's skill level. */
  record(auth: AuthContext, id: string, input: z.infer<typeof resultSchema>) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(hrTrainings).where(eq(hrTrainings.id, id)).for('update');
      if (!t) throw new NotFoundException('Training not found');
      if (t.status === 'cancelled') throw new ConflictException('The training was cancelled');
      let raised = 0;
      for (const r of input.results) {
        const [a] = await tx
          .update(hrTrainingAttendees)
          .set({
            attended: r.attended,
            passed: r.attended ? (r.passed ?? null) : false,
            score: r.score ?? null,
          })
          .where(and(eq(hrTrainingAttendees.trainingId, id), eq(hrTrainingAttendees.employeeId, r.employeeId)))
          .returning();
        if (!a) throw new BadRequestException('Someone in the results was not nominated');
        if (r.attended && r.passed && t.skillId && t.skillLevel) {
          await this.setLevel(tx, auth, r.employeeId, t.skillId, t.skillLevel, t.startsAt.toISOString().slice(0, 10), false);
          raised++;
        }
      }
      await tx.update(hrTrainings).set({ status: 'done' }).where(eq(hrTrainings.id, id));
      return { recorded: input.results.length, skillsRaised: raised };
    });
  }

  cancel(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx
        .update(hrTrainings)
        .set({ status: 'cancelled' })
        .where(and(eq(hrTrainings.id, id), eq(hrTrainings.status, 'planned')))
        .returning();
      if (!t) throw new ConflictException('Only a planned training can be cancelled');
      return t;
    });
  }

  /** The signed-in employee's trainings and skills. */
  mine(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const self = await requireSelf(tx, auth);
      const trainings = await many(
        tx,
        sql`select t.id, t.title, t.starts_at as "startsAt", t.hours, t.venue, t.status, a.attended, a.passed from hr_training_attendees a join hr_trainings t on t.id = a.training_id where a.employee_id = ${self.id} order by t.starts_at desc`,
      );
      const skills = await many(
        tx,
        sql`select s.code, s.name, x.level, x.assessed_on::text as "assessedOn", x.valid_until::text as "validUntil" from hr_employee_skills x join hr_skills s on s.id = x.skill_id where x.employee_id = ${self.id} order by s.code`,
      );
      return { trainings, skills };
    });
  }
}
