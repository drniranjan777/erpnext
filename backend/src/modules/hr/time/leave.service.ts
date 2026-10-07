import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { employees, leaveApplications, leaveLedger, leaveTypes, type Transaction } from '@nextgen/database';
import { and, asc, eq, gte, lte, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth-context';
import { todayIST } from '../../../common/fiscal-year';
import { DatabaseService } from '../../../database/database.service';
import { daysBetween, leaveDaysFor } from './attendance-engine';
import { isManagerOf, permissionsOf, selfEmployee, subjectOf } from './people';
import { TimeService } from './time.service';

const days = (max: number) => z.number().min(0).max(max);
export const leaveTypeSchema = z
  .object({
    code: z.string().trim().min(1).max(10),
    name: z.string().trim().min(2).max(60),
    isPaid: z.boolean().default(true),
    accrual: z.enum(['none', 'monthly', 'yearly', 'per_days_worked']).default('monthly'),
    annualQuota: days(365).default(0),
    daysWorkedPerLeave: z.number().int().min(1).max(60).nullable().optional(),
    carryForwardMax: days(365).default(0),
    encashable: z.boolean().default(false),
    encashMax: days(365).nullable().optional(),
    allowHalfDay: z.boolean().default(true),
    allowNegative: z.boolean().default(false),
    countHolidays: z.boolean().default(false),
    isCompOff: z.boolean().default(false),
    gender: z.enum(['male', 'female']).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((t) => t.accrual !== 'per_days_worked' || t.daysWorkedPerLeave, { message: 'Say how many days worked earn one day of leave', path: ['daysWorkedPerLeave'] });
export const applySchema = z
  .object({ employeeId: z.uuid().optional(), leaveTypeId: z.uuid(), fromDate: z.iso.date(), toDate: z.iso.date(), fromHalf: z.boolean().default(false), toHalf: z.boolean().default(false), reason: z.string().trim().min(3).max(300) })
  .refine((a) => a.toDate >= a.fromDate && daysBetween(a.fromDate, a.toDate) <= 180, { message: 'The leave must end on or after it starts, within 180 days', path: ['toDate'] });
export const adjustSchema = z.object({
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  days: z.number().min(-365).max(365).refine((d) => d !== 0, 'Days cannot be zero'),
  kind: z.enum(['opening', 'adjustment']).default('adjustment'),
  entryDate: z.iso.date().optional(),
  remarks: z.string().trim().min(3).max(200),
});
export const monthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month as YYYY-MM') });
export const yearSchema = z.object({ year: z.number().int().min(2000).max(2100) });
export const decideLeaveSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() });

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Leave types, the leave ledger (every credit and debit; the balance is the sum) and leave
 * applications decided by HR or the reporting manager.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly database: DatabaseService,
    private readonly time: TimeService,
  ) {}

  // ---- types ------------------------------------------------------------------------------

  types(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(leaveTypes).orderBy(asc(leaveTypes.code)));
  }

  saveType(auth: AuthContext, id: string | null, input: z.infer<typeof leaveTypeSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = {
        ...input,
        code: input.code.toUpperCase(),
        annualQuota: String(input.annualQuota),
        carryForwardMax: String(input.carryForwardMax),
        encashMax: input.encashMax === null || input.encashMax === undefined ? null : String(input.encashMax),
        daysWorkedPerLeave: input.daysWorkedPerLeave ?? null,
        gender: input.gender ?? null,
        // Comp-off is earned, not accrued.
        accrual: input.isCompOff ? 'none' : input.accrual,
      };
      const [dup] = await tx.select({ id: leaveTypes.id }).from(leaveTypes).where(and(eq(leaveTypes.code, values.code), id ? ne(leaveTypes.id, id) : undefined));
      if (dup) throw new ConflictException(`Leave code ${values.code} is already used`);
      if (id) {
        const [r] = await tx.update(leaveTypes).set(values).where(eq(leaveTypes.id, id)).returning();
        if (!r) throw new NotFoundException('Leave type not found');
        return r;
      }
      return (await tx.insert(leaveTypes).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  // ---- balances ---------------------------------------------------------------------------

  /** Balances for a year: one employee (yourself when omitted), or everyone for HR. */
  balances(auth: AuthContext, q: { employeeId?: string; all?: boolean; year: number }) {
    return this.database.run(auth, async (tx) => {
      const perms = await permissionsOf(this.database, auth);
      let filter = sql``;
      if (q.all) {
        if (!perms.has('hr.leave.read')) throw new ForbiddenException('Missing permission: hr.leave.read');
      } else {
        const self = await selfEmployee(tx, auth);
        const employeeId = q.employeeId ?? self?.id;
        if (!employeeId) throw new ForbiddenException('Your login is not linked to an employee record. Ask HR to link it.');
        if (employeeId !== self?.id && !perms.has('hr.leave.read') && !(await isManagerOf(tx, auth, employeeId))) throw new ForbiddenException('You can only see your own or your team’s leave');
        filter = sql`and e.id = ${employeeId}`;
      }
      const y0 = `${q.year}-01-01`;
      const y1 = `${q.year}-12-31`;
      return many(
        tx,
        sql`select e.id as "employeeId", e.code, e.full_name as "fullName", t.id as "leaveTypeId", t.code as "typeCode", t.name as "typeName", t.is_paid as "isPaid",
                   coalesce(sum(l.days) filter (where l.entry_date < ${y0}), 0)::float8 as opening,
                   coalesce(sum(l.days) filter (where l.entry_date between ${y0} and ${y1} and l.kind in ('opening', 'accrual', 'comp_off', 'adjustment')), 0)::float8 as credited,
                   coalesce(-sum(l.days) filter (where l.entry_date between ${y0} and ${y1} and l.kind in ('availed', 'reversal')), 0)::float8 as availed,
                   coalesce(-sum(l.days) filter (where l.entry_date between ${y0} and ${y1} and l.kind in ('encashment', 'lapse')), 0)::float8 as "closedOut",
                   coalesce(sum(l.days) filter (where l.entry_date <= ${y1}), 0)::float8 as balance,
                   coalesce(sum(l.days), 0)::float8 as "balanceNow",
                   coalesce((select sum(a.days) from leave_applications a where a.employee_id = e.id and a.leave_type_id = t.id and a.status = 'pending'), 0)::float8 as pending
            from employees e cross join leave_types t
            left join leave_ledger l on l.employee_id = e.id and l.leave_type_id = t.id
            where e.status <> 'exited' and t.is_active and (t.gender is null or t.gender = e.gender) ${filter}
            group by e.id, e.code, e.full_name, t.id, t.code, t.name, t.is_paid
            order by e.code, t.code`,
      );
    });
  }

  private async available(tx: Transaction, employeeId: string, leaveTypeId: string, exceptApplication?: string) {
    const [b] = await many<{ balance: number; pending: number }>(
      tx,
      sql`select coalesce((select sum(days) from leave_ledger where employee_id = ${employeeId} and leave_type_id = ${leaveTypeId}), 0)::float8 as balance,
                 coalesce((select sum(days) from leave_applications where employee_id = ${employeeId} and leave_type_id = ${leaveTypeId} and status = 'pending'
                            ${exceptApplication ? sql`and id <> ${exceptApplication}` : sql``}), 0)::float8 as pending`,
    );
    return r2(b.balance - b.pending);
  }

  adjust(auth: AuthContext, input: z.infer<typeof adjustSchema>) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select({ id: leaveTypes.id }).from(leaveTypes).where(eq(leaveTypes.id, input.leaveTypeId));
      if (!t) throw new NotFoundException('Leave type not found');
      const [e] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, input.employeeId));
      if (!e) throw new NotFoundException('Employee not found');
      const [r] = await tx.insert(leaveLedger).values({ tenantId: auth.tenantId, employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, entryDate: input.entryDate ?? todayIST(), days: String(input.days), kind: input.kind, remarks: input.remarks, createdBy: auth.userId }).returning();
      return r;
    });
  }

  ledger(auth: AuthContext, employeeId: string, year: number) {
    return this.database.run(auth, async (tx) => {
      const perms = await permissionsOf(this.database, auth);
      const self = await selfEmployee(tx, auth);
      if (employeeId !== self?.id && !perms.has('hr.leave.read') && !(await isManagerOf(tx, auth, employeeId))) throw new ForbiddenException('You can only see your own or your team’s leave');
      return tx
        .select({ id: leaveLedger.id, entryDate: leaveLedger.entryDate, days: leaveLedger.days, kind: leaveLedger.kind, remarks: leaveLedger.remarks, typeCode: leaveTypes.code })
        .from(leaveLedger)
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveLedger.leaveTypeId))
        .where(and(eq(leaveLedger.employeeId, employeeId), gte(leaveLedger.entryDate, `${year}-01-01`), lte(leaveLedger.entryDate, `${year}-12-31`)))
        .orderBy(asc(leaveLedger.entryDate), asc(leaveLedger.createdAt));
    });
  }

  // ---- applications -----------------------------------------------------------------------

  applications(auth: AuthContext, q: { status?: string; employeeId?: string }) {
    return this.database.run(auth, async (tx) => {
      const perms = await permissionsOf(this.database, auth);
      const all = perms.has('hr.leave.read');
      return many(
        tx,
        sql`select a.id, a.from_date::text as "fromDate", a.to_date::text as "toDate", a.from_half as "fromHalf", a.to_half as "toHalf", a.days::float8 as days, a.reason, a.status,
                   a.decision_note as "decisionNote", a.created_at as "createdAt", t.code as "typeCode", t.name as "typeName",
                   e.id as "employeeId", e.code, e.full_name as "fullName", (e.user_id = ${auth.userId}) as "isOwn", coalesce(m.user_id = ${auth.userId}, false) as "isManager"
            from leave_applications a join leave_types t on t.id = a.leave_type_id join employees e on e.id = a.employee_id left join employees m on m.id = e.reports_to_id
            where true ${q.status ? sql`and a.status = ${q.status}` : sql``} ${q.employeeId ? sql`and a.employee_id = ${q.employeeId}` : sql``}
              ${all ? sql`` : sql`and (e.user_id = ${auth.userId} or m.user_id = ${auth.userId})`}
            order by a.from_date desc limit 500`,
      );
    });
  }

  apply(auth: AuthContext, input: z.infer<typeof applySchema>) {
    return this.database.run(auth, async (tx) => {
      const perms = await permissionsOf(this.database, auth);
      const who = await subjectOf(tx, auth, perms, 'hr.leave.manage', input.employeeId);
      const [t] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, input.leaveTypeId));
      if (!t || !t.isActive) throw new BadRequestException('Choose an active leave type');
      const [e] = await tx.select({ gender: employees.gender, doj: employees.dateOfJoining, status: employees.status }).from(employees).where(eq(employees.id, who.employeeId));
      if (e.status === 'exited') throw new BadRequestException('The employee has left');
      if (t.gender && t.gender !== e.gender) throw new BadRequestException(`${t.name} is only for ${t.gender} employees`);
      if (input.fromDate < e.doj) throw new BadRequestException('The leave starts before the date of joining');
      if ((input.fromHalf || input.toHalf) && !t.allowHalfDay) throw new BadRequestException(`${t.name} cannot be taken for half a day`);
      if (input.fromDate === input.toDate && input.fromHalf && input.toHalf) throw new BadRequestException('Pick either the first or the second half of the day');
      const clash = await many(
        tx,
        sql`select 1 from leave_applications where employee_id = ${who.employeeId} and status in ('pending', 'approved') and from_date <= ${input.toDate} and to_date >= ${input.fromDate} limit 1`,
      );
      if (clash.length) throw new ConflictException('There is already a leave application for some of these days');
      const off = await this.time.offDays(tx, who.employeeId, input.fromDate, input.toDate);
      const n = leaveDaysFor(input, (d) => off.has(d), t.countHolidays);
      if (!n) throw new BadRequestException('These days are all weekly offs or holidays');
      if (t.isPaid && !t.allowNegative) {
        const avail = await this.available(tx, who.employeeId, t.id);
        if (n > avail) throw new BadRequestException(`Only ${avail} day(s) of ${t.name} are available (after pending applications); this needs ${n}`);
      }
      const [a] = await tx
        .insert(leaveApplications)
        .values({ tenantId: auth.tenantId, employeeId: who.employeeId, leaveTypeId: t.id, fromDate: input.fromDate, toDate: input.toDate, fromHalf: input.fromHalf, toHalf: input.toHalf, days: String(n), reason: input.reason, appliedBy: auth.userId })
        .returning();
      return a;
    });
  }

  decide(auth: AuthContext, id: string, input: z.infer<typeof decideLeaveSchema>) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.select().from(leaveApplications).where(eq(leaveApplications.id, id)).for('update');
      if (!a) throw new NotFoundException('Leave application not found');
      if (a.status !== 'pending') throw new BadRequestException(`This application is already ${a.status}`);
      const perms = await permissionsOf(this.database, auth);
      const self = await selfEmployee(tx, auth);
      if (self?.id === a.employeeId) throw new ForbiddenException('You cannot decide your own leave');
      if (!perms.has('hr.leave.manage') && !(await isManagerOf(tx, auth, a.employeeId))) throw new ForbiddenException('Only HR or the reporting manager can decide this');
      if (input.approve) {
        const [t] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, a.leaveTypeId));
        if (t.isPaid && !t.allowNegative) {
          const avail = await this.available(tx, a.employeeId, a.leaveTypeId, a.id);
          if (Number(a.days) > avail) throw new BadRequestException(`Only ${avail} day(s) of ${t.name} are left`);
        }
        await tx.insert(leaveLedger).values({ tenantId: auth.tenantId, employeeId: a.employeeId, leaveTypeId: a.leaveTypeId, entryDate: a.fromDate, days: String(-Number(a.days)), kind: 'availed', refKey: `leave:${a.id}`, remarks: `${a.fromDate} to ${a.toDate}`, createdBy: auth.userId });
      }
      await tx.update(leaveApplications).set({ status: input.approve ? 'approved' : 'rejected', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: input.note ?? null }).where(eq(leaveApplications.id, id));
      if (input.approve) await this.reprocess(tx, auth.tenantId, a);
      return { status: input.approve ? 'approved' : 'rejected' };
    });
  }

  /** Withdraws an application; an approved one is credited back (HR only once it has started). */
  cancel(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.select().from(leaveApplications).where(eq(leaveApplications.id, id)).for('update');
      if (!a) throw new NotFoundException('Leave application not found');
      if (a.status !== 'pending' && a.status !== 'approved') throw new BadRequestException(`This application is already ${a.status}`);
      const perms = await permissionsOf(this.database, auth);
      const self = await selfEmployee(tx, auth);
      const hr = perms.has('hr.leave.manage');
      if (!hr && self?.id !== a.employeeId) throw new ForbiddenException('You can only cancel your own leave');
      if (a.status === 'approved' && !hr && a.fromDate <= todayIST()) throw new ForbiddenException('Leave that has started can only be cancelled by HR');
      const locked = await many(tx, sql`select 1 from attendance_days where employee_id = ${a.employeeId} and date between ${a.fromDate} and ${a.toDate} and is_locked limit 1`);
      if (a.status === 'approved' && locked.length) throw new BadRequestException('Payroll for some of these days is closed');
      await tx.update(leaveApplications).set({ status: 'cancelled' }).where(eq(leaveApplications.id, id));
      if (a.status === 'approved') {
        await tx.insert(leaveLedger).values({ tenantId: auth.tenantId, employeeId: a.employeeId, leaveTypeId: a.leaveTypeId, entryDate: a.fromDate, days: a.days, kind: 'reversal', refKey: `leave:${a.id}:rev`, remarks: 'Cancelled', createdBy: auth.userId });
        await this.reprocess(tx, auth.tenantId, a);
      }
      return { status: 'cancelled' };
    });
  }

  private async reprocess(tx: Transaction, tenantId: string, a: { employeeId: string; fromDate: string; toDate: string }) {
    const today = todayIST();
    if (a.fromDate <= today) await this.time.processRange(tx, tenantId, a.fromDate, a.toDate < today ? a.toDate : today, [a.employeeId]);
  }

  // ---- accrual and year end ---------------------------------------------------------------

  /**
   * Credits a month's leave; safe to run again. Monthly types earn a twelfth of the quota (joiners
   * after the 15th start next month); yearly types are credited in January, or pro rata in the
   * month someone joins; per-days-worked types (Factories Act s.79 earned leave) are topped up to
   * one day for every N days worked so far in the year.
   */
  accrue(auth: AuthContext, month: string) {
    return this.database.run(auth, async (tx) => {
      const year = Number(month.slice(0, 4));
      const mon = Number(month.slice(5, 7));
      const from = `${month}-01`;
      const endD = new Date(`${from}T00:00:00Z`);
      endD.setUTCMonth(endD.getUTCMonth() + 1, 0);
      const to = endD.toISOString().slice(0, 10);
      const types = (await tx.select().from(leaveTypes).where(eq(leaveTypes.isActive, true))).filter((t) => t.accrual !== 'none' && !t.isCompOff);
      const emps = await tx
        .select({ id: employees.id, doj: employees.dateOfJoining, gender: employees.gender, exitDate: employees.exitDate })
        .from(employees)
        .where(and(lte(employees.dateOfJoining, to), sql`(${employees.exitDate} is null or ${employees.exitDate} >= ${from})`));
      const worked = new Map<string, number>();
      if (types.some((t) => t.accrual === 'per_days_worked') && emps.length) {
        for (const r of await many<{ id: string; n: number }>(
          tx,
          sql`select employee_id as id, sum(case status when 'present' then 1 when 'half_day' then 0.5 else 0 end)::float8 as n
              from attendance_days where date between ${`${year}-01-01`} and ${to} group by employee_id`,
        ))
          worked.set(r.id, r.n);
      }
      const rows: (typeof leaveLedger.$inferInsert)[] = [];
      let replaced = 0;
      for (const t of types) {
        const quota = Number(t.annualQuota);
        for (const e of emps) {
          if (t.gender && t.gender !== e.gender) continue;
          const base = { tenantId: auth.tenantId, employeeId: e.id, leaveTypeId: t.id, kind: 'accrual', createdBy: auth.userId };
          if (t.accrual === 'monthly') {
            if (e.doj > `${month}-15` || !quota) continue;
            rows.push({ ...base, entryDate: to, days: String(r2(quota / 12)), refKey: `acc:${t.id}:${e.id}:${month}`, remarks: `Monthly credit ${month}` });
          } else if (t.accrual === 'yearly') {
            if (!quota) continue;
            const joinedThisMonth = e.doj >= from && e.doj <= to;
            if (mon === 1 && e.doj < from) rows.push({ ...base, entryDate: from, days: String(quota), refKey: `acc:${t.id}:${e.id}:${year}`, remarks: `Yearly credit ${year}` });
            else if (joinedThisMonth) {
              // Months left in the year, counting the joining month only if they joined by the 15th.
              const months = 12 - mon + (Number(e.doj.slice(8, 10)) <= 15 ? 1 : 0);
              const share = Math.floor(((quota * months) / 12) * 2) / 2;
              if (share > 0) rows.push({ ...base, entryDate: e.doj, days: String(share), refKey: `acc:${t.id}:${e.id}:${year}`, remarks: `Pro rata credit ${year} (${months} months)` });
            }
          } else if (t.accrual === 'per_days_worked') {
            const key = `acc:${t.id}:${e.id}:${month}`;
            replaced += (await tx.delete(leaveLedger).where(eq(leaveLedger.refKey, key)).returning({ id: leaveLedger.id })).length;
            const [c] = await many<{ n: number }>(
              tx,
              sql`select coalesce(sum(days), 0)::float8 as n from leave_ledger where employee_id = ${e.id} and leave_type_id = ${t.id} and kind = 'accrual' and entry_date between ${`${year}-01-01`} and ${`${year}-12-31`}`,
            );
            const entitled = Math.floor((worked.get(e.id) ?? 0) / t.daysWorkedPerLeave!);
            if (entitled > c.n) rows.push({ ...base, entryDate: to, days: String(entitled - c.n), refKey: key, remarks: `${worked.get(e.id)} days worked to ${to}` });
          }
        }
      }
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 500) inserted += (await tx.insert(leaveLedger).values(rows.slice(i, i + 500)).onConflictDoNothing().returning({ id: leaveLedger.id })).length;
      return { month, credited: inserted, alreadyCredited: rows.length - inserted, recomputed: replaced };
    });
  }

  /** Year end: keep up to the carry-forward limit, encash what the type allows, lapse the rest. */
  yearEnd(auth: AuthContext, year: number) {
    return this.database.run(auth, async (tx) => {
      const y1 = `${year}-12-31`;
      const bal = await many<{ employeeId: string; leaveTypeId: string; balance: number; cf: number; encashable: boolean; encashMax: number | null }>(
        tx,
        sql`select l.employee_id as "employeeId", l.leave_type_id as "leaveTypeId", sum(l.days)::float8 as balance, t.carry_forward_max::float8 as cf, t.encashable, t.encash_max::float8 as "encashMax"
            from leave_ledger l join leave_types t on t.id = l.leave_type_id
            where l.entry_date <= ${y1}
            group by l.employee_id, l.leave_type_id, t.carry_forward_max, t.encashable, t.encash_max
            having sum(l.days) > 0`,
      );
      const rows: (typeof leaveLedger.$inferInsert)[] = [];
      let encashed = 0;
      let lapsed = 0;
      for (const b of bal) {
        const carry = Math.min(b.balance, b.cf);
        const encash = b.encashable ? Math.min(b.balance - carry, b.encashMax ?? Infinity) : 0;
        const lapse = r2(b.balance - carry - encash);
        const base = { tenantId: auth.tenantId, employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, entryDate: y1, createdBy: auth.userId };
        if (encash > 0) rows.push({ ...base, days: String(-r2(encash)), kind: 'encashment', refKey: `ye:${b.leaveTypeId}:${b.employeeId}:${year}:enc`, remarks: `Encashed at year end ${year}` });
        if (lapse > 0) rows.push({ ...base, days: String(-lapse), kind: 'lapse', refKey: `ye:${b.leaveTypeId}:${b.employeeId}:${year}:lapse`, remarks: `Lapsed at year end ${year}` });
      }
      for (let i = 0; i < rows.length; i += 500) {
        for (const r of await tx.insert(leaveLedger).values(rows.slice(i, i + 500)).onConflictDoNothing().returning({ days: leaveLedger.days, kind: leaveLedger.kind })) {
          if (r.kind === 'encashment') encashed -= Number(r.days);
          else lapsed -= Number(r.days);
        }
      }
      return { year, balances: bal.length, encashedDays: r2(encashed), lapsedDays: r2(lapsed) };
    });
  }

  /** Approved and pending leave in a range, for the team calendar. */
  calendar(auth: AuthContext, from: string, to: string) {
    return this.database.run(auth, async (tx) => {
      const perms = await permissionsOf(this.database, auth);
      const all = perms.has('hr.leave.read');
      const self = await selfEmployee(tx, auth);
      if (!all && !self) throw new ForbiddenException('Your login is not linked to an employee record');
      const scope = all ? undefined : sql`(e.id = ${self!.id} or e.reports_to_id = ${self!.id} or e.reports_to_id = ${self!.reportsToId ?? self!.id})`;
      return many(
        tx,
        sql`select a.id, a.from_date::text as "fromDate", a.to_date::text as "toDate", a.status, a.days::float8 as days, t.code as "typeCode", e.id as "employeeId", e.full_name as "fullName"
            from leave_applications a join leave_types t on t.id = a.leave_type_id join employees e on e.id = a.employee_id
            where a.status in ('pending', 'approved') and a.from_date <= ${to} and a.to_date >= ${from} ${scope ? sql`and ${scope}` : sql``}
            order by a.from_date`,
      );
    });
  }
}
