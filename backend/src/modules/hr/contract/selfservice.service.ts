import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { expenseClaims, payrollInputs } from '@nextgen/database';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth-context';
import { todayIST } from '../../../common/fiscal-year';
import { DatabaseService } from '../../../database/database.service';
import { isManagerOf, permissionsOf, selfEmployee, subjectOf } from '../time/people';
import { many } from '../../../common/sql';

export const claimSchema = z.object({
  employeeId: z.uuid().optional(),
  kind: z.enum(['travel', 'conveyance', 'food', 'medical', 'phone', 'other']),
  spentOn: z.iso.date(),
  amount: z.number().positive().max(1_000_000),
  description: z.string().trim().min(3).max(500),
});
export const decideClaimSchema = z.object({ approve: z.boolean(), approvedAmount: z.number().positive().max(1_000_000).optional(), note: z.string().trim().max(300).optional() });

const nextMonth = (m: string) => {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
};

/**
 * Employee and manager self-service: expense claims approved by the manager (or HR) and paid
 * through payroll as reimbursement, and the "my day" summary with the manager's approval queue.
 */
@Injectable()
export class SelfServiceService {
  constructor(private readonly database: DatabaseService) {}

  claims(auth: AuthContext, status?: string) {
    return this.database.run(auth, async (tx) => {
      const perms = await permissionsOf(this.database, auth);
      const all = perms.has('hr.claims.manage');
      return many(
        tx,
        sql`select c.id, c.kind, c.spent_on::text as "spentOn", c.amount, c.description, c.status, c.approved_amount as "approvedAmount", c.pay_month as "payMonth", c.decision_note as "decisionNote",
                   e.id as "employeeId", e.code, e.full_name as "fullName", (e.user_id = ${auth.userId}) as "isOwn", coalesce(m.user_id = ${auth.userId}, false) as "isManager"
            from hr_claims c join employees e on e.id = c.employee_id left join employees m on m.id = e.reports_to_id
            where true ${status ? sql`and c.status = ${status}` : sql``} ${all ? sql`` : sql`and (e.user_id = ${auth.userId} or m.user_id = ${auth.userId})`}
            order by c.created_at desc limit 500`,
      );
    });
  }

  submit(auth: AuthContext, input: z.infer<typeof claimSchema>) {
    if (input.spentOn > todayIST()) throw new BadRequestException('The expense date is in the future');
    return this.database.run(auth, async (tx) => {
      const perms = await permissionsOf(this.database, auth);
      const who = await subjectOf(tx, auth, perms, 'hr.claims.manage', input.employeeId);
      return (await tx.insert(expenseClaims).values({ tenantId: auth.tenantId, employeeId: who.employeeId, kind: input.kind, spentOn: input.spentOn, amount: input.amount.toFixed(2), description: input.description }).returning())[0];
    });
  }

