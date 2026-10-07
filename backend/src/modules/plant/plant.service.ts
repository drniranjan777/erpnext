import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { cmAnomalies, cmModels, energyMinutes, energySettings, iotSignals, maintAssets, type Transaction } from '@nextgen/database';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { counterStep } from '../iot/counters';
import { IotService, type IngestedSignal } from '../iot/iot.service';
import { MaintenanceOrdersService } from '../maintenance/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { cmStep, excursions, intervalStart, maxDemand, meanKineticTemperature, projectedDemandKw, stdOf } from './analytics';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const CM_PURPOSES = ['vibration', 'temperature', 'current', 'pressure', 'speed', 'power_kw', 'other'];

export const energySettingsSchema = z.object({
  contractDemandKw: z.number().positive().max(1_000_000).nullable(),
  demandIntervalMinutes: z.union([z.literal(15), z.literal(30)]).default(30),
  alertPct: z.number().int().min(50).max(120).default(90),
  gridFactor: z.number().min(0).max(2).default(0.716),
  tariffPerKwh: z.number().min(0).max(100).default(8),
  mainSignalIds: z.array(z.uuid()).max(20).default([]),
});
export const cmModelSchema = z.object({
  enabled: z.boolean().default(true),
  minSamples: z.number().int().min(20).max(100_000).default(200),
  zThreshold: z.number().min(2).max(20).default(4),
  consecutive: z.number().int().min(1).max(50).default(3),
  driftThreshold: z.number().min(1).max(20).default(2.5),
  createMaintenance: z.boolean().default(true),
});
export const feedbackSchema = z.object({ feedback: z.enum(['confirmed', 'false_alarm']), note: z.string().trim().max(500).nullable().optional() });
const range = (q: { from?: string; to?: string }, defaultDays: number) => {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - defaultDays * 86_400_000);
  if (!(from < to)) throw new BadRequestException('"from" must be before "to"');
  return { from, to };
};

type Ctx = { tenantId: string; actorUserId: string | null };

/**
 * Plant monitoring on top of the IoT readings: energy per machine, per unit and per item with
 * peak-demand alerts and Scope 2 carbon; condition monitoring that learns each signal's normal
 * behaviour and raises maintenance requests on spikes and drift; cold-chain logger reports with
 * excursions and mean kinetic temperature, also per transport trip.
 */
