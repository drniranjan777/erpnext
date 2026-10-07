import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { companies, employeeEvents, employees, hrChecklists, hrSeparations, hrTasks, leaveLedger, payrollSettings, type Transaction } from '@nextgen/database';
import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth-context';
import { todayIST } from '../../../common/fiscal-year';
import type { RequestMeta } from '../../../common/request-meta';
import { DatabaseService } from '../../../database/database.service';
import type { SystemKey } from '../../accounting/chart-template';
import { JournalsService } from '../../accounting/journals.service';
import { LedgerService } from '../../accounting/ledger.service';
import { AuditService } from '../../audit/audit.service';
import { DocumentsService } from '../../documents/documents.service';
import { addDays, daysBetween } from '../time/attendance-engine';
import { permissionsOf, selfEmployee } from '../time/people';
import { fullAndFinal, type SeparationKind } from './settlement';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;

export const checklistSchema = z.object({
  kind: z.enum(['onboarding', 'exit']),
  name: z.string().trim().min(2).max(80),
  items: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(160),
        owner: z.string().trim().min(2).max(40),
        days: z.number().int().min(-90).max(180).default(0),
      }),
    )
    .min(1)
    .max(60),
  isDefault: z.boolean().default(true),
});
export const taskSchema = z.object({
  status: z.enum(['pending', 'done', 'not_needed']),
  remarks: z.string().trim().max(500).nullable().optional(),
  recovery: z.number().min(0).max(1e8).nullable().optional(),
});
export const separationSchema = z.object({
  employeeId: z.uuid().optional(),
  kind: z.enum(['resignation', 'termination', 'retirement', 'death', 'absconding']).default('resignation'),
  noticeDate: z.iso.date().optional(),
  lastWorkingDay: z.iso.date(),
  reason: z.string().trim().min(3).max(1000),
});
export const acceptSeparationSchema = z.object({
  lastWorkingDay: z.iso.date().optional(),
  waiveShortfall: z.boolean().default(false),
});

