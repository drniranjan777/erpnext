import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import { attachments, companies, employeeDocuments, employeeEvents, employeeFamily, employeeLetters, employees, letterTemplates, memberships, users, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../documents/storage.service';
import { aadhaarValid, esicValid, ifscValid, maskPan, panValid, uanValid } from './ids';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const up = (v: string | null | undefined) => (v ? v.trim().toUpperCase() : v);
const date = z.iso.date().nullable().optional();

const addrText = (max: number) => z.string().trim().max(max).optional();
const address = z.object({ line1: addrText(200), line2: addrText(200), city: addrText(80), district: addrText(80), stateCode: addrText(2), pincode: addrText(6) }).default({});
const familySchema = z.object({
  name: z.string().trim().min(2).max(120),
  relation: z.enum(['spouse', 'father', 'mother', 'son', 'daughter', 'brother', 'sister', 'other']),
  dateOfBirth: date,
  isDependent: z.boolean().default(false),
  nomineeFor: z.array(z.enum(['pf', 'gratuity', 'insurance', 'esi'])).default([]),
  nomineeSharePct: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())),
});

const body = {
  code: z.string().trim().max(20).optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: optionalText(80),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  dateOfBirth: date,
  bloodGroup: optionalText(5),
  maritalStatus: z.enum(['single', 'married', 'widowed', 'divorced']).nullable().optional(),
  fatherOrSpouseName: optionalText(120),
  personalEmail: z.email().nullable().optional(),
  mobile: z.string().regex(/^[6-9]\d{9}$/, 'A 10-digit mobile number').nullable().optional(),
  currentAddress: address,
  permanentAddress: address,
  emergencyContact: optionalText(120),
  emergencyPhone: optionalText(15),
  dateOfJoining: z.iso.date(),
  probationEnd: date,
  employmentType: z.enum(['permanent', 'probation', 'contract', 'trainee', 'apprentice', 'consultant']).default('probation'),
  category: z.enum(['staff', 'worker', 'management']).default('staff'),
  departmentId: z.uuid().nullable().optional(),
  designationId: z.uuid().nullable().optional(),
  gradeId: z.uuid().nullable().optional(),
  locationId: z.uuid().nullable().optional(),
  reportsToId: z.uuid().nullable().optional(),
  userId: z.uuid().nullable().optional(),
  workEmail: z.email().nullable().optional(),
  noticeDays: z.number().int().min(0).max(180).default(30),
  /** Sent in clear, stored encrypted. Omit to keep what is stored; null to clear. */
  pan: z.string().trim().nullable().optional(),
  aadhaar: z.string().trim().nullable().optional(),
  uan: optionalText(12),
  pfNumber: optionalText(40),
  esicNumber: optionalText(17),
  bankName: optionalText(80),
  bankAccount: z.string().trim().regex(/^\d{6,20}$/, 'Account number: 6 to 20 digits').nullable().optional(),
  ifsc: optionalText(11),
  pfApplicable: z.boolean().default(true),
  esiApplicable: z.boolean().default(true),
  ptApplicable: z.boolean().default(true),
  lwfApplicable: z.boolean().default(true),
  taxRegime: z.enum(['new', 'old']).default('new'),
  family: z.array(familySchema).max(20).default([]),
};
export const createEmployeeSchema = z.object(body);
export type EmployeeInput = z.infer<typeof createEmployeeSchema>;
export const updateEmployeeSchema = z.object({ ...body, version: z.number().int() });
export const moveSchema = z
  .object({
    kind: z.enum(['transfer', 'promotion', 'redesignation']),
    effectiveDate: z.iso.date(),
    departmentId: z.uuid().nullable().optional(),
    designationId: z.uuid().nullable().optional(),
    gradeId: z.uuid().nullable().optional(),
    locationId: z.uuid().nullable().optional(),
    reportsToId: z.uuid().nullable().optional(),
    remarks: optionalText(1000),
  })
  .refine((m) => m.departmentId !== undefined || m.designationId !== undefined || m.gradeId !== undefined || m.locationId !== undefined || m.reportsToId !== undefined, { message: 'Say what changes' });
