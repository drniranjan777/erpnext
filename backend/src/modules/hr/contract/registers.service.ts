import { BadRequestException, Injectable } from '@nestjs/common';
import { companies, type Transaction } from '@nextgen/database';
import { asc, isNull, sql, type SQL } from 'drizzle-orm';
import type { AuthContext } from '../../../common/auth-context';
import { DatabaseService } from '../../../database/database.service';
import { TimeService } from '../time/time.service';
import { ContractService } from './contract.service';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;

export const REGISTERS = {
  'adult-workers': { title: 'Register of adult workers', law: 'Factories Act 1948, Form 12 · Shops and Establishments Act register of employment', period: 'none' },
  'muster-roll': { title: 'Muster roll', law: 'Factories Act 1948, Form 25', period: 'month' },
  'leave-register': { title: 'Register of leave with wages', law: 'Factories Act 1948, s.79 and Form 14', period: 'year' },
  wages: { title: 'Register of wages', law: 'Payment of Wages Act · Minimum Wages Act Form X · Shops and Establishments Act', period: 'month' },
  'clra-workmen': { title: 'Register of workmen employed by contractors', law: 'Contract Labour (R&A) Central Rules 1971, Form XIII', period: 'none' },
  'clra-muster': { title: 'Muster roll of contract labour', law: 'Contract Labour (R&A) Central Rules 1971, Form XVI', period: 'month' },
  'clra-wages': { title: 'Register of wages of contract labour', law: 'Contract Labour (R&A) Central Rules 1971, Form XVII', period: 'month' },
} as const;
export type RegisterKey = keyof typeof REGISTERS;

export interface Register {
  key: RegisterKey;
  title: string;
  law: string;
  period: string;
  company: { name: string; address: Record<string, string> | null } | null;
  columns: { key: string; label: string; align?: 'right' }[];
  rows: Record<string, unknown>[];
}