/**
 * Onboarding and exit checklists, separations (resignation, termination, retirement...) with
 * notice shortfall, exit clearance, and the full and final settlement posted to the books.
 */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ledger: LedgerService,
    private readonly journals: JournalsService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  // ---- checklists and tasks ---------------------------------------------------------------

  checklists(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(hrChecklists).orderBy(asc(hrChecklists.kind), asc(hrChecklists.name)));
  }

  saveChecklist(auth: AuthContext, id: string | null, input: z.infer<typeof checklistSchema>) {
    return this.database.run(auth, async (tx) => {
      if (input.isDefault)
        await tx
          .update(hrChecklists)
          .set({ isDefault: false })
          .where(and(eq(hrChecklists.kind, input.kind), id ? ne(hrChecklists.id, id) : undefined));
      if (id) {
        const [r] = await tx.update(hrChecklists).set(input).where(eq(hrChecklists.id, id)).returning();
        if (!r) throw new NotFoundException('Checklist not found');
        return r;
      }
      return (
        await tx
          .insert(hrChecklists)
          .values({ tenantId: auth.tenantId, ...input })
          .returning()
      )[0];
    });
  }

  tasks(auth: AuthContext, q: { kind?: string; employeeId?: string; status?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select t.id, t.employee_id as "employeeId", t.kind, t.separation_id as "separationId", t.title, t.owner, t.due_date::text as "dueDate", t.status, t.remarks, t.recovery, t.done_at as "doneAt", e.code, e.full_name as "fullName" from hr_tasks t join employees e on e.id = t.employee_id
            where true ${q.kind ? sql`and t.kind = ${q.kind}` : sql``} ${q.employeeId ? sql`and t.employee_id = ${q.employeeId}` : sql``} ${q.status ? sql`and t.status = ${q.status}` : sql``}
            order by t.due_date nulls last, e.code limit 1000`,
      ),
    );
  }

  updateTask(auth: AuthContext, id: string, input: z.infer<typeof taskSchema>) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(hrTasks).where(eq(hrTasks.id, id));
      if (!t) throw new NotFoundException('Task not found');
      if (t.separationId) {
        const [s] = await tx.select({ status: hrSeparations.status }).from(hrSeparations).where(eq(hrSeparations.id, t.separationId));
        if (s?.status === 'settled') throw new ConflictException('The settlement is already posted');
      }
      const done = input.status !== 'pending';
      return (
        await tx
          .update(hrTasks)
          .set({
            status: input.status,
            remarks: input.remarks ?? t.remarks,
            recovery: input.recovery === undefined ? t.recovery : input.recovery === null ? null : input.recovery.toFixed(2),
            doneBy: done ? auth.userId : null,
            doneAt: done ? new Date() : null,
          })
          .where(eq(hrTasks.id, id))
          .returning()
      )[0];
    });
  }

  // ---- separations ------------------------------------------------------------------------

  separations(auth: AuthContext, status?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, s.kind, s.notice_date::text as "noticeDate", s.last_working_day::text as "lastWorkingDay", s.reason, s.status, s.notice_shortfall_days as "noticeShortfallDays",
                   s.waive_shortfall as "waiveShortfall", s.settlement, s.journal_id as "journalId", e.id as "employeeId", e.code, e.full_name as "fullName", d.name as department,
                   (select count(*)::int from hr_tasks t where t.separation_id = s.id and t.status = 'pending') as "pendingTasks"
            from hr_separations s join employees e on e.id = s.employee_id left join hr_departments d on d.id = e.department_id
            where true ${status ? sql`and s.status = ${status}` : sql``} order by s.created_at desc limit 500`,
      ),
    );
  }

  mine(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const self = await selfEmployee(tx, auth);
      if (!self) throw new ForbiddenException('Your login is not linked to an employee record');
      return tx.select().from(hrSeparations).where(eq(hrSeparations.employeeId, self.id)).orderBy(asc(hrSeparations.createdAt));
    });
  }

  /** A resignation by the employee (hr.self.use), or any separation recorded by HR. */
  create(auth: AuthContext, input: z.infer<typeof separationSchema>) {
    return this.database.run(auth, async (tx) => {
      const perms = await permissionsOf(this.database, auth);
      const self = await selfEmployee(tx, auth);
      const hr = perms.has('hr.exit.manage');
      const employeeId = input.employeeId ?? self?.id;
      if (!employeeId) throw new ForbiddenException('Your login is not linked to an employee record');
      if (employeeId === self?.id && !hr) {
        if (!perms.has('hr.self.use')) throw new ForbiddenException('You do not have self-service access');
        if (input.kind !== 'resignation') throw new ForbiddenException('You can only resign');
      } else if (!hr) throw new ForbiddenException('Missing permission: hr.exit.manage');
      const [e] = await tx.select().from(employees).where(eq(employees.id, employeeId));
      if (!e) throw new NotFoundException('Employee not found');
      if (e.status === 'exited') throw new ConflictException('The employee has already left');
      const noticeDate = input.noticeDate ?? todayIST();
      if (input.lastWorkingDay < noticeDate) throw new BadRequestException('The last working day is before the notice date');
      const [open] = await tx
        .select({ id: hrSeparations.id })
        .from(hrSeparations)
        .where(and(eq(hrSeparations.employeeId, employeeId), sql`${hrSeparations.status} in ('requested', 'accepted')`));
      if (open) throw new ConflictException('There is already an open separation for this employee');
      return (
        await tx
          .insert(hrSeparations)
          .values({
            tenantId: auth.tenantId,
            employeeId,
            kind: input.kind,
            noticeDate,
            lastWorkingDay: input.lastWorkingDay,
            reason: input.reason,
            noticeShortfallDays: shortfall(e.noticeDays, noticeDate, input.lastWorkingDay, input.kind),
            requestedBy: auth.userId,
          })
          .returning()
      )[0];
    });
  }

  /** HR accepts: fixes the last working day, puts the employee on notice and raises the exit checklist. */
  accept(auth: AuthContext, id: string, input: z.infer<typeof acceptSeparationSchema>) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select().from(hrSeparations).where(eq(hrSeparations.id, id)).for('update');
      if (!s) throw new NotFoundException('Separation not found');
      if (s.status !== 'requested') throw new ConflictException(`This separation is already ${s.status}`);
      const [e] = await tx.select().from(employees).where(eq(employees.id, s.employeeId)).for('update');
      const lwd = input.lastWorkingDay ?? s.lastWorkingDay;
      if (lwd < s.noticeDate) throw new BadRequestException('The last working day is before the notice date');
      await tx
        .update(hrSeparations)
        .set({
          lastWorkingDay: lwd,
          waiveShortfall: input.waiveShortfall,
          noticeShortfallDays: shortfall(e.noticeDays, s.noticeDate, lwd, s.kind as SeparationKind),
          status: 'accepted',
          acceptedBy: auth.userId,
          version: s.version + 1,
        })
        .where(eq(hrSeparations.id, id));
      await tx
        .update(employees)
        .set({
          status: 'notice',
          exitDate: lwd,
          exitReason: `${s.kind}: ${s.reason}`.slice(0, 500),
          version: e.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, e.id));
      await tx.insert(employeeEvents).values({
        tenantId: auth.tenantId,
        employeeId: e.id,
        kind: 'exit',
        effectiveDate: lwd,
        from: { status: e.status },
        to: { status: 'notice' },
        remarks: `${s.kind} accepted`,
        recordedBy: auth.userId,
      });
      const [cl] = await tx
        .select()
        .from(hrChecklists)
        .where(and(eq(hrChecklists.kind, 'exit'), eq(hrChecklists.isDefault, true)))
        .limit(1);
      if (cl?.items.length)
        await tx.insert(hrTasks).values(
          cl.items.map((i) => ({
            tenantId: auth.tenantId,
            employeeId: e.id,
            kind: 'exit',
            separationId: id,
            title: i.title,
            owner: i.owner,
            dueDate: addDays(lwd, -i.days),
          })),
        );
      return {
        status: 'accepted',
        lastWorkingDay: lwd,
        exitTasks: cl?.items.length ?? 0,
      };
    });
  }

  withdraw(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select().from(hrSeparations).where(eq(hrSeparations.id, id)).for('update');
      if (!s) throw new NotFoundException('Separation not found');
      if (!['requested', 'accepted'].includes(s.status)) throw new ConflictException(`This separation is ${s.status}`);
      const perms = await permissionsOf(this.database, auth);
      const self = await selfEmployee(tx, auth);
      if (!perms.has('hr.exit.manage') && !(self?.id === s.employeeId && s.status === 'requested')) throw new ForbiddenException('Only HR can withdraw an accepted separation');
      await tx.update(hrSeparations).set({ status: 'withdrawn' }).where(eq(hrSeparations.id, id));
      if (s.status === 'accepted') {
        await tx
          .update(employees)
          .set({
            status: 'active',
            exitDate: null,
            exitReason: null,
            updatedAt: new Date(),
          })
          .where(eq(employees.id, s.employeeId));
        await tx.delete(hrTasks).where(and(eq(hrTasks.separationId, id), eq(hrTasks.status, 'pending')));
      }
      return { status: 'withdrawn' };
    });
  }

  // ---- full and final ---------------------------------------------------------------------

  settlement(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.compute(tx, id));
  }

  private async compute(tx: Transaction, id: string) {
    const [s] = await tx.select().from(hrSeparations).where(eq(hrSeparations.id, id));
    if (!s) throw new NotFoundException('Separation not found');
    if (s.status === 'settled' && s.settlement)
      return {
        separation: s,
        ...s.settlement,
        checks: [] as string[],
        leave: [] as { leaveTypeId: string; days: number }[],
        loans: [] as { id: string }[],
      };
    const [e] = await tx.select().from(employees).where(eq(employees.id, s.employeeId));
    const [sal] = await many<{ lines: { code: string; monthly: string }[] }>(tx, sql`select lines from employee_salaries where employee_id = ${e.id} and effective_from <= ${s.lastWorkingDay} order by effective_from desc limit 1`);
    const pfCodes = new Set((await many<{ code: string }>(tx, sql`select code::text as code from salary_components where is_pf_wage`)).map((r) => r.code));
    if (!pfCodes.size) ['BASIC', 'DA'].forEach((c) => pfCodes.add(c));
    const lines = sal?.lines ?? [];
    const basicDa = lines.filter((l) => pfCodes.has(l.code)).reduce((t, l) => t + Number(l.monthly), 0);
    const gross = lines.reduce((t, l) => t + Number(l.monthly), 0);
    const leave = await many<{ leaveTypeId: string; days: number }>(
      tx,
      sql`select l.leave_type_id as "leaveTypeId", sum(l.days)::float8 as days from leave_ledger l join leave_types t on t.id = l.leave_type_id
          where l.employee_id = ${e.id} and t.encashable group by l.leave_type_id having sum(l.days) > 0`,
    );
    const loans = await many<{ id: string; outstanding: number }>(tx, sql`select id, (principal - recovered)::float8 as outstanding from employee_loans where employee_id = ${e.id} and status = 'active' and principal > recovered`);
    const [{ recoveries, pending }] = await many<{
      recoveries: number;
      pending: number;
    }>(tx, sql`select coalesce(sum(recovery), 0)::float8 as recoveries, count(*) filter (where status = 'pending')::int as pending from hr_tasks where separation_id = ${id}`);
    const ff = fullAndFinal({
      kind: s.kind as SeparationKind,
      basicDa,
      monthlyGross: gross,
      dateOfJoining: e.dateOfJoining,
      lastWorkingDay: s.lastWorkingDay,
      leaveDays: leave.reduce((t, l) => t + l.days, 0),
      noticeShortfallDays: s.noticeShortfallDays,
      waiveShortfall: s.waiveShortfall,
      loanOutstanding: loans.reduce((t, l) => t + l.outstanding, 0),
      recoveries,
    });
    const checks: string[] = [];
    if (s.status !== 'accepted') checks.push('The separation must be accepted');
    if (s.lastWorkingDay > todayIST()) checks.push('The last working day has not passed yet');
    if (pending) checks.push(`${pending} exit clearance task(s) still pending`);
    if (!sal) checks.push('No salary on record: leave encashment and gratuity are nil');
    const [{ reports }] = await many<{ reports: number }>(tx, sql`select count(*)::int as reports from employees where reports_to_id = ${e.id} and status <> 'exited'`);
    if (reports) checks.push(`${reports} people still report to this employee: move them first`);
    const [run] = await many<{ status: string }>(tx, sql`select status from payroll_runs where month = ${s.lastWorkingDay.slice(0, 7)}`);
    const finalMonth = run && run.status !== 'draft' ? null : `Salary for ${s.lastWorkingDay.slice(0, 7)} comes with that month's payroll, not in this settlement`;
    return { separation: s, ...ff, checks, note: finalMonth, leave, loans };
  }

  settle(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [lock] = await tx.select().from(hrSeparations).where(eq(hrSeparations.id, id)).for('update');
      if (!lock) throw new NotFoundException('Separation not found');
      if (lock.status === 'settled') throw new ConflictException('Already settled');
      const c = await this.compute(tx, id);
      if (c.checks.length) throw new BadRequestException(c.checks.join('; '));
      const amt = (ls: { code: string; amount: string }[], code: string) => ls.filter((l) => l.code === code).reduce((t, l) => t + Number(l.amount), 0);
      const net = Number(c.net);
      const narration = `Full and final settlement`;
      type GlRow = {
        account: SystemKey;
        debit?: number;
        credit?: number;
        narration: string;
      };
      const gl = (
        [
          {
            account: 'gratuity_expense',
            debit: amt(c.earnings, 'LEAVE_ENC') + amt(c.earnings, 'GRATUITY'),
            narration: 'Leave encashment and gratuity',
          },
          {
            account: 'payroll_salaries',
            debit: amt(c.earnings, 'NOTICE_PAY'),
            narration: 'Pay in lieu of notice',
          },
          {
            account: 'payroll_salaries',
            credit: amt(c.deductions, 'NOTICE_REC') + amt(c.deductions, 'CLEARANCE'),
            narration: 'Notice and clearance recoveries',
          },
          {
            account: 'employee_loans',
            credit: amt(c.deductions, 'LOAN'),
            narration: 'Loans recovered',
          },
          net >= 0
            ? {
                account: 'salary_payable',
                credit: net,
                narration: 'Settlement payable',
              }
            : {
                account: 'employee_loans',
                debit: -net,
                narration: 'Due from the employee',
              },
        ] as GlRow[]
      ).filter((l) => Math.round(((l.debit ?? 0) + (l.credit ?? 0)) * 100) !== 0);
      let journalId: string | null = null;
      if (gl.length) {
        const [ps] = await tx.select({ companyId: payrollSettings.companyId }).from(payrollSettings);
        const companyId = ps?.companyId ?? (await tx.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1))[0]?.id;
        if (!companyId) throw new BadRequestException('Add a company to post the settlement to');
        await this.ledger.ensureBooks(tx, auth.tenantId, companyId, auth.userId);
        const accs = await this.ledger.resolveAccounts(
          tx,
          companyId,
          gl.map((l) => ({ account: l.account })),
        );
        const [e] = await tx.select({ code: employees.code, fullName: employees.fullName }).from(employees).where(eq(employees.id, lock.employeeId));
        const jv = await this.journals.createTx(
          tx,
          auth,
          {
            companyId,
            docDate: todayIST(),
            kind: 'journal',
            narration: `${narration}: ${e.code} ${e.fullName}`,
            lines: gl.map((l, i) => ({
              accountId: accs[i].id,
              debit: l.debit ? l.debit.toFixed(2) : null,
              credit: l.credit ? l.credit.toFixed(2) : null,
              narration: l.narration,
              partyId: null,
              costCenterId: null,
              againstVoucherId: null,
            })),
          },
          meta,
        );
        await this.documents.submit(tx, auth, await this.documents.find(tx, jv.id, 'journal_entry'), meta);
        journalId = jv.id;
      }
      for (const l of c.leave)
        await tx
          .insert(leaveLedger)
          .values({
            tenantId: auth.tenantId,
            employeeId: lock.employeeId,
            leaveTypeId: l.leaveTypeId,
            entryDate: lock.lastWorkingDay,
            days: String(-l.days),
            kind: 'encashment',
            refKey: `fnf:${id}:${l.leaveTypeId}`,
            remarks: 'Encashed in full and final settlement',
            createdBy: auth.userId,
          })
          .onConflictDoNothing();
      for (const l of c.loans) await tx.execute(sql`update employee_loans set recovered = principal, status = 'closed' where id = ${l.id}`);
      await tx
        .update(employees)
        .set({
          status: 'exited',
          exitDate: lock.lastWorkingDay,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, lock.employeeId));
      const settlement = {
        earnings: c.earnings,
        deductions: c.deductions,
        net: c.net,
      };
      await tx
        .update(hrSeparations)
        .set({
          status: 'settled',
          settlement,
          journalId,
          settledAt: new Date(),
        })
        .where(eq(hrSeparations.id, id));
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'hr.separation.settled',
        entityType: 'employee',
        entityId: lock.employeeId,
        metadata: { net: c.net },
        ...meta,
      });
      return { status: 'settled', journalId, ...settlement };
    });
  }
}

/** Notice days not served: a resignation short of the notice period, or a termination without it. */
function shortfall(noticeDays: number, noticeDate: string, lwd: string, kind: SeparationKind) {
  if (kind !== 'resignation' && kind !== 'termination' && kind !== 'absconding') return 0;
  return Math.max(0, noticeDays - daysBetween(noticeDate, lwd));
}