export const exitSchema = z.object({ exitDate: z.iso.date(), reason: z.string().trim().min(3).max(500) });
export const letterSchema = z.object({ templateId: z.uuid(), issuedOn: z.iso.date().optional(), extra: z.record(z.string(), z.string().max(500)).default({}) });
export const templateSchema = z.object({ code: z.string().trim().min(1).max(30), name: z.string().trim().min(2).max(120), kind: z.enum(['offer', 'appointment', 'confirmation', 'promotion', 'transfer', 'increment', 'experience', 'relieving', 'warning', 'other']), body: z.string().trim().min(10).max(50_000), isActive: z.boolean().default(true) });
const DOC_KINDS = ['id_proof', 'address_proof', 'education', 'experience', 'offer', 'appointment', 'medical', 'other'] as const;
const DOC_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

/**
 * The employee master and service record. PAN, Aadhaar and the bank account are encrypted at
 * rest (AES-256-GCM) and shown masked; the unmasked value needs `hr.employees.sensitive` and is
 * audited each time it is read.
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  list(auth: AuthContext, q: { status?: string; departmentId?: string; locationId?: string; q?: string; limit: number; offset: number }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q ? `%${q.q}%` : null;
      const rows = await many(
        tx,
        sql`select e.id, e.code, e.full_name as "fullName", e.status, e.category, e.employment_type as "employmentType", e.date_of_joining::text as "dateOfJoining", e.mobile,
                   d.name as department, g.name as designation, l.name as location, m.full_name as manager, count(*) over ()::int as total
            from employees e left join hr_departments d on d.id = e.department_id left join hr_designations g on g.id = e.designation_id
            left join hr_locations l on l.id = e.location_id left join employees m on m.id = e.reports_to_id
            where true
              ${q.status ? sql`and e.status = ${q.status}` : sql`and e.status <> 'exited'`}
              ${q.departmentId ? sql`and e.department_id = ${q.departmentId}` : sql``}
              ${q.locationId ? sql`and e.location_id = ${q.locationId}` : sql``}
              ${term ? sql`and (e.code ilike ${term} or e.full_name ilike ${term} or e.mobile ilike ${term})` : sql``}
            order by e.code limit ${sql`${q.limit}::int`} offset ${sql`${q.offset}::int`}`,
      );
      return { total: (rows[0] as { total?: number } | undefined)?.total ?? 0, items: rows };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.view(tx, auth, id));
  }

  create(auth: AuthContext, input: EmployeeInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const code = input.code ? input.code.toUpperCase() : await this.nextCode(tx);
      const values = await this.values(tx, auth, input, null);
      let row: typeof employees.$inferSelect;
      try {
        [row] = await tx.insert(employees).values({ tenantId: auth.tenantId, code, ...values, createdBy: auth.userId } as typeof employees.$inferInsert).returning();
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505') throw new ConflictException(`Employee code ${code} is already used, or that login belongs to another employee`);
        throw e;
      }
      await this.writeFamily(tx, auth, row.id, input.family);
      await tx.insert(employeeEvents).values({ tenantId: auth.tenantId, employeeId: row.id, kind: 'joined', effectiveDate: input.dateOfJoining, to: await this.positionNames(tx, row), recordedBy: auth.userId });
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'hr.employee.created', entityType: 'employee', entityId: row.id, metadata: { code }, ...meta });
      return this.view(tx, auth, row.id);
    });
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof updateEmployeeSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [cur] = await tx.select().from(employees).where(eq(employees.id, id)).for('update');
      if (!cur) throw new NotFoundException('Employee not found');
      if (cur.version !== input.version) throw new ConflictException('Someone else changed this employee: reload and try again');
      if (cur.status === 'exited') throw new ConflictException('The employee has left; the record is closed');
      // Org placement changes go through transfers / promotions so they are on the service record.
      for (const k of ['departmentId', 'designationId', 'gradeId', 'locationId', 'reportsToId'] as const) {
        if (input[k] !== undefined && (input[k] ?? null) !== cur[k]) throw new BadRequestException(`Change the ${k.replace('Id', '').replace('reportsTo', 'manager')} with a transfer or promotion`);
      }
      const values = await this.values(tx, auth, input, cur);
      await tx.update(employees).set({ ...values, code: input.code ? input.code.toUpperCase() : cur.code, version: cur.version + 1, updatedAt: new Date() }).where(eq(employees.id, id));
      await tx.delete(employeeFamily).where(eq(employeeFamily.employeeId, id));
      await this.writeFamily(tx, auth, id, input.family);
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'hr.employee.updated', entityType: 'employee', entityId: id, metadata: {}, ...meta });
      return this.view(tx, auth, id);
    });
  }

  /** Transfer, promotion or re-designation: updates the placement and records it on the service record. */
  move(auth: AuthContext, id: string, input: z.infer<typeof moveSchema>) {
    return this.database.run(auth, async (tx) => {
      const [cur] = await tx.select().from(employees).where(eq(employees.id, id)).for('update');
      if (!cur) throw new NotFoundException('Employee not found');
      if (cur.status === 'exited') throw new ConflictException('The employee has left');
      if (input.effectiveDate < cur.dateOfJoining) throw new BadRequestException('Before the date of joining');
      if (input.reportsToId === id) throw new BadRequestException('Nobody reports to themselves');
      if (input.reportsToId) await this.assertNoReportingLoop(tx, id, input.reportsToId);
      await this.checkRefs(tx, input);
      const from = await this.positionNames(tx, cur);
      const patch: Partial<typeof employees.$inferInsert> = {};
      for (const k of ['departmentId', 'designationId', 'gradeId', 'locationId', 'reportsToId'] as const) if (input[k] !== undefined) patch[k] = input[k] ?? null;
      const [next] = await tx.update(employees).set({ ...patch, version: cur.version + 1, updatedAt: new Date() }).where(eq(employees.id, id)).returning();
      const to = await this.positionNames(tx, next);
      await tx.insert(employeeEvents).values({ tenantId: auth.tenantId, employeeId: id, kind: input.kind, effectiveDate: input.effectiveDate, from, to, remarks: input.remarks, recordedBy: auth.userId });
      return this.view(tx, auth, id);
    });
  }

  confirm(auth: AuthContext, id: string, effectiveDate: string) {
    return this.database.run(auth, async (tx) => {
      const [cur] = await tx.select().from(employees).where(eq(employees.id, id)).for('update');
      if (!cur) throw new NotFoundException('Employee not found');
      if (cur.confirmedOn) throw new ConflictException('Already confirmed');
      if (cur.employmentType !== 'probation') throw new ConflictException('Only employees on probation are confirmed');
      if (effectiveDate < cur.dateOfJoining) throw new BadRequestException('Before the date of joining');
      await tx.update(employees).set({ confirmedOn: effectiveDate, employmentType: 'permanent', version: cur.version + 1, updatedAt: new Date() }).where(eq(employees.id, id));
      await tx.insert(employeeEvents).values({ tenantId: auth.tenantId, employeeId: id, kind: 'confirmation', effectiveDate, from: { employmentType: 'probation' }, to: { employmentType: 'permanent' }, recordedBy: auth.userId });
      return this.view(tx, auth, id);
    });
  }

  /** Records the last working day (full exit workflow and settlement come with 9.4). */
  exit(auth: AuthContext, id: string, input: z.infer<typeof exitSchema>) {
    return this.database.run(auth, async (tx) => {
      const [cur] = await tx.select().from(employees).where(eq(employees.id, id)).for('update');
      if (!cur) throw new NotFoundException('Employee not found');
      if (cur.status === 'exited') throw new ConflictException('Already exited');
      if (input.exitDate < cur.dateOfJoining) throw new BadRequestException('Before the date of joining');
      const [{ n }] = await many<{ n: number }>(tx, sql`select count(*)::int as n from employees where reports_to_id = ${id} and status <> 'exited'`);
      if (n) throw new ConflictException(`${n} people still report to this employee: move them first`);
      const status = input.exitDate <= todayIST() ? 'exited' : 'notice';
      await tx.update(employees).set({ status, exitDate: input.exitDate, exitReason: input.reason, version: cur.version + 1, updatedAt: new Date() }).where(eq(employees.id, id));
      await tx.insert(employeeEvents).values({ tenantId: auth.tenantId, employeeId: id, kind: 'exit', effectiveDate: input.exitDate, from: { status: cur.status }, to: { status }, remarks: input.reason, recordedBy: auth.userId });
      return this.view(tx, auth, id);
    });
  }

  /** The unmasked PAN, Aadhaar or bank account. Needs `hr.employees.sensitive`; every read is audited. */
  reveal(auth: AuthContext, id: string, field: 'pan' | 'aadhaar' | 'bankAccount', meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
      if (!perms.has('hr.employees.sensitive')) throw new ForbiddenException('Missing permission: hr.employees.sensitive');
      const [e] = await tx.select({ pan: employees.panEnc, aadhaar: employees.aadhaarEnc, bank: employees.bankAccountEnc }).from(employees).where(eq(employees.id, id));
      if (!e) throw new NotFoundException('Employee not found');
      const enc = field === 'pan' ? e.pan : field === 'aadhaar' ? e.aadhaar : e.bank;
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'hr.employee.revealed', entityType: 'employee', entityId: id, metadata: { field }, ...meta });
      return { field, value: enc ? this.crypto.decrypt(enc) : null };
    });
  }

  // ---- documents --------------------------------------------------------------------------

  async upload(auth: AuthContext, id: string, kind: string, title: string, expiryDate: string | null, file: { filename: string; mimetype: string; file: Readable }) {
    if (!DOC_TYPES.has(file.mimetype)) {
      file.file.resume();
      throw new UnsupportedMediaTypeException('Upload a PDF or an image');
    }
    if (!(DOC_KINDS as readonly string[]).includes(kind)) {
      file.file.resume();
      throw new BadRequestException('Unknown document kind');
    }
    await this.database.run(auth, async (tx) => {
      const [e] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, id));
      if (!e) throw new NotFoundException('Employee not found');
    });
    const stored = await this.storage.put(auth.tenantId, file.file, 10 * 1024 * 1024);
    return this.database.run(auth, async (tx) => {
      const name = file.filename.split(/[\\/]/).pop()!.slice(0, 200);
      const [a] = await tx.insert(attachments).values({ tenantId: auth.tenantId, entityType: 'employee', entityId: id, fileName: name, contentType: file.mimetype, sizeBytes: stored.sizeBytes, sha256: stored.sha256, storageKey: stored.key, uploadedBy: auth.userId }).returning({ id: attachments.id });
      const [d] = await tx.insert(employeeDocuments).values({ tenantId: auth.tenantId, employeeId: id, kind, title: title || name, expiryDate, attachmentId: a.id }).returning();
      return d;
    });
  }

  async download(auth: AuthContext, id: string, documentId: string) {
    const row = await this.database.run(auth, async (tx) => {
      const [d] = await tx.select({ key: attachments.storageKey, name: attachments.fileName, type: attachments.contentType, size: attachments.sizeBytes }).from(employeeDocuments).innerJoin(attachments, eq(attachments.id, employeeDocuments.attachmentId)).where(and(eq(employeeDocuments.id, documentId), eq(employeeDocuments.employeeId, id), isNull(attachments.deletedAt)));
      if (!d) throw new NotFoundException('Document not found');
      return d;
    });
    return { stream: await this.storage.open(row.key), fileName: row.name, contentType: row.type, sizeBytes: row.size };
  }

  // ---- letters ----------------------------------------------------------------------------

  templates(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(letterTemplates).orderBy(asc(letterTemplates.code)));
  }

  saveTemplate(auth: AuthContext, id: string | null, input: z.infer<typeof templateSchema>) {
    return this.database.run(auth, async (tx) => {
      try {
        if (id) {
          const [r] = await tx.update(letterTemplates).set(input).where(eq(letterTemplates.id, id)).returning();
          if (!r) throw new NotFoundException('Template not found');
          return r;
        }
        return (await tx.insert(letterTemplates).values({ tenantId: auth.tenantId, ...input }).returning())[0];
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505') throw new ConflictException(`Template code ${input.code} is already used`);
        throw e;
      }
    });
  }

  /**
   * Issues a letter: the template's {{placeholders}} are filled from the employee record
   * (employee.name, employee.code, designation, department, grade, location, doj, confirmed_on,
   * manager, company, today, date) and any extra values given; unknown placeholders are refused.
   */
  issueLetter(auth: AuthContext, id: string, input: z.infer<typeof letterSchema>) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(letterTemplates).where(eq(letterTemplates.id, input.templateId));
      if (!t || !t.isActive) throw new NotFoundException('Template not found');
      const [e] = await many<Record<string, string | null>>(
        tx,
        sql`select e.full_name, e.code, e.first_name, e.date_of_joining::text as doj, e.confirmed_on::text as confirmed_on, e.exit_date::text as exit_date,
                   d.name as department, g.name as designation, gr.name as grade, l.name as location, m.full_name as manager,
                   (select c.name from companies c where c.deleted_at is null order by c.created_at limit 1) as company
            from employees e left join hr_departments d on d.id = e.department_id left join hr_designations g on g.id = e.designation_id
            left join hr_grades gr on gr.id = e.grade_id left join hr_locations l on l.id = e.location_id left join employees m on m.id = e.reports_to_id
            where e.id = ${id}`,
      );
      if (!e) throw new NotFoundException('Employee not found');
      const issued = input.issuedOn ?? todayIST();
      const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
      const values: Record<string, string> = {
        'employee.name': e.full_name ?? '',
        'employee.first_name': e.first_name ?? '',
        'employee.code': e.code ?? '',
        designation: e.designation ?? '',
        department: e.department ?? '',
        grade: e.grade ?? '',
        location: e.location ?? '',
        manager: e.manager ?? '',
        doj: fmt(e.doj),
        confirmed_on: fmt(e.confirmed_on),
        exit_date: fmt(e.exit_date),
        company: e.company ?? '',
        today: fmt(issued),
        date: fmt(issued),
        ...input.extra,
      };
      const missing = [...new Set([...t.body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))].filter((k) => !(k in values));
      if (missing.length) throw new BadRequestException(`Give a value for ${missing.map((m) => `{{${m}}}`).join(', ')}`);
      const body = t.body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => values[k]);
      const [l] = await tx.insert(employeeLetters).values({ tenantId: auth.tenantId, employeeId: id, templateId: t.id, kind: t.kind, title: `${t.name}: ${e.full_name}`, body, issuedOn: issued, issuedBy: auth.userId }).returning();
      return l;
    });
  }

  letter(auth: AuthContext, letterId: string) {
    return this.database.run(auth, async (tx) => {
      const [l] = await tx.select().from(employeeLetters).where(eq(employeeLetters.id, letterId));
      if (!l) throw new NotFoundException('Letter not found');
      const [c] = await tx.select({ name: companies.name, address: companies.address, gstin: companies.gstin }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
      return { ...l, company: c ?? null };
    });
  }

  // ---- helpers ----------------------------------------------------------------------------

  private async nextCode(tx: Transaction) {
    const [r] = await many<{ n: number }>(tx, sql`select coalesce(max(substring(code::text from '^EMP(\\d+)$')::int), 0) + 1 as n from employees`);
    return `EMP${String(r.n).padStart(4, '0')}`;
  }

  private async checkRefs(tx: Transaction, input: { departmentId?: string | null; designationId?: string | null; gradeId?: string | null; locationId?: string | null; reportsToId?: string | null; userId?: string | null }, auth?: AuthContext) {
    const refs: [string | null | undefined, string, string][] = [
      [input.departmentId, 'hr_departments', 'Department'],
      [input.designationId, 'hr_designations', 'Designation'],
      [input.gradeId, 'hr_grades', 'Grade'],
      [input.locationId, 'hr_locations', 'Location'],
    ];
    for (const [v, table, label] of refs) {
      if (!v) continue;
      const [r] = await many<{ id: string }>(tx, sql`select id from ${sql.raw(table)} where id = ${v}`);
      if (!r) throw new BadRequestException(`${label} not found`);
    }
    if (input.reportsToId) {
      const [m] = await tx.select({ status: employees.status }).from(employees).where(eq(employees.id, input.reportsToId));
      if (!m || m.status === 'exited') throw new BadRequestException('The manager is not a current employee');
    }
    if (input.userId && auth) {
      const [m] = await tx.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, auth.tenantId), eq(memberships.userId, input.userId)));
      if (!m) throw new BadRequestException('That login is not a member of this workspace');
    }
  }

  private async assertNoReportingLoop(tx: Transaction, id: string, managerId: string) {
    const [r] = await many<{ found: boolean }>(tx, sql`with recursive up as (select id, reports_to_id from employees where id = ${managerId} union all select e.id, e.reports_to_id from employees e join up on e.id = up.reports_to_id) select exists (select 1 from up where id = ${id}) as found`);
    if (r.found) throw new BadRequestException('That manager reports (directly or not) to this employee');
  }

  /** Validated, encrypted column values; `cur` keeps stored secrets when the input omits them. */
  private async values(tx: Transaction, auth: AuthContext, input: EmployeeInput, cur: typeof employees.$inferSelect | null) {
    const errors: { path: string; message: string }[] = [];
    const pan = up(input.pan);
    const aadhaar = input.aadhaar?.replace(/\s/g, '');
    const ifsc = up(input.ifsc);
    if (pan && !panValid(pan)) errors.push({ path: 'pan', message: 'PAN looks wrong (ABCDE1234F)' });
    if (aadhaar && !aadhaarValid(aadhaar)) errors.push({ path: 'aadhaar', message: 'Aadhaar number is not valid' });
    if (ifsc && !ifscValid(ifsc)) errors.push({ path: 'ifsc', message: 'IFSC looks wrong (e.g. SBIN0001234)' });
    if (input.uan && !uanValid(input.uan)) errors.push({ path: 'uan', message: 'UAN is 12 digits' });
    if (input.esicNumber && !esicValid(input.esicNumber)) errors.push({ path: 'esicNumber', message: 'ESIC number is 10 or 17 digits' });
    if (input.bankAccount && !ifsc && !cur?.ifsc) errors.push({ path: 'ifsc', message: 'Give the IFSC with the account' });
    if (input.dateOfBirth && input.dateOfBirth > input.dateOfJoining) errors.push({ path: 'dateOfBirth', message: 'Born after joining?' });
    if (input.probationEnd && input.probationEnd < input.dateOfJoining) errors.push({ path: 'probationEnd', message: 'Probation ends before joining' });
    if (errors.length) throw new BadRequestException({ message: errors[0].message, errors });
    if (!cur) await this.checkRefs(tx, input, auth);
    else if (input.userId !== undefined && input.userId !== cur.userId) await this.checkRefs(tx, { userId: input.userId }, auth);
    const secret = (v: string | null | undefined, enc: string | null | undefined) => (v === undefined ? (enc ?? null) : v ? this.crypto.encrypt(v) : null);
    const { pan: _p, aadhaar: _a, bankAccount: _b, family: _f, code: _c, ...plain } = input as EmployeeInput & { version?: number };
    delete (plain as { version?: number }).version;
    return {
      ...plain,
      fullName: [input.firstName, input.lastName].filter(Boolean).join(' '),
      ifsc: ifsc ?? null,
      panEnc: secret(pan, cur?.panEnc),
      panMasked: pan === undefined ? (cur?.panMasked ?? null) : pan ? maskPan(pan) : null,
      aadhaarEnc: secret(aadhaar, cur?.aadhaarEnc),
      aadhaarLast4: aadhaar === undefined ? (cur?.aadhaarLast4 ?? null) : aadhaar ? aadhaar.slice(-4) : null,
      bankAccountEnc: secret(input.bankAccount, cur?.bankAccountEnc),
      bankAccountLast4: input.bankAccount === undefined ? (cur?.bankAccountLast4 ?? null) : input.bankAccount ? input.bankAccount.slice(-4) : null,
      departmentId: cur ? cur.departmentId : (input.departmentId ?? null),
      designationId: cur ? cur.designationId : (input.designationId ?? null),
      gradeId: cur ? cur.gradeId : (input.gradeId ?? null),
      locationId: cur ? cur.locationId : (input.locationId ?? null),
      reportsToId: cur ? cur.reportsToId : (input.reportsToId ?? null),
      userId: input.userId ?? null,
    };
  }

  private async writeFamily(tx: Transaction, auth: AuthContext, employeeId: string, family: EmployeeInput['family']) {
    for (const kind of ['pf', 'gratuity'] as const) {
      const shares = family.filter((f) => f.nomineeFor.includes(kind)).map((f) => Number(f.nomineeSharePct ?? 0));
      if (shares.length && Math.abs(shares.reduce((s, v) => s + v, 0) - 100) > 0.001) throw new BadRequestException(`${kind.toUpperCase()} nominee shares must add up to 100%`);
    }
    if (family.length) await tx.insert(employeeFamily).values(family.map((f) => ({ tenantId: auth.tenantId, employeeId, ...f, dateOfBirth: f.dateOfBirth ?? null })));
  }

  private async positionNames(tx: Transaction, e: { departmentId: string | null; designationId: string | null; gradeId: string | null; locationId: string | null; reportsToId: string | null }) {
    const [r] = await many<Record<string, string | null>>(
      tx,
      sql`select (select name from hr_departments where id = ${e.departmentId}) as department, (select name from hr_designations where id = ${e.designationId}) as designation,
                 (select name from hr_grades where id = ${e.gradeId}) as grade, (select name from hr_locations where id = ${e.locationId}) as location,
                 (select full_name from employees where id = ${e.reportsToId}) as manager`,
    );
    return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)) as Record<string, string | null>;
  }

  private async view(tx: Transaction, auth: AuthContext, id: string) {
    const [e] = await tx.select().from(employees).where(eq(employees.id, id));
    if (!e) throw new NotFoundException('Employee not found');
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const names = await this.positionNames(tx, e);
    const family = await tx.select().from(employeeFamily).where(eq(employeeFamily.employeeId, id)).orderBy(asc(employeeFamily.id));
    const events = await tx.select().from(employeeEvents).where(eq(employeeEvents.employeeId, id)).orderBy(desc(employeeEvents.effectiveDate), desc(employeeEvents.createdAt));
    const docs = await tx.select({ id: employeeDocuments.id, kind: employeeDocuments.kind, title: employeeDocuments.title, expiryDate: employeeDocuments.expiryDate, fileName: attachments.fileName, createdAt: employeeDocuments.createdAt }).from(employeeDocuments).innerJoin(attachments, eq(attachments.id, employeeDocuments.attachmentId)).where(eq(employeeDocuments.employeeId, id)).orderBy(desc(employeeDocuments.createdAt));
    const letters = await tx.select({ id: employeeLetters.id, kind: employeeLetters.kind, title: employeeLetters.title, issuedOn: employeeLetters.issuedOn }).from(employeeLetters).where(eq(employeeLetters.employeeId, id)).orderBy(desc(employeeLetters.createdAt));
    const reports = await tx.select({ id: employees.id, code: employees.code, fullName: employees.fullName }).from(employees).where(and(eq(employees.reportsToId, id), sql`${employees.status} <> 'exited'`)).orderBy(asc(employees.fullName));
    const login = e.userId ? (await tx.select({ email: users.email }).from(users).where(eq(users.id, e.userId)))[0] : null;
    const { tenantId: _t, panEnc: _p, aadhaarEnc: _a, bankAccountEnc: _b, ...rest } = e;
    return {
      ...rest,
      ...names,
      login: login?.email ?? null,
      hasPan: !!e.panEnc,
      hasAadhaar: !!e.aadhaarEnc,
      hasBankAccount: !!e.bankAccountEnc,
      family: family.map(({ tenantId: _ft, employeeId: _fe, ...f }) => f),
      events: events.map(({ tenantId: _et, employeeId: _ee, ...v }) => v),
      documents: docs,
      letters,
      reports,
      canSeeSensitive: perms.has('hr.employees.sensitive'),
      canManage: perms.has('hr.employees.manage') && e.status !== 'exited',
    };
  }

  /** People search for pickers (managers, trainees…). */
  search(auth: AuthContext, q: string) {
    return this.database.run(auth, (tx) =>
      tx
        .select({ id: employees.id, code: employees.code, fullName: employees.fullName })
        .from(employees)
        .where(and(sql`${employees.status} <> 'exited'`, q ? or(ilike(employees.code, `%${q}%`), ilike(employees.fullName, `%${q}%`)) : undefined))
        .orderBy(asc(employees.fullName))
        .limit(20),
    );
  }
}
