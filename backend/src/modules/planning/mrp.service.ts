import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { itemPlanning, items, mrpExceptions, mrpItemPlans, mrpRuns, plannedOrders, type Transaction } from '@nextgen/database';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { activeLines, type BomLineData } from '../manufacturing/bom-math';
import { WorkOrdersService } from '../manufacturing/work-orders.service';
import { lineQty, type Basis } from '../process/formula-math';
import { RequisitionsService } from '../purchase/requisitions.service';
import { months } from './forecast';
import { currentPeriod } from './forecasting.service';
import { addDays, runMrp, type Demand, type LotSizing, type PlanItem, type Receipt, type Source } from './mrp-engine';
import { many } from '../../common/sql';

const num = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const q4 = (v: number) => (Math.round(v * 1e4) / 1e4).toFixed(4);

const decimal = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), `${label}: zero or more, up to 4 decimals`);

export const runSchema = z.object({
  horizonDays: z.number().int().min(7).max(730).default(120),
  useForecast: z.boolean().default(true),
});
export type RunInput = z.infer<typeof runSchema>;

export const parametersSchema = z.object({
  source: z.enum(['auto', 'make', 'buy']).default('auto'),
  lotSizing: z.enum(['l4l', 'fixed', 'eoq', 'min_max', 'period']).default('l4l'),
  lotQty: decimal('Lot quantity').nullable().optional(),
  periodDays: z.number().int().min(1).max(365).nullable().optional(),
  orderCost: decimal('Cost per order').nullable().optional(),
  holdingPct: decimal('Holding cost %').nullable().optional(),
  excluded: z.boolean().default(false),
  leadTimeDays: z.number().int().min(0).max(999).nullable().optional(),
  safetyStock: decimal('Safety stock').nullable().optional(),
  minOrderQty: decimal('Minimum order quantity').nullable().optional(),
});
export type ParametersInput = z.infer<typeof parametersSchema>;

export const firmSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500), firm: z.boolean().default(true) });
export const editPlannedSchema = z.object({ qty: decimal('Quantity').refine((v) => Number(v) > 0, 'Quantity must be more than zero'), dueDate: z.iso.date(), releaseDate: z.iso.date().nullable().optional() });
export const convertSchema = z.object({ ids: z.array(z.uuid()).min(1).max(200), warehouseId: z.uuid().nullable().optional() });

interface StructureLine {
  itemId: string;
  qtyPer: number;
}

/**
 * MRP over the whole workspace (nettable warehouses together). Demand: open sales orders,
 * the forecast (consumed by the orders due in the same month), and materials still to issue
 * on open work orders. Supply: stock, open purchase orders, open requisitions, open work
 * orders and firmed planned orders.
 */
