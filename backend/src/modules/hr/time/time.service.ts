import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import {
  attachments,
  attendanceDays,
  attendancePunches,
  attendanceRegularisations,
  employees,
  hrHolidays,
  hrLocations,
  hrShiftAssignments,
  hrShifts,
  leaveApplications,
  leaveLedger,
  leaveTypes,
  type Transaction,
} from '@nextgen/database';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth-context';
import { todayIST } from '../../../common/fiscal-year';
import { DatabaseService } from '../../../database/database.service';
import { StorageService } from '../../documents/storage.service';
import { parseSheet } from '../../imports/file-parser';
import { addDays, at, daysBetween, datesIn, distanceMetres, evaluateDay, istDate, leaveOn, parsePunchTime, shiftOn, weekday, weeklyExtraOt, type ShiftDef } from './attendance-engine';
import { isManagerOf, permissionsOf, requireSelf, subjectOf } from './people';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time as HH:MM');
const minutes = (min: number, max: number) => z.number().int().min(min).max(max);
export const shiftSchema = z
  .object({
    code: z.string().trim().min(1).max(20),
    name: z.string().trim().min(2).max(80),
    startTime: hhmm,
    endTime: hhmm,
    breakMinutes: minutes(0, 180).default(30),
    graceMinutes: minutes(0, 120).default(10),
    halfDayMinutes: minutes(60, 720).default(240),
    fullDayMinutes: minutes(60, 960).default(450),
    otAfterMinutes: minutes(60, 960).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((s) => s.halfDayMinutes < s.fullDayMinutes, { message: 'A half day must be shorter than a full day', path: ['halfDayMinutes'] });
export const assignSchema = z.object({
  employeeIds: z.array(z.uuid()).min(1).max(1000),
  shiftIds: z.array(z.uuid()).min(1).max(6),
  rotateEveryDays: z.number().int().min(1).max(31).default(7),
  weeklyOffs: z.array(z.number().int().min(0).max(6)).max(3).default([0]),
  fromDate: z.iso.date(),
});
export const holidaySchema = z.object({ date: z.iso.date(), name: z.string().trim().min(2).max(80), locationId: z.uuid().nullable().optional(), isOptional: z.boolean().default(false) });
export const pushSchema = z.object({ punches: z.array(z.object({ employeeCode: z.string().trim().min(1).max(20), at: z.string().trim().min(1).max(40), deviceId: z.string().trim().max(60).optional() })).min(1).max(2000) });
export const processSchema = z
  .object({ from: z.iso.date(), to: z.iso.date(), employeeId: z.uuid().optional() })
  .refine((p) => p.to >= p.from && daysBetween(p.from, p.to) <= 62, { message: 'Process up to 62 days at a time', path: ['to'] });
export const regulariseSchema = z
  .object({ employeeId: z.uuid().optional(), date: z.iso.date(), inTime: hhmm.nullable().optional(), outTime: hhmm.nullable().optional(), reason: z.string().trim().min(3).max(300) })
  .refine((r) => r.inTime || r.outTime, { message: 'Give the in time, the out time or both', path: ['inTime'] });
export const decideSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() });
export const mobileSchema = z.object({ latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180), accuracy: z.coerce.number().min(0).max(100_000).optional() });

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const SELFIE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CODE: Record<string, string> = { present: 'P', half_day: 'HD', absent: 'A', missed_punch: 'MP', weekly_off: 'WO', holiday: 'H', leave: 'L' };
const monthRange = (month: string) => {
  const from = `${month}-01`;
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return { from, to: d.toISOString().slice(0, 10) };
};

type PunchRow = { employeeId: string; punchedAt: Date; source: string; deviceId?: string | null; latitude?: string | null; longitude?: string | null; distanceMetres?: number | null; insideFence?: boolean | null; selfieId?: string | null; createdBy?: string | null };

/**
 * Shifts, rosters, holidays, punches and the daily attendance they come to. Processing is
 * idempotent: a day is recomputed from its punches, roster, holidays and approved leave, except
 * days payroll has locked.
 */
