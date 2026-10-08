import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { IST_MS, workingMinutes, type Calendar } from '../planning/calendar';
import { many } from '../../common/sql';

const DAY = 86_400_000;
const num = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);

/**
 * Reliability and effectiveness, from signed-off breakdown orders and shop-floor job cards:
 * MTTR, MTBF and downtime per asset; maintenance cost; OEE per machine with its losses.
 */
@Injectable()
export class ReliabilityService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Per asset over the period:
   *  - failures: breakdown orders finished in it;
   *  - MTTR: their average downtime;
   *  - MTBF: working hours (the work centre's calendar for shop-floor machines, else round the
   *    clock) less downtime, divided by failures;
   *  - cost: maintenance orders signed off, split breakdown / planned.
   */
  reliability(auth: AuthContext, q: { from: string; to: string }) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<{ id: string; code: string; name: string; criticality: string; failures: number; downtime: number; breakdown_cost: string; planned_cost: string; hours_per_day: string | null; days_per_week: number | null; shift_start: number | null }>(
        tx,
        sql`select a.id, a.code, a.name, a.criticality,
                   count(*) filter (where o.kind = 'breakdown')::int as failures,
                   coalesce(sum(o.downtime_minutes) filter (where o.machine_down), 0)::int as downtime,
                   coalesce(sum(o.total_cost) filter (where o.kind = 'breakdown' and d.status = 'approved'), 0)::text as breakdown_cost,
                   coalesce(sum(o.total_cost) filter (where o.kind <> 'breakdown' and d.status = 'approved'), 0)::text as planned_cost,
                   wc.hours_per_day::text, wc.days_per_week, wc.shift_start
            from maint_assets a
            left join maintenance_orders o on o.asset_id = a.id and o.finished_at >= ${q.from}::date and o.finished_at < ${q.to}::date + 1
            left join documents d on d.id = o.id and d.status <> 'cancelled'
            left join machines m on m.id = a.machine_id left join work_centers wc on wc.id = m.work_center_id
            where a.status <> 'retired'
            group by a.id, a.code, a.name, a.criticality, wc.hours_per_day, wc.days_per_week, wc.shift_start
            order by a.code`,
      );
      const from = Date.parse(`${q.from}T00:00:00Z`) - IST_MS;
      const to = Date.parse(`${q.to}T00:00:00Z`) - IST_MS + DAY;
      return rows.map((r) => {
        const cal: Calendar | null = r.hours_per_day ? { minutesPerDay: Math.round(num(r.hours_per_day) * 60), daysPerWeek: r.days_per_week ?? 6, shiftStart: r.shift_start ?? 540 } : null;
        const available = cal ? workingMinutes(cal, from, to) : (to - from) / 60_000;
        const up = Math.max(0, available - r.downtime);
        return {
          asset: { id: r.id, code: r.code, name: r.name, criticality: r.criticality },
          failures: r.failures,
          downtimeHours: r1(r.downtime / 60),
          mttrHours: r.failures ? r1(r.downtime / 60 / r.failures) : null,
          mtbfHours: r.failures ? r1(up / 60 / r.failures) : null,
          availabilityPct: available > 0 ? pct(up / available) : null,
          breakdownCost: r.breakdown_cost,
          plannedCost: r.planned_cost,
        };
      });
    });
  }

  /**
   * OEE per shop-floor machine over the period:
   *  - availability = (working time − maintenance downtime) ÷ working time;
   *  - performance = standard minutes for the pieces made ÷ minutes booked on job cards;
   *  - quality = good ÷ (good + rejected).
   * Losses are given in minutes.
   */
  oee(auth: AuthContext, q: { from: string; to: string }) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<{ id: string; code: string; name: string; hours_per_day: string; days_per_week: number; shift_start: number; downtime: number; booked: string; standard: string; good: string; rejected: string; unit_std: string }>(
        tx,
        sql`select m.id, m.code, m.name, wc.hours_per_day::text, wc.days_per_week, wc.shift_start,
                   coalesce((select sum(o.downtime_minutes) from maintenance_orders o join maint_assets a on a.id = o.asset_id join documents d on d.id = o.id
                             where a.machine_id = m.id and o.machine_down and d.status <> 'cancelled' and o.finished_at >= ${q.from}::date and o.finished_at < ${q.to}::date + 1), 0)::int as downtime,
                   coalesce(sum(j.minutes), 0)::text as booked,
                   coalesce(sum(op.run_minutes * (j.good_qty + j.reject_qty)), 0)::text as standard,
                   coalesce(sum(j.good_qty), 0)::text as good, coalesce(sum(j.reject_qty), 0)::text as rejected,
                   coalesce(sum(op.run_minutes * j.reject_qty), 0)::text as unit_std
            from machines m join work_centers wc on wc.id = m.work_center_id
            left join job_cards j on j.machine_id = m.id and j.status = 'done' and j.ended_at >= ${q.from}::date and j.ended_at < ${q.to}::date + 1
            left join work_order_operations op on op.id = j.operation_id
            where m.is_active
            group by m.id, m.code, m.name, wc.hours_per_day, wc.days_per_week, wc.shift_start
            order by m.code`,
      );
      const from = Date.parse(`${q.from}T00:00:00Z`) - IST_MS;
      const to = Date.parse(`${q.to}T00:00:00Z`) - IST_MS + DAY;
      return rows.map((r) => {
        const planned = workingMinutes({ minutesPerDay: Math.round(num(r.hours_per_day) * 60), daysPerWeek: r.days_per_week, shiftStart: r.shift_start }, from, to);
        const booked = num(r.booked);
        const good = num(r.good);
        const total = good + num(r.rejected);
        const availability = planned > 0 ? Math.max(0, planned - r.downtime) / planned : null;
        const performance = booked > 0 ? Math.min(1, num(r.standard) / booked) : null;
        const quality = total > 0 ? good / total : null;
        const oee = availability !== null && performance !== null && quality !== null ? availability * performance * quality : null;
        return {
          machine: { id: r.id, code: r.code, name: r.name },
          plannedMinutes: Math.round(planned),
          downtimeMinutes: r.downtime,
          bookedMinutes: Math.round(booked),
          good,
          rejected: num(r.rejected),
          availabilityPct: pct(availability),
          performancePct: pct(performance),
          qualityPct: pct(quality),
          oeePct: pct(oee),
          losses: {
            breakdownMinutes: r.downtime,
            speedMinutes: booked > 0 ? Math.max(0, Math.round(booked - num(r.standard))) : 0,
            qualityMinutes: Math.round(num(r.unit_std)),
            idleMinutes: Math.max(0, Math.round(planned - r.downtime - booked)),
          },
        };
      });
    });
  }
}
