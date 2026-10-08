import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { jobCards, machines, mesAndonCalls, mesCounts, mesDowntimeReasons, mesMachineSettings, mesMachineStates, mesShifts, type Transaction } from '@nextgen/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { counterStep } from '../iot/counters';
import { IotService, type IngestedSignal } from '../iot/iot.service';
import { NotificationsService } from '../notifications/notifications.service';
import { combineOee, computeOee, currentShift, istDate, shiftWindows, type Loss, type MachineState, type OeeResult, type ShiftDef, type Span } from './oee';
import { many } from '../../common/sql';

const code = z.string().trim().min(1).max(20);

const LOSSES = ['breakdown', 'setup', 'minor_stop', 'speed', 'defects', 'startup', 'planned', 'other'] as const;
const DEFAULT_REASONS: { code: string; name: string; loss: Loss }[] = [
  { code: 'BRK', name: 'Breakdown', loss: 'breakdown' },
  { code: 'ELEC', name: 'Electrical fault', loss: 'breakdown' },
  { code: 'MOULD', name: 'Mould / die problem', loss: 'breakdown' },
  { code: 'SETUP', name: 'Changeover / setup', loss: 'setup' },
  { code: 'ADJ', name: 'Adjustment / trial', loss: 'setup' },
  { code: 'MAT', name: 'Waiting for material', loss: 'other' },
  { code: 'OPR', name: 'No operator', loss: 'other' },
  { code: 'QC', name: 'Waiting for quality approval', loss: 'other' },
  { code: 'PWR', name: 'Power cut', loss: 'other' },
  { code: 'BREAK', name: 'Tea / lunch break', loss: 'planned' },
  { code: 'NOPLAN', name: 'No production planned', loss: 'planned' },
  { code: 'PM', name: 'Planned maintenance', loss: 'planned' },
];
const DEFAULT_SHIFTS = [
  { code: 'A', name: 'Shift A', startMinute: 360, endMinute: 840, breakMinutes: 30 },
  { code: 'B', name: 'Shift B', startMinute: 840, endMinute: 1320, breakMinutes: 30 },
  { code: 'C', name: 'Shift C', startMinute: 1320, endMinute: 360, breakMinutes: 30 },
];

export const shiftsSchema = z
  .array(z.object({ code, name: z.string().trim().min(1).max(60), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(0).max(1439), breakMinutes: z.number().int().min(0).max(240).default(0) }))
  .min(1)
  .max(6)
  .refine((l) => new Set(l.map((s) => s.code.toLowerCase())).size === l.length, 'Shift codes must be different');
export const reasonSchema = z.object({ code, name: z.string().trim().min(2).max(80), loss: z.enum(LOSSES), isActive: z.boolean().default(true) });
export const settingsSchema = z.object({
  idealCycleSeconds: z.number().positive().max(86_400).nullable().optional(),
  stopAfterSeconds: z.number().int().min(10).max(3600).default(120),
  minorStopSeconds: z.number().int().min(0).max(3600).default(300),
  targetOeePct: z.number().int().min(1).max(100).default(65),
});
export const stateSchema = z.object({ state: z.enum(['running', 'stopped', 'setup', 'planned_stop']), reasonId: z.uuid().nullable().optional(), note: z.string().trim().max(300).nullable().optional() });
export const explainSchema = z.object({ reasonId: z.uuid(), note: z.string().trim().max(300).nullable().optional() });
export const andonSchema = z.object({ machineId: z.uuid(), kind: z.enum(['maintenance', 'quality', 'material', 'supervisor']), note: z.string().trim().max(300).nullable().optional() });
export const oeeQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  by: z.enum(['machine', 'workCenter', 'shift', 'day']).default('machine'),
  machineId: z.uuid().optional(),
});

type Settings = typeof mesMachineSettings.$inferSelect;
const MEASURED = new Set(['part_count', 'reject_count', 'run_state']);

/**
 * Real-time production: machine states from signals (a run-state signal, or parts being counted),
 * part and reject counts per minute and into the running job card, downtime with reasons, OEE by
 * machine / line / shift / day, and Andon calls.
 */