@Injectable()
export class TimeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  // ---- shifts and rosters -----------------------------------------------------------------

  shifts(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(hrShifts).orderBy(asc(hrShifts.code)));
  }

  saveShift(auth: AuthContext, id: string | null, input: z.infer<typeof shiftSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, code: input.code.toUpperCase(), otAfterMinutes: input.otAfterMinutes ?? null };
      if (id) {
        const [r] = await tx.update(hrShifts).set(values).where(eq(hrShifts.id, id)).returning();
        if (!r) throw new NotFoundException('Shift not found');
        return r;
      }
      const [dup] = await tx.select({ id: hrShifts.id }).from(hrShifts).where(eq(hrShifts.code, values.code));
      if (dup) throw new ConflictException(`Shift code ${values.code} is already used`);
      return (await tx.insert(hrShifts).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  /** Who works which shift on a date, with their rotation. */
  roster(auth: AuthContext, date: string) {
    return this.database.run(auth, async (tx) => {
      const shifts = new Map((await tx.select().from(hrShifts)).map((s) => [s.id, s]));
      const rows = await many<{ id: string; code: string; fullName: string; department: string | null; assignment: { shiftIds: string[]; rotateEveryDays: number; weeklyOffs: number[]; fromDate: string; toDate: string | null } | null }>(
        tx,
        sql`select e.id, e.code, e.full_name as "fullName", d.name as department,
                   (select json_build_object('shiftIds', a.shift_ids, 'rotateEveryDays', a.rotate_every_days, 'weeklyOffs', a.weekly_offs, 'fromDate', a.from_date, 'toDate', a.to_date)
                      from hr_shift_assignments a where a.employee_id = e.id and a.from_date <= ${date} and (a.to_date is null or a.to_date >= ${date})
                      order by a.from_date desc limit 1) as assignment
            from employees e left join hr_departments d on d.id = e.department_id
            where e.status <> 'exited' order by e.code`,
      );
      return rows.map((r) => {
        const today = r.assignment ? shiftOn(r.assignment, date) : null;
        return {
          ...r,
          rotation: r.assignment?.shiftIds.map((s) => shifts.get(s)?.code ?? '?') ?? [],
          shiftToday: today ? shifts.get(today)?.code ?? null : null,
          offToday: (r.assignment?.weeklyOffs ?? [0]).includes(weekday(date)),
        };
      });
    });
  }

  assign(auth: AuthContext, input: z.infer<typeof assignSchema>) {
    return this.database.run(auth, async (tx) => {
      const found = await tx.select({ id: hrShifts.id }).from(hrShifts).where(inArray(hrShifts.id, input.shiftIds));
      if (found.length !== new Set(input.shiftIds).size) throw new BadRequestException('Unknown shift');
      const emps = await tx.select({ id: employees.id }).from(employees).where(inArray(employees.id, input.employeeIds));
      if (emps.length !== new Set(input.employeeIds).size) throw new BadRequestException('Unknown employee');
      const ids = emps.map((e) => e.id);
      // The new roster replaces anything from its start date on and closes the one running then.
      await tx.delete(hrShiftAssignments).where(and(inArray(hrShiftAssignments.employeeId, ids), gte(hrShiftAssignments.fromDate, input.fromDate)));
      await tx
        .update(hrShiftAssignments)
        .set({ toDate: addDays(input.fromDate, -1) })
        .where(and(inArray(hrShiftAssignments.employeeId, ids), lt(hrShiftAssignments.fromDate, input.fromDate), or(isNull(hrShiftAssignments.toDate), gte(hrShiftAssignments.toDate, input.fromDate))));
      await tx.insert(hrShiftAssignments).values(ids.map((employeeId) => ({ tenantId: auth.tenantId, employeeId, shiftIds: input.shiftIds, rotateEveryDays: input.rotateEveryDays, weeklyOffs: [...new Set(input.weeklyOffs)], fromDate: input.fromDate })));
      return { assigned: ids.length };
    });
  }

  // ---- holidays ---------------------------------------------------------------------------

  holidays(auth: AuthContext, year: number) {
    return this.database.run(auth, (tx) =>
      tx
        .select({ id: hrHolidays.id, date: hrHolidays.date, name: hrHolidays.name, isOptional: hrHolidays.isOptional, locationId: hrHolidays.locationId, location: hrLocations.name })
        .from(hrHolidays)
        .leftJoin(hrLocations, eq(hrLocations.id, hrHolidays.locationId))
        .where(and(gte(hrHolidays.date, `${year}-01-01`), lte(hrHolidays.date, `${year}-12-31`)))
        .orderBy(asc(hrHolidays.date)),
    );
  }

  addHoliday(auth: AuthContext, input: z.infer<typeof holidaySchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx
        .select({ id: hrHolidays.id })
        .from(hrHolidays)
        .where(and(eq(hrHolidays.date, input.date), input.locationId ? eq(hrHolidays.locationId, input.locationId) : isNull(hrHolidays.locationId)));
      if (dup) throw new ConflictException('There is already a holiday on that date for that location');
      return (await tx.insert(hrHolidays).values({ tenantId: auth.tenantId, ...input, locationId: input.locationId ?? null }).returning())[0];
    });
  }

  removeHoliday(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.delete(hrHolidays).where(eq(hrHolidays.id, id)).returning({ id: hrHolidays.id });
      if (!r) throw new NotFoundException('Holiday not found');
      return { ok: true };
    });
  }

  // ---- punches ----------------------------------------------------------------------------

  /** Punches pushed by a biometric device or middleware (an API key with hr.attendance.manage). */
  push(auth: AuthContext, input: z.infer<typeof pushSchema>) {
    return this.database.run(auth, async (tx) => {
      const rows: { code: string; text: string; deviceId?: string; line: number }[] = input.punches.map((p, i) => ({ code: p.employeeCode, text: p.at, deviceId: p.deviceId, line: i + 1 }));
      return this.ingestRows(tx, auth, rows, 'device');
    });
  }

  /**
   * A punch file exported from a device: an employee code column and either one date-time column
   * or separate date and time columns.
   */
  async importFile(auth: AuthContext, buffer: Buffer, fileName: string) {
    const sheet = await parseSheet(buffer, fileName);
    const pick = (names: string[]) => names.find((n) => sheet.headers.includes(n));
    const codeCol = pick(['employee_code', 'emp_code', 'code', 'employee_id', 'emp_id', 'card_no']);
    const dtCol = pick(['punch_time', 'date_time', 'datetime', 'timestamp', 'punched_at', 'log_time']);
    const dateCol = pick(['date', 'punch_date', 'log_date']);
    const timeCol = pick(['time', 'punch_time_only', 'log_time_only']);
    if (!codeCol) throw new BadRequestException('The file needs an employee code column (employee_code)');
    if (!dtCol && !(dateCol && timeCol)) throw new BadRequestException('The file needs a punch_time column, or date and time columns');
    const rows = sheet.rows.map((r) => ({ code: r.values[codeCol], text: dtCol ? r.values[dtCol] : `${r.values[dateCol!]} ${r.values[timeCol!]}`, deviceId: r.values.device_id || undefined, line: r.rowNo }));
    return this.database.run(auth, (tx) => this.ingestRows(tx, auth, rows, 'import'));
  }

  private async ingestRows(tx: Transaction, auth: AuthContext, rows: { code: string; text: string; deviceId?: string; line: number }[], source: 'device' | 'import') {
    const codes = [...new Set(rows.map((r) => r.code.toUpperCase()))];
    const emps = new Map<string, string>();
    for (let i = 0; i < codes.length; i += 1000) {
      for (const e of await tx.select({ id: employees.id, code: employees.code }).from(employees).where(inArray(employees.code, codes.slice(i, i + 1000)))) emps.set(String(e.code).toUpperCase(), e.id);
    }
    const unknown = new Set<string>();
    const invalid: { line: number; value: string }[] = [];
    const punches: PunchRow[] = [];
    for (const r of rows) {
      const employeeId = emps.get(r.code.toUpperCase());
      if (!employeeId) {
        unknown.add(r.code);
        continue;
      }
      const t = parsePunchTime(r.text);
      if (!t || t.getTime() > Date.now() + 10 * 60_000) {
        invalid.push({ line: r.line, value: r.text });
        continue;
      }
      punches.push({ employeeId, punchedAt: t, source, deviceId: r.deviceId ?? null, createdBy: auth.userId });
    }
    const inserted = await this.insertPunches(tx, auth.tenantId, punches);
    return { received: rows.length, inserted, duplicates: punches.length - inserted, unknownCodes: [...unknown].slice(0, 50), invalid: invalid.slice(0, 50) };
  }

  /** Stores punches (ignoring ones already there) and reprocesses the days they touch. */
  private async insertPunches(tx: Transaction, tenantId: string, punches: PunchRow[]) {
    let inserted = 0;
    const touched = new Map<string, { from: string; to: string }>();
    for (let i = 0; i < punches.length; i += 500) {
      const chunk = punches.slice(i, i + 500);
      const r = await tx
        .insert(attendancePunches)
        .values(chunk.map((p) => ({ tenantId, ...p })))
        .onConflictDoNothing()
        .returning({ employeeId: attendancePunches.employeeId, punchedAt: attendancePunches.punchedAt });
      inserted += r.length;
      for (const p of r) {
        // A punch after midnight may close the previous day's night shift.
        const d = istDate(p.punchedAt);
        const cur = touched.get(p.employeeId);
        const from = addDays(d, -1);
        touched.set(p.employeeId, { from: cur && cur.from < from ? cur.from : from, to: cur && cur.to > d ? cur.to : d });
      }
    }
    const today = todayIST();
    for (const [employeeId, range] of touched) {
      const to = range.to > today ? today : range.to;
      // Old backfills are processed in 62-day slices like a manual run.
      for (let f = range.from; f <= to; f = addDays(f, 62)) {
        const t = addDays(f, 61) < to ? addDays(f, 61) : to;
        await this.processRange(tx, tenantId, f, t, [employeeId]);
      }
    }
    return inserted;
  }

  /** A geo-tagged punch with a selfie from the employee's own phone. */
  async mobilePunch(auth: AuthContext, input: z.infer<typeof mobileSchema>, selfie: { mimetype: string; file: Readable } | null) {
    if (selfie && !SELFIE_TYPES.has(selfie.mimetype)) {
      selfie.file.resume();
      throw new UnsupportedMediaTypeException('The selfie must be a JPEG, PNG or WebP image');
    }
    const self = await this.database.run(auth, async (tx) => {
      const perms = await permissionsOf(this.database, auth);
      if (!perms.has('hr.self.use')) throw new ForbiddenException('You do not have self-service access');
      return requireSelf(tx, auth);
    });
    if (!selfie) throw new BadRequestException('Take a selfie to punch');
    const stored = await this.storage.put(auth.tenantId, selfie.file, 3 * 1024 * 1024);
    return this.database.run(auth, async (tx) => {
      const [loc] = self.locationId ? await tx.select().from(hrLocations).where(eq(hrLocations.id, self.locationId)) : [];
      let distance: number | null = null;
      let inside: boolean | null = null;
      if (loc?.latitude && loc.longitude && loc.radiusMetres) {
        distance = distanceMetres(input.latitude, input.longitude, Number(loc.latitude), Number(loc.longitude));
        // The phone's own accuracy (capped at 100 m) is given the benefit of the doubt.
        inside = distance <= loc.radiusMetres + Math.min(input.accuracy ?? 0, 100);
      }
      const now = new Date();
      now.setMilliseconds(0);
      const [a] = await tx
        .insert(attachments)
        .values({ tenantId: auth.tenantId, entityType: 'attendance_punch', entityId: self.id, fileName: `selfie-${now.toISOString()}.jpg`, contentType: selfie.mimetype, sizeBytes: stored.sizeBytes, sha256: stored.sha256, storageKey: stored.key, uploadedBy: auth.userId })
        .returning({ id: attachments.id });
      const inserted = await this.insertPunches(tx, auth.tenantId, [{ employeeId: self.id, punchedAt: now, source: 'mobile', latitude: input.latitude.toFixed(6), longitude: input.longitude.toFixed(6), distanceMetres: distance, insideFence: inside, selfieId: a.id, createdBy: auth.userId }]);
      if (!inserted) throw new ConflictException('A punch was already recorded this second');
      return { punchedAt: now.toISOString(), insideFence: inside, distanceMetres: distance, location: loc?.name ?? null };
    });
  }

  punches(auth: AuthContext, q: { date?: string; employeeId?: string; flagged?: boolean }) {
    return this.database.run(auth, async (tx) => {
      const date = q.date ?? todayIST();
      return many(
        tx,
        sql`select p.id, p.punched_at as "punchedAt", p.source, p.device_id as "deviceId", p.latitude, p.longitude, p.distance_metres as "distanceMetres", p.inside_fence as "insideFence",
                   p.selfie_id is not null as "hasSelfie", e.id as "employeeId", e.code, e.full_name as "fullName"
            from attendance_punches p join employees e on e.id = p.employee_id
            where p.punched_at >= ${at(date, '00:00')} and p.punched_at < ${at(addDays(date, 1), '00:00')}
              ${q.employeeId ? sql`and p.employee_id = ${q.employeeId}` : sql``}
              ${q.flagged ? sql`and p.inside_fence = false` : sql``}
            order by p.punched_at desc limit 1000`,
      );
    });
  }

  async selfie(auth: AuthContext, punchId: string) {
    const row = await this.database.run(auth, async (tx) => {
      const [r] = await tx
        .select({ key: attachments.storageKey, name: attachments.fileName, type: attachments.contentType, size: attachments.sizeBytes })
        .from(attendancePunches)
        .innerJoin(attachments, eq(attachments.id, attendancePunches.selfieId))
        .where(eq(attendancePunches.id, punchId));
      if (!r) throw new NotFoundException('No selfie for this punch');
      return r;
    });
    return { stream: await this.storage.open(row.key), fileName: row.name, contentType: row.type, sizeBytes: row.size };
  }

  // ---- processing -------------------------------------------------------------------------

  process(auth: AuthContext, input: z.infer<typeof processSchema>) {
    return this.database.run(auth, async (tx) => ({ days: await this.processRange(tx, auth.tenantId, input.from, input.to > todayIST() ? todayIST() : input.to, input.employeeId ? [input.employeeId] : undefined) }));
  }

  /** Recomputes attendance for the employees (all when omitted) over from..to. */
  async processRange(tx: Transaction, tenantId: string, from: string, to: string, employeeIds?: string[]) {
    if (to < from) return 0;
    const emps = await tx
      .select({ id: employees.id, locationId: employees.locationId, doj: employees.dateOfJoining, exitDate: employees.exitDate })
      .from(employees)
      .where(and(lte(employees.dateOfJoining, to), or(isNull(employees.exitDate), gte(employees.exitDate, from)), employeeIds ? inArray(employees.id, employeeIds) : undefined));
    if (!emps.length) return 0;
    const shifts = new Map<string, ShiftDef>((await tx.select().from(hrShifts)).map((s) => [s.id, s]));
    const holidays = await tx.select().from(hrHolidays).where(and(gte(hrHolidays.date, from), lte(hrHolidays.date, to), eq(hrHolidays.isOptional, false)));
    const [compOff] = await tx.select({ id: leaveTypes.id }).from(leaveTypes).where(and(eq(leaveTypes.isCompOff, true), eq(leaveTypes.isActive, true))).orderBy(asc(leaveTypes.code)).limit(1);
    let count = 0;
    for (let i = 0; i < emps.length; i += 200) {
      const group = emps.slice(i, i + 200);
      const ids = group.map((e) => e.id);
      const assigns = await tx
        .select()
        .from(hrShiftAssignments)
        .where(and(inArray(hrShiftAssignments.employeeId, ids), lte(hrShiftAssignments.fromDate, to), or(isNull(hrShiftAssignments.toDate), gte(hrShiftAssignments.toDate, from))))
        .orderBy(desc(hrShiftAssignments.fromDate));
      const leaves = await tx
        .select({ employeeId: leaveApplications.employeeId, fromDate: leaveApplications.fromDate, toDate: leaveApplications.toDate, fromHalf: leaveApplications.fromHalf, toHalf: leaveApplications.toHalf, leaveTypeId: leaveApplications.leaveTypeId, paid: leaveTypes.isPaid, countHolidays: leaveTypes.countHolidays })
        .from(leaveApplications)
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveApplications.leaveTypeId))
        .where(and(inArray(leaveApplications.employeeId, ids), eq(leaveApplications.status, 'approved'), lte(leaveApplications.fromDate, to), gte(leaveApplications.toDate, from)));
      const punches = await tx
        .select({ employeeId: attendancePunches.employeeId, punchedAt: attendancePunches.punchedAt })
        .from(attendancePunches)
        .where(and(inArray(attendancePunches.employeeId, ids), gte(attendancePunches.punchedAt, at(addDays(from, -1), '00:00')), lt(attendancePunches.punchedAt, at(addDays(to, 2), '00:00'))));
      const locked = new Set(
        (await tx.select({ e: attendanceDays.employeeId, d: attendanceDays.date }).from(attendanceDays).where(and(inArray(attendanceDays.employeeId, ids), gte(attendanceDays.date, from), lte(attendanceDays.date, to), eq(attendanceDays.isLocked, true)))).map((r) => `${r.e}|${r.d}`),
      );
      const byEmp = <T extends { employeeId: string }>(rows: T[]) => {
        const m = new Map<string, T[]>();
        for (const r of rows) m.set(r.employeeId, [...(m.get(r.employeeId) ?? []), r]);
        return m;
      };
      const aBy = byEmp(assigns);
      const lBy = byEmp(leaves);
      const pBy = byEmp(punches);
      const days: (typeof attendanceDays.$inferInsert)[] = [];
      const credits: (typeof leaveLedger.$inferInsert)[] = [];
      const now = new Date();
      for (const e of group) {
        const start = e.doj > from ? e.doj : from;
        const end = e.exitDate && e.exitDate < to ? e.exitDate : to;
        const empPunches = (pBy.get(e.id) ?? []).map((p) => p.punchedAt);
        for (const date of start <= end ? datesIn(start, end) : []) {
          if (locked.has(`${e.id}|${date}`)) continue;
          const a = (aBy.get(e.id) ?? []).find((x) => shiftOn(x, date));
          const shiftId = a ? shiftOn(a, date) : null;
          const shift = shiftId ? shifts.get(shiftId) ?? null : null;
          const holiday = holidays.some((h) => h.date === date && (!h.locationId || h.locationId === e.locationId));
          let off: 'holiday' | 'weekly_off' | null = holiday ? 'holiday' : (a?.weeklyOffs ?? [0]).includes(weekday(date)) ? 'weekly_off' : null;
          const app = (lBy.get(e.id) ?? []).find((l) => leaveOn(l, date) > 0);
          // A leave that counts offs (sandwich rule) turns the off day into leave.
          if (off && app?.countHolidays) off = null;
          const r = evaluateDay({ date, shift, punches: empPunches, off, leave: app ? { days: leaveOn(app, date), paid: app.paid, leaveTypeId: app.leaveTypeId } : null });
          days.push({
            tenantId,
            employeeId: e.id,
            date,
            shiftId,
            status: r.status,
            firstIn: r.firstIn,
            lastOut: r.lastOut,
            workedMinutes: r.workedMinutes,
            lateMinutes: r.lateMinutes,
            earlyMinutes: r.earlyMinutes,
            otMinutes: r.otMinutes,
            leaveTypeId: app && r.leaveDays ? app.leaveTypeId : null,
            leaveDays: String(r.leaveDays),
            payableDays: String(r.payableDays),
            processedAt: now,
          });
          if (compOff && r.compOff) credits.push({ tenantId, employeeId: e.id, leaveTypeId: compOff.id, entryDate: date, days: String(r.compOff), kind: 'comp_off', refKey: `co:${e.id}:${date}`, remarks: `Worked on ${off === 'holiday' ? 'a holiday' : 'a weekly off'}` });
        }
      }
      const ex = (c: string) => sql.raw(`excluded.${c}`);
      for (let j = 0; j < days.length; j += 500) {
        await tx
          .insert(attendanceDays)
          .values(days.slice(j, j + 500))
          .onConflictDoUpdate({
            target: [attendanceDays.tenantId, attendanceDays.employeeId, attendanceDays.date],
            set: {
              shiftId: ex('shift_id'),
              status: ex('status'),
              firstIn: ex('first_in'),
              lastOut: ex('last_out'),
              workedMinutes: ex('worked_minutes'),
              lateMinutes: ex('late_minutes'),
              earlyMinutes: ex('early_minutes'),
              otMinutes: ex('ot_minutes'),
              leaveTypeId: ex('leave_type_id'),
              leaveDays: ex('leave_days'),
              payableDays: ex('payable_days'),
              processedAt: ex('processed_at'),
            },
            setWhere: sql`${attendanceDays.isLocked} = false`,
          });
      }
      // Comp-off credits follow the days: drop the old ones for the range and write the current ones.
      if (compOff) {
        await tx.delete(leaveLedger).where(and(inArray(leaveLedger.employeeId, ids), eq(leaveLedger.kind, 'comp_off'), gte(leaveLedger.entryDate, from), lte(leaveLedger.entryDate, to)));
        if (credits.length) await tx.insert(leaveLedger).values(credits).onConflictDoNothing();
      }
      count += days.length;
    }
    return count;
  }

  /** Weekly offs (from the roster, Sunday without one) and holidays at the employee's location. */
  async offDays(tx: Transaction, employeeId: string, from: string, to: string) {
    const [e] = await tx.select({ locationId: employees.locationId }).from(employees).where(eq(employees.id, employeeId));
    if (!e) throw new NotFoundException('Employee not found');
    const assigns = await tx
      .select()
      .from(hrShiftAssignments)
      .where(and(eq(hrShiftAssignments.employeeId, employeeId), lte(hrShiftAssignments.fromDate, to), or(isNull(hrShiftAssignments.toDate), gte(hrShiftAssignments.toDate, from))))
      .orderBy(desc(hrShiftAssignments.fromDate));
    const hols = await tx
      .select({ date: hrHolidays.date })
      .from(hrHolidays)
      .where(and(gte(hrHolidays.date, from), lte(hrHolidays.date, to), eq(hrHolidays.isOptional, false), e.locationId ? or(isNull(hrHolidays.locationId), eq(hrHolidays.locationId, e.locationId)) : isNull(hrHolidays.locationId)));
    const off = new Set(hols.map((h) => h.date));
    for (const d of datesIn(from, to)) {
      const a = assigns.find((x) => shiftOn(x, d));
      if ((a?.weeklyOffs ?? [0]).includes(weekday(d))) off.add(d);
    }
    return off;
  }

  /** The signed-in employee's record and today's attendance, for the punch screen. */
  me(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const self = await requireSelf(tx, auth);
      const today = todayIST();
      const punches = await tx
        .select({ punchedAt: attendancePunches.punchedAt, source: attendancePunches.source, insideFence: attendancePunches.insideFence })
        .from(attendancePunches)
        .where(and(eq(attendancePunches.employeeId, self.id), gte(attendancePunches.punchedAt, at(today, '00:00')), lt(attendancePunches.punchedAt, at(addDays(today, 1), '00:00'))))
        .orderBy(asc(attendancePunches.punchedAt));
      const [day] = await tx.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, self.id), eq(attendanceDays.date, today)));
      const [loc] = self.locationId ? await tx.select({ name: hrLocations.name, radiusMetres: hrLocations.radiusMetres, hasFence: sql<boolean>`${hrLocations.latitude} is not null` }).from(hrLocations).where(eq(hrLocations.id, self.locationId)) : [];
      return { employee: self, today, punches, day: day ?? null, location: loc ?? null };
    });
  }

  // ---- views ------------------------------------------------------------------------------

  /** The muster roll for a month with each employee's totals (what payroll reads). */
  month(auth: AuthContext, q: { month: string; departmentId?: string; locationId?: string; employeeId?: string }) {
    return this.database.run(auth, async (tx) => {
      const { from, to } = monthRange(q.month);
      const emps = await many<{ id: string; code: string; fullName: string; department: string | null; doj: string; exitDate: string | null }>(
        tx,
        sql`select e.id, e.code, e.full_name as "fullName", d.name as department, e.date_of_joining::text as doj, e.exit_date::text as "exitDate"
            from employees e left join hr_departments d on d.id = e.department_id
            where e.date_of_joining <= ${to} and (e.exit_date is null or e.exit_date >= ${from})
              ${q.departmentId ? sql`and e.department_id = ${q.departmentId}` : sql``}
              ${q.locationId ? sql`and e.location_id = ${q.locationId}` : sql``}
              ${q.employeeId ? sql`and e.id = ${q.employeeId}` : sql``}
            order by e.code limit 2000`,
      );
      const ids = emps.map((e) => e.id);
      const rows = ids.length
        ? await tx
            .select({ employeeId: attendanceDays.employeeId, date: attendanceDays.date, status: attendanceDays.status, workedMinutes: attendanceDays.workedMinutes, lateMinutes: attendanceDays.lateMinutes, otMinutes: attendanceDays.otMinutes, leaveDays: attendanceDays.leaveDays, payableDays: attendanceDays.payableDays, leaveCode: leaveTypes.code, leavePaid: leaveTypes.isPaid, isLocked: attendanceDays.isLocked })
            .from(attendanceDays)
            .leftJoin(leaveTypes, eq(leaveTypes.id, attendanceDays.leaveTypeId))
            .where(and(inArray(attendanceDays.employeeId, ids), gte(attendanceDays.date, from), lte(attendanceDays.date, to)))
        : [];
      const byEmp = new Map<string, typeof rows>();
      for (const r of rows) byEmp.set(r.employeeId, [...(byEmp.get(r.employeeId) ?? []), r]);
      const dates = datesIn(from, to);
      return {
        month: q.month,
        dates,
        rows: emps.map((e) => {
          const ds = byEmp.get(e.id) ?? [];
          const start = e.doj > from ? e.doj : from;
          const end = e.exitDate && e.exitDate < to ? e.exitDate : to;
          const employable = start <= end ? daysBetween(start, end) + 1 : 0;
          const n = (s: string) => ds.filter((d) => d.status === s).length;
          const sum = (f: (d: (typeof ds)[number]) => number) => ds.reduce((s, d) => s + f(d), 0);
          const payable = sum((d) => Number(d.payableDays));
          const paidLeave = sum((d) => (d.leavePaid ? Number(d.leaveDays) : 0));
          // Weekly overtime under s.51, week by week (Monday start).
          const weeks = new Map<string, typeof ds>();
          for (const d of ds) {
            const monday = addDays(d.date, -((weekday(d.date) + 6) % 7));
            weeks.set(monday, [...(weeks.get(monday) ?? []), d]);
          }
          const dailyOt = sum((d) => d.otMinutes);
          const weeklyOt = [...weeks.values()].reduce((s, w) => s + weeklyExtraOt(w), 0);
          return {
            employeeId: e.id,
            code: e.code,
            fullName: e.fullName,
            department: e.department,
            days: Object.fromEntries(ds.map((d) => [d.date, d.status === 'leave' || (Number(d.leaveDays) > 0 && d.leaveCode) ? (d.status === 'leave' ? d.leaveCode ?? 'L' : `HD/${d.leaveCode}`) : CODE[d.status] ?? d.status])),
            summary: {
              employableDays: employable,
              processedDays: ds.length,
              present: n('present') + n('half_day') * 0.5,
              absent: n('absent') + n('missed_punch'),
              missedPunches: n('missed_punch'),
              weeklyOffs: n('weekly_off'),
              holidays: n('holiday'),
              paidLeave,
              unpaidLeave: sum((d) => (d.leavePaid === false ? Number(d.leaveDays) : 0)),
              payableDays: payable,
              lopDays: Math.max(0, employable - payable),
              lateDays: ds.filter((d) => d.lateMinutes > 0).length,
              otHours: Math.round(((dailyOt + weeklyOt) / 60) * 100) / 100,
              locked: ds.some((d) => d.isLocked),
            },
          };
        }),
      };
    });
  }

  /** One employee's day: the computed result, the raw punches and any regularisation. */
  day(auth: AuthContext, employeeId: string, date: string) {
    return this.database.run(auth, async (tx) => {
      await this.assertCanSee(tx, auth, employeeId);
      const [d] = await tx.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, date)));
      const punches = await tx
        .select({ id: attendancePunches.id, punchedAt: attendancePunches.punchedAt, source: attendancePunches.source, insideFence: attendancePunches.insideFence, distanceMetres: attendancePunches.distanceMetres, hasSelfie: sql<boolean>`${attendancePunches.selfieId} is not null` })
        .from(attendancePunches)
        .where(and(eq(attendancePunches.employeeId, employeeId), gte(attendancePunches.punchedAt, at(addDays(date, -1), '12:00')), lt(attendancePunches.punchedAt, at(addDays(date, 1), '14:00'))))
        .orderBy(asc(attendancePunches.punchedAt));
      const regs = await tx.select().from(attendanceRegularisations).where(and(eq(attendanceRegularisations.employeeId, employeeId), eq(attendanceRegularisations.date, date))).orderBy(desc(attendanceRegularisations.createdAt));
      return { day: d ?? null, punches, regularisations: regs };
    });
  }

  private async assertCanSee(tx: Transaction, auth: AuthContext, employeeId: string) {
    const perms = await permissionsOf(this.database, auth);
    if (perms.has('hr.attendance.read')) return;
    const [e] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId));
    if (e?.userId === auth.userId || (await isManagerOf(tx, auth, employeeId))) return;
    throw new ForbiddenException('You can only see your own or your team’s attendance');
  }

  // ---- regularisation ---------------------------------------------------------------------

  regularisations(auth: AuthContext, q: { status?: string }) {
    return this.database.run(auth, async (tx) => {
      const perms = await permissionsOf(this.database, auth);
      const all = perms.has('hr.attendance.read');
      return many(
        tx,
        sql`select r.id, r.date::text as date, r.in_at as "inAt", r.out_at as "outAt", r.reason, r.status, r.decision_note as "decisionNote", r.created_at as "createdAt",
                   e.id as "employeeId", e.code, e.full_name as "fullName", coalesce(m.user_id = ${auth.userId}, false) as "isManager", (e.user_id = ${auth.userId}) as "isOwn"
            from attendance_regularisations r join employees e on e.id = r.employee_id
            left join employees m on m.id = e.reports_to_id
            where true ${q.status ? sql`and r.status = ${q.status}` : sql``}
              ${all ? sql`` : sql`and (e.user_id = ${auth.userId} or m.user_id = ${auth.userId})`}
            order by r.created_at desc limit 500`,
      );
    });
  }

  requestRegularisation(auth: AuthContext, input: z.infer<typeof regulariseSchema>) {
    return this.database.run(auth, async (tx) => {
      const perms = await permissionsOf(this.database, auth);
      const who = await subjectOf(tx, auth, perms, 'hr.attendance.manage', input.employeeId);
      if (input.date > todayIST()) throw new BadRequestException('Regularise a day that has passed');
      if (daysBetween(input.date, todayIST()) > 62) throw new BadRequestException('Regularisation is allowed for the last 62 days');
      const [lockedDay] = await tx.select({ id: attendanceDays.id }).from(attendanceDays).where(and(eq(attendanceDays.employeeId, who.employeeId), eq(attendanceDays.date, input.date), eq(attendanceDays.isLocked, true)));
      if (lockedDay) throw new BadRequestException('Payroll for that day is closed');
      const inAt = input.inTime ? at(input.date, input.inTime) : null;
      let outAt = input.outTime ? at(input.date, input.outTime) : null;
      if (inAt && outAt && outAt <= inAt) outAt = at(addDays(input.date, 1), input.outTime!);
      const [r] = await tx.insert(attendanceRegularisations).values({ tenantId: auth.tenantId, employeeId: who.employeeId, date: input.date, inAt, outAt, reason: input.reason, requestedBy: auth.userId }).returning();
      return r;
    });
  }

  decideRegularisation(auth: AuthContext, id: string, input: z.infer<typeof decideSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(attendanceRegularisations).where(eq(attendanceRegularisations.id, id)).for('update');
      if (!r) throw new NotFoundException('Regularisation not found');
      if (r.status !== 'pending') throw new BadRequestException(`This request is already ${r.status}`);
      const perms = await permissionsOf(this.database, auth);
      const [own] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, r.employeeId));
      if (own?.userId === auth.userId) throw new ForbiddenException('You cannot decide your own request');
      if (!perms.has('hr.attendance.manage') && !(await isManagerOf(tx, auth, r.employeeId))) throw new ForbiddenException('Only HR or the reporting manager can decide this');
      await tx.update(attendanceRegularisations).set({ status: input.approve ? 'approved' : 'rejected', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: input.note ?? null }).where(eq(attendanceRegularisations.id, id));
      if (input.approve) {
        const punches = [r.inAt, r.outAt].filter((t): t is Date => !!t).map((t) => ({ employeeId: r.employeeId, punchedAt: t, source: 'regularisation', createdBy: auth.userId }));
        await this.insertPunches(tx, auth.tenantId, punches);
        await this.processRange(tx, auth.tenantId, r.date, r.date, [r.employeeId]);
      }
      return { status: input.approve ? 'approved' : 'rejected' };
    });
  }
}
