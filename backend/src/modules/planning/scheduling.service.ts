import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { setupTransitions, workCenters, workOrderOperations, type Transaction } from '@nextgen/database';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { IST_MS, istDayStart, nextWorking, spread, workingMinutes, type Calendar } from './calendar';
import { schedule, type SchedOp, type SchedOrder, type SchedWorkCenter } from './scheduler';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const num = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const DAY = 86_400_000;
/** Midnight IST at the start of an ISO date. */
const dateStart = (d: string) => Date.parse(`${d}T00:00:00Z`) - IST_MS;
const isoDay = (t: number) => new Date(t + IST_MS).toISOString().slice(0, 10);

export const moveSchema = z.object({
  /** New start (ISO date-time); it snaps to the next working minute. */
  start: z.iso.datetime({ offset: true }).optional(),
  lane: z.number().int().min(0).max(499).optional(),
  /** false releases a hand-placed operation back to the scheduler. */
  locked: z.boolean().default(true),
});
export type MoveInput = z.infer<typeof moveSchema>;

export const transitionSchema = z.object({
  workCenterId: z.uuid(),
  fromItemId: z.uuid(),
  toItemId: z.uuid(),
  minutes: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,6}(\.\d{1,2})?$/.test(v), 'Minutes: up to 2 decimals'),
});

export const whatIfSchema = z.object({
  workCenters: z
    .array(z.object({ workCenterId: z.uuid(), units: z.number().int().min(1).max(50).optional(), hoursPerDay: z.number().min(1).max(24).optional(), daysPerWeek: z.number().int().min(1).max(7).optional(), efficiencyPct: z.number().min(10).max(200).optional() }))
    .max(50)
    .default([]),
  priorities: z.array(z.object({ workOrderId: z.uuid(), priority: z.number().int().min(1).max(5) })).max(200).default([]),
  newOrders: z.array(z.object({ itemId: z.uuid(), qty: z.number().positive().max(10_000_000), due: z.iso.date().optional(), release: z.iso.date().optional(), priority: z.number().int().min(1).max(5).default(3) })).max(20).default([]),
});

interface WcRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  kind: string;
  hours_per_day: string;
  days_per_week: number;
  shift_start: number;
  units: number;
  efficiency_pct: string;
}

const calOf = (w: WcRow): Calendar => ({ minutesPerDay: Math.round(num(w.hours_per_day) * 60), daysPerWeek: w.days_per_week, shiftStart: w.shift_start });

/**
 * Capacity (rough-cut and detailed load by work centre) and the finite schedule of open
 * work-order operations.
 */
@Injectable()
export class SchedulingService {
  constructor(private readonly database: DatabaseService) {}

  private workCenters(tx: Transaction) {
    return many<WcRow>(tx, sql`select id, code, name, kind, hours_per_day::text, days_per_week, shift_start, units, efficiency_pct::text from work_centers where is_active order by code`);
  }

  // ---- finite schedule -------------------------------------------------------------------

  run(auth: AuthContext) {
    return this.database.run(auth, (tx) => this.runTx(tx));
  }