  /** Approval adds a reimbursement to the first payroll month still open. */
  decide(auth: AuthContext, id: string, input: z.infer<typeof decideClaimSchema>) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(expenseClaims).where(eq(expenseClaims.id, id)).for('update');
      if (!c) throw new NotFoundException('Claim not found');
      if (c.status !== 'pending') throw new ConflictException(`This claim is already ${c.status}`);
      const self = await selfEmployee(tx, auth);
      if (self?.id === c.employeeId) throw new ForbiddenException('You cannot decide your own claim');
      const perms = await permissionsOf(this.database, auth);
      if (!perms.has('hr.claims.manage') && !(await isManagerOf(tx, auth, c.employeeId))) throw new ForbiddenException('Only the reporting manager or HR can decide this');
      if (!input.approve) {
        await tx.update(expenseClaims).set({ status: 'rejected', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: input.note ?? null }).where(eq(expenseClaims.id, id));
        return { status: 'rejected' };
      }
      const amount = input.approvedAmount ?? Number(c.amount);
      if (amount > Number(c.amount)) throw new BadRequestException('Approve at most the amount claimed');
      let month = todayIST().slice(0, 7);
      for (let i = 0; i < 12; i++) {
        const [run] = await many<{ status: string }>(tx, sql`select status from payroll_runs where month = ${month}`);
        if (!run || run.status === 'draft') break;
        month = nextMonth(month);
      }
      await tx.insert(payrollInputs).values({ tenantId: auth.tenantId, month, employeeId: c.employeeId, code: 'REIMB', amount: amount.toFixed(2), remarks: `Claim: ${c.kind} on ${c.spentOn}`, createdBy: auth.userId });
      await tx.update(expenseClaims).set({ status: 'approved', approvedAmount: amount.toFixed(2), payMonth: month, decidedBy: auth.userId, decidedAt: new Date(), decisionNote: input.note ?? null }).where(eq(expenseClaims.id, id));
      return { status: 'approved', payMonth: month, approvedAmount: amount.toFixed(2) };
    });
  }

  withdraw(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(expenseClaims).where(eq(expenseClaims.id, id));
      if (!c) throw new NotFoundException('Claim not found');
      const self = await selfEmployee(tx, auth);
      if (self?.id !== c.employeeId) throw new ForbiddenException('You can only withdraw your own claim');
      if (c.status !== 'pending') throw new ConflictException(`This claim is already ${c.status}`);
      await tx.delete(expenseClaims).where(eq(expenseClaims.id, id));
      return { ok: true };
    });
  }

  /** The employee's day and, for managers, what is waiting for them. */
  home(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const self = await selfEmployee(tx, auth);
      if (!self) return { employee: null };
      const today = todayIST();
      const [day] = await many(tx, sql`select status, first_in as "firstIn", last_out as "lastOut", worked_minutes as "workedMinutes" from attendance_days where employee_id = ${self.id} and date = ${today}`);
      const [{ punches }] = await many<{ punches: number }>(tx, sql`select count(*)::int as punches from attendance_punches where employee_id = ${self.id} and punched_at >= (${today}::date)::timestamp at time zone 'Asia/Kolkata' and punched_at < (${today}::date + 1)::timestamp at time zone 'Asia/Kolkata'`);
      const leave = await many(
        tx,
        sql`select t.code, t.name, coalesce(sum(l.days), 0)::float8 as balance from leave_types t left join leave_ledger l on l.leave_type_id = t.id and l.employee_id = ${self.id}
            where t.is_active and (t.gender is null or t.gender = ${self.gender}) group by t.code, t.name order by t.code`,
      );
      const [mine] = await many<{ leave: number; claims: number; regularisations: number }>(
        tx,
        sql`select (select count(*)::int from leave_applications where employee_id = ${self.id} and status = 'pending') as leave,
                   (select count(*)::int from hr_claims where employee_id = ${self.id} and status = 'pending') as claims,
                   (select count(*)::int from attendance_regularisations where employee_id = ${self.id} and status = 'pending') as regularisations`,
      );
      const [team] = await many<{ members: number; leave: number; claims: number; regularisations: number; interviews: number; goals: number }>(
        tx,
        sql`select (select count(*)::int from employees where reports_to_id = ${self.id} and status <> 'exited') as members,
                   (select count(*)::int from leave_applications a join employees e on e.id = a.employee_id where e.reports_to_id = ${self.id} and a.status = 'pending') as leave,
                   (select count(*)::int from hr_claims c join employees e on e.id = c.employee_id where e.reports_to_id = ${self.id} and c.status = 'pending') as claims,
                   (select count(*)::int from attendance_regularisations r join employees e on e.id = r.employee_id where e.reports_to_id = ${self.id} and r.status = 'pending') as regularisations,
                   (select count(*)::int from hr_interviews where interviewer_id = ${self.id} and result = 'pending') as interviews,
                   (select count(*)::int from hr_goals g join hr_review_cycles c on c.id = g.cycle_id join employees e on e.id = g.employee_id where e.reports_to_id = ${self.id} and c.status = 'review' and g.manager_rating is null) as goals`,
      );
      const onLeave = await many(
        tx,
        sql`select e.full_name as "fullName", t.code as "typeCode", a.to_date::text as "until" from leave_applications a join employees e on e.id = a.employee_id join leave_types t on t.id = a.leave_type_id
            where a.status = 'approved' and ${today} between a.from_date and a.to_date and (e.reports_to_id = ${self.id} or e.id = ${self.id})`,
      );
      const [payslip] = await many(tx, sql`select p.id, p.month, p.net from payslips p join payroll_runs r on r.id = p.run_id where p.employee_id = ${self.id} and r.status <> 'draft' order by p.month desc limit 1`);
      return { employee: self, today, day: day ?? null, punches, leave, mine, team, onLeave, payslip: payslip ?? null };
    });
  }
}
