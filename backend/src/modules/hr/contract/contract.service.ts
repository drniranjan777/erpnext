import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { contractAttendance, contractors, contractWages, contractWorkers, minimumWages, type Transaction } from '@nextgen/database';
import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth-context';
import { todayIST } from '../../../common/fiscal-year';
import { DatabaseService } from '../../../database/database.service';
import { daysBetween } from '../time/attendance-engine';
import { wageCheck } from './compliance';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const amount = z.number().min(0).max(1e8);
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const SKILLS = ['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'] as const;
const monthRange = (month: string) => {
  const from = `${month}-01`;
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return { from, to: d.toISOString().slice(0, 10) };
};

export const contractorSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(120),
  licenceNo: text(60),
  licenceValidUntil: z.iso.date().nullable().optional(),
  maxWorkers: z.number().int().min(1).max(10_000).nullable().optional(),
  work: text(200),
  locationId: z.uuid().nullable().optional(),
  pfCode: text(30),
  esiCode: text(30),
  contactName: text(80),
  mobile: text(15),
  isActive: z.boolean().default(true),
});
export const workerSchema = z.object({
  contractorId: z.uuid(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(120),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  dateOfBirth: z.iso.date().nullable().optional(),
  fatherName: text(120),
  skill: z.enum(SKILLS).default('unskilled'),
  dailyWage: amount,
  uan: z.string().regex(/^\d{12}$/, 'UAN: 12 digits').nullable().optional(),
  esicNumber: z.string().regex(/^\d{10}(\d{7})?$/, 'ESIC number: 10 or 17 digits').nullable().optional(),
  aadhaarLast4: z.string().regex(/^\d{4}$/).nullable().optional(),
  mobile: text(15),
  locationId: z.uuid().nullable().optional(),
  joinedOn: z.iso.date(),
  leftOn: z.iso.date().nullable().optional(),
});
export const markSchema = z.object({ date: z.iso.date(), entries: z.array(z.object({ workerId: z.uuid(), status: z.enum(['P', 'A', 'HD']), otHours: z.number().min(0).max(12).default(0) })).min(1).max(2000) });
export const wagesSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), entries: z.array(z.object({ workerId: z.uuid(), daysPaid: z.number().min(0).max(31), grossPaid: amount, pfDeducted: amount.default(0), esiDeducted: amount.default(0), paidOn: z.iso.date().nullable().optional() })).min(1).max(2000) });
export const minWageSchema = z.object({ stateCode: z.string().regex(/^\d{2}$/), skill: z.enum(SKILLS), dailyRate: amount, effectiveFrom: z.iso.date() });

/**
 * Contract labour under the CLRA Act: contractors and their licences, contract workers, the
 * principal employer's gate attendance, wages the contractor reports paying, and the check of
 * those wages against attendance, the notified minimum wage, PF and ESI.
 */
@Injectable()
export class ContractService {
  constructor(private readonly database: DatabaseService) {}