  /** Open operations, orders, work centres and setup transitions: the input of the finite schedule. */
  private async loadInput(tx: Transaction) {
    const now = Date.now();
    const wcs = await this.workCenters(tx);
    const wcMap = new Map<string, SchedWorkCenter>(wcs.map((w) => [w.id, { id: w.id, cal: calOf(w), units: w.units, efficiency: num(w.efficiency_pct) / 100 || 1, infinite: w.kind === 'subcontract' }]));
    const rows = await many<{ id: string; work_order_id: string; seq: number; work_center_id: string; item_id: string; setup_minutes: string; planned_minutes: string; actual_minutes: string; status: string; schedule_locked: boolean; scheduled_start: Date | null; lane: number | null; priority: number; planned_start: string | null; planned_end: string | null }>(
      tx,
      sql`select o.id, o.work_order_id, o.seq, o.work_center_id, w.item_id, o.setup_minutes::text, o.planned_minutes::text, o.actual_minutes::text, o.status, o.schedule_locked, o.scheduled_start, o.lane,
                 w.priority, w.planned_start::text, w.planned_end::text
          from work_order_operations o join work_orders w on w.id = o.work_order_id join documents d on d.id = w.id
          where d.status not in ('cancelled', 'rejected') and w.stage not in ('completed', 'closed') and o.status <> 'done'`,
    );
    const ops: SchedOp[] = rows.map((r) => {
      const running = r.status === 'in_progress';
      const setup = running ? 0 : num(r.setup_minutes);
      const run = running ? Math.max(0, num(r.planned_minutes) - num(r.actual_minutes)) : Math.max(0, num(r.planned_minutes) - num(r.setup_minutes));
      return { id: r.id, workOrderId: r.work_order_id, seq: r.seq, workCenterId: r.work_center_id, itemId: r.item_id, setupMinutes: setup, runMinutes: run, running, locked: r.schedule_locked && r.scheduled_start ? { start: new Date(r.scheduled_start).getTime(), lane: r.lane ?? 0 } : null };
    });
    const orderRows = new Map<string, SchedOrder>();
    for (const r of rows)
      if (!orderRows.has(r.work_order_id)) orderRows.set(r.work_order_id, { id: r.work_order_id, priority: r.priority, due: r.planned_end ? dateStart(r.planned_end) + DAY : null, release: r.planned_start ? dateStart(r.planned_start) : now });
    const trans = await tx.select().from(setupTransitions);
    const transitions = new Map(trans.map((t) => [`${t.workCenterId}|${t.fromItemId}|${t.toItemId}`, num(t.minutes)]));
    return { now, wcs, wcMap, orders: [...orderRows.values()], ops, transitions };
  }

