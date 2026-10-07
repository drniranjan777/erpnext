import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { companies, employees, payrollRuns, payslips, salaryComponents, type PayLine, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import type { SystemKey } from '../accounting/chart-template';
import { JournalsService } from '../accounting/journals.service';
import { LedgerService } from '../accounting/ledger.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { addDays, at, daysBetween } from '../hr/time/attendance-engine';
import { permissionsOf } from '../hr/time/people';
import { TimeService } from '../hr/time/time.service';
import { PayrollSetupService } from './setup.service';
import { esi, ESI_CEILING, esiPeriod, fiscalPosition, labourWelfareFund, monthlyTds, professionalTax, providentFund, type Declaration, type Regime } from './statutory';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const r0 = (n: number) => Math.round(n);
const money = (n: number) => n.toFixed(2);
const monthRange = (month: string) => {
  const from = `${month}-01`;
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return { from, to: d.toISOString().slice(0, 10) };
};
const sumLines = (ls: PayLine[], pred: (l: PayLine) => boolean = () => true) => ls.filter(pred).reduce((s, l) => s + Number(l.amount), 0);
const OTHER_DEDUCTION = (l: PayLine) => !['PF', 'ESI', 'PT', 'LWF', 'TDS', 'LOAN'].includes(l.code);

interface EmpRow {
  id: string;
  code: string;
  fullName: string;
  userId: string | null;
  gender: string | null;
  dob: string | null;
  regime: Regime;
  pf: boolean;
  esi: boolean;
  pt: boolean;
  lwf: boolean;
  doj: string;
  exitDate: string | null;
  stateCode: string | null;
  salary: { code: string; monthly: string }[] | null;
  [k: string]: unknown;
}

/**
 * Monthly payroll: compute a draft from salaries, the attendance muster, overtime, piece rate,
 * one-off inputs, loans and the statutory rules; approve it (locks attendance, recovers loans,
 * posts the salary journal) or reopen it; then the bank file, PF ECR and payslips.
 */
@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly setup: PayrollSetupService,
    private readonly time: TimeService,
    private readonly ledger: LedgerService,
    private readonly journals: JournalsService,
    private readonly documents: DocumentsService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  runs(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(payrollRuns).orderBy(desc(payrollRuns.month)));
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.view(tx, id));
  }

  private async view(tx: Transaction, id: string) {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, id));
    if (!run) throw new NotFoundException('Payroll run not found');
    const slips = await many<Record<string, unknown> & { stateCode: string | null; deductions: PayLine[]; employer: PayLine[]; uan: string | null; pfWages: string; epsWages: string; esiWages: string }>(
      tx,
      sql`select p.id, p.employee_id as "employeeId", e.code, e.full_name as "fullName", d.name as department, e.uan, p.month_days as "monthDays", p.payable_days as "payableDays", p.lop_days as "lopDays",
                 p.ot_hours as "otHours", p.gross, p.total_deductions as "totalDeductions", p.net, p.tds, p.pf_wages as "pfWages", p.eps_wages as "epsWages", p.esi_wages as "esiWages",
                 p.state_code as "stateCode", p.earnings, p.deductions, p.employer, p.warnings
          from payslips p join employees e on e.id = p.employee_id left join hr_departments d on d.id = e.department_id
          where p.run_id = ${id} order by e.code`,
    );
    const amt = (ls: PayLine[], code: string) => sumLines(ls, (l) => l.code === code);
    const pfRows = slips.filter((s) => amt(s.deductions, 'PF') > 0);
    const byState = (code: 'PT' | 'LWF') => {
      const m = new Map<string, { stateCode: string; employees: number; employee: number; employer: number }>();
      for (const s of slips) {
        const ee = amt(s.deductions, code);
        if (!ee) continue;
        const k = s.stateCode ?? '—';
        const cur = m.get(k) ?? { stateCode: k, employees: 0, employee: 0, employer: 0 };
        cur.employees++;
        cur.employee += ee;
        cur.employer += code === 'LWF' ? amt(s.employer, 'LWF_ER') : 0;
        m.set(k, cur);
      }
      return [...m.values()];
    };
    return {
      ...run,
      payslips: slips,
      statutory: {
        pf: {
          employees: pfRows.length,
          epfWages: pfRows.reduce((s, r) => s + Number(r.pfWages), 0),
          employee: pfRows.reduce((s, r) => s + amt(r.deductions, 'PF'), 0),
          eps: pfRows.reduce((s, r) => s + amt(r.employer, 'EPS'), 0),
          employerEpf: pfRows.reduce((s, r) => s + amt(r.employer, 'EPF_ER'), 0),
          edli: pfRows.reduce((s, r) => s + amt(r.employer, 'EDLI'), 0),
          missingUan: pfRows.filter((r) => !r.uan).map((r) => `${r.code} ${r.fullName}`),
        },
        esi: { employees: slips.filter((s) => Number(s.esiWages) > 0).length, wages: slips.reduce((s, r) => s + Number(r.esiWages), 0), employee: slips.reduce((s, r) => s + amt(r.deductions, 'ESI'), 0), employer: slips.reduce((s, r) => s + amt(r.employer, 'ESI_ER'), 0) },
        pt: byState('PT'),
        lwf: byState('LWF'),
        tds: slips.reduce((s, r) => s + Number(r.tds), 0),
      },
    };
  }

  // ---- compute ----------------------------------------------------------------------------

  compute(auth: AuthContext, month: string) {
    if (month > todayIST().slice(0, 7)) throw new BadRequestException('Payroll cannot be run for a future month');
    return this.database.run(auth, async (tx) => {
      const settings = await this.setup.ensureDefaults(tx, auth.tenantId);
      let [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.month, month)).for('update');
      if (run && run.status !== 'draft') throw new ConflictException(`Payroll for ${month} is ${run.status}; reopen it to recompute`);
      const companyId = settings.companyId ?? (await tx.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1))[0]?.id ?? null;
      if (!run) run = (await tx.insert(payrollRuns).values({ tenantId: auth.tenantId, month, companyId }).returning())[0];

      const { from, to } = monthRange(month);
      const monthDays = daysBetween(from, to) + 1;
      const comps = new Map((await tx.select().from(salaryComponents)).map((c) => [String(c.code), c]));
      const comp = (code: string) => comps.get(code);
      const emps = await many<EmpRow>(
        tx,
        sql`select e.id, e.code, e.full_name as "fullName", e.user_id as "userId", e.gender, e.date_of_birth::text as dob, e.tax_regime as regime,
                   e.pf_applicable as pf, e.esi_applicable as esi, e.pt_applicable as pt, e.lwf_applicable as lwf,
                   e.date_of_joining::text as doj, e.exit_date::text as "exitDate", l.state_code as "stateCode", s.lines as salary
            from employees e left join hr_locations l on l.id = e.location_id
            left join lateral (select lines from employee_salaries x where x.employee_id = e.id and x.effective_from <= ${to} order by x.effective_from desc limit 1) s on true
            where e.date_of_joining <= ${to} and (e.exit_date is null or e.exit_date >= ${from})
            order by e.code`,
      );
      const att = new Map((await this.time.monthSummary(tx, { month })).rows.map((r) => [r.employeeId, r.summary]));
      const inputs = await many<{ employeeId: string; code: string; amount: string }>(tx, sql`select employee_id as "employeeId", code::text as code, amount from payroll_inputs where month = ${month}`);
      const loans = await many<{ id: string; employeeId: string; kind: string; emi: string; outstanding: string }>(
        tx,
        sql`select id, employee_id as "employeeId", kind, emi, (principal - recovered) as outstanding from employee_loans where status = 'active' and start_month <= ${month} and principal > recovered`,
      );
      const piece = new Map(
        (
          await many<{ employeeId: string; amount: number; qty: number }>(
            tx,
            sql`select e.id as "employeeId", sum(jc.good_qty * pr.rate)::float8 as amount, sum(jc.good_qty)::float8 as qty
                from job_cards jc join employees e on e.user_id = jc.operator_id join work_order_operations o on o.id = jc.operation_id
                join lateral (select rate_per_unit as rate from payroll_piece_rates r where r.work_center_id = o.work_center_id and r.effective_from <= (jc.ended_at at time zone 'Asia/Kolkata')::date order by r.effective_from desc limit 1) pr on true
                where jc.status = 'done' and jc.ended_at >= ${at(from, '00:00')} and jc.ended_at < ${at(addDays(to, 1), '00:00')}
                group by e.id`,
          )
        ).map((r) => [r.employeeId, r]),
      );
      const fy = fiscalPosition(month);
      const prior = new Map(
        (
          await many<{ id: string; taxable: number; tds: number }>(
            tx,
            sql`select p.employee_id as id, sum(p.taxable_gross)::float8 as taxable, sum(p.tds)::float8 as tds from payslips p where p.month >= ${fy.fyStart} and p.month < ${month} group by 1`,
          )
        ).map((r) => [r.id, r]),
      );
      const esiCovered = new Set((await many<{ id: string }>(tx, sql`select distinct employee_id as id from payslips where month >= ${esiPeriod(month)} and month < ${month} and esi_wages > 0`)).map((r) => r.id));
      const decls = new Map((await many<{ id: string; data: Declaration }>(tx, sql`select employee_id as id, data from tax_declarations where fy = ${fy.fy}`)).map((r) => [r.id, r.data]));

      const runWarnings: string[] = [];
      const rows: (typeof payslips.$inferInsert)[] = [];
      for (const e of emps) {
        if (!e.salary?.length) {
          runWarnings.push(`${e.code} ${e.fullName}: no salary set, left out`);
          continue;
        }
        const warnings: string[] = [];
        const a = att.get(e.id);
        const start = e.doj > from ? e.doj : from;
        const end = e.exitDate && e.exitDate < to ? e.exitDate : to;
        const employable = daysBetween(start, end) + 1;
        let payable: number;
        let lop = 0;
        let otHours = 0;
        if (!a || a.processedDays === 0) {
          payable = employable;
          warnings.push('No attendance processed: paid for every day employed');
        } else {
          payable = a.payableDays;
          lop = a.lopDays;
          otHours = a.otHours;
          if (a.processedDays < a.employableDays) warnings.push(`${a.employableDays - a.processedDays} day(s) of attendance not processed are unpaid`);
          if (a.missedPunches) warnings.push(`${a.missedPunches} missed punch(es) unpaid`);
        }
        const factor = payable / monthDays;
        const earnings: PayLine[] = [];
        const add = (list: PayLine[], code: string, amount: number, name?: string, ref?: string) => {
          if (amount) list.push({ code, name: name ?? comp(code)?.name ?? code, amount: money(r0(amount)), ...(ref ? { ref } : {}) });
        };
        for (const l of e.salary) add(earnings, l.code, comp(l.code)?.prorate === false ? Number(l.monthly) : Number(l.monthly) * factor);
        const basicDa = e.salary.filter((l) => comp(l.code)?.isPfWage).reduce((s, l) => s + Number(l.monthly), 0);
        if (otHours > 0) add(earnings, 'OT', otHours * Number(settings.otMultiplier) * (basicDa / (settings.otDivisorDays * settings.otHoursPerDay)), `Overtime (${otHours} h)`);
        const pc = piece.get(e.id);
        if (pc?.amount) add(earnings, 'PIECE', pc.amount, `Piece rate (${pc.qty} units)`);
        const deductions: PayLine[] = [];
        for (const i of inputs.filter((x) => x.employeeId === e.id)) {
          const c = comp(i.code);
          add(c?.kind === 'deduction' ? deductions : earnings, i.code, Number(i.amount));
        }
        // Merge repeated one-off lines of the same code.
        const merge = (ls: PayLine[]) => {
          const m = new Map<string, PayLine>();
          for (const l of ls) {
            const k = l.ref ? `${l.code}:${l.ref}` : l.code;
            const cur = m.get(k);
            m.set(k, cur ? { ...cur, amount: money(Number(cur.amount) + Number(l.amount)) } : l);
          }
          return [...m.values()].sort((x, y) => (comp(x.code)?.sequence ?? 500) - (comp(y.code)?.sequence ?? 500));
        };
        const earn = merge(earnings);
        const gross = sumLines(earn);
        const pfWages = sumLines(earn, (l) => !!comp(l.code)?.isPfWage);
        const esiWages = sumLines(earn, (l) => comp(l.code)?.isEsiWage !== false);
        const fixedEsi = e.salary.filter((l) => comp(l.code)?.isEsiWage !== false).reduce((s, l) => s + Number(l.monthly), 0);
        const employer: PayLine[] = [];
        const ded: PayLine[] = [];
        let epsWages = 0;
        if (e.pf) {
          // EPS stops at 58.
          const age58 = e.dob ? `${Number(e.dob.slice(0, 4)) + 58}${e.dob.slice(4)}` <= to : false;
          const p = providentFund(pfWages, { restrictToCeiling: settings.pfRestrictToCeiling, epsEligible: !age58 });
          epsWages = p.epsWages;
          add(ded, 'PF', p.employee, 'Provident fund');
          add(employer, 'EPF_ER', p.employerEpf, 'PF (employer)');
          add(employer, 'EPS', p.employerEps, 'Pension scheme (employer)');
          add(employer, 'EDLI', p.edli, 'EDLI (employer)');
        }
        const covered = e.esi && (fixedEsi <= ESI_CEILING || esiCovered.has(e.id));
        if (covered) {
          const s = esi(esiWages, true);
          add(ded, 'ESI', s.employee, 'ESI');
          add(employer, 'ESI_ER', s.employer, 'ESI (employer)');
        }
        let pt = 0;
        if (e.pt) {
          if (!e.stateCode) warnings.push('No work location: professional tax not deducted');
          pt = professionalTax(e.stateCode ?? '', gross, month, e.gender);
          add(ded, 'PT', pt, 'Professional tax');
        }
        if (e.lwf && e.stateCode) {
          const l = labourWelfareFund(e.stateCode, month);
          add(ded, 'LWF', l.employee, 'Labour welfare fund');
          add(employer, 'LWF_ER', l.employer, 'Labour welfare fund (employer)');
        }
        const taxable = sumLines(earn, (l) => comp(l.code)?.isTaxable !== false);
        const regular = e.salary.filter((l) => comp(l.code)?.isTaxable !== false).reduce((s, l) => s + Number(l.monthly), 0);
        const pr = prior.get(e.id);
        const leaving = !!e.exitDate && e.exitDate <= to;
        const t = monthlyTds({ regime: e.regime === 'old' ? 'old' : 'new', paidSoFar: pr?.taxable ?? 0, thisMonth: taxable, regularMonthly: regular, monthsAfter: leaving ? 0 : fy.monthsAfter, ptForYear: pt * 12, tdsSoFar: pr?.tds ?? 0, declaration: decls.get(e.id) });
        add(ded, 'TDS', t.tds, 'Income tax (TDS)');
        for (const l of loans.filter((x) => x.employeeId === e.id)) add(ded, 'LOAN', Math.min(Number(l.emi), Number(l.outstanding)), l.kind === 'advance' ? 'Advance recovery' : 'Loan recovery', l.id);
        const deds = merge([...ded, ...deductions]);
        const totalDed = sumLines(deds);
        const net = gross - totalDed;
        if (net < 0) warnings.push('Deductions exceed the gross pay');
        rows.push({
          tenantId: auth.tenantId,
          runId: run.id,
          employeeId: e.id,
          month,
          monthDays,
          payableDays: String(payable),
          lopDays: String(lop),
          otHours: String(otHours),
          earnings: earn,
          deductions: deds,
          employer: merge(employer),
          gross: money(gross),
          totalDeductions: money(totalDed),
          net: money(net),
          taxableGross: money(taxable),
          pfWages: money(e.pf ? Math.min(pfWages, settings.pfRestrictToCeiling ? 15_000 : pfWages) : 0),
          epsWages: money(epsWages),
          esiWages: money(covered ? esiWages : 0),
          tds: money(t.tds),
          stateCode: e.stateCode,
          warnings,
        });
      }
      await tx.delete(payslips).where(eq(payslips.runId, run.id));
      for (let i = 0; i < rows.length; i += 300) await tx.insert(payslips).values(rows.slice(i, i + 300));
      const tot = (f: (r: (typeof rows)[number]) => number) => money(rows.reduce((s, r) => s + f(r), 0));
      const totals = {
        employees: rows.length,
        gross: tot((r) => Number(r.gross)),
        deductions: tot((r) => Number(r.totalDeductions)),
        net: tot((r) => Number(r.net)),
        employer: tot((r) => sumLines(r.employer!)),
        tds: tot((r) => Number(r.tds)),
      };
      await tx.update(payrollRuns).set({ totals, warnings: runWarnings, computedAt: new Date(), computedBy: auth.userId, companyId, version: sql`${payrollRuns.version} + 1` }).where(eq(payrollRuns.id, run.id));
      return this.view(tx, run.id);
    });
  }

  // ---- approve / reopen / paid ------------------------------------------------------------

  approve(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, id)).for('update');
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== 'draft') throw new ConflictException(`This payroll is already ${run.status}`);
      if (!run.computedAt) throw new BadRequestException('Compute the payroll first');
      if (!run.companyId) throw new BadRequestException('Add a company (or choose one in payroll settings) to post salaries to');
      const slips = await tx.select().from(payslips).where(eq(payslips.runId, id));
      if (!slips.length) throw new BadRequestException('There are no payslips to approve');
      const { from, to } = monthRange(run.month);
      await tx.execute(sql`update attendance_days set is_locked = true where date between ${from} and ${to} and employee_id in (select employee_id from payslips where run_id = ${id})`);
      await this.applyLoans(tx, slips, 1);
      const sum = (pick: (s: (typeof slips)[number]) => PayLine[], pred: (l: PayLine) => boolean) => slips.reduce((s, p) => s + sumLines(pick(p), pred), 0);
      const code = (c: string) => (l: PayLine) => l.code === c;
      const gross = slips.reduce((s, p) => s + Number(p.gross), 0);
      const net = slips.reduce((s, p) => s + Number(p.net), 0);
      const employerTotal = sum((p) => p.employer, () => true);
      const pf = sum((p) => p.deductions, code('PF')) + sum((p) => p.employer, (l) => ['EPF_ER', 'EPS', 'EDLI'].includes(l.code));
      const esiTotal = sum((p) => p.deductions, code('ESI')) + sum((p) => p.employer, code('ESI_ER'));
      const lwf = sum((p) => p.deductions, code('LWF')) + sum((p) => p.employer, code('LWF_ER'));
      const narration = `Payroll ${run.month}`;
      type GlRow = { account: SystemKey; debit?: number; credit?: number; narration: string };
      const gl = (
        [
        { account: 'payroll_salaries', debit: gross, narration },
        // Recoveries such as canteen reduce the salary cost.
        { account: 'payroll_salaries', credit: sum((p) => p.deductions, OTHER_DEDUCTION), narration: 'Recoveries from salary' },
        { account: 'payroll_contributions', debit: employerTotal, narration: 'Employer PF, ESI and LWF' },
        { account: 'salary_payable', credit: net, narration: 'Net salaries' },
        { account: 'pf_payable', credit: pf, narration: 'PF (employee and employer)' },
        { account: 'esi_payable', credit: esiTotal, narration: 'ESI (employee and employer)' },
        { account: 'pt_payable', credit: sum((p) => p.deductions, code('PT')), narration: 'Professional tax' },
        { account: 'lwf_payable', credit: lwf, narration: 'Labour welfare fund' },
        { account: 'tds_payable', credit: sum((p) => p.deductions, code('TDS')), narration: 'TDS on salary (section 192)' },
        { account: 'employee_loans', credit: sum((p) => p.deductions, code('LOAN')), narration: 'Loan and advance recovery' },
        ] as GlRow[]
      ).filter((l) => Math.round(((l.debit ?? 0) + (l.credit ?? 0)) * 100) !== 0);
      // Posted as a system journal so it shows in the day book and can be reversed by cancelling it.
      await this.ledger.ensureBooks(tx, auth.tenantId, run.companyId, auth.userId);
      const accs = await this.ledger.resolveAccounts(tx, run.companyId, gl.map((l) => ({ account: l.account })));
      const jv = await this.journals.createTx(
        tx,
        auth,
        {
          companyId: run.companyId,
          docDate: to,
          kind: 'journal',
          narration: `Salaries for ${run.month} (payroll)`,
          lines: gl.map((l, i) => ({ accountId: accs[i].id, debit: l.debit ? money(l.debit) : null, credit: l.credit ? money(l.credit) : null, narration: l.narration, partyId: null, costCenterId: null, againstVoucherId: null })),
        },
        meta,
      );
      await this.documents.submit(tx, auth, await this.documents.find(tx, jv.id, 'journal_entry'), meta);
      const voucherId = jv.id;
      await tx.update(payrollRuns).set({ status: 'approved', approvedAt: new Date(), approvedBy: auth.userId, glVoucherId: voucherId }).where(eq(payrollRuns.id, id));
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'payroll.run.approved', entityType: 'payroll_run', entityId: id, metadata: { month: run.month, net: money(net) }, ...meta });
      return this.view(tx, id);
    });
  }

  reopen(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, id)).for('update');
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== 'approved') throw new ConflictException(run.status === 'paid' ? 'Salaries are already paid; record corrections in next month as arrears or deductions' : 'Only approved payroll can be reopened');
      const [later] = await tx.select({ month: payrollRuns.month }).from(payrollRuns).where(and(sql`${payrollRuns.month} > ${run.month}`, ne(payrollRuns.status, 'draft'))).limit(1);
      if (later) throw new ConflictException(`Payroll for ${later.month} is already approved; reopen that first`);
      if (run.glVoucherId) await this.documents.cancel(tx, auth, await this.documents.find(tx, run.glVoucherId, 'journal_entry'), `Payroll ${run.month} reopened`, meta);
      const slips = await tx.select().from(payslips).where(eq(payslips.runId, id));
      await this.applyLoans(tx, slips, -1);
      const { from, to } = monthRange(run.month);
      await tx.execute(sql`update attendance_days set is_locked = false where date between ${from} and ${to} and employee_id in (select employee_id from payslips where run_id = ${id})`);
      await tx.update(payrollRuns).set({ status: 'draft', approvedAt: null, approvedBy: null, glVoucherId: null }).where(eq(payrollRuns.id, id));
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'payroll.run.reopened', entityType: 'payroll_run', entityId: id, metadata: { month: run.month }, ...meta });
      return this.view(tx, id);
    });
  }

  markPaid(auth: AuthContext, id: string, paidOn: string) {
    return this.database.run(auth, async (tx) => {
      const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, id)).for('update');
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== 'approved') throw new ConflictException('Approve the payroll before marking it paid');
      await tx.update(payrollRuns).set({ status: 'paid', paidOn }).where(eq(payrollRuns.id, id));
      return this.view(tx, id);
    });
  }

  private async applyLoans(tx: Transaction, slips: { deductions: PayLine[] }[], sign: 1 | -1) {
    for (const s of slips)
      for (const l of s.deductions.filter((d) => d.code === 'LOAN' && d.ref)) {
        await tx.execute(
          sql`update employee_loans set recovered = recovered + ${String(sign * Number(l.amount))}::numeric,
                     status = case when recovered + ${String(sign * Number(l.amount))}::numeric >= principal then 'closed' else 'active' end
              where id = ${l.ref!}`,
        );
      }
  }

  // ---- files ------------------------------------------------------------------------------

  /** The bank salary upload: full account numbers, so it needs its own permission and is audited. */
  bankFile(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, id));
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status === 'draft') throw new BadRequestException('Approve the payroll first');
      const rows = await many<{ code: string; fullName: string; bankName: string | null; ifsc: string | null; enc: string | null; net: string }>(
        tx,
        sql`select e.code, e.full_name as "fullName", e.bank_name as "bankName", e.ifsc, e.bank_account_enc as enc, p.net
            from payslips p join employees e on e.id = p.employee_id where p.run_id = ${id} and p.net > 0 order by e.code`,
      );
      const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const lines = ['Employee code,Name,Bank,IFSC,Account number,Amount,Narration'];
      let missing = 0;
      for (const r of rows) {
        const account = r.enc ? this.crypto.decrypt(r.enc) : '';
        if (!account || !r.ifsc) missing++;
        lines.push([r.code, r.fullName, r.bankName ?? '', r.ifsc ?? '', account, Number(r.net).toFixed(2), `Salary ${run.month}`].map((v) => q(String(v))).join(','));
      }
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'payroll.bank_file.exported', entityType: 'payroll_run', entityId: id, metadata: { month: run.month, rows: rows.length }, ...meta });
      return { fileName: `salary-${run.month}.csv`, content: `${lines.join('\r\n')}\r\n`, missing };
    });
  }

  /** EPFO ECR 2.0 text file: one line per member, fields separated by #~#. */
  ecr(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const run = await this.view(tx, id);
      const lines: string[] = [];
      for (const p of run.payslips as unknown as (Record<string, unknown> & { uan: string | null; fullName: string; gross: string; pfWages: string; epsWages: string; lopDays: string; deductions: PayLine[]; employer: PayLine[] })[]) {
        const ee = sumLines(p.deductions, (l) => l.code === 'PF');
        if (!ee || !p.uan) continue;
        const eps = sumLines(p.employer, (l) => l.code === 'EPS');
        const diff = sumLines(p.employer, (l) => l.code === 'EPF_ER');
        const edliWages = Number(p.epsWages) || Math.min(Number(p.pfWages), 15_000);
        lines.push([p.uan, p.fullName.toUpperCase(), r0(Number(p.gross)), r0(Number(p.pfWages)), r0(Number(p.epsWages)), r0(edliWages), r0(ee), r0(eps), r0(diff), Math.round(Number(p.lopDays)), 0].join('#~#'));
      }
      return { fileName: `ECR-${run.month}.txt`, content: `${lines.join('\n')}\n`, skippedWithoutUan: run.statutory.pf.missingUan };
    });
  }

  // ---- payslips ---------------------------------------------------------------------------

  payslip(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [p] = await many<Record<string, unknown> & { userId: string | null; status: string; employeeId: string; month: string }>(
        tx,
        sql`select p.*, p.run_id as "runId", p.employee_id as "employeeId", p.month_days as "monthDays", p.payable_days as "payableDays", p.lop_days as "lopDays", p.ot_hours as "otHours",
                   p.total_deductions as "totalDeductions", p.taxable_gross as "taxableGross", r.status, e.user_id as "userId", e.code, e.full_name as "fullName", e.date_of_joining::text as doj,
                   e.uan, e.esic_number as "esicNumber", e.pan_masked as "panMasked", e.bank_name as "bankName", e.bank_account_last4 as "bankAccountLast4", e.tax_regime as regime,
                   d.name as department, g.name as designation, l.name as location
            from payslips p join payroll_runs r on r.id = p.run_id join employees e on e.id = p.employee_id
            left join hr_departments d on d.id = e.department_id left join hr_designations g on g.id = e.designation_id left join hr_locations l on l.id = e.location_id
            where p.id = ${id}`,
      );
      if (!p) throw new NotFoundException('Payslip not found');
      const perms = await permissionsOf(this.database, auth);
      const own = p.userId === auth.userId;
      if (!perms.has('payroll.runs.read') && !(own && perms.has('hr.self.use'))) throw new ForbiddenException('You can only see your own payslips');
      if (!perms.has('payroll.runs.read') && p.status === 'draft') throw new NotFoundException('Payslip not found');
      const fy = fiscalPosition(p.month);
      const [ytd] = await many<{ gross: number; tds: number; pf: number }>(
        tx,
        sql`select coalesce(sum(gross), 0)::float8 as gross, coalesce(sum(tds), 0)::float8 as tds,
                   coalesce(sum((select coalesce(sum((d->>'amount')::numeric), 0) from jsonb_array_elements(deductions) d where d->>'code' = 'PF')), 0)::float8 as pf
            from payslips where employee_id = ${p.employeeId} and month >= ${fy.fyStart} and month <= ${p.month}`,
      );
      const [c] = await tx.select({ name: companies.name, address: companies.address }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
      const { userId: _u, ...rest } = p;
      return { ...rest, fy: fy.fy, ytd, company: c ?? null };
    });
  }

  myPayslips(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const [e] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, auth.userId)).limit(1);
      if (!e) throw new ForbiddenException('Your login is not linked to an employee record');
      return many(tx, sql`select p.id, p.month, p.gross, p.total_deductions as "totalDeductions", p.net from payslips p join payroll_runs r on r.id = p.run_id where p.employee_id = ${e.id} and r.status <> 'draft' order by p.month desc`);
    });
  }
}
