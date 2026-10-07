import { Injectable, NotFoundException } from '@nestjs/common';
import { twinLayouts, twinNodes, type Transaction } from '@nextgen/database';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { MesService } from '../mes/mes.service';
import { SchedulingService, whatIfSchema } from '../planning/scheduling.service';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;

export const layoutSchema = z.object({
  name: z.string().trim().min(2).max(80),
  width: z.number().int().min(10).max(500).default(60),
  height: z.number().int().min(10).max(500).default(30),
  isDefault: z.boolean().default(false),
  nodes: z
    .array(
      z.object({
        kind: z.enum(['machine', 'area', 'label']),
        machineId: z.uuid().nullable().optional(),
        workCenterId: z.uuid().nullable().optional(),
        label: z.string().trim().max(80).nullable().optional(),
        x: z.number().min(0).max(500),
        y: z.number().min(0).max(500),
        w: z.number().min(0.5).max(500).default(4),
        h: z.number().min(0.5).max(500).default(3),
      }),
    )
    .max(500)
    .default([]),
});

/**
 * Digital twin: plant layouts with each machine drawn where it stands, shown live (state, job,
 * shift OEE, key signals, alarms, anomalies, vision defects), and what-if simulation of the
 * production schedule.
 */
@Injectable()
export class TwinService {
  constructor(
    private readonly database: DatabaseService,
    private readonly mes: MesService,
    private readonly scheduling: SchedulingService,
  ) {}

  layouts(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select l.id, l.name, l.width, l.height, l.is_default as "isDefault", l.updated_at as "updatedAt", (select count(*)::int from twin_nodes n where n.layout_id = l.id) as nodes
            from twin_layouts l order by l.is_default desc, l.name`,
      ),
    );
  }

  save(auth: AuthContext, id: string | null, input: z.infer<typeof layoutSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { name: input.name, width: input.width, height: input.height, isDefault: input.isDefault, updatedBy: auth.userId, updatedAt: new Date() };
      if (input.isDefault) await tx.update(twinLayouts).set({ isDefault: false });
      let layoutId = id;
      if (id) {
        const [l] = await tx.update(twinLayouts).set(values).where(eq(twinLayouts.id, id)).returning({ id: twinLayouts.id });
        if (!l) throw new NotFoundException('Layout not found');
        await tx.delete(twinNodes).where(eq(twinNodes.layoutId, id));
      } else layoutId = (await tx.insert(twinLayouts).values({ tenantId: auth.tenantId, ...values }).returning({ id: twinLayouts.id }))[0].id;
      if (input.nodes.length)
        await tx.insert(twinNodes).values(
          input.nodes.map((n) => ({ tenantId: auth.tenantId, layoutId: layoutId!, kind: n.kind, machineId: n.kind === 'machine' ? (n.machineId ?? null) : null, workCenterId: n.workCenterId ?? null, label: n.label ?? null, x: n.x, y: n.y, w: n.w, h: n.h })),
        );
      return this.getTx(tx, layoutId!);
    });
  }

  remove(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const r = await tx.delete(twinLayouts).where(eq(twinLayouts.id, id)).returning({ id: twinLayouts.id });
      if (!r.length) throw new NotFoundException('Layout not found');
      return { ok: true };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.getTx(tx, id));
  }

  private async getTx(tx: Transaction, id: string) {
    const [l] = await tx.select().from(twinLayouts).where(eq(twinLayouts.id, id));
    if (!l) throw new NotFoundException('Layout not found');
    const nodes = await many(
      tx,
      sql`select n.id, n.kind, n.machine_id as "machineId", m.code as "machineCode", m.name as "machineName", n.work_center_id as "workCenterId", n.label, n.x, n.y, n.w, n.h
          from twin_nodes n left join machines m on m.id = n.machine_id where n.layout_id = ${id} order by n.kind, n.y, n.x`,
    );
    return { ...l, nodes };
  }

  /** The layout with every machine's live status. */
  async live(auth: AuthContext, id: string) {
    const layout = await this.get(auth, id);
    const board = await this.mes.board(auth);
    const extra = await this.database.run(auth, async (tx) => {
      const ids = (layout.nodes as { machineId: string | null }[]).map((n) => n.machineId).filter((x): x is string => !!x);
      if (!ids.length) return { signals: [], alarms: [], anomalies: [], vision: [], calls: [] };
      const signals = await many<{ machineId: string; code: string; name: string; purpose: string; unit: string | null; lastValue: number | null; lastAt: string | null }>(
        tx,
        sql`select machine_id as "machineId", code, name, purpose, unit, last_value as "lastValue", last_at as "lastAt" from iot_signals
            where machine_id in ${ids} and is_active and purpose in ('temperature', 'vibration', 'current', 'pressure', 'power_kw', 'speed', 'humidity') order by code`,
      );
      const alarms = await many<{ machineId: string; n: number }>(tx, sql`select machine_id as "machineId", count(*)::int as n from iot_alarms where machine_id in ${ids} and cleared_at is null group by 1`);
      const anomalies = await many<{ machineId: string; n: number }>(tx, sql`select machine_id as "machineId", count(*)::int as n from cm_anomalies where machine_id in ${ids} and cleared_at is null group by 1`);
      const vision = await many<{ machineId: string; total: number; defects: number }>(
        tx,
        sql`select machine_id as "machineId", count(*)::int as total, count(*) filter (where result = 'defect')::int as defects from vision_inspections
            where machine_id in ${ids} and ts > now() - interval '1 hour' group by 1`,
      );
      return { signals, alarms, anomalies, vision };
    });
    const nodes = (layout.nodes as { machineId: string | null }[]).map((n) => {
      if (!n.machineId) return n;
      const m = board.machines.find((x) => x.id === n.machineId);
      const v = extra.vision.find((x) => x.machineId === n.machineId);
      return {
        ...n,
        live: {
          state: m?.state ?? null,
          since: m?.since ?? null,
          reason: m?.reason ?? null,
          offline: m?.offline ?? true,
          oee: m?.shift.oee ?? null,
          targetOeePct: m?.targetOeePct ?? null,
          job: m?.job ?? null,
          calls: m?.calls.length ?? 0,
          alarms: extra.alarms.find((x) => x.machineId === n.machineId)?.n ?? 0,
          anomalies: extra.anomalies.find((x) => x.machineId === n.machineId)?.n ?? 0,
          visionDefectPct: v && v.total ? Math.round((v.defects / v.total) * 1000) / 10 : null,
          signals: extra.signals.filter((s) => s.machineId === n.machineId).slice(0, 4),
        },
      };
    });
    return { ...layout, shift: board.shift, nodes };
  }

  simulate(auth: AuthContext, input: z.infer<typeof whatIfSchema>) {
    return this.scheduling.simulate(auth, input);
  }

  /** Default layout id, if any. */
  async defaultLayout(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const [l] = await tx.select({ id: twinLayouts.id }).from(twinLayouts).where(and(eq(twinLayouts.isDefault, true))).limit(1);
      return { id: l?.id ?? null };
    });
  }
}
