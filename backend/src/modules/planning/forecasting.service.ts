import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { demandForecasts, items, type Transaction } from '@nextgen/database';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { DatabaseService } from '../../database/database.service';
import { forecastSeries, months } from './forecast';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;

export const generateSchema = z.object({
  /** Months to forecast, from the current month. */
  horizon: z.number().int().min(1).max(24).default(6),
  /** Months of history to learn from (up to the last complete month). */
  historyMonths: z.number().int().min(6).max(60).default(36),
  itemId: z.uuid().nullable().optional(),
});
export type GenerateInput = z.infer<typeof generateSchema>;

export const overrideSchema = z.object({
  itemId: z.uuid(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be YYYY-MM'),
  /** null resets the month to the statistical forecast. */
  qty: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), 'Quantity must be zero or more (up to 4 decimals)')
    .nullable(),
});
export type OverrideInput = z.infer<typeof overrideSchema>;

/** Current month (IST) as YYYY-MM. */
export const currentPeriod = () => todayIST().slice(0, 7);

/**
 * Demand history is what customers ordered: approved sales order lines (base units) by the
 * month of the order. Forecasts are kept per item and month; a planner's override survives
 * re-forecasting (the statistical figure is still refreshed next to it).
 */
@Injectable()
export class ForecastingService {
  constructor(private readonly database: DatabaseService) {}

  generate(auth: AuthContext, input: GenerateInput) {
    return this.database.run(auth, async (tx) => {
      const now = currentPeriod();
      const start = shift(now, -input.historyMonths);
      const hist = months(start, input.historyMonths);
      const future = months(now, input.horizon);
      const rows = await many<{ item_id: string; period: string; qty: string }>(
        tx,
        sql`select l.item_id, to_char(d.doc_date, 'YYYY-MM') as period, sum(l.base_qty)::text as qty
            from sales_order_lines l join documents d on d.id = l.order_id
            where d.status in ('approved', 'completed') and d.doc_date >= ${`${start}-01`}::date and d.doc_date < ${`${now}-01`}::date
              ${input.itemId ? sql`and l.item_id = ${input.itemId}` : sql``}
            group by 1, 2`,
      );
      const byItem = new Map<string, Map<string, number>>();
      for (const r of rows) {
        const m = byItem.get(r.item_id) ?? new Map<string, number>();
        m.set(r.period, Number(r.qty));
        byItem.set(r.item_id, m);
      }
      const methods: Record<string, number> = {};
      let written = 0;
      const values: (typeof demandForecasts.$inferInsert)[] = [];
      for (const [itemId, m] of byItem) {
        let series = hist.map((p) => m.get(p) ?? 0);
        // A product launched within the window: learn from its first month on.
        const firstSale = series.findIndex((v) => v > 0);
        if (firstSale > 0) series = series.slice(firstSale);
        const f = forecastSeries(series, input.horizon);
        methods[f.method] = (methods[f.method] ?? 0) + 1;
        future.forEach((period, i) => {
          values.push({ tenantId: auth.tenantId, itemId, period, qty: f.forecast[i].toFixed(4), statQty: f.forecast[i].toFixed(4), method: f.method, mae: f.mae.toFixed(4), mapePct: f.mape === null ? null : f.mape.toFixed(1), isOverride: false, updatedBy: auth.userId });
        });
      }
      for (let i = 0; i < values.length; i += 1000) {
        const chunk = values.slice(i, i + 1000);
        await tx
          .insert(demandForecasts)
          .values(chunk)
          .onConflictDoUpdate({
            target: [demandForecasts.tenantId, demandForecasts.itemId, demandForecasts.period],
            set: {
              qty: sql`case when ${demandForecasts.isOverride} then ${demandForecasts.qty} else excluded.qty end`,
              statQty: sql`excluded.stat_qty`,
              method: sql`excluded.method`,
              mae: sql`excluded.mae`,
              mapePct: sql`excluded.mape_pct`,
              updatedBy: sql`excluded.updated_by`,
              updatedAt: sql`now()`,
            },
          });
        written += chunk.length;
      }
      return { items: byItem.size, months: future, rows: written, methods };
    });
  }

