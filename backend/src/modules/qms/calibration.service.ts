import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { calibrations, gauges, grrStudies } from '@nextgen/database';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { gaugeRR, validateStudy } from '../quality/msa';
import { many } from '../../common/sql';

const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export const gaugeSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['vernier', 'micrometer', 'gauge', 'balance', 'thermometer', 'pressure', 'other']).default('other'),
  make: optionalText(80),
  serialNo: optionalText(80),
  range: optionalText(80),
  leastCount: optionalText(40),
  location: optionalText(120),
  owner: optionalText(120),
  calibrationSource: z.enum(['internal', 'external']).default('external'),
  intervalDays: z.number().int().min(7).max(3650).default(365),
  acceptance: optionalText(500),
  /** For gauges already calibrated before they were entered. */
  lastCalibrated: z.iso.date().nullable().optional(),
  status: z.enum(['in_use', 'out_of_service', 'scrapped']).default('in_use'),
});

const dec = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d{1,12}(\.\d{1,6})?$/.test(v), 'A number');

export const calibrationSchema = z.object({
  calibratedOn: z.iso.date(),
  calibratedBy: z.string().trim().min(2).max(120),
  certificateNo: optionalText(80),
  result: z.enum(['pass', 'adjusted', 'fail']),
  points: z.array(z.object({ nominal: dec, actual: dec })).max(50).default([]),
  /** Blank = calibrated on + the gauge's interval. */
  nextDue: z.iso.date().nullable().optional(),
  notes: optionalText(1000),
});

export const grrSchema = z.object({
  studyDate: z.iso.date(),
  characteristic: z.string().trim().min(2).max(120),
  tolerance: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()))
    .refine((v) => v === null || (/^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0), 'Tolerance must be more than zero'),
  operators: z.array(z.string().trim().min(1).max(60)).min(2).max(3),
  measurements: z.array(z.array(z.array(z.number()))),
});

/**
 * Gauges and their calibration: an interval, the last and next due dates, calibration records
 * with points (nominal / actual / error) and a result. A failed calibration takes the gauge
 * out of service. Gauge R&R studies by the AIAG average-and-range method.
 */
@Injectable()
export class CalibrationService {
  constructor(private readonly database: DatabaseService) {}

  list(auth: AuthContext, q: { due?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select g.id, g.code, g.name, g.kind, g.make, g.serial_no as "serialNo", g.range, g.least_count as "leastCount", g.location, g.owner, g.calibration_source as "calibrationSource",
                   g.interval_days as "intervalDays", g.acceptance, g.last_calibrated::text as "lastCalibrated", g.next_due::text as "nextDue", g.status,
                   case when g.status <> 'in_use' then null
                        when g.next_due is null or g.next_due < (now() at time zone 'Asia/Kolkata')::date then 'overdue'
                        when g.next_due <= (now() at time zone 'Asia/Kolkata')::date + 15 then 'due_soon' else 'ok' end as "dueState"
            from gauges g
            where g.status <> 'scrapped' ${q.due === 'true' ? sql`and g.status = 'in_use' and (g.next_due is null or g.next_due <= (now() at time zone 'Asia/Kolkata')::date + 15)` : sql``}
            order by g.next_due nulls first, g.code`,
      ),
    );
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [g] = await tx.select().from(gauges).where(eq(gauges.id, id));
      if (!g) throw new NotFoundException('Gauge not found');
      const cals = await tx.select().from(calibrations).where(eq(calibrations.gaugeId, id)).orderBy(desc(calibrations.calibratedOn));
      const studies = await tx.select().from(grrStudies).where(eq(grrStudies.gaugeId, id)).orderBy(desc(grrStudies.studyDate));
      const { tenantId: _t, ...rest } = g;
      return { ...rest, calibrations: cals.map(({ tenantId: _c, ...c }) => c), studies: studies.map(({ tenantId: _s, measurements: _m, ...s }) => s) };
    });
  }

  save(auth: AuthContext, id: string | null, input: z.infer<typeof gaugeSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, lastCalibrated: input.lastCalibrated ?? null, nextDue: input.lastCalibrated ? plusDays(input.lastCalibrated, input.intervalDays) : null };
      try {
        if (id) {
          const [cur] = await tx.select().from(gauges).where(eq(gauges.id, id));
          if (!cur) throw new NotFoundException('Gauge not found');
          // The calibration history drives the dates once there is one.
          const last = input.lastCalibrated ?? cur.lastCalibrated;
          const [r] = await tx.update(gauges).set({ ...values, lastCalibrated: last, nextDue: last ? plusDays(last, input.intervalDays) : null }).where(eq(gauges.id, id)).returning();
          return r;
        }
        const [r] = await tx.insert(gauges).values({ tenantId: auth.tenantId, ...values }).returning();
        return r;
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505') throw new ConflictException(`Gauge code ${input.code} is already used`);
        throw e;
      }
    });
  }

  calibrate(auth: AuthContext, gaugeId: string, input: z.infer<typeof calibrationSchema>) {
    return this.database.run(auth, async (tx) => {
      const [g] = await tx.select().from(gauges).where(eq(gauges.id, gaugeId));
      if (!g) throw new NotFoundException('Gauge not found');
      if (g.status === 'scrapped') throw new ConflictException('The gauge is scrapped');
      if (g.lastCalibrated && input.calibratedOn < g.lastCalibrated) throw new BadRequestException('A later calibration is already recorded');
      const next = input.result === 'fail' ? null : (input.nextDue ?? plusDays(input.calibratedOn, g.intervalDays));
      if (next && next <= input.calibratedOn) throw new BadRequestException('The next due date must be after the calibration');
      const points = input.points.map((p) => ({ ...p, error: String(Math.round((Number(p.actual) - Number(p.nominal)) * 1e6) / 1e6) }));
      const [c] = await tx.insert(calibrations).values({ tenantId: auth.tenantId, gaugeId, ...input, points, nextDue: next, createdBy: auth.userId }).returning();
      await tx.update(gauges).set({ lastCalibrated: input.calibratedOn, nextDue: next, status: input.result === 'fail' ? 'out_of_service' : 'in_use' }).where(eq(gauges.id, gaugeId));
      return c;
    });
  }

  study(auth: AuthContext, gaugeId: string, input: z.infer<typeof grrSchema>) {
    const problem = validateStudy(input.measurements);
    if (problem) throw new BadRequestException(problem);
    if (input.operators.length !== input.measurements.length) throw new BadRequestException('One set of measurements per operator');
    const result = gaugeRR(input.measurements, input.tolerance ? Number(input.tolerance) : null);
    return this.database.run(auth, async (tx) => {
      const [g] = await tx.select({ id: gauges.id }).from(gauges).where(eq(gauges.id, gaugeId));
      if (!g) throw new NotFoundException('Gauge not found');
      const [s] = await tx.insert(grrStudies).values({ tenantId: auth.tenantId, gaugeId, ...input, result: result as unknown as Record<string, unknown>, createdBy: auth.userId }).returning();
      return { ...s, result };
    });
  }
}