  private async runTx(tx: Transaction) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('schedule:' || current_setting('app.tenant_id', true)))`);
    const { now, wcMap, orders, ops, transitions } = await this.loadInput(tx);
    const out = schedule({ now, workCenters: wcMap, orders, ops, transitions });
    for (let i = 0; i < out.ops.length; i += 500) {
      const chunk = out.ops.slice(i, i + 500);
      const values = sql.join(
        chunk.map((o) => sql`(${o.id}::uuid, ${new Date(o.start).toISOString()}::timestamptz, ${new Date(o.end).toISOString()}::timestamptz, ${o.lane}::smallint, ${o.setup.toFixed(2)}::numeric)`),
        sql`, `,
      );
      await tx.execute(sql`update work_order_operations o set scheduled_start = v.s, scheduled_end = v.e, lane = v.l, setup_applied = v.su from (values ${values}) as v(id, s, e, l, su) where o.id = v.id`);
    }
    const late = out.orders.filter((o) => o.late).length;
    const ends = out.orders.map((o) => o.end ?? 0);
    return { operations: out.ops.length, orders: out.orders.length, late, conflicts: out.ops.filter((o) => o.conflict).length, finishesAt: ends.length ? new Date(Math.max(...ends)).toISOString() : null, setupMinutes: Math.round(out.ops.reduce((s, o) => s + o.setup, 0)) };
  }

  /**
   * What-if: the finite schedule with changed capacity (units, hours, working days, efficiency),
   * changed priorities and extra orders, compared with today's plan. Nothing is saved.
   */
  simulate(auth: AuthContext, input: z.infer<typeof whatIfSchema>) {
    return this.database.run(auth, async (tx) => {
      const base = await this.loadInput(tx);
      const baseline = schedule({ now: base.now, workCenters: base.wcMap, orders: base.orders, ops: base.ops, transitions: base.transitions });

      const wcMap = new Map(base.wcMap);
      for (const c of input.workCenters) {
        const w = base.wcs.find((x) => x.id === c.workCenterId);
        if (!w) throw new BadRequestException('Work centre not found');
        const cur = wcMap.get(w.id)!;
        wcMap.set(w.id, {
          ...cur,
          units: c.units ?? cur.units,
          efficiency: c.efficiencyPct !== undefined ? c.efficiencyPct / 100 : cur.efficiency,
          cal: { minutesPerDay: c.hoursPerDay !== undefined ? Math.round(c.hoursPerDay * 60) : cur.cal.minutesPerDay, daysPerWeek: c.daysPerWeek ?? cur.cal.daysPerWeek, shiftStart: cur.cal.shiftStart },
        });
      }
      const orders = base.orders.map((o) => ({ ...o, priority: input.priorities.find((p) => p.workOrderId === o.id)?.priority ?? o.priority }));
      const ops = [...base.ops];
      const added: { id: string; itemId: string; code: string; name: string; qty: number }[] = [];
      for (const [i, n] of input.newOrders.entries()) {
        const [bom] = await many<{ id: string; code: string; name: string }>(
          tx,
          sql`select b.id, it.code, it.name from boms b join documents d on d.id = b.id join items it on it.id = b.item_id
              where b.item_id = ${n.itemId} and d.status = 'approved' order by b.is_default desc, d.created_at desc limit 1`,
        );
        if (!bom) throw new BadRequestException('The item has no approved bill of materials with a routing');
        const routing = await many<{ seq: number; work_center_id: string; setup_minutes: string; run_minutes: string }>(
          tx,
          sql`select seq, work_center_id, setup_minutes::text, run_minutes::text from bom_operations where bom_id = ${bom.id} order by seq`,
        );
        if (!routing.length) throw new BadRequestException(`${bom.code} has no routing`);
        const id = `whatif-${i + 1}`;
        orders.push({ id, priority: n.priority, due: n.due ? dateStart(n.due) + DAY : null, release: n.release ? Math.max(dateStart(n.release), base.now) : base.now });
        for (const r of routing) ops.push({ id: `${id}-${r.seq}`, workOrderId: id, seq: r.seq, workCenterId: r.work_center_id, itemId: n.itemId, setupMinutes: num(r.setup_minutes), runMinutes: num(r.run_minutes) * n.qty, running: false, locked: null });
        added.push({ id, itemId: n.itemId, code: bom.code, name: bom.name, qty: n.qty });
      }
      const scenario = schedule({ now: base.now, workCenters: wcMap, orders, ops, transitions: base.transitions });

      const numbers = await many<{ id: string; number: string | null; code: string; name: string; due: string | null }>(
        tx,
        sql`select w.id, d.number, i.code, i.name, w.planned_end::text as due from work_orders w join documents d on d.id = w.id join items i on i.id = w.item_id
            where w.id in ${base.orders.length ? base.orders.map((o) => o.id) : ['00000000-0000-0000-0000-000000000000']}`,
      );
      const horizonEnd = Math.max(base.now + 7 * DAY, ...scenario.ops.map((o) => o.end), ...baseline.ops.map((o) => o.end));
      const wcOf = new Map(ops.map((o) => [o.id, o.workCenterId]));
      const load = (out: typeof baseline, map: Map<string, SchedWorkCenter>) =>
        base.wcs.map((w) => {
          const wc = map.get(w.id)!;
          // Working minutes each operation occupies its lane (an operation can span nights and holidays).
          const busy = out.ops.filter((o) => wcOf.get(o.id) === w.id).reduce((n, o) => n + workingMinutes(wc.cal, o.start, o.end), 0);
          const weeks = (horizonEnd - base.now) / (7 * DAY);
          const available = wc.infinite ? null : wc.units * wc.cal.minutesPerDay * wc.cal.daysPerWeek * weeks;
          return { workCenterId: w.id, code: w.code, name: w.name, units: wc.units, hoursPerDay: wc.cal.minutesPerDay / 60, busyHours: Math.round(busy / 6) / 10, loadPct: available ? Math.round((busy / available) * 1000) / 10 : null };
        });
      const summary = (out: typeof baseline) => {
        const ends = out.orders.map((o) => o.end ?? 0);
        return { late: out.orders.filter((o) => o.late).length, finishesAt: ends.length ? new Date(Math.max(...ends)) : null, setupMinutes: Math.round(out.ops.reduce((n, o) => n + o.setup, 0)) };
      };
      const orderRows = scenario.orders.map((o) => {
        const b = baseline.orders.find((x) => x.id === o.id);
        const meta = numbers.find((x) => x.id === o.id);
        const extra = added.find((x) => x.id === o.id);
        return {
          id: o.id,
          number: meta?.number ?? (extra ? 'What-if' : 'Draft'),
          item: meta ? `${meta.code} · ${meta.name}` : extra ? `${extra.code} · ${extra.name} × ${extra.qty}` : '',
          added: !!extra,
          before: b ? { end: b.end ? new Date(b.end) : null, late: b.late } : null,
          after: { end: o.end ? new Date(o.end) : null, late: o.late },
          shiftHours: b?.end && o.end ? Math.round(((o.end - b.end) / 3_600_000) * 10) / 10 : null,
        };
      });
      return {
        baseline: { ...summary(baseline), load: load(baseline, base.wcMap) },
        scenario: { ...summary(scenario), load: load(scenario, wcMap) },
        orders: orderRows.sort((a, b) => Math.abs(b.shiftHours ?? 0) - Math.abs(a.shiftHours ?? 0) || Number(b.added) - Number(a.added)),
      };
    });
  }

  /** Operations on the board between two dates, with the work centres as rows. */
  board(auth: AuthContext, q: { from: string; days: number }) {
    return this.database.run(auth, async (tx) => {
      const from = dateStart(q.from);
      const to = from + q.days * DAY;
      const wcs = await this.workCenters(tx);
      const ops = await many<{ id: string; work_order_id: string; number: string | null; seq: number; name: string; work_center_id: string; lane: number | null; start: Date; end: Date; setup_applied: string | null; schedule_locked: boolean; status: string; item_code: string; item_name: string; qty: string; planned_end: string | null; wo_end: Date; prev_end: Date | null }>(
        tx,
        sql`select * from (
              select o.id, o.work_order_id, d.number, o.seq, o.name, o.work_center_id, o.lane, o.scheduled_start as start, o.scheduled_end as "end", o.setup_applied::text, o.schedule_locked, o.status,
                     i.code as item_code, i.name as item_name, w.qty::text, w.planned_end::text,
                     max(o.scheduled_end) over (partition by o.work_order_id) as wo_end,
                     lag(o.scheduled_end) over (partition by o.work_order_id order by o.seq) as prev_end
              from work_order_operations o join work_orders w on w.id = o.work_order_id join documents d on d.id = w.id join items i on i.id = w.item_id
              where d.status not in ('cancelled', 'rejected') and w.stage not in ('completed', 'closed') and o.status <> 'done' and o.scheduled_start is not null
            ) x where x.start < ${new Date(to).toISOString()}::timestamptz and x."end" > ${new Date(from).toISOString()}::timestamptz
            order by x.start`,
      );
      return {
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        workCenters: wcs.map((w) => ({ id: w.id, code: w.code, name: w.name, lanes: w.kind === 'subcontract' ? 1 : w.units, outside: w.kind === 'subcontract', hoursPerDay: num(w.hours_per_day), shiftStart: w.shift_start, daysPerWeek: w.days_per_week })),
        operations: ops.map((o) => ({
          id: o.id,
          workOrder: { id: o.work_order_id, number: o.number ?? 'Draft' },
          seq: o.seq,
          name: o.name,
          workCenterId: o.work_center_id,
          lane: o.lane ?? 0,
          start: new Date(o.start).toISOString(),
          end: new Date(o.end).toISOString(),
          setupMinutes: num(o.setup_applied),
          locked: o.schedule_locked,
          running: o.status === 'in_progress',
          item: { code: o.item_code, name: o.item_name },
          qty: o.qty,
          dueDate: o.planned_end,
          late: !!o.planned_end && new Date(o.wo_end).getTime() > dateStart(o.planned_end) + DAY,
          conflict: !!o.prev_end && new Date(o.prev_end).getTime() > new Date(o.start).getTime(),
        })),
      };
    });
  }

  /** Drag on the board: pin the operation (or release it) and reschedule everything else around it. */
  move(auth: AuthContext, id: string, input: MoveInput) {
    return this.database.run(auth, async (tx) => {
      const [op] = await tx.select({ o: workOrderOperations, wc: workCenters }).from(workOrderOperations).innerJoin(workCenters, eq(workCenters.id, workOrderOperations.workCenterId)).where(eq(workOrderOperations.id, id));
      if (!op) throw new NotFoundException('Operation not found');
      if (op.o.status === 'done') throw new BadRequestException('The operation is finished');
      if (!input.locked) {
        await tx.update(workOrderOperations).set({ scheduleLocked: false }).where(eq(workOrderOperations.id, id));
        return this.runTx(tx);
      }
      if (!input.start && !op.o.scheduledStart) throw new BadRequestException('Give the new start');
      const lanes = op.wc.kind === 'subcontract' ? 1 : op.wc.units;
      const lane = input.lane ?? op.o.lane ?? 0;
      if (lane >= lanes) throw new BadRequestException(`${op.wc.code} has ${lanes} unit${lanes === 1 ? '' : 's'}`);
      const cal: Calendar = { minutesPerDay: Math.round(Number(op.wc.hoursPerDay) * 60), daysPerWeek: op.wc.daysPerWeek, shiftStart: op.wc.shiftStart };
      const start = nextWorking(cal, input.start ? Date.parse(input.start) : op.o.scheduledStart!.getTime());
      await tx.update(workOrderOperations).set({ scheduledStart: new Date(start), lane, scheduleLocked: true }).where(eq(workOrderOperations.id, id));
      return this.runTx(tx);
    });
  }

  // ---- setup transitions ---------------------------------------------------------------

  transitions(auth: AuthContext, workCenterId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select t.id, t.work_center_id as "workCenterId", wc.code as "workCenter", t.from_item_id as "fromItemId", f.code as "fromCode", f.name as "fromName", t.to_item_id as "toItemId", tt.code as "toCode", tt.name as "toName", t.minutes::text
            from setup_transitions t join work_centers wc on wc.id = t.work_center_id join items f on f.id = t.from_item_id join items tt on tt.id = t.to_item_id
            ${workCenterId ? sql`where t.work_center_id = ${workCenterId}` : sql``}
            order by wc.code, f.code, tt.code`,
      ),
    );
  }

  saveTransition(auth: AuthContext, input: z.infer<typeof transitionSchema>) {
    if (input.fromItemId === input.toItemId) throw new BadRequestException('A changeover is between two different items');
    return this.database.run(auth, async (tx) => {
      const [r] = await tx
        .insert(setupTransitions)
        .values({ tenantId: auth.tenantId, ...input })
        .onConflictDoUpdate({ target: [setupTransitions.workCenterId, setupTransitions.fromItemId, setupTransitions.toItemId], set: { minutes: input.minutes } })
        .returning();
      return r;
    });
  }

  deleteTransition(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      await tx.delete(setupTransitions).where(and(eq(setupTransitions.id, id)));
    });
  }

  // ---- capacity --------------------------------------------------------------------------

  /**
   * Load against capacity per work centre.
   *  - rough: weekly buckets; open work orders (remaining operation minutes spread over their
   *    planned window) plus MRP planned make / batch orders (routing or formula stages spread
   *    from release to due);
   *  - detailed: daily buckets from the finite schedule.
   * Capacity is working minutes × units; load is standard minutes ÷ efficiency.
   */
  capacity(auth: AuthContext, q: { mode: 'rough' | 'detailed'; from: string; periods: number }) {
    return this.database.run(auth, async (tx) => {
      const wcs = await this.workCenters(tx);
      let start = dateStart(q.from);
      const len = q.mode === 'rough' ? 7 * DAY : DAY;
      if (q.mode === 'rough') {
        const dow = new Date(start + IST_MS).getUTCDay();
        start -= ((dow + 6) % 7) * DAY; // back to Monday
      }
      const buckets = Array.from({ length: q.periods }, (_, i) => ({ start: start + i * len, end: start + (i + 1) * len }));
      const end = buckets[buckets.length - 1].end;
      const load = new Map<string, { orders: number[]; planned: number[] }>(wcs.map((w) => [w.id, { orders: buckets.map(() => 0), planned: buckets.map(() => 0) }]));
      const wcById = new Map(wcs.map((w) => [w.id, w]));
      const add = (wcId: string, key: 'orders' | 'planned', parts: number[]) => {
        const l = load.get(wcId);
        if (l) parts.forEach((v, i) => (l[key][i] += v));
      };
      const eff = (w: WcRow) => num(w.efficiency_pct) / 100 || 1;

      if (q.mode === 'detailed') {
        const ops = await many<{ work_center_id: string; s: Date; e: Date }>(
          tx,
          sql`select o.work_center_id, o.scheduled_start as s, o.scheduled_end as e
              from work_order_operations o join work_orders w on w.id = o.work_order_id join documents d on d.id = w.id
              where d.status not in ('cancelled', 'rejected') and w.stage not in ('completed', 'closed') and o.status <> 'done'
                and o.scheduled_start < ${new Date(end).toISOString()}::timestamptz and o.scheduled_end > ${new Date(start).toISOString()}::timestamptz`,
        );
        for (const o of ops) {
          const w = wcById.get(o.work_center_id);
          if (!w) continue;
          const s = new Date(o.s).getTime();
          const e = new Date(o.e).getTime();
          add(w.id, 'orders', buckets.map((b) => (Math.min(e, b.end) > Math.max(s, b.start) ? workingMinutes(calOf(w), Math.max(s, b.start), Math.min(e, b.end)) : 0)));
        }
      } else {
        const today = istDayStart(Date.now());
        const ops = await many<{ work_center_id: string; planned_minutes: string; actual_minutes: string; status: string; planned_start: string | null; planned_end: string | null }>(
          tx,
          sql`select o.work_center_id, o.planned_minutes::text, o.actual_minutes::text, o.status, w.planned_start::text, w.planned_end::text
              from work_order_operations o join work_orders w on w.id = o.work_order_id join documents d on d.id = w.id
              where d.status not in ('cancelled', 'rejected') and w.stage not in ('completed', 'closed') and o.status <> 'done'`,
        );
        for (const o of ops) {
          const w = wcById.get(o.work_center_id);
          if (!w) continue;
          const mins = Math.max(0, num(o.planned_minutes) - num(o.actual_minutes)) / eff(w);
          const s = Math.max(today, o.planned_start ? dateStart(o.planned_start) : today);
          const e = Math.max(s + DAY, o.planned_end ? dateStart(o.planned_end) + DAY : s + DAY);
          add(w.id, 'orders', spread(calOf(w), s, e, mins, buckets));
        }
        // MRP planned make orders: BOM routing (setup + run × qty), or formula stages scaled to the batch.
        const planned = await many<{ work_center_id: string; minutes: string; release_date: string; due_date: string }>(
          tx,
          sql`select bo.work_center_id, (bo.setup_minutes + bo.run_minutes * p.qty)::text as minutes, p.release_date::text, p.due_date::text
              from planned_orders p
              join boms b on b.item_id = p.item_id and b.is_default join documents bd on bd.id = b.id and bd.status = 'approved'
              join bom_operations bo on bo.bom_id = b.id
              where p.status in ('planned', 'firmed') and p.source = 'make'
              union all
              select fs.work_center_id, (fs.minutes * (p.qty * 100 / nullif(f.yield_pct, 0)) / nullif(f.batch_size, 0))::text, p.release_date::text, p.due_date::text
              from planned_orders p
              join formulas f on f.item_id = p.item_id and f.is_default join documents fd on fd.id = f.id and fd.status = 'approved'
              join formula_stages fs on fs.formula_id = f.id
              where p.status in ('planned', 'firmed') and p.source = 'batch'`,
        );
        for (const p of planned) {
          const w = wcById.get(p.work_center_id);
          if (!w) continue;
          add(w.id, 'planned', spread(calOf(w), dateStart(p.release_date), dateStart(p.due_date) + DAY, num(p.minutes) / eff(w), buckets));
        }
      }

      return {
        mode: q.mode,
        buckets: buckets.map((b) => ({ start: isoDay(b.start), end: isoDay(b.end - DAY) })),
        workCenters: wcs.map((w) => {
          const cal = calOf(w);
          const units = w.kind === 'subcontract' ? 0 : w.units;
          const l = load.get(w.id)!;
          const capacity = buckets.map((b) => Math.round(workingMinutes(cal, b.start, b.end) * units));
          return {
            id: w.id,
            code: w.code,
            name: w.name,
            outside: w.kind === 'subcontract',
            capacity,
            orders: l.orders.map(Math.round),
            planned: l.planned.map(Math.round),
            utilisation: capacity.map((c, i) => (c > 0 ? Math.round(((l.orders[i] + l.planned[i]) / c) * 100) : null)),
          };
        }),
      };
    });
  }
}