@Injectable()
export class MesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly iot: IotService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.iot.onIngest((tx, ctx, signals) => this.consume(tx, ctx.tenantId, signals));
  }

  // ---- setup -----------------------------------------------------------------------------------

  private async ensureDefaults(tx: Transaction, tenantId: string) {
    const [r] = await tx.select({ id: mesDowntimeReasons.id }).from(mesDowntimeReasons).limit(1);
    if (!r) await tx.insert(mesDowntimeReasons).values(DEFAULT_REASONS.map((d) => ({ tenantId, ...d }))).onConflictDoNothing();
    const [s] = await tx.select({ id: mesShifts.id }).from(mesShifts).limit(1);
    if (!s) await tx.insert(mesShifts).values(DEFAULT_SHIFTS.map((d) => ({ tenantId, ...d }))).onConflictDoNothing();
  }

  private async shifts(tx: Transaction): Promise<ShiftDef[]> {
    return tx.select({ code: mesShifts.code, name: mesShifts.name, startMinute: mesShifts.startMinute, endMinute: mesShifts.endMinute, breakMinutes: mesShifts.breakMinutes }).from(mesShifts).where(eq(mesShifts.isActive, true));
  }

  setup(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      await this.ensureDefaults(tx, auth.tenantId);
      const reasons = await tx.select().from(mesDowntimeReasons).orderBy(mesDowntimeReasons.code);
      const shifts = await tx.select().from(mesShifts).orderBy(mesShifts.startMinute);
      const ms = await many(
        tx,
        sql`select m.id, m.code, m.name, wc.code as "workCenterCode", s.ideal_cycle_seconds as "idealCycleSeconds", coalesce(s.stop_after_seconds, 120) as "stopAfterSeconds",
              coalesce(s.minor_stop_seconds, 300) as "minorStopSeconds", coalesce(s.target_oee_pct, 65) as "targetOeePct",
              (select count(*)::int from iot_signals g where g.machine_id = m.id and g.purpose in ('part_count', 'reject_count', 'run_state')) as signals
            from machines m join work_centers wc on wc.id = m.work_center_id left join mes_machine_settings s on s.machine_id = m.id where m.is_active order by m.code`,
      );
      return { shifts, reasons, machines: ms };
    });
  }

  saveShifts(auth: AuthContext, input: z.infer<typeof shiftsSchema>) {
    return this.database.run(auth, async (tx) => {
      await tx.delete(mesShifts);
      await tx.insert(mesShifts).values(input.map((s) => ({ tenantId: auth.tenantId, ...s })));
      return tx.select().from(mesShifts).orderBy(mesShifts.startMinute);
    });
  }

  saveReason(auth: AuthContext, id: string | null, input: z.infer<typeof reasonSchema>) {
    return this.database.run(auth, async (tx) => {
      await this.ensureDefaults(tx, auth.tenantId);
      const [dup] = await tx.select({ id: mesDowntimeReasons.id }).from(mesDowntimeReasons).where(eq(mesDowntimeReasons.code, input.code));
      if (dup && dup.id !== id) throw new ConflictException(`Reason ${input.code} already exists`);
      if (id) {
        const [r] = await tx.update(mesDowntimeReasons).set(input).where(eq(mesDowntimeReasons.id, id)).returning();
        if (!r) throw new NotFoundException('Reason not found');
        return r;
      }
      const [r] = await tx.insert(mesDowntimeReasons).values({ tenantId: auth.tenantId, ...input }).returning();
      return r;
    });
  }

  saveSettings(auth: AuthContext, machineId: string, input: z.infer<typeof settingsSchema>) {
    return this.database.run(auth, async (tx) => {
      const [m] = await tx.select({ id: machines.id }).from(machines).where(eq(machines.id, machineId));
      if (!m) throw new NotFoundException('Machine not found');
      const values = { idealCycleSeconds: input.idealCycleSeconds ?? null, stopAfterSeconds: input.stopAfterSeconds, minorStopSeconds: input.minorStopSeconds, targetOeePct: input.targetOeePct };
      const [s] = await tx
        .insert(mesMachineSettings)
        .values({ tenantId: auth.tenantId, machineId, ...values })
        .onConflictDoUpdate({ target: [mesMachineSettings.tenantId, mesMachineSettings.machineId], set: values })
        .returning();
      return s;
    });
  }

  private async settingsFor(tx: Transaction, tenantId: string, machineId: string): Promise<Settings> {
    const [s] = await tx.select().from(mesMachineSettings).where(eq(mesMachineSettings.machineId, machineId));
    if (s) return s;
    const [created] = await tx.insert(mesMachineSettings).values({ tenantId, machineId }).onConflictDoNothing().returning();
    return created ?? (await tx.select().from(mesMachineSettings).where(eq(mesMachineSettings.machineId, machineId)))[0];
  }

  // ---- from signals ----------------------------------------------------------------------------

  /** Turns new readings of counter and run-state signals into machine states and counts. */
  async consume(tx: Transaction, tenantId: string, signals: IngestedSignal[]) {
    const byMachine = new Map<string, IngestedSignal[]>();
    for (const s of signals) if (s.machineId && MEASURED.has(s.purpose)) byMachine.set(s.machineId, [...(byMachine.get(s.machineId) ?? []), s]);
    if (!byMachine.size) return;
    await this.ensureDefaults(tx, tenantId);
    for (const [machineId, sigs] of byMachine) {
      const settings = await this.settingsFor(tx, tenantId, machineId);
      const [rs] = await many<{ n: number }>(tx, sql`select count(*)::int as n from iot_signals where machine_id = ${machineId} and purpose = 'run_state' and is_active`);
      const hasRunState = rs.n > 0;
      const events = sigs.flatMap((s) => s.readings.map((r) => ({ s, ...r }))).sort((a, b) => a.ts.getTime() - b.ts.getTime());
      let lastPartAt = settings.lastPartAt;
      for (const e of events) {
        if (e.s.purpose === 'run_state') {
          await this.setState(tx, tenantId, machineId, e.value > 0.5 ? 'running' : 'stopped', e.ts, { source: 'auto' });
          continue;
        }
        const delta = await counterStep(tx, tenantId, e.s.id, e.value, e.ts);
        if (delta === null) continue;
        if (e.s.purpose === 'part_count') {
          if (delta > 0) {
            await this.addCount(tx, tenantId, machineId, settings, e.ts, delta, 'part');
            if (!hasRunState) await this.setState(tx, tenantId, machineId, 'running', lastPartAt && e.ts.getTime() - lastPartAt.getTime() <= settings.stopAfterSeconds * 1000 ? lastPartAt : e.ts, { source: 'auto' });
            lastPartAt = e.ts;
          } else if (!hasRunState && lastPartAt && e.ts.getTime() - lastPartAt.getTime() >= settings.stopAfterSeconds * 1000) {
            await this.setState(tx, tenantId, machineId, 'stopped', lastPartAt, { source: 'auto' });
          }
        } else if (delta > 0) await this.addCount(tx, tenantId, machineId, settings, e.ts, delta, 'reject');
      }
      const last = events[events.length - 1]?.ts ?? null;
      await tx
        .update(mesMachineSettings)
        .set({ lastPartAt, lastSignalAt: last && (!settings.lastSignalAt || last > settings.lastSignalAt) ? last : settings.lastSignalAt })
        .where(eq(mesMachineSettings.id, settings.id));
    }
  }

  /** Adds parts (or rejects) to the minute's counts and to the job card running on the machine. */
  private async addCount(tx: Transaction, tenantId: string, machineId: string, settings: Settings, ts: Date, delta: number, kind: 'part' | 'reject') {
    const [card] = await many<{ id: string; runMinutes: string; cavities: number | null }>(
      tx,
      sql`select jc.id, op.run_minutes as "runMinutes", t.cavities from job_cards jc join work_order_operations op on op.id = jc.operation_id
          left join tools t on t.id = jc.tool_id where jc.machine_id = ${machineId} and jc.status = 'running' and jc.started_at <= ${ts.toISOString()}
          order by jc.started_at desc limit 1`,
    );
    const cavities = kind === 'part' ? (card?.cavities ?? 1) : 1;
    const pieces = delta * cavities;
    const perPiece = card && Number(card.runMinutes) > 0 ? Number(card.runMinutes) * 60 : (settings.idealCycleSeconds ?? 0) / cavities;
    const minute = new Date(Math.floor(ts.getTime() / 60_000) * 60_000);
    const good = kind === 'part' ? pieces : -pieces;
    const reject = kind === 'reject' ? pieces : 0;
    const ideal = kind === 'part' ? pieces * perPiece : 0;
    await tx
      .insert(mesCounts)
      .values({ tenantId, machineId, minute, good, reject, idealSeconds: ideal, jobCardId: card?.id ?? null })
      .onConflictDoUpdate({
        target: [mesCounts.tenantId, mesCounts.machineId, mesCounts.minute],
        set: { good: sql`${mesCounts.good} + ${good}`, reject: sql`${mesCounts.reject} + ${reject}`, idealSeconds: sql`${mesCounts.idealSeconds} + ${ideal}`, jobCardId: card?.id ?? sql`${mesCounts.jobCardId}` },
      });
    if (card) {
      await tx
        .update(jobCards)
        .set({
          goodQty: sql`greatest(0, ${jobCards.goodQty} + ${good})`,
          rejectQty: sql`${jobCards.rejectQty} + ${reject}`,
          shots: kind === 'part' ? sql`${jobCards.shots} + ${delta}` : sql`${jobCards.shots}`,
        })
        .where(eq(jobCards.id, card.id));
    }
  }

  /**
   * Moves a machine to a new state at `at`. Automatic "stopped" does not override a setup or
   * planned stop set by a person; automatic "running" ends it (the machine is producing again).
   */
  private async setState(tx: Transaction, tenantId: string, machineId: string, state: MachineState, at: Date, opts: { source: 'auto' | 'manual'; reasonId?: string | null; note?: string | null; userId?: string | null }) {
    const [cur] = await tx.select().from(mesMachineStates).where(and(eq(mesMachineStates.machineId, machineId), isNull(mesMachineStates.endedAt))).for('update');
    if (cur) {
      if (opts.source === 'auto' && cur.state === state) return cur;
      if (opts.source === 'auto' && state === 'stopped' && cur.source === 'manual' && cur.state !== 'running') return cur;
      if (at < cur.startedAt) at = cur.startedAt;
      await tx.update(mesMachineStates).set({ endedAt: at }).where(eq(mesMachineStates.id, cur.id));
    }
    const [row] = await tx
      .insert(mesMachineStates)
      .values({ tenantId, machineId, state, startedAt: at, source: opts.source, reasonId: opts.reasonId ?? null, note: opts.note ?? null, setBy: opts.userId ?? null })
      .returning();
    return row;
  }

  // ---- people on the floor ---------------------------------------------------------------------

  setManualState(auth: AuthContext, machineId: string, input: z.infer<typeof stateSchema>) {
    return this.database.run(auth, async (tx) => {
      const [m] = await tx.select({ id: machines.id }).from(machines).where(eq(machines.id, machineId));
      if (!m) throw new NotFoundException('Machine not found');
      if (input.reasonId) await this.reason(tx, input.reasonId);
      return this.setState(tx, auth.tenantId, machineId, input.state, new Date(), { source: 'manual', reasonId: input.reasonId, note: input.note, userId: auth.userId });
    });
  }

  /** Gives a reason for a stop (or corrects it). */
  explain(auth: AuthContext, stateId: string, input: z.infer<typeof explainSchema>) {
    return this.database.run(auth, async (tx) => {
      await this.reason(tx, input.reasonId);
      const [s] = await tx
        .update(mesMachineStates)
        .set({ reasonId: input.reasonId, note: input.note ?? null, setBy: auth.userId })
        .where(and(eq(mesMachineStates.id, stateId), sql`${mesMachineStates.state} <> 'running'`))
        .returning();
      if (!s) throw new NotFoundException('Stop not found');
      return s;
    });
  }

  private async reason(tx: Transaction, id: string) {
    const [r] = await tx.select().from(mesDowntimeReasons).where(eq(mesDowntimeReasons.id, id));
    if (!r || !r.isActive) throw new BadRequestException('Choose an active downtime reason');
    return r;
  }

  /** Stops long enough to count as downtime (and setups), newest first. */
  downtime(auth: AuthContext, q: { from?: string; to?: string; machineId?: string; unexplained?: boolean }) {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 86_400_000);
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select st.id, st.state, st.started_at as "startedAt", st.ended_at as "endedAt", st.source, st.note,
              round(extract(epoch from (coalesce(st.ended_at, now()) - st.started_at)))::int as seconds,
              m.id as "machineId", m.code as "machineCode", m.name as "machineName", r.id as "reasonId", r.code as "reasonCode", r.name as "reasonName", r.loss
            from mes_machine_states st join machines m on m.id = st.machine_id
            left join mes_machine_settings s on s.machine_id = st.machine_id left join mes_downtime_reasons r on r.id = st.reason_id
            where st.state <> 'running' and st.started_at < ${to.toISOString()} and coalesce(st.ended_at, now()) > ${from.toISOString()}
              and (st.state <> 'stopped' or extract(epoch from (coalesce(st.ended_at, now()) - st.started_at)) >= coalesce(s.minor_stop_seconds, 300))
              ${q.machineId ? sql`and st.machine_id = ${q.machineId}` : sql``} ${q.unexplained ? sql`and st.reason_id is null and st.state = 'stopped'` : sql``}
            order by st.started_at desc limit 500`,
      ),
    );
  }

  // ---- OEE -------------------------------------------------------------------------------------

  private async machineData(tx: Transaction, from: Date, to: Date, machineId?: string) {
    const ms = await many<{ id: string; code: string; name: string; workCenterId: string; workCenterCode: string; workCenterName: string; minorStopSeconds: number; targetOeePct: number }>(
      tx,
      sql`select m.id, m.code, m.name, wc.id as "workCenterId", wc.code as "workCenterCode", wc.name as "workCenterName",
            coalesce(s.minor_stop_seconds, 300) as "minorStopSeconds", coalesce(s.target_oee_pct, 65) as "targetOeePct"
          from machines m join work_centers wc on wc.id = m.work_center_id left join mes_machine_settings s on s.machine_id = m.id
          where m.is_active and (s.id is not null or exists (select 1 from mes_machine_states x where x.machine_id = m.id)) ${machineId ? sql`and m.id = ${machineId}` : sql``}
          order by m.code`,
    );
    const states = await many<{ machineId: string; state: MachineState; start: string; end: string | null; loss: Loss | null }>(
      tx,
      sql`select st.machine_id as "machineId", st.state, st.started_at as start, st.ended_at as end, r.loss
          from mes_machine_states st left join mes_downtime_reasons r on r.id = st.reason_id
          where st.started_at < ${to.toISOString()} and coalesce(st.ended_at, now()) > ${from.toISOString()}`,
    );
    const counts = await many<{ machineId: string; minute: string; good: number; reject: number; idealSeconds: number }>(
      tx,
      sql`select machine_id as "machineId", minute, good, reject, ideal_seconds as "idealSeconds" from mes_counts where minute >= ${from.toISOString()} and minute < ${to.toISOString()}`,
    );
    const spans = (id: string): Span[] => states.filter((s) => s.machineId === id).map((s) => ({ state: s.state, start: Date.parse(s.start), end: s.end ? Date.parse(s.end) : null, loss: s.loss }));
    const cnt = (id: string) => counts.filter((c) => c.machineId === id).map((c) => ({ minute: Date.parse(c.minute), good: c.good, reject: c.reject, idealSeconds: c.idealSeconds }));
    return { ms, spans, cnt };
  }

  oee(auth: AuthContext, q: z.infer<typeof oeeQuery>) {
    const now = Date.now();
    const to = q.to ? new Date(q.to) : new Date(now);
    const from = q.from ? new Date(q.from) : new Date(Date.parse(`${istDate(now)}T00:00:00Z`) - 5.5 * 3_600_000);
    if (!(from < to)) throw new BadRequestException('"from" must be before "to"');
    return this.database.run(auth, async (tx) => {
      await this.ensureDefaults(tx, auth.tenantId);
      const shifts = await this.shifts(tx);
      const { ms, spans, cnt } = await this.machineData(tx, from, to, q.machineId);
      const windows = shiftWindows(shifts, from.getTime(), to.getTime()).map((w) => ({ ...w, start: Math.max(w.start, from.getTime()), end: Math.min(w.end, to.getTime()) }));
      const cells: { machine: (typeof ms)[number]; shift: string; date: string; r: OeeResult }[] = [];
      for (const m of ms) {
        const sp = spans(m.id);
        const ct = cnt(m.id);
        for (const w of windows) {
          const full = shifts.find((s) => s.code === w.shift.code)!;
          const fullLen = ((full.endMinute > full.startMinute ? full.endMinute : full.endMinute + 1440) - full.startMinute) * 60;
          const breakSeconds = (full.breakMinutes * 60 * (w.end - w.start)) / 1000 / fullLen;
          cells.push({ machine: m, shift: w.shift.code, date: w.date, r: computeOee({ from: w.start, to: w.end, now, spans: sp, counts: ct, minorStopSeconds: m.minorStopSeconds, breakSeconds }) });
        }
      }
      const groups = new Map<string, { key: string; label: string; target: number | null; rows: OeeResult[] }>();
      for (const c of cells) {
        const [key, label, target] =
          q.by === 'machine' ? [c.machine.id, `${c.machine.code} · ${c.machine.name}`, c.machine.targetOeePct] : q.by === 'workCenter' ? [c.machine.workCenterId, `${c.machine.workCenterCode} · ${c.machine.workCenterName}`, null] : q.by === 'shift' ? [c.shift, `Shift ${c.shift}`, null] : [c.date, c.date, null];
        const g = groups.get(key) ?? { key, label, target, rows: [] };
        g.rows.push(c.r);
        groups.set(key, g);
      }
      const rows = [...groups.values()].map((g) => ({ key: g.key, label: g.label, targetOeePct: g.target, ...combineOee(g.rows) }));
      return { from, to, by: q.by, total: combineOee(cells.map((c) => c.r)), rows: q.by === 'day' ? rows.sort((a, b) => a.key.localeCompare(b.key)) : rows };
    });
  }

  // ---- board -----------------------------------------------------------------------------------

  /** Every monitored machine now: state and since when, the job running, this shift's OEE, open calls. */
  board(auth: AuthContext) {
    const now = Date.now();
    return this.database.run(auth, async (tx) => {
      await this.ensureDefaults(tx, auth.tenantId);
      const shifts = await this.shifts(tx);
      const shift = currentShift(shifts, now);
      const from = new Date(shift?.start ?? now - 8 * 3_600_000);
      const { ms, spans, cnt } = await this.machineData(tx, from, new Date(now));
      const cur = await many<{ machineId: string; id: string; state: string; since: string; reasonName: string | null; source: string; lastSignalAt: string | null }>(
        tx,
        sql`select st.machine_id as "machineId", st.id, st.state, st.started_at as since, r.name as "reasonName", st.source, s.last_signal_at as "lastSignalAt"
            from mes_machine_states st left join mes_downtime_reasons r on r.id = st.reason_id left join mes_machine_settings s on s.machine_id = st.machine_id
            where st.ended_at is null`,
      );
      const jobs = await many<{ machineId: string; cardId: string; woId: string; woNumber: string; item: string; operation: string; goodQty: string; rejectQty: string; orderQty: string; operator: string | null }>(
        tx,
        sql`select distinct on (jc.machine_id) jc.machine_id as "machineId", jc.id as "cardId", wo.id as "woId", d.number as "woNumber", i.name as item, op.name as operation,
              jc.good_qty as "goodQty", jc.reject_qty as "rejectQty", wo.qty as "orderQty", jc.operator_name as operator
            from job_cards jc join work_orders wo on wo.id = jc.work_order_id join documents d on d.id = wo.id join items i on i.id = wo.item_id
            join work_order_operations op on op.id = jc.operation_id where jc.status = 'running' and jc.machine_id is not null order by jc.machine_id, jc.started_at desc`,
      );
      const calls = await tx.select().from(mesAndonCalls).where(isNull(mesAndonCalls.resolvedAt));
      const minorFor = (id: string) => ms.find((m) => m.id === id)?.minorStopSeconds ?? 300;
      return {
        shift: shift ? { code: shift.shift.code, name: shift.shift.name, start: new Date(shift.start), end: new Date(shift.end) } : null,
        machines: ms.map((m) => {
          const c = cur.find((x) => x.machineId === m.id);
          const offline = !c?.lastSignalAt || now - Date.parse(c.lastSignalAt) > 5 * 60_000;
          const o = computeOee({ from: from.getTime(), to: now, now, spans: spans(m.id), counts: cnt(m.id), minorStopSeconds: minorFor(m.id) });
          const j = jobs.find((x) => x.machineId === m.id);
          return {
            id: m.id,
            code: m.code,
            name: m.name,
            workCenterCode: m.workCenterCode,
            state: c?.state ?? null,
            stateId: c?.id ?? null,
            since: c?.since ?? null,
            reason: c?.reasonName ?? null,
            manual: c?.source === 'manual',
            offline,
            targetOeePct: m.targetOeePct,
            shift: { oee: o.oee, availability: o.availability, performance: o.performance, quality: o.quality, good: o.good, reject: o.reject, stops: o.stops },
            job: j ? { cardId: j.cardId, workOrderId: j.woId, number: j.woNumber, item: j.item, operation: j.operation, good: Number(j.goodQty), reject: Number(j.rejectQty), orderQty: Number(j.orderQty), operator: j.operator } : null,
            calls: calls.filter((k) => k.machineId === m.id).map((k) => ({ id: k.id, kind: k.kind, note: k.note, raisedAt: k.raisedAt, ackedAt: k.ackedAt })),
          };
        }),
      };
    });
  }

  // ---- Andon -----------------------------------------------------------------------------------

  raiseCall(auth: AuthContext, input: z.infer<typeof andonSchema>) {
    return this.database.run(auth, async (tx) => {
      const [m] = await tx.select({ id: machines.id, code: machines.code, name: machines.name }).from(machines).where(eq(machines.id, input.machineId));
      if (!m) throw new NotFoundException('Machine not found');
      const [open] = await tx.select({ id: mesAndonCalls.id }).from(mesAndonCalls).where(and(eq(mesAndonCalls.machineId, m.id), eq(mesAndonCalls.kind, input.kind), isNull(mesAndonCalls.resolvedAt)));
      if (open) throw new ConflictException(`A ${input.kind} call is already open on ${m.code}`);
      const [call] = await tx.insert(mesAndonCalls).values({ tenantId: auth.tenantId, machineId: m.id, kind: input.kind, note: input.note ?? null, raisedBy: auth.userId }).returning();
      const holders = await many<{ userId: string }>(
        tx,
        sql`select distinct m.user_id as "userId" from memberships m join membership_roles mr on mr.membership_id = m.id
            join role_permissions rp on rp.role_id = mr.role_id where m.status = 'active' and rp.permission_code = 'mes.shopfloor.use' and m.user_id <> ${auth.userId}`,
      );
      if (holders.length)
        await this.notifications.notify(tx, auth.tenantId, 'mes.andon_call', holders.map((h) => ({ userId: h.userId })), { title: `Andon: ${input.kind} needed at ${m.code}`, body: `${m.code} ${m.name}${input.note ? `: ${input.note}` : ''}`, link: '/mes/andon' });
      return call;
    });
  }

  calls(auth: AuthContext, open: boolean) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select c.id, c.kind, c.note, c.raised_at as "raisedAt", c.acked_at as "ackedAt", c.resolved_at as "resolvedAt", c.resolution,
              m.code as "machineCode", m.name as "machineName", ru.full_name as "raisedBy", au.full_name as "ackedBy",
              round(extract(epoch from (coalesce(c.acked_at, now()) - c.raised_at)))::int as "responseSeconds"
            from mes_andon_calls c join machines m on m.id = c.machine_id left join users ru on ru.id = c.raised_by left join users au on au.id = c.acked_by
            ${open ? sql`where c.resolved_at is null` : sql``} order by c.raised_at desc limit 200`,
      ),
    );
  }

  ackCall(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.update(mesAndonCalls).set({ ackedAt: new Date(), ackedBy: auth.userId }).where(and(eq(mesAndonCalls.id, id), isNull(mesAndonCalls.ackedAt))).returning();
      if (!c) throw new ConflictException('Call not found or already answered');
      return c;
    });
  }

  resolveCall(auth: AuthContext, id: string, resolution: string | null) {
    return this.database.run(auth, async (tx) => {
      const now = new Date();
      const [c] = await tx
        .update(mesAndonCalls)
        .set({ resolvedAt: now, resolution, ackedAt: sql`coalesce(${mesAndonCalls.ackedAt}, ${now.toISOString()})`, ackedBy: sql`coalesce(${mesAndonCalls.ackedBy}, ${auth.userId})` })
        .where(and(eq(mesAndonCalls.id, id), isNull(mesAndonCalls.resolvedAt)))
        .returning();
      if (!c) throw new ConflictException('Call not found or already closed');
      return c;
    });
  }
}
