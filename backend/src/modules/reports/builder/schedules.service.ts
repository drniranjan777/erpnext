import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { reportSchedules, savedReports, tenants, type Transaction } from '@nextgen/database';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth-context';
import { loadPermissions } from '../../../common/guards';
import { DatabaseService } from '../../../database/database.service';
import { JobsService } from '../../jobs/jobs.service';
import { MailService } from '../../notifications/mail.service';
import { REPORTS, ReportsService } from '../reports.service';
import { BuilderService } from './builder.service';
import { nextRun } from './schedule-time';

const QUEUE = 'report-schedule';

export const scheduleSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    savedReportId: z.uuid().nullable().optional(),
    reportKey: z.string().regex(/^[a-z0-9-]{2,60}$/).nullable().optional(),
    params: z.record(z.string().regex(/^[a-zA-Z]{1,30}$/), z.string().max(80)).default({}),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    weekday: z.number().int().min(1).max(7).nullable().optional(),
    monthDay: z.number().int().min(1).max(28).nullable().optional(),
    hour: z.number().int().min(0).max(23).default(8),
    recipients: z.array(z.email()).min(1, 'Add at least one email address').max(20),
    format: z.enum(['xlsx', 'csv']).default('xlsx'),
    isActive: z.boolean().default(true),
  })
  .refine((s) => !!s.savedReportId !== !!s.reportKey, { message: 'Choose one report', path: ['reportKey'] })
  .refine((s) => s.frequency !== 'weekly' || !!s.weekday, { message: 'Choose the day of the week', path: ['weekday'] })
  .refine((s) => s.frequency !== 'monthly' || !!s.monthDay, { message: 'Choose the day of the month', path: ['monthDay'] });
export type ScheduleInput = z.infer<typeof scheduleSchema>;

type Schedule = typeof reportSchedules.$inferSelect;

/**
 * Scheduled email delivery of standard and saved reports. Each run is a job at the next run
 * time (deduplicated per schedule and time); a job whose time no longer matches the schedule
 * is stale and does nothing. Runs use the owner's current permissions.
 */
