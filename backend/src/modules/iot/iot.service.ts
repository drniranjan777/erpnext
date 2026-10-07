import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { iotAlarmRules, iotAlarms, iotBatches, iotGateways, iotReadings, iotSignals, maintAssets, type Transaction } from '@nextgen/database';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { MaintenanceOrdersService } from '../maintenance/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { bucketSeconds, describeRule, parseTs, stepRule, type AlarmOp, type RuleEvent } from './rules';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const code = z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9._:/-]+$/, 'Letters, digits and . _ : / - only');
const text = (n: number) => z.string().trim().max(n).nullable().optional();

export const PURPOSES = ['part_count', 'reject_count', 'run_state', 'temperature', 'humidity', 'vibration', 'current', 'pressure', 'energy_kwh', 'power_kw', 'speed', 'other'] as const;
/** Signals whose value only goes up (the agent always sends them; resets are handled by consumers). */
export const COUNTER_PURPOSES = new Set(['part_count', 'reject_count', 'energy_kwh']);

export const gatewaySchema = z.object({ code, name: z.string().trim().min(2).max(120), location: text(200) });
export const signalSchema = z.object({
  code,
  name: z.string().trim().min(2).max(120),
  gatewayId: z.uuid().nullable().optional(),
  machineId: z.uuid().nullable().optional(),
  warehouseId: z.uuid().nullable().optional(),
  vehicleNo: text(20),
  purpose: z.enum(PURPOSES).default('other'),
  unit: text(20),
  scale: z.number().finite().default(1),
  offset: z.number().finite().default(0),
  deadband: z.number().min(0).default(0),
  source: z
    .object({ protocol: z.enum(['modbus-tcp', 'mqtt', 'http-json', 'simulator', 'push']) })
    .catchall(z.union([z.string().max(300), z.number(), z.boolean()]))
    .default({ protocol: 'push' }),
  isActive: z.boolean().default(true),
});
export const ruleSchema = z
  .object({
    signalId: z.uuid(),
    name: z.string().trim().min(2).max(120),
    op: z.enum(['above', 'below', 'outside', 'equals']),
    threshold: z.number().finite(),
    threshold2: z.number().finite().nullable().optional(),
    delaySeconds: z.number().int().min(0).max(86_400).default(0),
    severity: z.enum(['info', 'warning', 'critical']).default('warning'),
    notify: z.boolean().default(true),
    createMaintenance: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .refine((r) => r.op !== 'outside' || (r.threshold2 != null && r.threshold2 > r.threshold), { path: ['threshold2'], message: 'Give the upper limit (above the lower one)' });
export const ingestSchema = z.object({
  batchId: z.string().trim().min(1).max(80),
  agentVersion: z.string().trim().max(40).optional(),
  buffered: z.number().int().min(0).optional(),
  readings: z
    .array(z.object({ s: z.string().trim().min(1).max(60), t: z.union([z.number(), z.string().max(40)]), v: z.union([z.number().finite(), z.boolean()]) }))
    .max(5000),
});

export interface IngestedSignal {
  id: string;
  code: string;
  purpose: string;
  machineId: string | null;
  unit: string | null;
  readings: { ts: Date; value: number }[];
}
/** Called inside the ingestion transaction with the new readings of each signal (time order). */
export type IngestHook = (tx: Transaction, ctx: { tenantId: string; gatewayId: string; actorUserId: string | null }, signals: IngestedSignal[]) => Promise<void>;

/**
 * IoT platform: edge gateways, signals (tags), time-series readings, live values and alarms.
 * Gateways send batches with their device token; a batch id is applied once, so the agent can
 * replay its store-and-forward buffer safely after a network drop.
 */
@Injectable()
export class IotService {
  private readonly logger = new Logger('Iot');
  private readonly hooks: IngestHook[] = [];

  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly maintenance: MaintenanceOrdersService,
  ) {}

  /** Lets other modules (production counts, machine states, energy…) consume new readings. */
  onIngest(hook: IngestHook) {
    this.hooks.push(hook);
  }

  // ---- gateways --------------------------------------------------------------------------------

  gateways(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select g.id, g.code, g.name, g.location, g.status, g.token_hint as "tokenHint", g.last_seen_at as "lastSeenAt", g.last_ip as "lastIp",
              g.agent_version as "agentVersion", g.buffered, (g.last_seen_at > now() - interval '2 minutes') as online,
              (select count(*)::int from iot_signals s where s.gateway_id = g.id) as signals,
              (select count(*)::int from iot_batches b where b.gateway_id = g.id and b.received_at > now() - interval '1 hour') as "batchesLastHour"
            from iot_gateways g order by g.code`,
      ),
    );
  }

  createGateway(auth: AuthContext, input: z.infer<typeof gatewaySchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: iotGateways.id }).from(iotGateways).where(eq(iotGateways.code, input.code));
      if (dup) throw new ConflictException(`Gateway ${input.code} already exists`);
      const token = this.newToken(auth.tenantId);
      const [g] = await tx
        .insert(iotGateways)
        .values({ tenantId: auth.tenantId, code: input.code, name: input.name, location: input.location ?? null, tokenHash: sha256(token), tokenHint: token.slice(-4), createdBy: auth.userId })
        .returning();
      return { ...this.publicGateway(g), token };
    });
  }

  /** New device token (the old one stops working at once). */
  rotateToken(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const token = this.newToken(auth.tenantId);
      const [g] = await tx.update(iotGateways).set({ tokenHash: sha256(token), tokenHint: token.slice(-4), status: 'active' }).where(eq(iotGateways.id, id)).returning();
      if (!g) throw new NotFoundException('Gateway not found');
      return { ...this.publicGateway(g), token };
    });
  }

  setGatewayStatus(auth: AuthContext, id: string, status: 'active' | 'disabled') {
    return this.database.run(auth, async (tx) => {
      const [g] = await tx.update(iotGateways).set({ status }).where(eq(iotGateways.id, id)).returning();
      if (!g) throw new NotFoundException('Gateway not found');
      return this.publicGateway(g);
    });
  }

  private newToken(tenantId: string) {
    return `${tenantId}.${randomBytes(24).toString('base64url')}`;
  }

  private publicGateway(g: typeof iotGateways.$inferSelect) {
    const { tokenHash: _hash, ...rest } = g;
    return rest;
  }

  // ---- signals ---------------------------------------------------------------------------------

  signals(auth: AuthContext, q: { machineId?: string; gatewayId?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, s.code, s.name, s.purpose, s.unit, s.scale, s."offset", s.deadband, s.source, s.is_active as "isActive",
              s.gateway_id as "gatewayId", g.code as "gatewayCode", s.machine_id as "machineId", m.code as "machineCode", m.name as "machineName",
              s.warehouse_id as "warehouseId", w.name as "warehouseName", s.vehicle_no as "vehicleNo", s.last_value as "lastValue", s.last_at as "lastAt",
              (s.last_at is null or s.last_at < now() - interval '5 minutes') as stale,
              (select count(*)::int from iot_alarms a where a.signal_id = s.id and a.cleared_at is null) as "openAlarms"
            from iot_signals s left join iot_gateways g on g.id = s.gateway_id left join machines m on m.id = s.machine_id left join warehouses w on w.id = s.warehouse_id
            where true ${q.machineId ? sql`and s.machine_id = ${q.machineId}` : sql``} ${q.gatewayId ? sql`and s.gateway_id = ${q.gatewayId}` : sql``}
            order by s.code`,
      ),
    );
  }

  saveSignal(auth: AuthContext, id: string | null, input: z.infer<typeof signalSchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: iotSignals.id }).from(iotSignals).where(eq(iotSignals.code, input.code));
      if (dup && dup.id !== id) throw new ConflictException(`Signal ${input.code} already exists`);
      const values = {
        code: input.code,
        name: input.name,
        gatewayId: input.gatewayId ?? null,
        machineId: input.machineId ?? null,
        warehouseId: input.warehouseId ?? null,
        vehicleNo: input.vehicleNo ?? null,
        purpose: input.purpose,
        unit: input.unit ?? null,
        scale: input.scale,
        offset: input.offset,
        deadband: input.deadband,
        source: input.source,
        isActive: input.isActive,
      };
      if (id) {
        const [s] = await tx.update(iotSignals).set(values).where(eq(iotSignals.id, id)).returning();
        if (!s) throw new NotFoundException('Signal not found');
        return s;
      }
      const [s] = await tx.insert(iotSignals).values({ tenantId: auth.tenantId, ...values }).returning();
      return s;
    });
  }

  /** Readings of one signal, averaged into buckets sized for a chart of about `points` points. */
  series(auth: AuthContext, id: string, q: { from?: string; to?: string; points: number }) {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * 3_600_000);
    if (!(from < to)) throw new BadRequestException('"from" must be before "to"');
    const bucket = bucketSeconds(from, to, q.points);
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select({ id: iotSignals.id, code: iotSignals.code, name: iotSignals.name, unit: iotSignals.unit, purpose: iotSignals.purpose }).from(iotSignals).where(eq(iotSignals.id, id));
      if (!s) throw new NotFoundException('Signal not found');
      const points = await many<{ t: string; avg: number; min: number; max: number; last: number; n: number }>(
        tx,
        sql`select date_bin(make_interval(secs => ${bucket}::int), ts, timestamptz '2000-01-01') as t, avg(value) as avg, min(value) as min, max(value) as max,
              (array_agg(value order by ts desc))[1] as last, count(*)::int as n
            from iot_readings where signal_id = ${id} and ts >= ${from.toISOString()} and ts < ${to.toISOString()} group by 1 order by 1`,
      );
      return { signal: s, from, to, bucketSeconds: bucket, points: points.map((p) => ({ ...p, avg: Math.round(p.avg * 1000) / 1000 })) };
    });
  }

  // ---- alarm rules and alarms ------------------------------------------------------------------

  rules(auth: AuthContext, signalId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select r.id, r.signal_id as "signalId", s.code as "signalCode", s.unit, r.name, r.op, r.threshold, r.threshold2, r.delay_seconds as "delaySeconds",
              r.severity, r.notify, r.create_maintenance as "createMaintenance", r.is_active as "isActive"
            from iot_alarm_rules r join iot_signals s on s.id = r.signal_id ${signalId ? sql`where r.signal_id = ${signalId}` : sql``} order by s.code, r.name`,
      ),
    );
  }

  saveRule(auth: AuthContext, id: string | null, input: z.infer<typeof ruleSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, threshold2: input.threshold2 ?? null, pendingSince: null };
      if (id) {
        const [r] = await tx.update(iotAlarmRules).set(values).where(eq(iotAlarmRules.id, id)).returning();
        if (!r) throw new NotFoundException('Alarm rule not found');
        return r;
      }
      const [s] = await tx.select({ id: iotSignals.id }).from(iotSignals).where(eq(iotSignals.id, input.signalId));
      if (!s) throw new NotFoundException('Signal not found');
      const [r] = await tx.insert(iotAlarmRules).values({ tenantId: auth.tenantId, ...values }).returning();
      return r;
    });
  }

  alarms(auth: AuthContext, q: { status: 'open' | 'all'; limit: number }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select a.id, a.severity, a.message, a.raised_at as "raisedAt", a.value, a.peak_value as "peakValue", a.cleared_at as "clearedAt",
              a.acked_at as "ackedAt", u.full_name as "ackedBy", a.note, a.maintenance_order_id as "maintenanceOrderId", d.number as "maintenanceNumber",
              s.id as "signalId", s.code as "signalCode", s.unit, m.code as "machineCode", m.name as "machineName", r.name as "ruleName"
            from iot_alarms a join iot_signals s on s.id = a.signal_id join iot_alarm_rules r on r.id = a.rule_id
            left join machines m on m.id = a.machine_id left join users u on u.id = a.acked_by left join documents d on d.id = a.maintenance_order_id
            ${q.status === 'open' ? sql`where a.cleared_at is null or a.acked_at is null` : sql``}
            order by a.raised_at desc limit ${q.limit}`,
      ),
    );
  }

  ack(auth: AuthContext, id: string, note?: string | null) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx
        .update(iotAlarms)
        .set({ ackedAt: new Date(), ackedBy: auth.userId, note: note ?? null })
        .where(and(eq(iotAlarms.id, id), isNull(iotAlarms.ackedAt)))
        .returning({ id: iotAlarms.id });
      if (!a) throw new ConflictException('Alarm not found or already acknowledged');
      return { ok: true };
    });
  }

  // ---- devices ---------------------------------------------------------------------------------

  private async device<T>(token: string | undefined, fn: (tx: Transaction, g: typeof iotGateways.$inferSelect) => Promise<T>): Promise<T> {
    const tenantId = token?.split('.')[0] ?? '';
    if (!token || !UUID.test(tenantId)) throw new UnauthorizedException('Send the gateway token in the x-device-token header');
    return this.database.run({ tenantId, userId: null as unknown as string }, async (tx) => {
      const [g] = await tx.select().from(iotGateways).where(eq(iotGateways.tokenHash, sha256(token)));
      if (!g || g.status !== 'active') throw new UnauthorizedException('Unknown or disabled gateway');
      return fn(tx, g);
    });
  }

  /** What the agent should read: its signals with protocol, address, scaling and deadband. */
  agentConfig(token: string | undefined) {
    return this.device(token, async (tx, g) => {
      const rows = await tx
        .select({ code: iotSignals.code, purpose: iotSignals.purpose, unit: iotSignals.unit, scale: iotSignals.scale, offset: iotSignals.offset, deadband: iotSignals.deadband, source: iotSignals.source })
        .from(iotSignals)
        .where(and(eq(iotSignals.gatewayId, g.id), eq(iotSignals.isActive, true)));
      return { gateway: { code: g.code, name: g.name }, signals: rows.map((r) => ({ ...r, counter: COUNTER_PURPOSES.has(r.purpose) })) };
    });
  }

  ingest(token: string | undefined, input: z.infer<typeof ingestSchema>, ip: string | null) {
    return this.device(token, async (tx, g) => {
      await tx
        .update(iotGateways)
        .set({ lastSeenAt: new Date(), lastIp: ip, agentVersion: input.agentVersion ?? g.agentVersion, buffered: input.buffered ?? 0 })
        .where(eq(iotGateways.id, g.id));
      const [seen] = await tx.select({ accepted: iotBatches.accepted }).from(iotBatches).where(and(eq(iotBatches.gatewayId, g.id), eq(iotBatches.batchId, input.batchId)));
      if (seen) return { batchId: input.batchId, duplicate: true, accepted: seen.accepted, unknown: [], rejected: 0 };

      const codes = [...new Set(input.readings.map((r) => r.s.toLowerCase()))];
      const sigs = codes.length
        ? await tx
            .select({ id: iotSignals.id, code: iotSignals.code, purpose: iotSignals.purpose, machineId: iotSignals.machineId, unit: iotSignals.unit, gatewayId: iotSignals.gatewayId, isActive: iotSignals.isActive })
            .from(iotSignals)
            .where(inArray(sql`lower(${iotSignals.code})`, codes))
        : [];
      const byCode = new Map(sigs.filter((s) => s.isActive && (!s.gatewayId || s.gatewayId === g.id)).map((s) => [s.code.toLowerCase(), s]));
      const unknown = new Set<string>();
      const now = Date.now();
      let rejected = 0;
      const rows: { tenantId: string; signalId: string; ts: Date; value: number }[] = [];
      for (const r of input.readings) {
        const s = byCode.get(r.s.toLowerCase());
        if (!s) {
          unknown.add(r.s);
          continue;
        }
        const ts = parseTs(r.t);
        if (!ts || ts.getTime() > now + 5 * 60_000 || ts.getTime() < now - 90 * 86_400_000) {
          rejected++;
          continue;
        }
        rows.push({ tenantId: g.tenantId, signalId: s.id, ts, value: typeof r.v === 'boolean' ? Number(r.v) : r.v });
      }
      const accepted: typeof rows = [];
      for (let i = 0; i < rows.length; i += 1000) {
        const ins = await tx.insert(iotReadings).values(rows.slice(i, i + 1000)).onConflictDoNothing().returning({ signalId: iotReadings.signalId, ts: iotReadings.ts, value: iotReadings.value });
        accepted.push(...ins.map((x) => ({ tenantId: g.tenantId, ...x })));
      }
      const oldest = accepted.reduce((m, r) => Math.min(m, r.ts.getTime()), now);
      await tx.insert(iotBatches).values({ tenantId: g.tenantId, gatewayId: g.id, batchId: input.batchId, readings: input.readings.length, accepted: accepted.length, lagSeconds: Math.round((now - oldest) / 1000) });

      const grouped = new Map<string, IngestedSignal>();
      for (const r of accepted.sort((a, b) => a.ts.getTime() - b.ts.getTime())) {
        const s = sigs.find((x) => x.id === r.signalId)!;
        const e = grouped.get(s.id) ?? { id: s.id, code: s.code, purpose: s.purpose, machineId: s.machineId, unit: s.unit, readings: [] };
        e.readings.push({ ts: r.ts, value: r.value });
        grouped.set(s.id, e);
      }
      const touched = [...grouped.values()];
      for (const s of touched) {
        const last = s.readings[s.readings.length - 1];
        await tx
          .update(iotSignals)
          .set({ lastValue: last.value, lastAt: last.ts })
          .where(and(eq(iotSignals.id, s.id), sql`(${iotSignals.lastAt} is null or ${iotSignals.lastAt} <= ${last.ts.toISOString()})`));
      }
      const ctx = { tenantId: g.tenantId, gatewayId: g.id, actorUserId: g.createdBy };
      await this.evaluateAlarms(tx, ctx, touched);
      for (const hook of this.hooks) await hook(tx, ctx, touched);
      return { batchId: input.batchId, duplicate: false, accepted: accepted.length, unknown: [...unknown].slice(0, 50), rejected };
    });
  }

  // ---- alarm evaluation ------------------------------------------------------------------------

  /** Applies new readings to every active rule of the signals; opens and clears alarms. */
  async evaluateAlarms(tx: Transaction, ctx: { tenantId: string; actorUserId: string | null }, signals: IngestedSignal[]) {
    if (!signals.length) return;
    const rules = await tx
      .select()
      .from(iotAlarmRules)
      .where(and(inArray(iotAlarmRules.signalId, signals.map((s) => s.id)), eq(iotAlarmRules.isActive, true)));
    for (const rule of rules) {
      const s = signals.find((x) => x.id === rule.signalId)!;
      const [open] = await tx.select().from(iotAlarms).where(and(eq(iotAlarms.ruleId, rule.id), isNull(iotAlarms.clearedAt)));
      const limits = { op: rule.op as AlarmOp, threshold: rule.threshold, threshold2: rule.threshold2, delaySeconds: rule.delaySeconds };
      const { state, events } = stepRule(limits, { pendingSince: rule.pendingSince, open: open ? { peak: open.peakValue } : null }, s.readings);
      let current: typeof iotAlarms.$inferSelect | null = open ?? null;
      for (const e of events) current = await this.applyEvent(tx, ctx, rule, s, limits, current, e);
      if (current && state.open) await tx.update(iotAlarms).set({ peakValue: state.open.peak }).where(eq(iotAlarms.id, current.id));
      if (+(state.pendingSince ?? 0) !== +(rule.pendingSince ?? 0)) await tx.update(iotAlarmRules).set({ pendingSince: state.pendingSince }).where(eq(iotAlarmRules.id, rule.id));
    }
  }

  private async applyEvent(
    tx: Transaction,
    ctx: { tenantId: string; actorUserId: string | null },
    rule: typeof iotAlarmRules.$inferSelect,
    s: IngestedSignal,
    limits: { op: AlarmOp; threshold: number; threshold2: number | null; delaySeconds: number },
    current: typeof iotAlarms.$inferSelect | null,
    e: RuleEvent,
  ): Promise<typeof iotAlarms.$inferSelect | null> {
    if (e.kind === 'clear') {
      if (current) await tx.update(iotAlarms).set({ clearedAt: e.at, peakValue: e.peak }).where(eq(iotAlarms.id, current.id));
      return null;
    }
    const [m] = s.machineId ? await many<{ code: string; name: string }>(tx, sql`select code, name from machines where id = ${s.machineId}`) : [];
    const where = m ? `${m.code} ${m.name}` : s.code;
    const message = `${rule.name}: ${s.code} is ${e.value}${s.unit ? ` ${s.unit}` : ''} (limit ${describeRule(limits, s.unit)})`;
    const [alarm] = await tx
      .insert(iotAlarms)
      .values({ tenantId: ctx.tenantId, ruleId: rule.id, signalId: s.id, machineId: s.machineId, severity: rule.severity, message, raisedAt: e.at, value: e.value, peakValue: e.value })
      .returning();
    if (rule.createMaintenance && s.machineId && ctx.actorUserId) {
      const [asset] = await tx.select({ id: maintAssets.id }).from(maintAssets).where(eq(maintAssets.machineId, s.machineId)).limit(1);
      if (asset) {
        const auth = { tenantId: ctx.tenantId, userId: ctx.actorUserId } as AuthContext;
        const mo = await this.maintenance.createTx(
          tx,
          auth,
          { kind: 'condition', assetId: asset.id, problem: `Raised by machine alarm. ${message}`, priority: rule.severity === 'critical' ? 'urgent' : 'high', requestedBy: 'IoT alarm', assignedTo: null, reportedAt: e.at.toISOString() },
          { ip: null, userAgent: 'iot', requestId: `iot-alarm-${alarm.id}` },
        );
        await tx.update(iotAlarms).set({ maintenanceOrderId: mo.id }).where(eq(iotAlarms.id, alarm.id));
      }
    }
    if (rule.notify) {
      const holders = await many<{ userId: string }>(
        tx,
        sql`select distinct m.user_id as "userId" from memberships m join membership_roles mr on mr.membership_id = m.id
            join role_permissions rp on rp.role_id = mr.role_id where m.status = 'active' and rp.permission_code = 'iot.data.read'`,
      );
      if (holders.length)
        await this.notifications.notify(tx, ctx.tenantId, 'iot.alarm', holders.map((h) => ({ userId: h.userId })), { title: `${rule.severity === 'critical' ? 'Critical alarm' : 'Alarm'} on ${where}`, body: message, link: '/iot/alarms' });
    }
    return alarm;
  }
}
