import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { maintAssets, pmSchedules } from '@nextgen/database';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { MaintenanceOrdersService } from './orders.service';
import { many } from '../../common/sql';

const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const scheduleSchema = z
  .object({
    assetId: z.uuid().nullable().optional(),
    toolId: z.uuid().nullable().optional(),
    title: z.string().trim().min(3).max(160),
    trigger: z.enum(['time', 'meter']).default('time'),
    intervalDays: z.number().int().min(1).max(3650).nullable().optional(),
    intervalMeter: z
      .union([z.string(), z.number()])
      .nullable()
      .optional()
      .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())),
    /** First due date (time) or meter reading (meter); defaults from today / the current meter. */
    firstDue: z.iso.date().nullable().optional(),
    checklist: z.array(z.string().trim().min(1).max(300)).max(60).default([]),
    estimatedMinutes: z.number().int().min(1).max(10_000).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((s, ctx) => {
    if (!s.assetId && !s.toolId) ctx.addIssue({ code: 'custom', path: ['assetId'], message: 'Choose the asset' });
    if (s.trigger === 'time' && !s.intervalDays) ctx.addIssue({ code: 'custom', path: ['intervalDays'], message: 'How many days between services?' });
    if (s.trigger === 'meter' && !(Number(s.intervalMeter) > 0)) ctx.addIssue({ code: 'custom', path: ['intervalMeter'], message: 'Meter interval between services' });
  });

/**
 * Preventive maintenance: schedules by calendar or meter, and the generator that opens a
 * maintenance order for each schedule that has come due (and for moulds / dies whose shot count
 * since the last service has reached their maintenance interval).
 */
@Injectable()
export class PmService {
  constructor(
    private readonly database: DatabaseService,
    private readonly orders: MaintenanceOrdersService,
  ) {}