@Injectable()
export class PlantService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly iot: IotService,
    private readonly maintenance: MaintenanceOrdersService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.iot.onIngest(async (tx, ctx, signals) => {
      await this.consumeEnergy(tx, ctx, signals.filter((s) => s.purpose === 'energy_kwh'));
      await this.consumeCondition(tx, ctx, signals.filter((s) => CM_PURPOSES.includes(s.purpose)));
    });
  }

  private async holders(tx: Transaction, permission: string) {
    return many<{ userId: string }>(
      tx,
      sql`select distinct m.user_id as "userId" from memberships m join membership_roles mr on mr.membership_id = m.id
          join role_permissions rp on rp.role_id = mr.role_id where m.status = 'active' and rp.permission_code = ${permission}`,
    );
  }

  // ---- energy ----------------------------------------------------------------------------------

  private async settings(tx: Transaction, tenantId: string) {
    const [s] = await tx.select().from(energySettings);
    return s ?? (await tx.insert(energySettings).values({ tenantId }).onConflictDoNothing().returning())[0] ?? (await tx.select().from(energySettings))[0];
  }

  private async consumeEnergy(tx: Transaction, ctx: Ctx, signals: IngestedSignal[]) {
    if (!signals.length) return;
    let latest = 0;
    for (const s of signals) {
      for (const r of s.readings) {
        const delta = await counterStep(tx, ctx.tenantId, s.id, r.value, r.ts);
        if (!delta) continue;
        const minute = new Date(Math.floor(r.ts.getTime() / 60_000) * 60_000);
        await tx
          .insert(energyMinutes)
          .values({ tenantId: ctx.tenantId, signalId: s.id, machineId: s.machineId, minute, kwh: delta })
          .onConflictDoUpdate({ target: [energyMinutes.tenantId, energyMinutes.signalId, energyMinutes.minute], set: { kwh: sql`${energyMinutes.kwh} + ${delta}` } });
        latest = Math.max(latest, r.ts.getTime());
      }
    }
    if (latest) await this.checkDemand(tx, ctx, latest);
  }

  /** Alerts once per demand interval when the projected demand nears the contract demand. */
  private async checkDemand(tx: Transaction, ctx: Ctx, ts: number) {
    const s = await this.settings(tx, ctx.tenantId);
    if (!s.contractDemandKw) return;
    const start = intervalStart(ts, s.demandIntervalMinutes);
    const elapsed = (ts - start) / 60_000;
    if (elapsed < 3 || (s.lastAlertInterval && s.lastAlertInterval.getTime() === start)) return;
    const [r] = await many<{ kwh: number }>(
      tx,
      sql`select coalesce(sum(kwh), 0)::float8 as kwh from energy_minutes where minute >= ${new Date(start).toISOString()} and minute < ${new Date(start + s.demandIntervalMinutes * 60_000).toISOString()}
          ${s.mainSignalIds.length ? sql`and signal_id in ${s.mainSignalIds}` : sql``}`,
    );
    const projected = projectedDemandKw(r.kwh, elapsed);
    if (projected < (s.contractDemandKw * s.alertPct) / 100) return;
    await tx.update(energySettings).set({ lastAlertInterval: new Date(start) }).where(eq(energySettings.id, s.id));
    const people = await this.holders(tx, 'iot.data.read');
    if (people.length)
      await this.notifications.notify(tx, ctx.tenantId, 'plant.peak_demand', people.map((p) => ({ userId: p.userId })), {
        title: `Demand heading for ${projected} kW`,
        body: `This ${s.demandIntervalMinutes}-minute interval is projected at ${projected} kW against a contract demand of ${s.contractDemandKw} kW (${Math.round((projected / s.contractDemandKw) * 100)} %). Hold back large loads to avoid a penalty.`,
        link: '/plant/energy',
      });
  }

  getEnergySettings(auth: AuthContext) {
    return this.database.run(auth, (tx) => this.settings(tx, auth.tenantId));
  }

  saveEnergySettings(auth: AuthContext, input: z.infer<typeof energySettingsSchema>) {
    return this.database.run(auth, async (tx) => {
      const s = await this.settings(tx, auth.tenantId);
      const [r] = await tx.update(energySettings).set(input).where(eq(energySettings.id, s.id)).returning();
      return r;
    });
  }

  energy(auth: AuthContext, q: { from?: string; to?: string }) {
    const { from, to } = range(q, 7);
    return this.database.run(auth, async (tx) => {
      const s = await this.settings(tx, auth.tenantId);
      const f = from.toISOString();
      const t = to.toISOString();
      const meters = await many<{ signalId: string; code: string; name: string; machineCode: string | null; kwh: number }>(
        tx,
        sql`select e.signal_id as "signalId", g.code, g.name, m.code as "machineCode", sum(e.kwh)::float8 as kwh
            from energy_minutes e join iot_signals g on g.id = e.signal_id left join machines m on m.id = e.machine_id
            where e.minute >= ${f} and e.minute < ${t} group by 1, 2, 3, 4 order by 5 desc`,
      );
      const byMachine = await many<{ machineId: string; code: string; name: string; kwh: number; good: number }>(
        tx,
        sql`select m.id as "machineId", m.code, m.name, k.kwh, coalesce(c.good, 0)::float8 as good
            from (select machine_id, sum(kwh)::float8 as kwh from energy_minutes where machine_id is not null and minute >= ${f} and minute < ${t} group by 1) k
            join machines m on m.id = k.machine_id
            left join (select machine_id, sum(good) as good from mes_counts where minute >= ${f} and minute < ${t} group by 1) c on c.machine_id = k.machine_id
            order by k.kwh desc`,
      );
      // Per item: a machine's kWh in the minutes it was counting parts of a job card go to that card's item.
      const byItem = await many<{ itemId: string; code: string; name: string; kwh: number; good: number }>(
        tx,
        sql`select i.id as "itemId", i.code, i.name, sum(e.kwh)::float8 as kwh, sum(c.good)::float8 as good
            from mes_counts c join job_cards jc on jc.id = c.job_card_id join work_orders wo on wo.id = jc.work_order_id join items i on i.id = wo.item_id
            join lateral (select coalesce(sum(kwh), 0) as kwh from energy_minutes em where em.machine_id = c.machine_id and em.minute = c.minute) e on true
            where c.minute >= ${f} and c.minute < ${t} group by 1, 2, 3 order by 4 desc`,
      );
      const daily = await many<{ day: string; kwh: number }>(
        tx,
        sql`select to_char(minute at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day, sum(kwh)::float8 as kwh from energy_minutes
            where minute >= ${f} and minute < ${t} ${s.mainSignalIds.length ? sql`and signal_id in ${s.mainSignalIds}` : sql``} group by 1 order by 1`,
      );
      const demandMinutes = await many<{ minute: string; kwh: number }>(
        tx,
        sql`select minute, sum(kwh)::float8 as kwh from energy_minutes where minute >= ${f} and minute < ${t} ${s.mainSignalIds.length ? sql`and signal_id in ${s.mainSignalIds}` : sql``} group by 1`,
      );
      const md = maxDemand(demandMinutes.map((m) => ({ minute: Date.parse(m.minute), kwh: m.kwh })), s.demandIntervalMinutes);
      const total = daily.reduce((n, d) => n + d.kwh, 0);
      const r2 = (v: number) => Math.round(v * 100) / 100;
      return {
        from,
        to,
        settings: s,
        totalKwh: r2(total),
        costInr: r2(total * s.tariffPerKwh),
        co2Kg: r2(total * s.gridFactor),
        maxDemandKw: md.kw,
        maxDemandAt: md.at ? new Date(md.at) : null,
        contractDemandKw: s.contractDemandKw,
        meters: meters.map((m) => ({ ...m, kwh: r2(m.kwh), main: s.mainSignalIds.includes(m.signalId) })),
        machines: byMachine.map((m) => ({ ...m, kwh: r2(m.kwh), kwhPerUnit: m.good > 0 ? Math.round((m.kwh / m.good) * 10_000) / 10_000 : null, co2KgPerUnit: m.good > 0 ? Math.round(((m.kwh * s.gridFactor) / m.good) * 10_000) / 10_000 : null })),
        items: byItem.map((i) => ({ ...i, kwh: r2(i.kwh), kwhPerUnit: i.good > 0 ? Math.round((i.kwh / i.good) * 10_000) / 10_000 : null })),
        daily: daily.map((d) => ({ ...d, kwh: r2(d.kwh), co2Kg: r2(d.kwh * s.gridFactor) })),
      };
    });
  }

  // ---- condition monitoring ---------------------------------------------------------------------

  private async consumeCondition(tx: Transaction, ctx: Ctx, signals: IngestedSignal[]) {
    if (!signals.length) return;
    const models = await tx
      .select()
      .from(cmModels)
      .where(and(eq(cmModels.enabled, true), sql`${cmModels.signalId} in ${signals.map((s) => s.id)}`));
    for (const m of models) {
      const s = signals.find((x) => x.id === m.signalId)!;
      let state = { n: m.n, mean: m.mean, variance: m.variance, recent: m.recent, streak: m.streak };
      let lastScore = m.lastScore;
      const [open] = await tx.select().from(cmAnomalies).where(and(eq(cmAnomalies.signalId, s.id), isNull(cmAnomalies.clearedAt)));
      let openId: string | null = open?.id ?? null;
      for (const r of s.readings) {
        const before = state;
        const step = cmStep(state, r.value, m);
        state = step.state;
        lastScore = step.anomaly === 'drift' ? step.drift : step.z;
        if (step.anomaly && !openId) {
          openId = await this.raiseAnomaly(tx, ctx, m, s, step.anomaly, r.ts, r.value, step.anomaly === 'drift' ? step.drift : step.z, before);
        } else if (openId && step.normal && state.streak === 0) {
          await tx.update(cmAnomalies).set({ clearedAt: r.ts }).where(eq(cmAnomalies.id, openId));
          openId = null;
        }
      }
      await tx.update(cmModels).set({ ...state, lastScore, updatedAt: new Date() }).where(eq(cmModels.id, m.id));
    }
  }

  private async raiseAnomaly(tx: Transaction, ctx: Ctx, m: typeof cmModels.$inferSelect, s: IngestedSignal, kind: 'spike' | 'drift', at: Date, value: number, score: number, baseline: { mean: number; variance: number }) {
    const std = stdOf(baseline);
    const [a] = await tx
      .insert(cmAnomalies)
      .values({ tenantId: ctx.tenantId, signalId: s.id, machineId: s.machineId, kind, raisedAt: at, value, score, baselineMean: Math.round(baseline.mean * 1000) / 1000, baselineStd: Math.round(std * 1000) / 1000 })
      .returning();
    const [machine] = s.machineId ? await many<{ code: string; name: string }>(tx, sql`select code, name from machines where id = ${s.machineId}`) : [];
    const what = kind === 'spike' ? `${s.code} jumped to ${value}${s.unit ? ` ${s.unit}` : ''}` : `${s.code} has drifted to about ${value}${s.unit ? ` ${s.unit}` : ''}`;
    const message = `${what}; normal is ${Math.round(baseline.mean * 100) / 100} ± ${Math.round(std * 100) / 100} (${Math.abs(score)} standard deviations).`;
    if (m.createMaintenance && s.machineId && ctx.actorUserId) {
      const [asset] = await tx.select({ id: maintAssets.id }).from(maintAssets).where(eq(maintAssets.machineId, s.machineId)).limit(1);
      if (asset) {
        const mo = await this.maintenance.createTx(
          tx,
          { tenantId: ctx.tenantId, userId: ctx.actorUserId } as AuthContext,
          { kind: 'condition', assetId: asset.id, problem: `Condition monitoring: ${message} Inspect before it fails.`, priority: 'high', requestedBy: 'Condition monitoring', assignedTo: null, reportedAt: at.toISOString() },
          { ip: null, userAgent: 'iot', requestId: `cm-${a.id}` },
        );
        await tx.update(cmAnomalies).set({ maintenanceOrderId: mo.id }).where(eq(cmAnomalies.id, a.id));
      }
    }
    const people = await this.holders(tx, 'maintenance.orders.read');
    if (people.length)
      await this.notifications.notify(tx, ctx.tenantId, 'plant.anomaly', people.map((p) => ({ userId: p.userId })), {
        title: `Unusual ${s.purpose.replace('_', ' ')} on ${machine ? `${machine.code} ${machine.name}` : s.code}`,
        body: message,
        link: '/plant/condition',
      });
    return a.id;
  }

  cmModels(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id as "signalId", s.code, s.name, s.purpose, s.unit, m.code as "machineCode", s.last_value as "lastValue",
              c.id, coalesce(c.enabled, false) as enabled, c.min_samples as "minSamples", c.z_threshold as "zThreshold", c.consecutive, c.drift_threshold as "driftThreshold",
              c.create_maintenance as "createMaintenance", c.n, c.mean, sqrt(greatest(c.variance, 0)) as std, c.recent, c.last_score as "lastScore",
              (c.n >= c.min_samples) as learned,
              (select count(*)::int from cm_anomalies a where a.signal_id = s.id and a.cleared_at is null) as "openAnomalies"
            from iot_signals s left join cm_models c on c.signal_id = s.id left join machines m on m.id = s.machine_id
            where s.purpose in ${CM_PURPOSES} and s.is_active order by s.code`,
      ),
    );
  }

  saveCmModel(auth: AuthContext, signalId: string, input: z.infer<typeof cmModelSchema>, relearn = false) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select({ id: iotSignals.id, purpose: iotSignals.purpose }).from(iotSignals).where(eq(iotSignals.id, signalId));
      if (!s) throw new NotFoundException('Signal not found');
      if (!CM_PURPOSES.includes(s.purpose)) throw new BadRequestException('Condition monitoring works on measured values (vibration, temperature, current, pressure…), not counters or states');
      const reset = relearn ? { n: 0, mean: 0, variance: 0, recent: null, streak: 0, lastScore: null } : {};
      const [m] = await tx
        .insert(cmModels)
        .values({ tenantId: auth.tenantId, signalId, ...input })
        .onConflictDoUpdate({ target: [cmModels.tenantId, cmModels.signalId], set: { ...input, ...reset, updatedAt: new Date() } })
        .returning();
      return m;
    });
  }

  anomalies(auth: AuthContext, q: { status: 'open' | 'all'; days: number }) {
    return this.database.run(auth, async (tx) => {
      const rows = await many(
        tx,
        sql`select a.id, a.kind, a.raised_at as "raisedAt", a.value, a.score, a.baseline_mean as "baselineMean", a.baseline_std as "baselineStd", a.cleared_at as "clearedAt",
              a.maintenance_order_id as "maintenanceOrderId", a.feedback, a.feedback_note as "feedbackNote", a.feedback_at as "feedbackAt", u.full_name as "feedbackBy",
              s.id as "signalId", s.code as "signalCode", s.unit, s.purpose, m.code as "machineCode", m.name as "machineName"
            from cm_anomalies a join iot_signals s on s.id = a.signal_id left join machines m on m.id = a.machine_id left join users u on u.id = a.feedback_by
            where a.raised_at > now() - make_interval(days => ${q.days}::int) ${q.status === 'open' ? sql`and (a.cleared_at is null or a.feedback is null)` : sql``}
            order by a.raised_at desc limit 300`,
      );
      const [sum] = await many<{ total: number; confirmed: number; falseAlarms: number; withMaintenance: number }>(
        tx,
        sql`select count(*)::int as total, count(*) filter (where feedback = 'confirmed')::int as confirmed, count(*) filter (where feedback = 'false_alarm')::int as "falseAlarms",
              count(*) filter (where maintenance_order_id is not null)::int as "withMaintenance"
            from cm_anomalies where raised_at > now() - make_interval(days => ${q.days}::int)`,
      );
      const judged = sum.confirmed + sum.falseAlarms;
      return { rows, summary: { ...sum, precisionPct: judged ? Math.round((sum.confirmed / judged) * 1000) / 10 : null } };
    });
  }

  feedback(auth: AuthContext, id: string, input: z.infer<typeof feedbackSchema>) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx
        .update(cmAnomalies)
        .set({ feedback: input.feedback, feedbackNote: input.note ?? null, feedbackBy: auth.userId, feedbackAt: new Date() })
        .where(eq(cmAnomalies.id, id))
        .returning();
      if (!a) throw new NotFoundException('Anomaly not found');
      return a;
    });
  }

  // ---- cold chain ------------------------------------------------------------------------------

  /** The logger's acceptable range: from its first active "outside" alarm limit, else the given one. */
  private async loggerRange(tx: Transaction, signalId: string) {
    const [r] = await many<{ low: number; high: number }>(
      tx,
      sql`select threshold as low, threshold2 as high from iot_alarm_rules where signal_id = ${signalId} and op = 'outside' and is_active order by created_at limit 1`,
    );
    return r ?? null;
  }

  private async report(tx: Transaction, signalId: string, from: Date, to: Date, low: number | null, high: number | null) {
    const [s] = await many<{ id: string; code: string; name: string; unit: string | null; purpose: string; warehouseName: string | null; vehicleNo: string | null }>(
      tx,
      sql`select s.id, s.code, s.name, s.unit, s.purpose, w.name as "warehouseName", s.vehicle_no as "vehicleNo" from iot_signals s left join warehouses w on w.id = s.warehouse_id where s.id = ${signalId}`,
    );
    if (!s) throw new NotFoundException('Logger not found');
    const set = await this.loggerRange(tx, signalId);
    const lo = low ?? set?.low ?? null;
    const hi = high ?? set?.high ?? null;
    const readings = await many<{ ts: string; value: number }>(tx, sql`select ts, value from iot_readings where signal_id = ${signalId} and ts >= ${from.toISOString()} and ts < ${to.toISOString()} order by ts`);
    const values = readings.map((r) => r.value);
    const ex = excursions(readings.map((r) => ({ ts: Date.parse(r.ts), value: r.value })), lo, hi);
    return {
      logger: s,
      from,
      to,
      range: { low: lo, high: hi },
      readings: readings.length,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      avg: values.length ? Math.round((values.reduce((n, v) => n + v, 0) / values.length) * 100) / 100 : null,
      mktC: s.purpose === 'temperature' ? meanKineticTemperature(values) : null,
      minutesOutside: ex.minutesOutside,
      excursions: ex.excursions.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) })),
    };
  }

  coldChain(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const loggers = await many<{ id: string; code: string; name: string; unit: string | null; purpose: string; warehouseName: string | null; vehicleNo: string | null; lastValue: number | null; lastAt: string | null }>(
        tx,
        sql`select s.id, s.code, s.name, s.unit, s.purpose, w.name as "warehouseName", s.vehicle_no as "vehicleNo", s.last_value as "lastValue", s.last_at as "lastAt"
            from iot_signals s left join warehouses w on w.id = s.warehouse_id
            where s.is_active and s.purpose in ('temperature', 'humidity') and (s.warehouse_id is not null or s.vehicle_no is not null) order by s.code`,
      );
      const to = new Date();
      const from = new Date(to.getTime() - 86_400_000);
      const out = [];
      for (const l of loggers) {
        const r = await this.report(tx, l.id, from, to, null, null);
        const outNow = l.lastValue !== null && ((r.range.high !== null && l.lastValue > r.range.high) || (r.range.low !== null && l.lastValue < r.range.low));
        out.push({ ...l, range: r.range, status: l.lastAt === null || to.getTime() - Date.parse(l.lastAt) > 15 * 60_000 ? 'no_data' : outNow ? 'out_of_range' : 'ok', last24h: { min: r.min, max: r.max, mktC: r.mktC, minutesOutside: r.minutesOutside, excursions: r.excursions.length } });
      }
      return out;
    });
  }

  coldChainReport(auth: AuthContext, q: { signalId: string; from?: string; to?: string; low?: number; high?: number }) {
    const { from, to } = range(q, 1);
    return this.database.run(auth, (tx) => this.report(tx, q.signalId, from, to, q.low ?? null, q.high ?? null));
  }

  /** Readings of the loggers in a trip's vehicle while the trip was on the road. */
  tripReport(auth: AuthContext, tripId: string) {
    return this.database.run(auth, async (tx) => {
      const [t] = await many<{ number: string; vehicleNo: string; dispatchedAt: string | null; completedAt: string | null }>(
        tx,
        sql`select number, vehicle_no as "vehicleNo", dispatched_at as "dispatchedAt", completed_at as "completedAt" from tms_trips where id = ${tripId}`,
      );
      if (!t) throw new NotFoundException('Trip not found');
      if (!t.dispatchedAt) throw new ConflictException('The trip has not left yet');
      const loggers = await many<{ id: string }>(
        tx,
        sql`select id from iot_signals where purpose in ('temperature', 'humidity') and upper(regexp_replace(coalesce(vehicle_no, ''), '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(${t.vehicleNo}, '[^A-Za-z0-9]', '', 'g'))`,
      );
      const from = new Date(t.dispatchedAt);
      const to = t.completedAt ? new Date(t.completedAt) : new Date();
      const reports = [];
      for (const l of loggers) reports.push(await this.report(tx, l.id, from, to, null, null));
      return { trip: t, loggers: reports };
    });
  }
}