@Injectable()
export class MrpService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workOrders: WorkOrdersService,
    private readonly requisitions: RequisitionsService,
  ) {}

  run(auth: AuthContext, input: RunInput) {
    return this.database.run(auth, async (tx) => {
      // One run at a time per workspace.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mrp:${auth.tenantId}`}))`);
      const t0 = Date.now();
      const today = todayIST();
      const horizonEnd = addDays(today, input.horizonDays);
      const [run] = await tx.insert(mrpRuns).values({ tenantId: auth.tenantId, horizonDays: input.horizonDays, useForecast: input.useForecast, startedBy: auth.userId }).returning();

      const data = await this.load(tx, today, horizonEnd, input.useForecast);
      const tLoad = Date.now();
      const out = runMrp({ today, horizonEnd, items: data.items, structure: data.structure, onHand: data.onHand, demands: data.demands, receipts: data.receipts });
      const tPlan = Date.now();

      // Planned (not firmed or converted) orders are replaced by this run.
      await tx.delete(plannedOrders).where(eq(plannedOrders.status, 'planned'));
      const ids = new Map<number, string>(out.plannedOrders.map((p) => [p.key, randomUUID()]));
      const realId = (id: string | null | undefined) => (id && id.startsWith('#') ? (ids.get(Number(id.slice(1))) ?? null) : (id ?? null));
      const fixRef = <T extends { id?: string | null } | null>(r: T): T => (r ? { ...r, id: realId(r.id) } : r);

      const poRows = out.plannedOrders.map((p) => ({
        id: ids.get(p.key)!,
        tenantId: auth.tenantId,
        runId: run.id,
        itemId: p.itemId,
        source: p.source,
        qty: q4(p.qty),
        dueDate: p.dueDate,
        releaseDate: p.releaseDate,
        level: p.level,
        refKey: p.key,
        pegs: p.pegs.map((g) => ({ ...g, id: realId(g.id) })),
      }));
      for (let i = 0; i < poRows.length; i += 500) await tx.insert(plannedOrders).values(poRows.slice(i, i + 500));
      const exRows = out.exceptions.map((e) => ({
        tenantId: auth.tenantId,
        runId: run.id,
        itemId: e.itemId,
        kind: e.kind,
        date: e.date,
        toDate: e.toDate ?? null,
        qty: e.qty === null ? null : q4(e.qty),
        refKind: e.ref?.kind ?? null,
        refId: e.ref ? realId(e.ref.id) : null,
        refNumber: e.ref?.number ?? null,
        message: e.message,
      }));
      for (let i = 0; i < exRows.length; i += 1000) await tx.insert(mrpExceptions).values(exRows.slice(i, i + 1000));
      const planRows = out.plans.map((p) => ({
        tenantId: auth.tenantId,
        runId: run.id,
        itemId: p.itemId,
        level: p.level,
        onHand: q4(p.onHand),
        safetyStock: q4(p.safetyStock),
        demand: q4(p.demand),
        receipts: q4(p.receipts),
        planned: q4(p.planned),
        endBalance: q4(p.endBalance),
        firstShortage: p.firstShortage,
        timeline: p.timeline.map((r) => ({ ...r, ref: fixRef(r.ref) })),
      }));
      for (let i = 0; i < planRows.length; i += 500) await tx.insert(mrpItemPlans).values(planRows.slice(i, i + 500));

      const byKind: Record<string, number> = {};
      for (const e of out.exceptions) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      const stats = {
        items: data.items.size,
        plannedItems: out.plans.length,
        plannedOrders: out.plannedOrders.length,
        buy: out.plannedOrders.filter((p) => p.source === 'buy').length,
        make: out.plannedOrders.filter((p) => p.source !== 'buy').length,
        exceptions: out.exceptions.length,
        ...Object.fromEntries(Object.entries(byKind).map(([k, v]) => [`ex_${k}`, v])),
        loadMs: tLoad - t0,
        planMs: tPlan - tLoad,
        saveMs: Date.now() - tPlan,
        ms: Date.now() - t0,
      };
      const [done] = await tx.update(mrpRuns).set({ status: 'done', stats, finishedAt: new Date() }).where(eq(mrpRuns.id, run.id)).returning();
      // Keep the last ten runs.
      await tx.execute(sql`delete from mrp_runs where id in (select id from mrp_runs order by started_at desc offset 10)`);
      return done;
    });
  }

  /** Everything the engine needs, in a handful of set-based queries. */
  private async load(tx: Transaction, today: string, horizonEnd: string, useForecast: boolean) {
    const itemRows = await many<{ id: string; code: string; lt: number | null; ss: string | null; moq: string | null; cost: string | null; source: string | null; lot_sizing: string | null; lot_qty: string | null; period_days: number | null; order_cost: string | null; holding_pct: string | null }>(
      tx,
      sql`select i.id, i.code, i.lead_time_days as lt, i.safety_stock::text as ss, i.min_order_qty::text as moq, coalesce(i.standard_cost, i.last_purchase_rate)::text as cost,
                 p.source, p.lot_sizing, p.lot_qty::text, p.period_days, p.order_cost::text, p.holding_pct::text
          from items i left join item_planning p on p.item_id = i.id
          where i.is_active and i.deleted_at is null and i.is_stock_item and i.type not in ('service', 'asset') and not coalesce(p.excluded, false)`,
    );
    const bomRows = await many<{ parent: string; bq: string; item_id: string; kind: string; qty: string; scrap_pct: string; is_phantom: boolean; alternate_group: string | null; priority: number; bom_id: string }>(
      tx,
      sql`select b.item_id as parent, b.id as bom_id, b.quantity::text as bq, l.item_id, l.kind, l.qty::text, l.scrap_pct::text, l.is_phantom, l.alternate_group, l.priority
          from boms b join documents d on d.id = b.id join bom_lines l on l.bom_id = b.id
          where b.is_default and d.status = 'approved' and l.kind = 'component' and (b.effective_to is null or b.effective_to >= ${today}::date)`,
    );
    const formulaRows = await many<{ parent: string; batch_size: string; batch_multiple: string | null; yield_pct: string; item_id: string; basis: Basis; qty: string; std_potency: string | null }>(
      tx,
      sql`select f.item_id as parent, f.batch_size::text, f.batch_multiple::text, f.yield_pct::text, l.item_id, l.basis, l.qty::text, l.std_potency::text
          from formulas f join documents d on d.id = f.id join formula_lines l on l.formula_id = f.id
          where f.is_default and d.status = 'approved' and l.kind = 'ingredient' and (f.effective_to is null or f.effective_to >= ${today}::date)`,
    );

    // Structures: BOMs first; formulas for items without one.
    const structure = new Map<string, StructureLine[]>();
    const bomGroups = new Map<string, typeof bomRows>();
    for (const r of bomRows) bomGroups.set(r.parent, [...(bomGroups.get(r.parent) ?? []), r]);
    for (const [parent, rows] of bomGroups) {
      const lines: BomLineData[] = rows.map((r) => ({ kind: 'component', itemId: r.item_id, qty: r.qty, scrapPct: r.scrap_pct, isPhantom: r.is_phantom, alternateGroup: r.alternate_group, priority: r.priority, recoveryRate: null }));
      const bq = num(rows[0].bq) || 1;
      structure.set(parent, merge(activeLines(lines).map((l) => ({ itemId: l.itemId, qtyPer: (num(l.qty) / bq) * (1 + num(l.scrapPct) / 100) }))));
    }
    const formulaInfo = new Map<string, { multiple: number }>();
    const fGroups = new Map<string, typeof formulaRows>();
    for (const r of formulaRows) if (!structure.has(r.parent)) fGroups.set(r.parent, [...(fGroups.get(r.parent) ?? []), r]);
    for (const [parent, rows] of fGroups) {
      const y = (num(rows[0].yield_pct) || 100) / 100;
      // Per unit of output: the batch quantity is input, output = input × yield.
      structure.set(parent, merge(rows.map((r) => ({ itemId: r.item_id, qtyPer: Number(lineQty({ kind: 'ingredient', itemId: r.item_id, basis: r.basis, qty: r.qty, stdPotency: r.std_potency }, r.batch_size, '1').toFixed(6)) / y }))));
      formulaInfo.set(parent, { multiple: num(rows[0].batch_multiple) * y });
    }

    const planItems = new Map<string, PlanItem>();
    for (const r of itemRows) {
      const hasBom = bomGroups.has(r.id);
      const formula = formulaInfo.get(r.id);
      const want = r.source ?? 'auto';
      let source: Source = 'buy';
      if (want === 'make' || (want === 'auto' && (hasBom || formula))) source = !hasBom && formula ? 'batch' : 'make';
      planItems.set(r.id, {
        id: r.id,
        code: r.code,
        source,
        leadTimeDays: r.lt ?? 0,
        safetyStock: num(r.ss),
        minOrderQty: num(r.moq),
        lotSizing: (r.lot_sizing as LotSizing) ?? 'l4l',
        lotQty: num(r.lot_qty),
        periodDays: r.period_days ?? 0,
        multiple: source === 'batch' ? (formula?.multiple ?? 0) : 0,
        missingStructure: source !== 'buy' && !structure.has(r.id),
        eoq: r.lot_sizing === 'eoq' ? { orderCost: num(r.order_cost), unitCost: num(r.cost), holdingPct: r.holding_pct === null ? 20 : num(r.holding_pct) } : undefined,
      });
    }
    for (const id of structure.keys()) if (planItems.get(id)?.source === 'buy') structure.delete(id);

    const onHand = new Map<string, number>();
    for (const r of await many<{ item_id: string; qty: string }>(tx, sql`select sv.item_id, sum(sv.qty)::text as qty from stock_valuation sv join warehouses w on w.id = sv.warehouse_id where w.is_nettable group by 1`)) onHand.set(r.item_id, num(r.qty));

    const demands: Demand[] = [];
    const receipts: Receipt[] = [];
    const so = await many<{ item_id: string; qty: string; date: string; id: string; number: string | null }>(
      tx,
      sql`select l.item_id, ((l.qty - l.delivered_qty) * l.conversion_factor)::text as qty, coalesce(l.delivery_date, s.expected_date, d.doc_date)::text as date, d.id, d.number
          from sales_order_lines l join sales_orders s on s.id = l.order_id join documents d on d.id = s.id
          where d.status = 'approved' and s.closed_at is null and l.qty > l.delivered_qty`,
    );
    for (const r of so) demands.push({ itemId: r.item_id, date: r.date, qty: num(r.qty), ref: { kind: 'sales_order', id: r.id, number: r.number } });

    if (useForecast) {
      const first = currentPeriod();
      const last = horizonEnd.slice(0, 7);
      const fc = await many<{ item_id: string; period: string; qty: string }>(tx, sql`select item_id, period, qty::text from demand_forecasts where period >= ${first} and period <= ${last} and qty > 0`);
      // Forecast consumption: orders due in a month use up that month's forecast.
      const booked = new Map<string, number>();
      for (const d of demands) {
        const p = (d.date < today ? today : d.date).slice(0, 7);
        booked.set(`${d.itemId}|${p}`, (booked.get(`${d.itemId}|${p}`) ?? 0) + d.qty);
      }
      const periods = new Set(months(first, 25));
      for (const r of fc) {
        if (!periods.has(r.period)) continue;
        const left = num(r.qty) - (booked.get(`${r.item_id}|${r.period}`) ?? 0);
        if (left <= 0) continue;
        const start = `${r.period}-01`;
        demands.push({ itemId: r.item_id, date: start < today ? today : start, qty: left, ref: { kind: 'forecast', id: null, number: r.period } });
      }
    }

    const po = await many<{ item_id: string; qty: string; date: string; id: string; number: string | null }>(
      tx,
      sql`select l.item_id, ((l.qty - l.received_qty) * l.conversion_factor)::text as qty, coalesce(l.delivery_date, p.expected_date, d.doc_date)::text as date, d.id, d.number
          from purchase_order_lines l join purchase_orders p on p.id = l.po_id join documents d on d.id = p.id
          where d.status = 'approved' and p.closed_at is null and l.qty > l.received_qty`,
    );
    for (const r of po) receipts.push({ itemId: r.item_id, date: r.date, qty: num(r.qty), ref: { kind: 'purchase_order', id: r.id, number: r.number } });

    const pr = await many<{ item_id: string; qty: string; date: string; id: string; number: string | null }>(
      tx,
      sql`select l.item_id,
                 ((l.quantity - l.ordered_qty) * case when l.uom_id is null or l.uom_id = i.base_uom_id then 1 else coalesce(c.factor, 1) end)::text as qty,
                 coalesce(l.required_by, r.required_by, d.doc_date)::text as date, d.id, d.number
          from purchase_requisition_lines l join purchase_requisitions r on r.id = l.requisition_id join documents d on d.id = r.id join items i on i.id = l.item_id
          left join item_uom_conversions c on c.item_id = l.item_id and c.uom_id = l.uom_id
          where l.item_id is not null and d.status in ('draft', 'pending_approval', 'approved') and l.quantity > l.ordered_qty`,
    );
    for (const r of pr) receipts.push({ itemId: r.item_id, date: r.date, qty: num(r.qty), ref: { kind: 'requisition', id: r.id, number: r.number ?? 'Draft requisition' } });

    const wo = await many<{ id: string; number: string | null; item_id: string; kind: string; qty: string; produced: string; rejected: string; end_date: string; yield_pct: string | null }>(
      tx,
      sql`select w.id, d.number, w.item_id, w.kind, w.qty::text, w.produced_qty::text as produced, w.rejected_qty::text as rejected,
                 coalesce(w.planned_end, w.planned_start, d.doc_date)::text as end_date, f.yield_pct::text
          from work_orders w join documents d on d.id = w.id left join formulas f on f.id = w.formula_id
          where d.status not in ('cancelled', 'rejected') and w.stage not in ('completed', 'closed')`,
    );
    for (const r of wo) {
      if (r.kind === 'rework') continue;
      const expected = r.kind === 'batch' && r.yield_pct ? (num(r.qty) * num(r.yield_pct)) / 100 : num(r.qty);
      const left = expected - num(r.produced) - num(r.rejected);
      if (left > 0) receipts.push({ itemId: r.item_id, date: r.end_date, qty: left, ref: { kind: 'work_order', id: r.id, number: r.number ?? 'Draft work order' } });
    }
    const mats = await many<{ item_id: string; qty: string; date: string; id: string; number: string | null }>(
      tx,
      sql`select m.item_id, (m.required_qty - m.issued_qty)::text as qty, coalesce(w.planned_start, d.doc_date)::text as date, d.id, d.number
          from work_order_materials m join work_orders w on w.id = m.work_order_id join documents d on d.id = w.id
          where m.kind = 'component' and m.required_qty > m.issued_qty and d.status not in ('cancelled', 'rejected') and w.stage not in ('completed', 'closed')`,
    );
    for (const r of mats) demands.push({ itemId: r.item_id, date: r.date, qty: num(r.qty), ref: { kind: 'work_order', id: r.id, number: r.number ?? 'Draft work order' } });

    // Firmed planned orders are supply, and their components are demand.
    const firmed = await tx.select().from(plannedOrders).where(eq(plannedOrders.status, 'firmed'));
    for (const f of firmed) {
      const code = planItems.get(f.itemId)?.code ?? null;
      receipts.push({ itemId: f.itemId, date: f.dueDate, qty: num(f.qty), ref: { kind: 'firmed', id: f.id, number: code } });
      if (f.source !== 'buy') for (const c of structure.get(f.itemId) ?? []) demands.push({ itemId: c.itemId, date: f.releaseDate, qty: num(f.qty) * c.qtyPer, ref: { kind: 'planned_order', id: f.id, number: code } });
    }
    return { items: planItems, structure, onHand, demands, receipts };
  }

  // ---- reading ---------------------------------------------------------------------------

  runs(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(mrpRuns).orderBy(desc(mrpRuns.startedAt)).limit(10));
  }

  private async latestRun(tx: Transaction) {
    const [r] = await tx.select().from(mrpRuns).where(eq(mrpRuns.status, 'done')).orderBy(desc(mrpRuns.startedAt)).limit(1);
    return r ?? null;
  }

  plannedList(auth: AuthContext, q: { status?: string; source?: string; itemId?: string; q?: string; limit: number; offset: number }) {
    return this.database.run(auth, async (tx) => {
      const statuses = q.status ? q.status.split(',') : ['planned', 'firmed'];
      const term = q.q ? `%${q.q}%` : null;
      const rows = await many<{ id: string; item_id: string; code: string; name: string; uom: string; source: string; qty: string; due_date: string; release_date: string; level: number; status: string; pegs: unknown; converted_doc_id: string | null; converted_number: string | null; converted_type: string | null; total: number }>(
        tx,
        sql`select p.id, p.item_id, i.code, i.name, u.code as uom, p.source, p.qty::text, p.due_date::text, p.release_date::text, p.level, p.status, p.pegs,
                   p.converted_doc_id, cd.number as converted_number, cd.doc_type as converted_type, count(*) over ()::int as total
            from planned_orders p join items i on i.id = p.item_id join uoms u on u.id = i.base_uom_id left join documents cd on cd.id = p.converted_doc_id
            where p.status in ${statuses}
              ${q.source ? sql`and p.source = ${q.source}` : sql``}
              ${q.itemId ? sql`and p.item_id = ${q.itemId}` : sql``}
              ${term ? sql`and (i.code ilike ${term} or i.name ilike ${term})` : sql``}
            order by p.release_date, i.code
            limit ${sql`${q.limit}::int`} offset ${sql`${q.offset}::int`}`,
      );
      return {
        total: rows[0]?.total ?? 0,
        items: rows.map((r) => ({
          id: r.id,
          item: { id: r.item_id, code: r.code, name: r.name, uom: r.uom },
          source: r.source,
          qty: r.qty,
          dueDate: r.due_date,
          releaseDate: r.release_date,
          level: r.level,
          status: r.status,
          pegs: r.pegs,
          converted: r.converted_doc_id ? { id: r.converted_doc_id, number: r.converted_number, docType: r.converted_type } : null,
        })),
      };
    });
  }

  exceptions(auth: AuthContext, q: { kind?: string; itemId?: string; limit: number; offset: number }) {
    return this.database.run(auth, async (tx) => {
      const run = await this.latestRun(tx);
      if (!run) return { run: null, counts: {}, total: 0, items: [] };
      const counts = await many<{ kind: string; n: number }>(tx, sql`select kind, count(*)::int as n from mrp_exceptions where run_id = ${run.id} group by 1`);
      const rows = await many<{ id: string; item_id: string; code: string; name: string; kind: string; date: string | null; to_date: string | null; qty: string | null; ref_kind: string | null; ref_id: string | null; ref_number: string | null; message: string; total: number }>(
        tx,
        sql`select e.id, e.item_id, i.code, i.name, e.kind, e.date::text, e.to_date::text, e.qty::text, e.ref_kind, e.ref_id, e.ref_number, e.message, count(*) over ()::int as total
            from mrp_exceptions e join items i on i.id = e.item_id
            where e.run_id = ${run.id} ${q.kind ? sql`and e.kind = ${q.kind}` : sql``} ${q.itemId ? sql`and e.item_id = ${q.itemId}` : sql``}
            order by case e.kind when 'expedite' then 0 when 'past_due' then 1 when 'late_demand' then 2 when 'reschedule_in' then 3 when 'below_safety' then 4 when 'no_structure' then 5 when 'bom_loop' then 6 else 7 end, e.date nulls last, i.code
            limit ${sql`${q.limit}::int`} offset ${sql`${q.offset}::int`}`,
      );
      return {
        run: { id: run.id, startedAt: run.startedAt },
        counts: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
        total: rows[0]?.total ?? 0,
        items: rows.map((r) => ({ id: r.id, item: { id: r.item_id, code: r.code, name: r.name }, kind: r.kind, date: r.date, toDate: r.to_date, qty: r.qty, ref: r.ref_kind ? { kind: r.ref_kind, id: r.ref_id, number: r.ref_number } : null, message: r.message })),
      };
    });
  }

  /** The MRP record of one item in the latest run, with its planning parameters. */
  itemPlan(auth: AuthContext, itemId: string) {
    return this.database.run(auth, async (tx) => {
      const [item] = await tx
        .select({ id: items.id, code: items.code, name: items.name, leadTimeDays: items.leadTimeDays, safetyStock: items.safetyStock, minOrderQty: items.minOrderQty })
        .from(items)
        .where(eq(items.id, itemId));
      if (!item) throw new NotFoundException('Item not found');
      const [params] = await tx.select().from(itemPlanning).where(eq(itemPlanning.itemId, itemId));
      const run = await this.latestRun(tx);
      const [plan] = run ? await tx.select().from(mrpItemPlans).where(and(eq(mrpItemPlans.runId, run.id), eq(mrpItemPlans.itemId, itemId))) : [];
      return {
        item,
        parameters: params ?? { source: 'auto', lotSizing: 'l4l', lotQty: null, periodDays: null, orderCost: null, holdingPct: null, excluded: false },
        run: run ? { id: run.id, startedAt: run.startedAt, horizonDays: run.horizonDays } : null,
        plan: plan ?? null,
      };
    });
  }

  setParameters(auth: AuthContext, itemId: string, input: ParametersInput) {
    return this.database.run(auth, async (tx) => {
      const [item] = await tx.select({ id: items.id }).from(items).where(eq(items.id, itemId));
      if (!item) throw new NotFoundException('Item not found');
      if ((input.lotSizing === 'fixed' || input.lotSizing === 'min_max') && !(Number(input.lotQty) > 0)) throw new BadRequestException(input.lotSizing === 'fixed' ? 'Enter the fixed lot quantity' : 'Enter the maximum stock level');
      if (input.lotSizing === 'period' && !input.periodDays) throw new BadRequestException('Enter the number of days each order covers');
      if (input.lotSizing === 'eoq' && !(Number(input.orderCost) > 0)) throw new BadRequestException('Enter the cost of placing an order');
      const values = { source: input.source, lotSizing: input.lotSizing, lotQty: input.lotQty ?? null, periodDays: input.periodDays ?? null, orderCost: input.orderCost ?? null, holdingPct: input.holdingPct ?? null, excluded: input.excluded, updatedAt: new Date() };
      await tx
        .insert(itemPlanning)
        .values({ tenantId: auth.tenantId, itemId, ...values })
        .onConflictDoUpdate({ target: itemPlanning.itemId, set: values });
      const patch: Partial<typeof items.$inferInsert> = {};
      if (input.leadTimeDays !== undefined) patch.leadTimeDays = input.leadTimeDays;
      if (input.safetyStock !== undefined) patch.safetyStock = input.safetyStock;
      if (input.minOrderQty !== undefined) patch.minOrderQty = input.minOrderQty;
      if (Object.keys(patch).length) await tx.update(items).set({ ...patch, updatedBy: auth.userId }).where(eq(items.id, itemId));
      return { ok: true };
    });
  }

  // ---- acting on planned orders --------------------------------------------------------

  firm(auth: AuthContext, ids: string[], firm: boolean) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .update(plannedOrders)
        .set({ status: firm ? 'firmed' : 'planned' })
        .where(and(inArray(plannedOrders.id, ids), inArray(plannedOrders.status, firm ? ['planned'] : ['firmed'])))
        .returning({ id: plannedOrders.id });
      return { updated: rows.length };
    });
  }

  /** A planner's change of quantity or date firms the order, so the next run keeps it. */
  edit(auth: AuthContext, id: string, input: z.infer<typeof editPlannedSchema>) {
    return this.database.run(auth, async (tx) => {
      const [p] = await tx.select().from(plannedOrders).where(eq(plannedOrders.id, id));
      if (!p) throw new NotFoundException('Planned order not found');
      if (p.status === 'converted') throw new BadRequestException('The planned order has already been converted');
      const [it] = await tx.select({ lt: items.leadTimeDays }).from(items).where(eq(items.id, p.itemId));
      const release = input.releaseDate ?? addDays(input.dueDate, -(it?.lt ?? 0));
      if (release > input.dueDate) throw new BadRequestException('The release date is after the due date');
      const [r] = await tx.update(plannedOrders).set({ qty: input.qty, dueDate: input.dueDate, releaseDate: release, status: 'firmed' }).where(eq(plannedOrders.id, id)).returning();
      return r;
    });
  }

  /**
   * Buy orders become one draft purchase requisition; make orders become draft work orders,
   * batch orders draft process batches (input quantity = output ÷ yield, in batch multiples).
   */
  async convert(auth: AuthContext, input: z.infer<typeof convertSchema>, meta: RequestMeta) {
    const prep = await this.database.run(auth, async (tx) => {
      const rows = await many<{ id: string; item_id: string; code: string; name: string; uom_id: string; uom: string; source: string; qty: string; due_date: string; release_date: string; pegs: { kind: string; number?: string | null }[]; batch_size: string | null; batch_multiple: string | null; yield_pct: string | null }>(
        tx,
        sql`select p.id, p.item_id, i.code, i.name, i.base_uom_id as uom_id, u.code as uom, p.source, p.qty::text, p.due_date::text, p.release_date::text, p.pegs,
                   f.batch_size::text, f.batch_multiple::text, f.yield_pct::text
            from planned_orders p join items i on i.id = p.item_id join uoms u on u.id = i.base_uom_id
            left join lateral (select f.* from formulas f join documents d on d.id = f.id where f.item_id = p.item_id and f.is_default and d.status = 'approved' limit 1) f on true
            where p.id in ${input.ids} and p.status in ('planned', 'firmed')`,
      );
      let wh = input.warehouseId ?? null;
      if (!wh) {
        const [w] = await many<{ id: string }>(tx, sql`select id from warehouses where type = 'store' and is_active order by code limit 1`);
        wh = w?.id ?? null;
      }
      return { rows, wh };
    });
    if (!prep.rows.length) throw new BadRequestException('None of these planned orders can be converted (already converted or replaced by a newer run)');
    // Converting raises documents, so it needs the right to raise them too.
    const perms = auth.permissions;
    if (perms && prep.rows.some((r) => r.source === 'buy') && !perms.has('purchase.requisitions.manage')) throw new ForbiddenException('Missing permission: purchase.requisitions.manage');
    if (perms && prep.rows.some((r) => r.source !== 'buy') && !perms.has('manufacturing.production.manage')) throw new ForbiddenException('Missing permission: manufacturing.production.manage');
    const errors: { id: string; code: string; message: string }[] = [];
    const done: { id: string; docId: string }[] = [];
    const pegText = (pegs: { kind: string; number?: string | null }[]) => {
      const refs = [...new Set(pegs.map((g) => (g.kind === 'sales_order' ? g.number : g.kind === 'forecast' ? `forecast ${g.number}` : g.kind === 'planned_order' ? `for ${g.number}` : g.kind === 'work_order' ? g.number : g.kind.replace('_', ' '))).filter(Boolean))];
      return `MRP: ${refs.join(', ')}`.slice(0, 300);
    };

    let requisition: { id: string; number: string } | null = null;
    const buys = prep.rows.filter((r) => r.source === 'buy');
    if (buys.length) {
      try {
        const pr = await this.requisitions.create(
          auth,
          {
            priority: 'normal',
            department: null,
            purpose: `MRP planned orders (${buys.length} item${buys.length === 1 ? '' : 's'})`,
            notes: null,
            requiredBy: buys.map((b) => b.due_date).sort()[0],
            lines: buys.map((b) => ({ itemId: b.item_id, uomId: b.uom_id, itemCode: b.code, description: b.name, uom: b.uom, quantity: b.qty, estimatedRate: null, requiredBy: b.due_date, remarks: pegText(b.pegs) })),
          },
          meta,
        );
        requisition = { id: pr.id, number: pr.displayNumber };
        for (const b of buys) done.push({ id: b.id, docId: pr.id });
      } catch (e) {
        for (const b of buys) errors.push({ id: b.id, code: b.code, message: (e as Error).message });
      }
    }
    const workOrders: { id: string; number: string; item: string; qty: string }[] = [];
    for (const r of prep.rows.filter((x) => x.source !== 'buy')) {
      if (!prep.wh) {
        errors.push({ id: r.id, code: r.code, message: 'No store to make into: create a warehouse first' });
        continue;
      }
      let qty = Number(r.qty);
      if (r.source === 'batch') {
        qty = (qty * 100) / (Number(r.yield_pct) || 100);
        const m = Number(r.batch_multiple);
        if (m > 0) qty = Math.ceil(qty / m - 1e-9) * m;
      }
      try {
        const w = await this.workOrders.create(
          auth,
          { kind: r.source === 'batch' ? 'batch' : 'mts', itemId: r.item_id, bomId: null, formulaId: null, batchNo: null, qty: q4(qty), salesOrderLineId: null, parentWorkOrderId: null, sourceWarehouseId: prep.wh, targetWarehouseId: prep.wh, plannedStart: r.release_date, plannedEnd: r.due_date, priority: 3, backflush: false, notes: pegText(r.pegs) },
          meta,
        );
        workOrders.push({ id: w.id, number: w.displayNumber, item: r.code, qty: q4(qty) });
        done.push({ id: r.id, docId: w.id });
      } catch (e) {
        errors.push({ id: r.id, code: r.code, message: (e as Error).message });
      }
    }
    if (done.length)
      await this.database.run(auth, async (tx) => {
        for (const d of done) await tx.update(plannedOrders).set({ status: 'converted', convertedDocId: d.docId, convertedAt: new Date() }).where(eq(plannedOrders.id, d.id));
      });
    return { requisition, workOrders, errors, converted: done.length };
  }
}

function merge(lines: StructureLine[]) {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qtyPer);
  return [...m].map(([itemId, qtyPer]) => ({ itemId, qtyPer }));
}

