import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { employeeLoans, employees, employeeSalaries, payrollInputs, payrollSettings, pieceRates, salaryComponents, salaryTemplates, taxDeclarations, workCenters, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { permissionsOf, selfEmployee } from '../hr/time/people';
import { applyTemplate } from './salary';

const money = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e10) {
    ctx.addIssue({ code: 'custom', message: 'Enter an amount' });
    return z.NEVER;
  }
  return Math.round(n * 100) / 100;
});
const code = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9_]+$/, 'Letters, digits and _ only')
  .transform((c) => c.toUpperCase());
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month as YYYY-MM');
/** Codes payroll computes itself. */
export const RESERVED = new Set(['PF', 'ESI', 'PT', 'LWF', 'TDS', 'LOAN', 'EPF_ER', 'EPS', 'EDLI', 'ESI_ER', 'LWF_ER']);

export const settingsSchema = z.object({
  companyId: z.uuid().nullable().optional(),
  pfRestrictToCeiling: z.boolean().default(true),
  pfEstablishmentCode: z.string().trim().max(30).nullable().optional(),
  esiEmployerCode: z.string().trim().max(30).nullable().optional(),
  otMultiplier: z.number().min(1).max(3).default(2),
  otDivisorDays: z.number().int().min(20).max(31).default(26),
  otHoursPerDay: z.number().int().min(4).max(12).default(8),
});
export const componentSchema = z.object({
  code,
  name: z.string().trim().min(2).max(60),
  kind: z.enum(['earning', 'deduction']),
  isPfWage: z.boolean().default(false),
  isEsiWage: z.boolean().default(true),
  isTaxable: z.boolean().default(true),
  prorate: z.boolean().default(true),
  sequence: z.number().int().min(1).max(999).default(100),
  isActive: z.boolean().default(true),
});
export const templateSchema = z.object({
  code,
  name: z.string().trim().min(2).max(60),
  lines: z.array(z.object({ code, calc: z.enum(['percent_ctc', 'percent_basic', 'fixed', 'balance']), value: z.number().min(0).max(10_000_000) })).min(1).max(20),
  employerPfInCtc: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
export const salarySchema = z
  .object({
    employeeId: z.uuid(),
    effectiveFrom: z.iso.date(),
    ctcAnnual: money.optional(),
    templateId: z.uuid().optional(),
    lines: z.array(z.object({ code, monthly: money })).max(30).optional(),
    remarks: z.string().trim().max(200).optional(),
  })
  .refine((s) => (s.templateId && s.ctcAnnual) || s.lines?.length, { message: 'Give a CTC and template, or the monthly amounts', path: ['lines'] });
export const loanSchema = z.object({ employeeId: z.uuid(), kind: z.enum(['loan', 'advance']).default('loan'), issuedOn: z.iso.date(), principal: money, emi: money, startMonth: month, remarks: z.string().trim().max(200).optional() }).refine((l) => l.emi > 0 && l.emi <= l.principal, { message: 'The instalment must be above zero and not more than the amount', path: ['emi'] });
export const inputSchema = z.object({ month, employeeId: z.uuid(), code, amount: money, remarks: z.string().trim().max(200).optional() });
export const declarationSchema = z.object({
  employeeId: z.uuid().optional(),
  fy: z.string().regex(/^\d{4}-\d{2}$/, 'Year as 2026-27'),
  regime: z.enum(['new', 'old']).optional(),
  data: z
    .object({ section80C: money.optional(), section80D: money.optional(), hraExemption: money.optional(), otherDeductions: money.optional(), employerNps: money.optional(), previousIncome: money.optional(), previousTds: money.optional() })
    .default({}),
});
export const pieceRateSchema = z.object({ workCenterId: z.uuid(), ratePerUnit: z.number().min(0).max(1_000_000), effectiveFrom: z.iso.date() });

const DEFAULT_COMPONENTS: Omit<typeof salaryComponents.$inferInsert, 'tenantId'>[] = [
  { code: 'BASIC', name: 'Basic', kind: 'earning', isPfWage: true, sequence: 10 },
  { code: 'DA', name: 'Dearness allowance', kind: 'earning', isPfWage: true, sequence: 20 },
  { code: 'HRA', name: 'House rent allowance', kind: 'earning', sequence: 30 },
  { code: 'CONV', name: 'Conveyance', kind: 'earning', sequence: 40 },
  { code: 'SPL', name: 'Special allowance', kind: 'earning', sequence: 50 },
  { code: 'OT', name: 'Overtime', kind: 'earning', prorate: false, isSystem: true, sequence: 60 },
  { code: 'PIECE', name: 'Piece-rate earnings', kind: 'earning', prorate: false, isSystem: true, sequence: 70 },
  { code: 'ARREAR', name: 'Arrears', kind: 'earning', prorate: false, sequence: 80 },
  { code: 'INCENT', name: 'Incentive', kind: 'earning', prorate: false, sequence: 85 },
  { code: 'BONUS', name: 'Bonus', kind: 'earning', prorate: false, isEsiWage: false, sequence: 90 },
  { code: 'REIMB', name: 'Reimbursement', kind: 'earning', prorate: false, isEsiWage: false, isTaxable: false, sequence: 99 },
  { code: 'CANTEEN', name: 'Canteen', kind: 'deduction', prorate: false, isEsiWage: false, sequence: 110 },
  { code: 'OTHDED', name: 'Other deduction', kind: 'deduction', prorate: false, isEsiWage: false, sequence: 120 },
];

/** Payroll masters: components, templates, salaries, loans, monthly inputs, declarations and settings. */
@Injectable()
export class PayrollSetupService {
  constructor(private readonly database: DatabaseService) {}

  /** Built-in components and the settings row, created on first use. */
  async ensureDefaults(tx: Transaction, tenantId: string) {
    const [has] = await tx.select({ id: salaryComponents.id }).from(salaryComponents).limit(1);
    if (!has) await tx.insert(salaryComponents).values(DEFAULT_COMPONENTS.map((c) => ({ ...c, tenantId }))).onConflictDoNothing();
    const [s] = await tx.select().from(payrollSettings);
    return s ?? (await tx.insert(payrollSettings).values({ tenantId }).onConflictDoNothing().returning())[0] ?? (await tx.select().from(payrollSettings))[0];
  }

  settings(auth: AuthContext) {
    return this.database.run(auth, (tx) => this.ensureDefaults(tx, auth.tenantId));
  }

  saveSettings(auth: AuthContext, input: z.infer<typeof settingsSchema>) {
    return this.database.run(auth, async (tx) => {
      const s = await this.ensureDefaults(tx, auth.tenantId);
      const [r] = await tx
        .update(payrollSettings)
        .set({ ...input, companyId: input.companyId ?? null, pfEstablishmentCode: input.pfEstablishmentCode ?? null, esiEmployerCode: input.esiEmployerCode ?? null, otMultiplier: String(input.otMultiplier), updatedAt: new Date() })
        .where(eq(payrollSettings.id, s.id))
        .returning();
      return r;
    });
  }

  components(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      await this.ensureDefaults(tx, auth.tenantId);
      return tx.select().from(salaryComponents).orderBy(asc(salaryComponents.sequence), asc(salaryComponents.code));
    });
  }

  saveComponent(auth: AuthContext, id: string | null, input: z.infer<typeof componentSchema>) {
    if (RESERVED.has(input.code)) throw new BadRequestException(`${input.code} is computed by payroll; choose another code`);
    return this.database.run(auth, async (tx) => {
      await this.ensureDefaults(tx, auth.tenantId);
      const [dup] = await tx.select({ id: salaryComponents.id }).from(salaryComponents).where(and(eq(salaryComponents.code, input.code), id ? ne(salaryComponents.id, id) : undefined));
      if (dup) throw new ConflictException(`Component ${input.code} already exists`);
      if (id) {
        const [cur] = await tx.select().from(salaryComponents).where(eq(salaryComponents.id, id));
        if (!cur) throw new NotFoundException('Component not found');
        // Built-in components keep their code and kind.
        const values = cur.isSystem ? { ...input, code: cur.code, kind: cur.kind } : input;
        return (await tx.update(salaryComponents).set(values).where(eq(salaryComponents.id, id)).returning())[0];
      }
      return (await tx.insert(salaryComponents).values({ tenantId: auth.tenantId, ...input }).returning())[0];
    });
  }

  templates(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(salaryTemplates).orderBy(asc(salaryTemplates.code)));
  }

  saveTemplate(auth: AuthContext, id: string | null, input: z.infer<typeof templateSchema>) {
    return this.database.run(auth, async (tx) => {
      await this.ensureDefaults(tx, auth.tenantId);
      const comps = new Map((await tx.select().from(salaryComponents)).map((c) => [String(c.code), c]));
      for (const l of input.lines) {
        const c = comps.get(l.code);
        if (!c || c.kind !== 'earning' || c.isSystem) throw new BadRequestException(`${l.code} is not a salary earning`);
      }
      if (input.lines.filter((l) => l.calc === 'balance').length > 1) throw new BadRequestException('Only one line can take the balance');
      if (new Set(input.lines.map((l) => l.code)).size !== input.lines.length) throw new BadRequestException('A component appears twice');
      try {
        applyTemplate(1_200_000, input.lines, { pfWageCodes: new Set(), employerPfInCtc: false, restrictToCeiling: true });
      } catch (e) {
        if ((e as Error).message.startsWith('The template')) throw new BadRequestException((e as Error).message);
      }
      const [dup] = await tx.select({ id: salaryTemplates.id }).from(salaryTemplates).where(and(eq(salaryTemplates.code, input.code), id ? ne(salaryTemplates.id, id) : undefined));
      if (dup) throw new ConflictException(`Template ${input.code} already exists`);
      if (id) {
        const [r] = await tx.update(salaryTemplates).set(input).where(eq(salaryTemplates.id, id)).returning();
        if (!r) throw new NotFoundException('Template not found');
        return r;
      }
      return (await tx.insert(salaryTemplates).values({ tenantId: auth.tenantId, ...input }).returning())[0];
    });
  }

  /** Works out the monthly split of a CTC without saving it. */
  preview(auth: AuthContext, templateId: string, ctcAnnual: number) {
    return this.database.run(auth, (tx) => this.split(tx, auth.tenantId, templateId, ctcAnnual));
  }

  private async split(tx: Transaction, tenantId: string, templateId: string, ctcAnnual: number) {
    const s = await this.ensureDefaults(tx, tenantId);
    const [t] = await tx.select().from(salaryTemplates).where(eq(salaryTemplates.id, templateId));
    if (!t) throw new NotFoundException('Template not found');
    const pfCodes = new Set((await tx.select({ code: salaryComponents.code }).from(salaryComponents).where(eq(salaryComponents.isPfWage, true))).map((c) => String(c.code)));
    try {
      return applyTemplate(ctcAnnual, t.lines, { pfWageCodes: pfCodes, employerPfInCtc: t.employerPfInCtc, restrictToCeiling: s.pfRestrictToCeiling });
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  // ---- salaries ---------------------------------------------------------------------------

  /** Everyone's current salary (latest revision on or before today). */
  salaries(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      tx.execute(
        sql`select e.id as "employeeId", e.code, e.full_name as "fullName", e.status, s.id, s.effective_from::text as "effectiveFrom", s.ctc_annual as "ctcAnnual", s.lines,
                   (select coalesce(sum((l->>'monthly')::numeric), 0) from jsonb_array_elements(s.lines) l) as "monthlyGross"
            from employees e
            left join lateral (select * from employee_salaries x where x.employee_id = e.id and x.effective_from <= (now() at time zone 'Asia/Kolkata')::date order by x.effective_from desc limit 1) s on true
            where e.status <> 'exited' order by e.code`,
      ).then((r) => r.rows),
    );
  }

  history(auth: AuthContext, employeeId: string) {
    return this.database.run(auth, (tx) => tx.select().from(employeeSalaries).where(eq(employeeSalaries.employeeId, employeeId)).orderBy(desc(employeeSalaries.effectiveFrom)));
  }

  setSalary(auth: AuthContext, input: z.infer<typeof salarySchema>) {
    return this.database.run(auth, async (tx) => {
      await this.ensureDefaults(tx, auth.tenantId);
      const [e] = await tx.select({ id: employees.id, doj: employees.dateOfJoining }).from(employees).where(eq(employees.id, input.employeeId));
      if (!e) throw new NotFoundException('Employee not found');
      let lines = input.lines?.map((l) => ({ code: l.code, monthly: l.monthly.toFixed(2) })) ?? [];
      let ctc = input.ctcAnnual ?? 0;
      if (input.templateId && input.ctcAnnual) lines = (await this.split(tx, auth.tenantId, input.templateId, input.ctcAnnual)).lines;
      const comps = new Map((await tx.select().from(salaryComponents)).map((c) => [String(c.code), c]));
      for (const l of lines) {
        const c = comps.get(l.code);
        if (!c || c.kind !== 'earning' || c.isSystem || !c.prorate) throw new BadRequestException(`${l.code} is not a monthly salary earning`);
      }
      if (!lines.some((l) => l.code === 'BASIC' && Number(l.monthly) > 0)) throw new BadRequestException('The salary needs a basic');
      if (!ctc) ctc = lines.reduce((s, l) => s + Number(l.monthly), 0) * 12;
      const [paid] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from payslips p join payroll_runs r on r.id = p.run_id where p.employee_id = ${e.id} and r.status <> 'draft' and r.month >= ${input.effectiveFrom.slice(0, 7)}`).then((r) => r.rows);
      if (paid.n) throw new BadRequestException('Payroll is already approved for that month; give the revision a later date and pay the difference as arrears');
      const [r] = await tx
        .insert(employeeSalaries)
        .values({ tenantId: auth.tenantId, employeeId: e.id, effectiveFrom: input.effectiveFrom, ctcAnnual: ctc.toFixed(2), templateId: input.templateId ?? null, lines, remarks: input.remarks ?? null, createdBy: auth.userId })
        .onConflictDoUpdate({ target: [employeeSalaries.tenantId, employeeSalaries.employeeId, employeeSalaries.effectiveFrom], set: { ctcAnnual: ctc.toFixed(2), templateId: input.templateId ?? null, lines, remarks: input.remarks ?? null, createdBy: auth.userId, createdAt: new Date() } })
        .returning();
      return r;
    });
  }

  // ---- loans and inputs -------------------------------------------------------------------

  loans(auth: AuthContext, employeeId?: string) {
    return this.database.run(auth, (tx) =>
      tx
        .select({ loan: employeeLoans, code: employees.code, fullName: employees.fullName })
        .from(employeeLoans)
        .innerJoin(employees, eq(employees.id, employeeLoans.employeeId))
        .where(employeeId ? eq(employeeLoans.employeeId, employeeId) : undefined)
        .orderBy(desc(employeeLoans.issuedOn))
        .then((rows) => rows.map((r) => ({ ...r.loan, code: r.code, fullName: r.fullName, outstanding: (Number(r.loan.principal) - Number(r.loan.recovered)).toFixed(2) }))),
    );
  }

  addLoan(auth: AuthContext, input: z.infer<typeof loanSchema>) {
    return this.database.run(auth, async (tx) => {
      const [e] = await tx.select({ id: employees.id, status: employees.status }).from(employees).where(eq(employees.id, input.employeeId));
      if (!e || e.status === 'exited') throw new BadRequestException('Choose a current employee');
      return (await tx.insert(employeeLoans).values({ tenantId: auth.tenantId, ...input, principal: input.principal.toFixed(2), emi: input.emi.toFixed(2), remarks: input.remarks ?? null, createdBy: auth.userId }).returning())[0];
    });
  }

  closeLoan(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.update(employeeLoans).set({ status: 'closed' }).where(eq(employeeLoans.id, id)).returning();
      if (!r) throw new NotFoundException('Loan not found');
      return r;
    });
  }

  inputs(auth: AuthContext, m: string) {
    return this.database.run(auth, (tx) =>
      tx
        .select({ id: payrollInputs.id, month: payrollInputs.month, employeeId: payrollInputs.employeeId, code: payrollInputs.code, amount: payrollInputs.amount, remarks: payrollInputs.remarks, empCode: employees.code, fullName: employees.fullName, name: salaryComponents.name, kind: salaryComponents.kind })
        .from(payrollInputs)
        .innerJoin(employees, eq(employees.id, payrollInputs.employeeId))
        .leftJoin(salaryComponents, eq(salaryComponents.code, payrollInputs.code))
        .where(eq(payrollInputs.month, m))
        .orderBy(asc(employees.code)),
    );
  }

  addInput(auth: AuthContext, input: z.infer<typeof inputSchema>) {
    return this.database.run(auth, async (tx) => {
      await this.ensureDefaults(tx, auth.tenantId);
      const [c] = await tx.select().from(salaryComponents).where(eq(salaryComponents.code, input.code));
      if (!c || c.isSystem || c.prorate) throw new BadRequestException(`${input.code} is not a one-off earning or deduction (arrears, bonus, incentive, reimbursement, canteen...)`);
      await this.assertMonthOpen(tx, input.month);
      return (await tx.insert(payrollInputs).values({ tenantId: auth.tenantId, ...input, amount: input.amount.toFixed(2), remarks: input.remarks ?? null, createdBy: auth.userId }).returning())[0];
    });
  }

  removeInput(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [i] = await tx.select().from(payrollInputs).where(eq(payrollInputs.id, id));
      if (!i) throw new NotFoundException('Input not found');
      await this.assertMonthOpen(tx, i.month);
      await tx.delete(payrollInputs).where(eq(payrollInputs.id, id));
      return { ok: true };
    });
  }

  private async assertMonthOpen(tx: Transaction, m: string) {
    const [r] = await tx.execute<{ status: string }>(sql`select status from payroll_runs where month = ${m}`).then((x) => x.rows);
    if (r && r.status !== 'draft') throw new BadRequestException(`Payroll for ${m} is ${r.status}; reopen it first`);
  }

  // ---- piece rates ------------------------------------------------------------------------

  pieceRates(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      tx
        .select({ id: pieceRates.id, workCenterId: pieceRates.workCenterId, ratePerUnit: pieceRates.ratePerUnit, effectiveFrom: pieceRates.effectiveFrom, workCenter: workCenters.name, workCenterCode: workCenters.code })
        .from(pieceRates)
        .innerJoin(workCenters, eq(workCenters.id, pieceRates.workCenterId))
        .orderBy(asc(workCenters.code), desc(pieceRates.effectiveFrom)),
    );
  }

  savePieceRate(auth: AuthContext, input: z.infer<typeof pieceRateSchema>) {
    return this.database.run(auth, async (tx) => {
      const [wc] = await tx.select({ id: workCenters.id }).from(workCenters).where(eq(workCenters.id, input.workCenterId));
      if (!wc) throw new NotFoundException('Work centre not found');
      const rate = String(input.ratePerUnit);
      return (await tx.insert(pieceRates).values({ tenantId: auth.tenantId, ...input, ratePerUnit: rate }).onConflictDoUpdate({ target: [pieceRates.tenantId, pieceRates.workCenterId, pieceRates.effectiveFrom], set: { ratePerUnit: rate } }).returning())[0];
    });
  }

  // ---- tax declarations -------------------------------------------------------------------

  declaration(auth: AuthContext, fy: string, employeeId?: string) {
    return this.database.run(auth, async (tx) => {
      const id = await this.declarant(tx, auth, employeeId, 'payroll.salaries.read');
      const [e] = await tx.select({ regime: employees.taxRegime, fullName: employees.fullName }).from(employees).where(eq(employees.id, id));
      const [d] = await tx.select().from(taxDeclarations).where(and(eq(taxDeclarations.employeeId, id), eq(taxDeclarations.fy, fy)));
      return { employeeId: id, fullName: e.fullName, fy, regime: e.regime, data: d?.data ?? {} };
    });
  }

  saveDeclaration(auth: AuthContext, input: z.infer<typeof declarationSchema>) {
    return this.database.run(auth, async (tx) => {
      const id = await this.declarant(tx, auth, input.employeeId, 'payroll.salaries.manage');
      if (input.regime) await tx.update(employees).set({ taxRegime: input.regime }).where(eq(employees.id, id));
      const data = Object.fromEntries(Object.entries(input.data).filter(([, v]) => v !== undefined)) as Record<string, number>;
      await tx
        .insert(taxDeclarations)
        .values({ tenantId: auth.tenantId, employeeId: id, fy: input.fy, data, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: [taxDeclarations.tenantId, taxDeclarations.employeeId, taxDeclarations.fy], set: { data, updatedBy: auth.userId, updatedAt: new Date() } });
      return { employeeId: id, fy: input.fy, regime: input.regime, data };
    });
  }

  /** An employee declares for themselves; HR for anyone. */
  private async declarant(tx: Transaction, auth: AuthContext, employeeId: string | undefined, permission: string) {
    const perms = await permissionsOf(this.database, auth);
    const self = await selfEmployee(tx, auth);
    if (!employeeId || employeeId === self?.id) {
      if (!self) throw new ForbiddenException('Your login is not linked to an employee record');
      if (!perms.has('hr.self.use') && !perms.has(permission)) throw new ForbiddenException('You do not have self-service access');
      return self.id;
    }
    if (!perms.has(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
    return employeeId;
  }
}
