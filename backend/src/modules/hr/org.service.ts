import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hrDepartments, hrDesignations, hrGrades, hrLocations, type Transaction } from '@nextgen/database';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const code = z.string().trim().min(1).max(20);
const amount = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()))
  .refine((v) => v === null || /^\d{1,14}(\.\d{1,2})?$/.test(v), 'An amount');

export const departmentSchema = z.object({ code, name: z.string().trim().min(2).max(120), parentId: z.uuid().nullable().optional(), costCentre: optionalText(40), isActive: z.boolean().default(true) });
export const gradeSchema = z.object({ code, name: z.string().trim().min(1).max(80), minSalary: amount, maxSalary: amount, level: z.number().int().min(1).max(50).default(1), isActive: z.boolean().default(true) });
export const designationSchema = z.object({ code, name: z.string().trim().min(2).max(120), gradeId: z.uuid().nullable().optional(), isActive: z.boolean().default(true) });
export const locationSchema = z.object({
  code,
  name: z.string().trim().min(2).max(120),
  stateCode: z.string().regex(/^\d{2}$/, 'GST state code, e.g. 36'),
  address: z.record(z.string(), z.unknown()).default({}),
  isFactory: z.boolean().default(true),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  radiusMetres: z.number().int().min(20).max(5000).nullable().optional(),
  isActive: z.boolean().default(true),
});

type Kind = 'departments' | 'grades' | 'designations' | 'locations';
const TABLE = { departments: hrDepartments, grades: hrGrades, designations: hrDesignations, locations: hrLocations } as const;
const LABEL = { departments: 'Department', grades: 'Grade', designations: 'Designation', locations: 'Location' } as const;

/** Departments, grades, designations and work locations, plus the org chart. */
@Injectable()
export class OrgService {
  constructor(private readonly database: DatabaseService) {}

  list(auth: AuthContext, kind: Kind) {
    return this.database.run(auth, async (tx) => {
      const t = TABLE[kind];
      const rows = await tx.select().from(t).orderBy(asc(t.code));
      const counts = await many<{ id: string; n: number }>(
        tx,
        sql`select ${sql.raw(kind === 'departments' ? 'department_id' : kind === 'grades' ? 'grade_id' : kind === 'designations' ? 'designation_id' : 'location_id')} as id, count(*)::int as n from employees where status <> 'exited' group by 1`,
      );
      return rows.map(({ tenantId: _t, ...r }) => ({ ...r, employees: counts.find((c) => c.id === r.id)?.n ?? 0 }));
    });
  }

  save(auth: AuthContext, kind: Kind, id: string | null, input: Record<string, unknown>) {
    return this.database.run(auth, async (tx) => {
      const t = TABLE[kind];
      const values = { ...input } as Record<string, unknown>;
      for (const k of ['parentId', 'gradeId', 'latitude', 'longitude', 'radiusMetres']) if (k in values && values[k] === undefined) values[k] = null;
      if (kind === 'departments' && values.parentId && values.parentId === id) throw new BadRequestException('A department cannot sit under itself');
      if (kind === 'locations') for (const k of ['latitude', 'longitude']) if (values[k] !== null && values[k] !== undefined) values[k] = String(values[k]);
      if (kind === 'grades' && values.minSalary && values.maxSalary && Number(values.minSalary) > Number(values.maxSalary)) throw new BadRequestException('The band minimum is above its maximum');
      try {
        if (id) {
          const [r] = await tx.update(t).set(values).where(eq(t.id, id)).returning();
          if (!r) throw new NotFoundException(`${LABEL[kind]} not found`);
          return r;
        }
        return (await tx.insert(t).values({ tenantId: auth.tenantId, ...values } as never).returning())[0];
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505') throw new ConflictException(`${LABEL[kind]} code ${String(input.code)} is already used`);
        throw e;
      }
    });
  }

  /** Who reports to whom (active and on notice), for the org chart. */
  chart(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select e.id, e.code, e.full_name as "fullName", e.reports_to_id as "reportsToId", d.name as department, g.name as designation, e.status,
                   (select count(*)::int from employees r where r.reports_to_id = e.id and r.status <> 'exited') as reports
            from employees e left join hr_departments d on d.id = e.department_id left join hr_designations g on g.id = e.designation_id
            where e.status <> 'exited' order by e.full_name`,
      ),
    );
  }

  /** Headcount by department, location, category and gender. */
  headcount(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const by = (col: string, join = '') =>
        many(tx, sql`select coalesce(${sql.raw(col)}, '—') as key, count(*)::int as n from employees e ${sql.raw(join)} where e.status <> 'exited' group by 1 order by 2 desc`);
      return {
        total: (await many<{ n: number }>(tx, sql`select count(*)::int as n from employees where status <> 'exited'`))[0].n,
        byDepartment: await by('d.name', 'left join hr_departments d on d.id = e.department_id'),
        byLocation: await by('l.name', 'left join hr_locations l on l.id = e.location_id'),
        byCategory: await by('e.category'),
        byGender: await by('e.gender'),
        joinersThisMonth: (await many<{ n: number }>(tx, sql`select count(*)::int as n from employees where date_trunc('month', date_of_joining) = date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)`))[0].n,
        exitsThisMonth: (await many<{ n: number }>(tx, sql`select count(*)::int as n from employees where exit_date is not null and date_trunc('month', exit_date) = date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)`))[0].n,
      };
    });
  }
}