  contractors(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select c.id, c.code, c.name, c.licence_no as "licenceNo", c.licence_valid_until::text as "licenceValidUntil", c.max_workers as "maxWorkers", c.work, c.location_id as "locationId",
                   c.pf_code as "pfCode", c.esi_code as "esiCode", c.contact_name as "contactName", c.mobile, c.is_active as "isActive", l.name as location,
                   (select count(*)::int from hr_contract_workers w where w.contractor_id = c.id and (w.left_on is null or w.left_on >= ${todayIST()})) as workers
            from hr_contractors c left join hr_locations l on l.id = c.location_id order by c.code`,
      ),
    );
  }

  saveContractor(auth: AuthContext, id: string | null, input: z.infer<typeof contractorSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, code: input.code.toUpperCase() };
      const [dup] = await tx.select({ id: contractors.id }).from(contractors).where(and(eq(contractors.code, values.code), id ? ne(contractors.id, id) : undefined));
      if (dup) throw new ConflictException(`Contractor ${values.code} already exists`);
      if (id) {
        const [r] = await tx.update(contractors).set(values).where(eq(contractors.id, id)).returning();
        if (!r) throw new NotFoundException('Contractor not found');
        return r;
      }
      return (await tx.insert(contractors).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  workers(auth: AuthContext, q: { contractorId?: string; current?: boolean }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select w.id, w.code, w.name, w.gender, w.date_of_birth::text as "dateOfBirth", w.father_name as "fatherName", w.skill, w.daily_wage as "dailyWage", w.uan, w.esic_number as "esicNumber",
                   w.aadhaar_last4 as "aadhaarLast4", w.mobile, w.location_id as "locationId", w.joined_on::text as "joinedOn", w.left_on::text as "leftOn", w.contractor_id as "contractorId", c.name as contractor
            from hr_contract_workers w join hr_contractors c on c.id = w.contractor_id
            where true ${q.contractorId ? sql`and w.contractor_id = ${q.contractorId}` : sql``} ${q.current ? sql`and (w.left_on is null or w.left_on >= ${todayIST()})` : sql``}
            order by w.code limit 5000`,
      ),
    );
  }

  saveWorker(auth: AuthContext, id: string | null, input: z.infer<typeof workerSchema>) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(contractors).where(eq(contractors.id, input.contractorId));
      if (!c) throw new NotFoundException('Contractor not found');
      if (input.leftOn && input.leftOn < input.joinedOn) throw new BadRequestException('Left before joining');
      const values = { ...input, code: input.code.toUpperCase(), dailyWage: input.dailyWage.toFixed(2), locationId: input.locationId ?? c.locationId };
      const [dup] = await tx.select({ id: contractWorkers.id }).from(contractWorkers).where(and(eq(contractWorkers.code, values.code), id ? ne(contractWorkers.id, id) : undefined));
      if (dup) throw new ConflictException(`Worker code ${values.code} is already used`);
      if (!id && c.maxWorkers) {
        // The licence caps how many workers the contractor may engage at a time.
        const [{ n }] = await many<{ n: number }>(tx, sql`select count(*)::int as n from hr_contract_workers where contractor_id = ${c.id} and (left_on is null or left_on >= ${input.joinedOn})`);
        if (n >= c.maxWorkers) throw new BadRequestException(`${c.name}'s licence allows ${c.maxWorkers} workers; ${n} are engaged`);
      }
      if (id) {
        const [r] = await tx.update(contractWorkers).set(values).where(eq(contractWorkers.id, id)).returning();
        if (!r) throw new NotFoundException('Worker not found');
        return r;
      }
      return (await tx.insert(contractWorkers).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  mark(auth: AuthContext, input: z.infer<typeof markSchema>) {
    if (input.date > todayIST()) throw new BadRequestException('Attendance cannot be marked for a future day');
    return this.database.run(auth, async (tx) => {
      const ids = [...new Set(input.entries.map((e) => e.workerId))];
      const ws = await tx.select({ id: contractWorkers.id, joinedOn: contractWorkers.joinedOn, leftOn: contractWorkers.leftOn }).from(contractWorkers).where(inArray(contractWorkers.id, ids));
      if (ws.length !== ids.length) throw new BadRequestException('Unknown worker');
      const off = ws.filter((w) => w.joinedOn > input.date || (w.leftOn && w.leftOn < input.date));
      if (off.length) throw new BadRequestException(`${off.length} worker(s) were not engaged on ${input.date}`);
      const ex = (c: string) => sql.raw(`excluded.${c}`);
      await tx
        .insert(contractAttendance)
        .values(input.entries.map((e) => ({ tenantId: auth.tenantId, workerId: e.workerId, date: input.date, status: e.status, otHours: String(e.status === 'A' ? 0 : e.otHours) })))
        .onConflictDoUpdate({ target: [contractAttendance.workerId, contractAttendance.date], set: { status: ex('status'), otHours: ex('ot_hours') } });
      return { marked: input.entries.length };
    });
  }

  /** The contract muster for a month (CLRA Form XVI). */
  muster(auth: AuthContext, month: string, contractorId?: string) {
    return this.database.run(auth, (tx) => this.musterTx(tx, month, contractorId));
  }

  async musterTx(tx: Transaction, month: string, contractorId?: string) {
    const { from, to } = monthRange(month);
    const ws = await many<{ id: string; code: string; name: string; contractor: string; contractorId: string; skill: string; dailyWage: string; uan: string | null; stateCode: string | null; fatherName: string | null }>(
      tx,
      sql`select w.id, w.code, w.name, c.name as contractor, c.id as "contractorId", w.skill, w.daily_wage as "dailyWage", w.uan, l.state_code as "stateCode", w.father_name as "fatherName"
          from hr_contract_workers w join hr_contractors c on c.id = w.contractor_id left join hr_locations l on l.id = coalesce(w.location_id, c.location_id)
          where w.joined_on <= ${to} and (w.left_on is null or w.left_on >= ${from}) ${contractorId ? sql`and w.contractor_id = ${contractorId}` : sql``}
          order by c.name, w.code`,
    );
    const att = ws.length ? await tx.select().from(contractAttendance).where(and(inArray(contractAttendance.workerId, ws.map((w) => w.id)), sql`${contractAttendance.date} between ${from} and ${to}`)) : [];
    const days = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
    return {
      month,
      dates: days,
      rows: ws.map((w) => {
        const mine = att.filter((a) => a.workerId === w.id);
        return {
          ...w,
          days: Object.fromEntries(mine.map((a) => [a.date, a.status])),
          present: mine.reduce((s, a) => s + (a.status === 'P' ? 1 : a.status === 'HD' ? 0.5 : 0), 0),
          otHours: mine.reduce((s, a) => s + Number(a.otHours), 0),
        };
      }),
    };
  }

  recordWages(auth: AuthContext, input: z.infer<typeof wagesSchema>) {
    return this.database.run(auth, async (tx) => {
      const ex = (c: string) => sql.raw(`excluded.${c}`);
      await tx
        .insert(contractWages)
        .values(input.entries.map((e) => ({ tenantId: auth.tenantId, workerId: e.workerId, month: input.month, daysPaid: String(e.daysPaid), grossPaid: e.grossPaid.toFixed(2), pfDeducted: e.pfDeducted.toFixed(2), esiDeducted: e.esiDeducted.toFixed(2), paidOn: e.paidOn ?? null })))
        .onConflictDoUpdate({ target: [contractWages.workerId, contractWages.month], set: { daysPaid: ex('days_paid'), grossPaid: ex('gross_paid'), pfDeducted: ex('pf_deducted'), esiDeducted: ex('esi_deducted'), paidOn: ex('paid_on') } });
      return { recorded: input.entries.length };
    });
  }

  /** Each worker's wages checked against attendance and the minimum wage; contractor licence status. */
  compliance(auth: AuthContext, month: string) {
    return this.database.run(auth, async (tx) => {
      const { to } = monthRange(month);
      const m = await this.musterTx(tx, month);
      const wages = m.rows.length ? await tx.select().from(contractWages).where(and(eq(contractWages.month, month), inArray(contractWages.workerId, m.rows.map((r) => r.id)))) : [];
      const mins = await tx.select().from(minimumWages).where(sql`${minimumWages.effectiveFrom} <= ${to}`).orderBy(asc(minimumWages.effectiveFrom));
      const minFor = (state: string | null, skill: string) => {
        const hit = mins.filter((x) => x.stateCode === state && x.skill === skill).at(-1);
        return hit ? Number(hit.dailyRate) : null;
      };
      const workers = m.rows.map((w) => {
        const d = wages.find((x) => x.workerId === w.id);
        const check = wageCheck({
          daysPresent: w.present,
          otHours: w.otHours,
          agreedDaily: Number(w.dailyWage),
          minDaily: minFor(w.stateCode, w.skill),
          declared: d ? { daysPaid: Number(d.daysPaid), grossPaid: Number(d.grossPaid), pfDeducted: Number(d.pfDeducted), esiDeducted: Number(d.esiDeducted) } : null,
          hasUan: !!w.uan,
        });
        return { workerId: w.id, code: w.code, name: w.name, contractor: w.contractor, contractorId: w.contractorId, present: w.present, otHours: w.otHours, minDaily: minFor(w.stateCode, w.skill), grossPaid: d ? Number(d.grossPaid) : null, ...check };
      });
      const today = todayIST();
      const cs = await tx.select().from(contractors).where(eq(contractors.isActive, true)).orderBy(asc(contractors.code));
      return {
        month,
        workers,
        contractors: cs.map((c) => {
          const mine = workers.filter((w) => w.contractorId === c.id);
          const alerts: string[] = [];
          if (!c.licenceNo) alerts.push('No CLRA licence on record');
          else if (c.licenceValidUntil && c.licenceValidUntil < today) alerts.push(`Licence expired on ${c.licenceValidUntil}`);
          else if (c.licenceValidUntil && daysBetween(today, c.licenceValidUntil) <= 30) alerts.push(`Licence expires on ${c.licenceValidUntil}`);
          if (c.maxWorkers && mine.length > c.maxWorkers) alerts.push(`${mine.length} workers engaged; the licence allows ${c.maxWorkers}`);
          return { id: c.id, code: c.code, name: c.name, workers: mine.length, withIssues: mine.filter((w) => w.issues.length).length, shortfall: mine.reduce((s, w) => s + w.shortfall, 0), alerts };
        }),
      };
    });
  }

  minimumWages(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(minimumWages).orderBy(asc(minimumWages.stateCode), asc(minimumWages.skill), asc(minimumWages.effectiveFrom)));
  }

  saveMinimumWage(auth: AuthContext, input: z.infer<typeof minWageSchema>) {
    return this.database.run(auth, async (tx) => {
      const rate = input.dailyRate.toFixed(2);
      return (await tx.insert(minimumWages).values({ tenantId: auth.tenantId, ...input, dailyRate: rate }).onConflictDoUpdate({ target: [minimumWages.tenantId, minimumWages.stateCode, minimumWages.skill, minimumWages.effectiveFrom], set: { dailyRate: rate } }).returning())[0];
    });
  }
}
