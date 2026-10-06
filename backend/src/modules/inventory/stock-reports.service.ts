import { Injectable, NotFoundException } from '@nestjs/common';
import { batches, itemGroups, items, stockBalances, stockLedger, stockValuation, uoms, warehouses } from '@nextgen/database';
import { and, asc, desc, eq, gte, ilike, lt, lte, or, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { DatabaseService } from '../../database/database.service';
import type { LedgerQuery, StockLevelsQuery } from './inventory.schemas';
import { NO_BATCH } from './stock.service';

@Injectable()
export class StockReportsService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Stock position per item. "available" counts only nettable warehouses
   * (quarantine / rejected / transit stock is on hand but not usable).
   */
  levels(auth: AuthContext, q: StockLevelsQuery) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const whFilter = q.warehouseId ? sql`and sv.warehouse_id = ${q.warehouseId}` : sql``;
      const agg = sql`(
        select sv.item_id,
               sum(sv.qty) as qty,
               sum(sv.value) as value,
               sum(case when w.is_nettable then sv.qty else 0 end) as available
          from stock_valuation sv join warehouses w on w.id = sv.warehouse_id
         where true ${whFilter}
         group by sv.item_id
      )`;
      const rows = await tx
        .select({
          itemId: items.id,
          code: items.code,
          name: items.name,
          type: items.type,
          group: itemGroups.name,
          uom: uoms.code,
          uomDecimals: uoms.decimals,
          qty: sql<string>`coalesce(s.qty, 0)::numeric(18,4)::text`,
          available: sql<string>`coalesce(s.available, 0)::numeric(18,4)::text`,
          value: sql<string>`coalesce(s.value, 0)::numeric(18,2)::text`,
          valuationRate: sql<string | null>`case when coalesce(s.qty, 0) > 0 then (s.value / s.qty)::numeric(18,6)::text end`,
          reorderLevel: items.reorderLevel,
          reorderQty: items.reorderQty,
          safetyStock: items.safetyStock,
          belowReorder: sql<boolean>`(${items.reorderLevel} is not null and coalesce(s.available, 0) <= ${items.reorderLevel})`,
        })
        .from(items)
        .innerJoin(uoms, eq(uoms.id, items.baseUomId))
        .leftJoin(itemGroups, eq(itemGroups.id, items.groupId))
        .leftJoin(sql`${agg} s`, sql`s.item_id = ${items.id}`)
        .where(
          and(
            eq(items.isStockItem, true),
            eq(items.isActive, true),
            q.groupId ? eq(items.groupId, q.groupId) : undefined,
            term ? or(ilike(items.code, `%${term}%`), ilike(items.name, `%${term}%`)) : undefined,
            q.includeZero === 'true' || q.belowReorder === 'true' ? undefined : sql`coalesce(s.qty, 0) <> 0`,
            q.belowReorder === 'true' ? sql`${items.reorderLevel} is not null and coalesce(s.available, 0) <= ${items.reorderLevel}` : undefined,
          ),
        )
        .orderBy(asc(items.code))
        .limit(q.limit)
        .offset(q.offset);
      const [totals] = await tx.execute<{ value: string; items: string }>(
        sql`select coalesce(sum(sv.value), 0)::numeric(18,2)::text as value, count(distinct sv.item_id) filter (where sv.qty <> 0)::text as items
              from stock_valuation sv where true ${whFilter}`,
      ).then((r) => r.rows);
      return {
        items: rows.map((r) => ({
          ...r,
          // Suggested order: bring available up to reorder level + reorder qty.
          suggestedOrderQty: r.belowReorder && r.reorderQty ? r.reorderQty : null,
        })),
        totals: { value: totals?.value ?? '0.00', items: Number(totals?.items ?? 0) },
      };
    });
  }

  /** One item: position by warehouse and by batch. */
  item(auth: AuthContext, itemId: string) {
    return this.database.run(auth, async (tx) => {
      const [item] = await tx
        .select({ id: items.id, code: items.code, name: items.name, uom: uoms.code, trackBatch: items.trackBatch, trackSerial: items.trackSerial, valuationMethod: items.valuationMethod, reorderLevel: items.reorderLevel })
        .from(items)
        .innerJoin(uoms, eq(uoms.id, items.baseUomId))
        .where(eq(items.id, itemId));
      if (!item) throw new NotFoundException('Item not found');
      const byWarehouse = await tx
        .select({
          warehouseId: warehouses.id,
          code: warehouses.code,
          name: warehouses.name,
          type: warehouses.type,
          isNettable: warehouses.isNettable,
          qty: stockValuation.qty,
          value: stockValuation.value,
          valuationRate: sql<string | null>`case when ${stockValuation.qty} > 0 then (${stockValuation.value} / ${stockValuation.qty})::numeric(18,6)::text end`,
        })
        .from(stockValuation)
        .innerJoin(warehouses, eq(warehouses.id, stockValuation.warehouseId))
        .where(and(eq(stockValuation.itemId, itemId), sql`${stockValuation.qty} <> 0`))
        .orderBy(asc(warehouses.code));
      const byBatch = item.trackBatch
        ? await tx
            .select({
              batchId: batches.id,
              batchNo: batches.batchNo,
              mfgDate: batches.mfgDate,
              expiryDate: batches.expiryDate,
              warehouseId: stockBalances.warehouseId,
              warehouseCode: warehouses.code,
              qty: stockBalances.qty,
            })
            .from(stockBalances)
            .innerJoin(batches, eq(batches.id, stockBalances.batchKey))
            .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
            .where(and(eq(stockBalances.itemId, itemId), sql`${stockBalances.qty} <> 0`))
            .orderBy(sql`${batches.expiryDate} nulls last`, asc(batches.batchNo))
        : [];
      return { item, byWarehouse, byBatch };
    });
  }

  /** Movements with running position (balance after each row, per item + warehouse). */
  ledger(auth: AuthContext, q: LedgerQuery) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          id: stockLedger.id,
          postingDate: stockLedger.postingDate,
          itemId: stockLedger.itemId,
          itemCode: items.code,
          itemName: items.name,
          uom: uoms.code,
          warehouseId: stockLedger.warehouseId,
          warehouseCode: warehouses.code,
          batchNo: batches.batchNo,
          serialNos: stockLedger.serialNos,
          qty: stockLedger.qty,
          rate: stockLedger.rate,
          value: stockLedger.value,
          balanceQty: stockLedger.balanceQty,
          balanceValue: stockLedger.balanceValue,
          valuationRate: stockLedger.valuationRate,
          voucherType: stockLedger.voucherType,
          voucherId: stockLedger.voucherId,
          voucherNumber: stockLedger.voucherNumber,
          isReversal: stockLedger.isReversal,
          createdAt: stockLedger.createdAt,
        })
        .from(stockLedger)
        .innerJoin(items, eq(items.id, stockLedger.itemId))
        .innerJoin(uoms, eq(uoms.id, items.baseUomId))
        .innerJoin(warehouses, eq(warehouses.id, stockLedger.warehouseId))
        .leftJoin(batches, eq(batches.id, stockLedger.batchId))
        .where(
          and(
            q.itemId ? eq(stockLedger.itemId, q.itemId) : undefined,
            q.warehouseId ? eq(stockLedger.warehouseId, q.warehouseId) : undefined,
            q.voucherId ? eq(stockLedger.voucherId, q.voucherId) : undefined,
            q.from ? gte(stockLedger.postingDate, q.from) : undefined,
            q.to ? lte(stockLedger.postingDate, q.to) : undefined,
            q.cursor ? lt(stockLedger.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(stockLedger.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
    });
  }

  /** Batches with stock, earliest expiry first (FEFO). */
  batches(auth: AuthContext, itemId: string, warehouseId?: string) {
    return this.database.run(auth, (tx) =>
      tx
        .select({
          batchId: batches.id,
          batchNo: batches.batchNo,
          mfgDate: batches.mfgDate,
          expiryDate: batches.expiryDate,
          warehouseId: stockBalances.warehouseId,
          warehouseCode: warehouses.code,
          qty: stockBalances.qty,
          expired: sql<boolean>`coalesce(${batches.expiryDate} < ${todayIST()}::date, false)`,
        })
        .from(stockBalances)
        .innerJoin(batches, eq(batches.id, stockBalances.batchKey))
        .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
        .where(
          and(
            eq(stockBalances.itemId, itemId),
            warehouseId ? eq(stockBalances.warehouseId, warehouseId) : undefined,
            sql`${stockBalances.batchKey} <> ${NO_BATCH}::uuid`,
            sql`${stockBalances.qty} > 0`,
          ),
        )
        .orderBy(sql`${batches.expiryDate} nulls last`, asc(batches.createdAt)),
    );
  }

  /** Batches in stock that expire within `days` (or already have). */
  expiring(auth: AuthContext, days: number, warehouseId?: string) {
    return this.database.run(auth, (tx) => {
      const today = todayIST();
      return tx
        .select({
          itemId: items.id,
          itemCode: items.code,
          itemName: items.name,
          uom: uoms.code,
          batchNo: batches.batchNo,
          expiryDate: batches.expiryDate,
          daysLeft: sql<number>`(${batches.expiryDate} - ${today}::date)`,
          warehouseId: warehouses.id,
          warehouseCode: warehouses.code,
          qty: stockBalances.qty,
        })
        .from(stockBalances)
        .innerJoin(batches, eq(batches.id, stockBalances.batchKey))
        .innerJoin(items, eq(items.id, stockBalances.itemId))
        .innerJoin(uoms, eq(uoms.id, items.baseUomId))
        .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
        .where(
          and(
            sql`${stockBalances.qty} > 0`,
            sql`${batches.expiryDate} <= ${today}::date + ${days}::int`,
            warehouseId ? eq(stockBalances.warehouseId, warehouseId) : undefined,
          ),
        )
        .orderBy(asc(batches.expiryDate), asc(items.code));
    });
  }

  /** Stock value by warehouse and by item group. */
  valuation(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const byWarehouse = await tx
        .select({
          warehouseId: warehouses.id,
          code: warehouses.code,
          name: warehouses.name,
          type: warehouses.type,
          items: sql<number>`count(*) filter (where ${stockValuation.qty} <> 0)::int`,
          value: sql<string>`coalesce(sum(${stockValuation.value}), 0)::numeric(18,2)::text`,
        })
        .from(stockValuation)
        .innerJoin(warehouses, eq(warehouses.id, stockValuation.warehouseId))
        .groupBy(warehouses.id)
        .orderBy(asc(warehouses.code));
      const byGroup = await tx
        .select({
          groupId: itemGroups.id,
          name: sql<string>`coalesce(${itemGroups.name}, 'Ungrouped')`,
          items: sql<number>`count(distinct ${stockValuation.itemId}) filter (where ${stockValuation.qty} <> 0)::int`,
          value: sql<string>`coalesce(sum(${stockValuation.value}), 0)::numeric(18,2)::text`,
        })
        .from(stockValuation)
        .innerJoin(items, eq(items.id, stockValuation.itemId))
        .leftJoin(itemGroups, eq(itemGroups.id, items.groupId))
        .groupBy(itemGroups.id, itemGroups.name)
        .orderBy(sql`sum(${stockValuation.value}) desc nulls last`);
      return { byWarehouse, byGroup };
    });
  }
}