/** Statutory registers as tables for printing (the print view lays them out landscape). */
@Injectable()
export class RegistersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly time: TimeService,
    private readonly contract: ContractService,
  ) {}

  list() {
    return Object.entries(REGISTERS).map(([key, r]) => ({ key, ...r }));
  }

  get(auth: AuthContext, key: string, q: { month?: string; year?: number }): Promise<Register> {
    if (!(key in REGISTERS)) throw new BadRequestException('Unknown register');
    const k = key as RegisterKey;
    const meta = REGISTERS[k];
    if (meta.period === 'month' && !q.month) throw new BadRequestException('Choose a month');
    if (meta.period === 'year' && !q.year) throw new BadRequestException('Choose a year');
    return this.database.run(auth, async (tx) => {
      const [company] = await tx.select({ name: companies.name, address: companies.address }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
      const base = { key: k, title: meta.title, law: meta.law, period: meta.period === 'month' ? q.month! : meta.period === 'year' ? String(q.year) : '', company: (company as Register['company']) ?? null };
      return { ...base, ...(await this.body(tx, k, q)) };
    });
  }

  private async body(tx: Transaction, k: RegisterKey, q: { month?: string; year?: number }): Promise<Pick<Register, 'columns' | 'rows'>> {
    switch (k) {
      case 'adult-workers':
        return {
          columns: [
            { key: 'code', label: 'No.' },
            { key: 'name', label: 'Name' },
            { key: 'fatherOrSpouse', label: 'Father / spouse' },
            { key: 'gender', label: 'Sex' },
            { key: 'dob', label: 'Date of birth' },
            { key: 'address', label: 'Residential address' },
            { key: 'doj', label: 'Date of joining' },
            { key: 'work', label: 'Nature of work' },
            { key: 'category', label: 'Category' },
            { key: 'shift', label: 'Shift / group' },
          ],
          rows: await many(
            tx,
            sql`select e.code, e.full_name as name, e.father_or_spouse_name as "fatherOrSpouse", e.gender, e.date_of_birth::text as dob,
                       concat_ws(', ', e.current_address->>'line1', e.current_address->>'city', e.current_address->>'pincode') as address, e.date_of_joining::text as doj,
                       concat_ws(', ', g.name, d.name) as work, e.category,
                       (select string_agg(s.code::text, ' / ') from hr_shift_assignments a join hr_shifts s on s.id = any(a.shift_ids) where a.employee_id = e.id and a.to_date is null) as shift
                from employees e left join hr_departments d on d.id = e.department_id left join hr_designations g on g.id = e.designation_id
                where e.status <> 'exited' order by e.code`,
          ),
        };
      case 'muster-roll': {
        const m = await this.time.monthSummary(tx, { month: q.month! });
        return {
          columns: [{ key: 'code', label: 'No.' }, { key: 'fullName', label: 'Name' }, ...m.dates.map((d) => ({ key: d, label: String(Number(d.slice(8))) })), { key: 'present', label: 'Days worked', align: 'right' as const }, { key: 'leave', label: 'Leave', align: 'right' as const }, { key: 'ot', label: 'OT h', align: 'right' as const }],
          rows: m.rows.map((r) => ({ code: r.code, fullName: r.fullName, ...r.days, present: r.summary.present, leave: r.summary.paidLeave + r.summary.unpaidLeave, ot: r.summary.otHours })),
        };
      }
      case 'leave-register': {
        const y0 = `${q.year}-01-01`;
        const y1 = `${q.year}-12-31`;
        return {
          columns: [
            { key: 'code', label: 'No.' },
            { key: 'name', label: 'Name' },
            { key: 'leaveType', label: 'Leave' },
            { key: 'daysWorked', label: 'Days worked', align: 'right' },
            { key: 'opening', label: 'Brought forward', align: 'right' },
            { key: 'earned', label: 'Earned', align: 'right' },
            { key: 'availed', label: 'Availed', align: 'right' },
            { key: 'encashed', label: 'Encashed / lapsed', align: 'right' },
            { key: 'balance', label: 'Balance', align: 'right' },
          ],
          rows: await many(
            tx,
            sql`select e.code, e.full_name as name, t.name as "leaveType",
                       (select coalesce(sum(case status when 'present' then 1 when 'half_day' then 0.5 else 0 end), 0)::float8 from attendance_days a where a.employee_id = e.id and a.date between ${y0} and ${y1}) as "daysWorked",
                       coalesce(sum(l.days) filter (where l.entry_date < ${y0}), 0)::float8 as opening,
                       coalesce(sum(l.days) filter (where l.entry_date between ${y0} and ${y1} and l.days > 0), 0)::float8 as earned,
                       coalesce(-sum(l.days) filter (where l.entry_date between ${y0} and ${y1} and l.kind in ('availed', 'reversal')), 0)::float8 as availed,
                       coalesce(-sum(l.days) filter (where l.entry_date between ${y0} and ${y1} and l.kind in ('encashment', 'lapse')), 0)::float8 as encashed,
                       coalesce(sum(l.days) filter (where l.entry_date <= ${y1}), 0)::float8 as balance
                from employees e cross join leave_types t left join leave_ledger l on l.employee_id = e.id and l.leave_type_id = t.id
                where (e.status <> 'exited' or e.exit_date >= ${y0}) and (t.accrual = 'per_days_worked' or t.encashable)
                group by e.id, e.code, e.full_name, t.name order by e.code, t.name`,
          ),
        };
      }
      case 'wages': {
        const rows = await many<{ code: string; name: string; designation: string | null; payableDays: string; monthDays: number; otHours: string; earnings: { code: string; amount: string }[]; deductions: { code: string; amount: string }[]; gross: string; totalDeductions: string; net: string }>(
          tx,
          sql`select e.code, e.full_name as name, g.name as designation, p.payable_days as "payableDays", p.month_days as "monthDays", p.ot_hours as "otHours", p.earnings, p.deductions, p.gross, p.total_deductions as "totalDeductions", p.net
              from payslips p join payroll_runs r on r.id = p.run_id join employees e on e.id = p.employee_id left join hr_designations g on g.id = e.designation_id
              where p.month = ${q.month} and r.status <> 'draft' order by e.code`,
        );
        const amt = (ls: { code: string; amount: string }[], codes: string[]) => ls.filter((l) => codes.includes(l.code)).reduce((s, l) => s + Number(l.amount), 0);
        return {
          columns: [
            { key: 'code', label: 'No.' },
            { key: 'name', label: 'Name' },
            { key: 'designation', label: 'Designation' },
            { key: 'days', label: 'Days paid', align: 'right' },
            { key: 'basic', label: 'Basic + DA', align: 'right' },
            { key: 'ot', label: 'Overtime', align: 'right' },
            { key: 'other', label: 'Other earnings', align: 'right' },
            { key: 'gross', label: 'Gross', align: 'right' },
            { key: 'pf', label: 'PF', align: 'right' },
            { key: 'esi', label: 'ESI', align: 'right' },
            { key: 'ptTds', label: 'PT + TDS', align: 'right' },
            { key: 'otherDed', label: 'Other deductions', align: 'right' },
            { key: 'net', label: 'Net paid', align: 'right' },
            { key: 'sign', label: 'Signature / thumb' },
          ],
          rows: rows.map((r) => {
            const basic = amt(r.earnings, ['BASIC', 'DA']);
            const ot = amt(r.earnings, ['OT']);
            const statutory = amt(r.deductions, ['PF', 'ESI', 'PT', 'TDS']);
            return {
              code: r.code,
              name: r.name,
              designation: r.designation,
              days: `${Number(r.payableDays)}/${r.monthDays}`,
              basic,
              ot,
              other: Number(r.gross) - basic - ot,
              gross: Number(r.gross),
              pf: amt(r.deductions, ['PF']),
              esi: amt(r.deductions, ['ESI']),
              ptTds: amt(r.deductions, ['PT', 'TDS']),
              otherDed: Number(r.totalDeductions) - statutory,
              net: Number(r.net),
              sign: '',
            };
          }),
        };
      }
      case 'clra-workmen':
        return {
          columns: [
            { key: 'code', label: 'No.' },
            { key: 'name', label: 'Name and surname' },
            { key: 'age', label: 'Age and sex' },
            { key: 'fatherName', label: "Father's / husband's name" },
            { key: 'work', label: 'Nature of employment' },
            { key: 'contractor', label: 'Contractor' },
            { key: 'joinedOn', label: 'Date of commencement' },
            { key: 'leftOn', label: 'Date of termination' },
          ],
          rows: await many(
            tx,
            sql`select w.code, w.name, concat_ws(' ', date_part('year', age(w.date_of_birth))::int, left(w.gender, 1)) as age, w.father_name as "fatherName",
                       concat_ws(', ', replace(w.skill, '_', ' '), c.work) as work, c.name as contractor, w.joined_on::text as "joinedOn", w.left_on::text as "leftOn"
                from hr_contract_workers w join hr_contractors c on c.id = w.contractor_id order by c.name, w.code`,
          ),
        };
      case 'clra-muster': {
        const m = await this.contract.musterTx(tx, q.month!);
        return {
          columns: [{ key: 'code', label: 'No.' }, { key: 'name', label: 'Name' }, { key: 'contractor', label: 'Contractor' }, ...m.dates.map((d) => ({ key: d, label: String(Number(d.slice(8))) })), { key: 'present', label: 'Days', align: 'right' as const }],
          rows: m.rows.map((r) => ({ code: r.code, name: r.name, contractor: r.contractor, ...r.days, present: r.present })),
        };
      }
      case 'clra-wages':
        return {
          columns: [
            { key: 'code', label: 'No.' },
            { key: 'name', label: 'Name' },
            { key: 'contractor', label: 'Contractor' },
            { key: 'daysPaid', label: 'Days worked', align: 'right' },
            { key: 'rate', label: 'Daily rate', align: 'right' },
            { key: 'grossPaid', label: 'Gross wages', align: 'right' },
            { key: 'pf', label: 'PF', align: 'right' },
            { key: 'esi', label: 'ESI', align: 'right' },
            { key: 'net', label: 'Net paid', align: 'right' },
            { key: 'paidOn', label: 'Paid on' },
            { key: 'sign', label: 'Signature / thumb' },
          ],
          rows: (
            await many<{ code: string; name: string; contractor: string; daysPaid: string; rate: string; grossPaid: string; pf: string; esi: string; paidOn: string | null }>(
              tx,
              sql`select w.code, w.name, c.name as contractor, x.days_paid as "daysPaid", w.daily_wage as rate, x.gross_paid as "grossPaid", x.pf_deducted as pf, x.esi_deducted as esi, x.paid_on::text as "paidOn"
                  from hr_contract_wages x join hr_contract_workers w on w.id = x.worker_id join hr_contractors c on c.id = w.contractor_id where x.month = ${q.month} order by c.name, w.code`,
            )
          ).map((r) => ({ ...r, daysPaid: Number(r.daysPaid), rate: Number(r.rate), grossPaid: Number(r.grossPaid), pf: Number(r.pf), esi: Number(r.esi), net: Number(r.grossPaid) - Number(r.pf) - Number(r.esi), sign: '' })),
        };
    }
  }
}