  list(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, s.title, s.trigger, s.interval_days as "intervalDays", s.interval_meter::text as "intervalMeter", s.last_done_on::text as "lastDoneOn", s.next_due::text as "nextDue",
                   s.next_meter::text as "nextMeter", s.checklist, s.estimated_minutes as "estimatedMinutes", s.is_active as "isActive",
                   a.id as "assetId", a.code as "assetCode", a.name as "assetName", a.meter_reading::text as "meterReading", a.meter_unit as "meterUnit", t.id as "toolId", t.code as "toolCode",
                   case when not s.is_active then null
                        when s.trigger = 'time' and s.next_due < (now() at time zone 'Asia/Kolkata')::date then 'overdue'
                        when s.trigger = 'time' and s.next_due <= (now() at time zone 'Asia/Kolkata')::date + 7 then 'due'
                        when s.trigger = 'meter' and a.meter_reading >= s.next_meter then 'due' else 'ok' end as state,
                   (select d.number from maintenance_orders o join documents d on d.id = o.id where o.schedule_id = s.id and d.status in ('draft', 'pending_approval') limit 1) as "openOrder"
            from pm_schedules s left join maint_assets a on a.id = s.asset_id left join tools t on t.id = s.tool_id
            order by s.next_due nulls last, s.title`,
      ),
    );
  }

  save(auth: AuthContext, id: string | null, input: z.infer<typeof scheduleSchema>) {
    return this.database.run(auth, async (tx) => {
      let meter: string | null = null;
      if (input.assetId) {
        const [a] = await tx.select({ m: maintAssets.meterReading, unit: maintAssets.meterUnit }).from(maintAssets).where(eq(maintAssets.id, input.assetId));
        if (!a) throw new NotFoundException('Asset not found');
        if (input.trigger === 'meter' && !a.unit) throw new BadRequestException('The asset has no meter');
        meter = a.m;
      }
      const values = {
        assetId: input.assetId ?? null,
        toolId: input.toolId ?? null,
        title: input.title,
        trigger: input.trigger,
        intervalDays: input.trigger === 'time' ? (input.intervalDays ?? null) : null,
        intervalMeter: input.trigger === 'meter' ? input.intervalMeter : null,
        checklist: input.checklist,
        estimatedMinutes: input.estimatedMinutes ?? null,
        isActive: input.isActive,
      };
      if (id) {
        const [r] = await tx.update(pmSchedules).set(values).where(eq(pmSchedules.id, id)).returning();
        if (!r) throw new NotFoundException('Schedule not found');
        return r;
      }
      const first = input.trigger === 'time' ? { nextDue: input.firstDue ?? plusDays(todayIST(), input.intervalDays!) } : { nextMeter: String(Number(meter ?? 0) + Number(input.intervalMeter)) };
      return (await tx.insert(pmSchedules).values({ tenantId: auth.tenantId, ...values, ...first }).returning())[0];
    });
  }

  /**
   * Opens a maintenance order for every active schedule due within `lookahead` days (time) or
   * whose meter has passed its next reading, and for every mould / die due on shots — unless one
   * is already open for it.
   */
  async generate(auth: AuthContext, lookahead: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const due = await many<{ id: string; title: string; asset_id: string | null; tool_id: string | null; checklist: string[]; next_due: string | null }>(
        tx,
        sql`select s.id, s.title, s.asset_id, s.tool_id, s.checklist, s.next_due::text
            from pm_schedules s left join maint_assets a on a.id = s.asset_id
            where s.is_active and (a.id is null or a.status <> 'retired')
              and ((s.trigger = 'time' and s.next_due <= (now() at time zone 'Asia/Kolkata')::date + ${sql`${lookahead}::int`})
                or (s.trigger = 'meter' and a.meter_reading >= s.next_meter))
              and not exists (select 1 from maintenance_orders o join documents d on d.id = o.id where o.schedule_id = s.id and d.status in ('draft', 'pending_approval'))`,
      );
      const created: { id: string; number: string; title: string }[] = [];
      for (const s of due) {
        const o = await this.orders.createTx(tx, auth, { kind: 'preventive', assetId: s.asset_id, toolId: s.tool_id, problem: s.title, priority: 'normal', requestedBy: 'PM schedule', plannedDate: s.next_due && s.next_due > todayIST() ? s.next_due : todayIST(), machineDown: false, assignedTo: null }, meta, { scheduleId: s.id, checklist: s.checklist });
        created.push({ id: o.id, number: o.displayNumber, title: s.title });
      }
      // Moulds and dies due on shots, without a schedule of their own.
      const moulds = await many<{ id: string; code: string; since: number; every: number }>(
        tx,
        sql`select t.id, t.code, (t.shots_used - t.last_maintenance_at) as since, t.maintenance_every as every from tools t
            where t.maintenance_every is not null and t.status <> 'retired' and t.shots_used - t.last_maintenance_at >= t.maintenance_every
              and not exists (select 1 from pm_schedules s where s.tool_id = t.id)
              and not exists (select 1 from maintenance_orders o join documents d on d.id = o.id where o.tool_id = t.id and d.status in ('draft', 'pending_approval'))`,
      );
      for (const t of moulds) {
        const o = await this.orders.createTx(tx, auth, { kind: 'preventive', assetId: null, toolId: t.id, problem: `${t.code}: ${t.since} shots since the last service (every ${t.every})`, priority: 'normal', requestedBy: 'Shot counter', plannedDate: todayIST(), machineDown: false, assignedTo: null }, meta);
        created.push({ id: o.id, number: o.displayNumber, title: `${t.code} shot service` });
      }
      return { created };
    });
  }

  /** PM orders signed off in the period and how many were done by their planned date. */
  compliance(auth: AuthContext, q: { from: string; to: string }) {
    return this.database.run(auth, async (tx) => {
      const [r] = await many(
        tx,
        sql`select count(*)::int as done, count(*) filter (where (o.finished_at at time zone 'Asia/Kolkata')::date <= coalesce(o.planned_date, d.doc_date))::int as "onTime"
            from maintenance_orders o join documents d on d.id = o.id
            where o.kind = 'preventive' and d.status = 'approved' and d.doc_date between ${q.from}::date and ${q.to}::date`,
      );
      return r;
    });
  }
}