  /** Items with a forecast from the current month on, with the last 12 months of history. */
  list(auth: AuthContext, q: { q?: string; limit: number; offset: number }) {
    return this.database.run(auth, async (tx) => {
      const now = currentPeriod();
      const term = q.q ? `%${q.q}%` : null;
      const its = await many<{ id: string; code: string; name: string; uom: string; total: number }>(
        tx,
        sql`select i.id, i.code, i.name, u.code as uom, count(*) over ()::int as total
            from items i join uoms u on u.id = i.base_uom_id
            where exists (select 1 from demand_forecasts f where f.item_id = i.id and f.period >= ${now})
              ${term ? sql`and (i.code ilike ${term} or i.name ilike ${term})` : sql``}
            order by i.code limit ${sql`${q.limit}::int`} offset ${sql`${q.offset}::int`}`,
      );
      if (!its.length) return { months: [], history: [], items: [], total: 0 };
      const ids = its.map((i) => i.id);
      const histMonths = months(shift(now, -12), 12);
      const fc = await tx.execute<{ item_id: string; period: string; qty: string; stat_qty: string | null; method: string | null; mae: string | null; mape_pct: string | null; is_override: boolean }>(
        sql`select item_id, period, qty::text, stat_qty::text, method, mae::text, mape_pct::text, is_override from demand_forecasts where period >= ${now} and item_id in ${ids} order by period`,
      );
      const hist = await many<{ item_id: string; period: string; qty: string }>(
        tx,
        sql`select l.item_id, to_char(d.doc_date, 'YYYY-MM') as period, sum(l.base_qty)::text as qty
            from sales_order_lines l join documents d on d.id = l.order_id
            where d.status in ('approved', 'completed') and d.doc_date >= ${`${histMonths[0]}-01`}::date and d.doc_date < ${`${now}-01`}::date and l.item_id in ${ids}
            group by 1, 2`,
      );
      const futureMonths = [...new Set(fc.rows.map((r) => r.period))].sort();
      return {
        months: futureMonths,
        history: histMonths,
        total: its[0].total,
        items: its.map((i) => {
          const rows = fc.rows.filter((r) => r.item_id === i.id);
          return {
            item: { id: i.id, code: i.code, name: i.name, uom: i.uom },
            method: rows[0]?.method ?? null,
            mae: rows[0]?.mae ?? null,
            mapePct: rows[0]?.mape_pct ?? null,
            history: histMonths.map((p) => hist.find((h) => h.item_id === i.id && h.period === p)?.qty ?? '0'),
            forecast: futureMonths.map((p) => {
              const r = rows.find((x) => x.period === p);
              return r ? { qty: r.qty, statQty: r.stat_qty, override: r.is_override } : null;
            }),
          };
        }),
      };
    });
  }

  override(auth: AuthContext, input: OverrideInput) {
    return this.database.run(auth, async (tx) => {
      const [item] = await tx.select({ id: items.id }).from(items).where(eq(items.id, input.itemId));
      if (!item) throw new NotFoundException('Item not found');
      if (input.period < currentPeriod()) throw new BadRequestException('Past months cannot be changed');
      const where = and(eq(demandForecasts.itemId, input.itemId), eq(demandForecasts.period, input.period));
      const [cur] = await tx.select().from(demandForecasts).where(where);
      if (input.qty === null) {
        if (!cur) return null;
        if (cur.statQty === null) {
          await tx.delete(demandForecasts).where(where);
          return null;
        }
        const [r] = await tx.update(demandForecasts).set({ qty: cur.statQty, isOverride: false, updatedBy: auth.userId, updatedAt: new Date() }).where(where).returning();
        return r;
      }
      if (cur) {
        const [r] = await tx.update(demandForecasts).set({ qty: input.qty, isOverride: true, updatedBy: auth.userId, updatedAt: new Date() }).where(where).returning();
        return r;
      }
      const [r] = await tx.insert(demandForecasts).values({ tenantId: auth.tenantId, itemId: input.itemId, period: input.period, qty: input.qty, isOverride: true, updatedBy: auth.userId }).returning();
      return r;
    });
  }
}

/** YYYY-MM shifted by n months. */
export function shift(period: string, n: number) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