@Injectable()
export class SchedulesService implements OnModuleInit {
  private readonly logger = new Logger('ReportSchedules');

  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
    private readonly reports: ReportsService,
    private readonly builder: BuilderService,
  ) {}

  onModuleInit() {
    this.jobs.register(QUEUE, async (payload, ctx) => {
      await this.fire(ctx.tenantId, String(payload.scheduleId), String(payload.runAt));
    });
  }

  private async plan(tx: Transaction, s: Schedule) {
    if (!s.isActive) return null;
    const at = nextRun(new Date(), { frequency: s.frequency as 'daily', hour: s.hour, weekday: s.weekday, monthDay: s.monthDay });
    await tx.update(reportSchedules).set({ nextRunAt: at }).where(eq(reportSchedules.id, s.id));
    await this.jobs.enqueue(tx, s.tenantId, QUEUE, { scheduleId: s.id, runAt: at.toISOString() }, { runAt: at, dedupeKey: `${QUEUE}:${s.id}:${at.toISOString()}`, maxAttempts: 3 });
    return at;
  }

  list(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx.select().from(reportSchedules).where(eq(reportSchedules.ownerId, auth.userId)).orderBy(asc(reportSchedules.name));
      return rows.map(({ tenantId: _t, membershipId: _m, ...r }) => ({ ...r, reportTitle: r.reportKey ? (REPORTS.find((x) => x.key === r.reportKey)?.title ?? r.reportKey) : null }));
    });
  }

  async save(auth: AuthContext, id: string | null, input: ScheduleInput) {
    // The report must exist and the owner must be able to run it now.
    if (input.reportKey) await this.reports.find(auth, input.reportKey);
    if (input.savedReportId) await this.builder.get(auth, input.savedReportId);
    return this.database.run(auth, async (tx) => {
      const values = {
        name: input.name,
        savedReportId: input.savedReportId ?? null,
        reportKey: input.reportKey ?? null,
        params: input.params,
        frequency: input.frequency,
        weekday: input.frequency === 'weekly' ? (input.weekday ?? null) : null,
        monthDay: input.frequency === 'monthly' ? (input.monthDay ?? null) : null,
        hour: input.hour,
        recipients: input.recipients,
        format: input.format,
        isActive: input.isActive,
        updatedBy: auth.userId,
      };
      let row: Schedule;
      if (id) {
        const [cur] = await tx.select().from(reportSchedules).where(eq(reportSchedules.id, id));
        if (!cur || cur.ownerId !== auth.userId) throw new NotFoundException('Schedule not found');
        [row] = await tx.update(reportSchedules).set({ ...values, nextRunAt: null, updatedAt: new Date() }).where(eq(reportSchedules.id, id)).returning();
      } else {
        [row] = await tx.insert(reportSchedules).values({ ...values, tenantId: auth.tenantId, ownerId: auth.userId, membershipId: auth.membershipId, createdBy: auth.userId }).returning();
      }
      const next = await this.plan(tx, row);
      return { id: row.id, nextRunAt: next };
    });
  }

  async remove(auth: AuthContext, id: string) {
    await this.database.run(auth, async (tx) => {
      const [cur] = await tx.select().from(reportSchedules).where(eq(reportSchedules.id, id));
      if (!cur || cur.ownerId !== auth.userId) throw new NotFoundException('Schedule not found');
      await tx.delete(reportSchedules).where(eq(reportSchedules.id, id));
    });
  }

  /** Sends the report now, without changing the schedule. */
  async runNow(auth: AuthContext, id: string) {
    const [s] = await this.database.run(auth, (tx) => tx.select().from(reportSchedules).where(eq(reportSchedules.id, id)));
    if (!s || s.ownerId !== auth.userId) throw new NotFoundException('Schedule not found');
    return this.deliver(s);
  }

  /** Job handler: send, record the outcome and plan the next run. */
  private async fire(tenantId: string, scheduleId: string, runAt: string) {
    const [s] = await this.database.run({ tenantId }, (tx) => tx.select().from(reportSchedules).where(eq(reportSchedules.id, scheduleId)));
    if (!s || !s.isActive || s.nextRunAt?.toISOString() !== runAt) return; // deleted, paused or rescheduled
    await this.deliver(s);
    await this.database.run({ tenantId, userId: s.ownerId }, async (tx) => {
      const [fresh] = await tx.select().from(reportSchedules).where(eq(reportSchedules.id, s.id));
      if (fresh) await this.plan(tx, fresh);
    });
  }

  private async deliver(s: Schedule) {
    const auth = { tenantId: s.tenantId, userId: s.ownerId, membershipId: s.membershipId, sessionId: '' } as AuthContext;
    let status: 'sent' | 'failed' = 'sent';
    let error: string | null = null;
    try {
      auth.permissions = await loadPermissions(this.database, s.tenantId, s.ownerId, s.membershipId);
      let file: { name: string; type: string; body: Buffer };
      let title: string;
      let rows: number;
      if (s.savedReportId) {
        const [saved] = await this.database.run(auth, (tx) => tx.select().from(savedReports).where(eq(savedReports.id, s.savedReportId!)));
        if (!saved) throw new BadRequestException('The saved report no longer exists');
        const data = await this.builder.runSpec(auth, saved.spec as never, saved.name, `saved-${saved.id}`);
        title = saved.name;
        rows = data.rows.length;
        file = await this.builder.exportSpec(auth, saved.spec as never, s.format as 'xlsx', saved.name, saved.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
      } else {
        const data = await this.reports.run(auth, s.reportKey!, s.params);
        title = data.title;
        rows = data.rows.length;
        file = await this.reports.export(auth, s.reportKey!, s.params, s.format as 'xlsx');
      }
      const [t] = await this.database.run(auth, (tx) => tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, s.tenantId)));
      for (const to of s.recipients) {
        await this.mail.send({
          to,
          workspace: t?.name ?? 'NextGen ERP',
          message: { title: `${title} (${s.name})`, body: `${title}, ${rows} row${rows === 1 ? '' : 's'}, is attached. This is the ${s.frequency} delivery set up in NextGen ERP.`, link: s.reportKey ? `/reports/${s.reportKey}` : `/reports/builder?saved=${s.savedReportId}`, action: 'Open in NextGen ERP' },
          attachments: [{ filename: file.name, content: file.body, contentType: file.type }],
        });
      }
    } catch (e) {
      status = 'failed';
      error = e instanceof ForbiddenException ? 'The owner no longer has access to this report' : e instanceof Error ? e.message : 'Failed';
      this.logger.warn(`Schedule ${s.id} failed: ${error}`);
    }
    await this.database.run(auth, (tx) => tx.update(reportSchedules).set({ lastRunAt: new Date(), lastStatus: status, lastError: error }).where(eq(reportSchedules.id, s.id)));
    return { status, error };
  }
}
