import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  batches,
  wmsBinCountLines,
  wmsBinCounts,
  wmsBins,
  wmsConsignments,
  wmsDips,
  wmsItemProfiles,
  wmsReelEvents,
  wmsReels,
  wmsReturnableMoves,
  wmsReturnableTypes,
  wmsSettings,
  wmsTanks,
  wmsTasks,
  type Transaction,
} from '@nextgen/database';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { NIL_BATCH, wmsConfigs } from '../inventory/bins';
import { StockEntriesService } from '../inventory/stock-entries.service';
import { abcClasses, floorLife, MSL_HOURS, replenishQty, tankLitres } from './control';
import { allocate } from './outbound';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const n4 = (v: number) => v.toFixed(4);
const MSL_LEVELS = Object.keys(MSL_HOURS) as [string, ...string[]];

export const cycleSchema = z.object({ warehouseId: z.uuid(), maxBins: z.number().int().min(1).max(500).default(50), blind: z.boolean().default(true) });
export const adhocCountSchema = z.object({ warehouseId: z.uuid(), binIds: z.array(z.uuid()).min(1).max(500), blind: z.boolean().default(true) });
export const countLineSchema = z.object({ countedQty: z.number().min(0).max(1e10) });
export const foundSchema = z.object({ binId: z.uuid(), itemId: z.uuid(), batchNo: text(40), countedQty: z.number().min(0).max(1e10) });
export const pickFaceSchema = z.object({ replenMin: z.number().min(0).max(1e10).nullable(), replenMax: z.number().positive().max(1e10).nullable() });
export const countSettingsSchema = z.object({ countDaysA: z.number().int().min(1).max(366), countDaysB: z.number().int().min(1).max(366), countDaysC: z.number().int().min(1).max(730) });
export const tankSchema = z.object({
  binId: z.uuid(),
  itemId: z.uuid(),
  capacityLitres: z.number().positive().max(1e9),
  stockUnit: z.enum(['litre', 'kg']).default('litre'),
  densityKgPerL: z.number().positive().max(30).nullable().optional(),
  calibration: z.array(z.object({ mm: z.number().min(0).max(100_000), litres: z.number().min(0).max(1e9) })).min(2).max(2000),
  tolerancePct: z.number().min(0).max(10).default(0.5),
});
export const dipSchema = z.object({ dipMm: z.number().min(0).max(100_000), temperatureC: z.number().min(-50).max(200).nullable().optional(), adjust: z.boolean().default(false) });
export const returnableTypeSchema = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(2).max(80), depositAmount: z.number().min(0).max(1e7).nullable().optional(), isActive: z.boolean().default(true) });
export const returnableMoveSchema = z.object({ typeId: z.uuid(), partyId: z.uuid(), direction: z.enum(['out', 'back']), qty: z.number().int().positive().max(1_000_000), date: z.iso.date().optional(), reference: text(80), documentId: z.uuid().nullable().optional(), notes: text(300) });
export const reelSchema = z.object({ code: z.string().trim().min(3).max(40), itemId: z.uuid(), batchNo: text(40), warehouseId: z.uuid().nullable().optional(), binId: z.uuid().nullable().optional(), qty: z.number().positive().max(1e9), mslLevel: z.enum(MSL_LEVELS).nullable().optional() });
export const reelEventSchema = z.object({ kind: z.enum(['open', 'seal', 'bake', 'use', 'move']), qty: z.number().positive().max(1e9).optional(), binId: z.uuid().nullable().optional(), note: text(200) });
export const consignmentSchema = z.object({ partyId: z.uuid(), direction: z.enum(['vendor_stock', 'customer_stock']), warehouseId: z.uuid(), notes: text(300) });

/**
 * Inventory control on bins and special stock: ABC classes, cycle counts posted to the exact bins,
 * pick-face replenishment, slotting suggestions, tank dips, returnable packaging, MSL reels and
 * consignment statements.
 */
@Injectable()
export class WmsControlService {
  constructor(
    private readonly database: DatabaseService,
    private readonly entries: StockEntriesService,
  ) {}

  private async cfg(tx: Transaction, warehouseId: string) {
    const c = (await wmsConfigs(tx, [warehouseId])).get(warehouseId);
    if (!c) throw new BadRequestException('This warehouse does not run with bins');
    return c;
  }

  // ---- ABC --------------------------------------------------------------------------------------

  /** Classes every stock item by the value issued in the last 12 months and saves it on the storage profiles. */
  abc(auth: AuthContext, apply: boolean) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<{ itemId: string; code: string; name: string; value: string }>(
        tx,
        // Issues only: a voucher that also brings the item back in (a transfer) or was reversed does not count.
        sql`select i.id as "itemId", i.code, i.name, coalesce((select sum(-l.value) from stock_ledger l where l.item_id = i.id and l.qty < 0 and not l.is_reversal and l.posting_date > current_date - 365
                  and not exists (select 1 from stock_ledger r where r.voucher_id = l.voucher_id and r.item_id = l.item_id and (r.qty > 0 or r.is_reversal))), 0)::text as value
            from items i where i.is_stock_item and i.deleted_at is null`,
      );
      const classes = abcClasses(rows.map((r) => ({ itemId: r.itemId, value: Number(r.value) })));
      if (apply) {
        for (const [itemId, abcClass] of classes) {
          await tx.insert(wmsItemProfiles).values({ tenantId: auth.tenantId, itemId, abcClass }).onConflictDoUpdate({ target: wmsItemProfiles.itemId, set: { abcClass, updatedAt: new Date() } });
        }
      }
      const out = rows.map((r) => ({ ...r, abcClass: classes.get(r.itemId)! })).sort((a, b) => Number(b.value) - Number(a.value));
      return { applied: apply, counts: { A: out.filter((r) => r.abcClass === 'A').length, B: out.filter((r) => r.abcClass === 'B').length, C: out.filter((r) => r.abcClass === 'C').length }, items: out.slice(0, 500) };
    });
  }

  countSettings(auth: AuthContext) {
    return this.database.run(auth, async (tx) => (await tx.select().from(wmsSettings))[0] ?? { countDaysA: 30, countDaysB: 90, countDaysC: 180 });
  }

  saveCountSettings(auth: AuthContext, input: z.infer<typeof countSettingsSchema>) {
    return this.database.run(auth, async (tx) => (await tx.insert(wmsSettings).values({ tenantId: auth.tenantId, ...input }).onConflictDoUpdate({ target: wmsSettings.tenantId, set: { ...input, updatedAt: new Date() } }).returning())[0]);
  }

  // ---- cycle counts -------------------------------------------------------------------------------

  /** Bins due for counting: never counted, or counted longer ago than the interval of their highest class. */
  dueBins(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, (tx) => this.due(tx, warehouseId));
  }

  private async due(tx: Transaction, warehouseId: string) {
    const [s] = await tx.select().from(wmsSettings);
    const days = { A: s?.countDaysA ?? 30, B: s?.countDaysB ?? 90, C: s?.countDaysC ?? 180 };
    return many<{ id: string; code: string; cls: string; lastCountedAt: string | null; items: number }>(
      tx,
      sql`select b.id, b.code, b.last_counted_at as "lastCountedAt", count(distinct st.item_id)::int as items,
                 coalesce(min(coalesce(p.abc_class, 'C')), 'C') as cls
          from wms_bins b join wms_zones z on z.id = b.zone_id join wms_bin_stock st on st.bin_id = b.id and st.qty > 0 left join wms_item_profiles p on p.item_id = st.item_id
          where b.warehouse_id = ${warehouseId} and b.is_active and z.kind in ('storage', 'staging', 'quarantine')
            and not exists (select 1 from wms_bin_count_lines l join wms_bin_counts c on c.id = l.count_id where l.bin_id = b.id and c.status = 'open')
          group by b.id
          having b.last_counted_at is null or b.last_counted_at < now() - make_interval(days => case coalesce(min(coalesce(p.abc_class, 'C')), 'C') when 'A' then ${days.A}::int when 'B' then ${days.B}::int else ${days.C}::int end)
          order by coalesce(min(coalesce(p.abc_class, 'C')), 'C'), b.last_counted_at nulls first, b.pick_sequence`,
    );
  }

  private async openCount(tx: Transaction, auth: AuthContext, warehouseId: string, binIds: string[], kind: 'cycle' | 'adhoc', blind: boolean) {
    const number = await nextCode(tx, auth.tenantId, 'wms_bin_count', 'BC', 5);
    const [c] = await tx.insert(wmsBinCounts).values({ tenantId: auth.tenantId, number, warehouseId, kind, blind, createdBy: auth.userId }).returning();
    const stock = await many<{ binId: string; itemId: string; batchKey: string; qty: string }>(tx, sql`select bin_id as "binId", item_id as "itemId", batch_key as "batchKey", qty::text as qty from wms_bin_stock where bin_id in ${binIds} and qty <> 0`);
    if (stock.length) await tx.insert(wmsBinCountLines).values(stock.map((s) => ({ tenantId: auth.tenantId, countId: c.id, binId: s.binId, itemId: s.itemId, batchKey: s.batchKey, systemQty: s.qty })));
    // Empty bins are counted too: a line per bin with nothing is added when something is found.
    return { ...c, bins: binIds.length, lines: stock.length };
  }

  planCycle(auth: AuthContext, input: z.infer<typeof cycleSchema>) {
    return this.database.run(auth, async (tx) => {
      await this.cfg(tx, input.warehouseId);
      const due = (await this.due(tx, input.warehouseId)).slice(0, input.maxBins);
      if (!due.length) throw new BadRequestException('No bin is due for counting');
      return this.openCount(tx, auth, input.warehouseId, due.map((d) => d.id), 'cycle', input.blind);
    });
  }

  adhoc(auth: AuthContext, input: z.infer<typeof adhocCountSchema>) {
    return this.database.run(auth, async (tx) => {
      await this.cfg(tx, input.warehouseId);
      const bins = await tx.select({ id: wmsBins.id }).from(wmsBins).where(and(inArray(wmsBins.id, input.binIds), eq(wmsBins.warehouseId, input.warehouseId)));
      if (bins.length !== new Set(input.binIds).size) throw new BadRequestException('Every bin must be in this warehouse');
      const [busy] = await many<{ code: string }>(tx, sql`select b.code from wms_bin_count_lines l join wms_bin_counts c on c.id = l.count_id join wms_bins b on b.id = l.bin_id where c.status = 'open' and l.bin_id in ${input.binIds} limit 1`);
      if (busy) throw new ConflictException(`Bin ${busy.code} is already in an open count`);
      return this.openCount(tx, auth, input.warehouseId, input.binIds, 'adhoc', input.blind);
    });
  }

  counts(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select c.id, c.number, c.kind, c.status, c.blind, c.accuracy_pct as "accuracyPct", c.created_at as "createdAt", c.posted_at as "postedAt", d.number as "entryNumber", c.entry_id as "entryId",
                   (select count(*)::int from wms_bin_count_lines l where l.count_id = c.id) as lines, (select count(*)::int from wms_bin_count_lines l where l.count_id = c.id and l.counted_qty is null) as uncounted
            from wms_bin_counts c left join documents d on d.id = c.entry_id where c.warehouse_id = ${warehouseId} order by c.created_at desc limit 100`,
      ),
    );
  }

  count(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(wmsBinCounts).where(eq(wmsBinCounts.id, id));
      if (!c) throw new NotFoundException('Count not found');
      const lines = await many<{ systemQty: string | null }>(
        tx,
        sql`select l.id, l.bin_id as "binId", b.code as bin, l.item_id as "itemId", i.code as "itemCode", i.name as "itemName", coalesce(bt.batch_no, l.new_batch_no) as "batchNo", l.system_qty::text as "systemQty", l.counted_qty::text as "countedQty", l.counted_at as "countedAt"
            from wms_bin_count_lines l join wms_bins b on b.id = l.bin_id join items i on i.id = l.item_id left join batches bt on bt.id = l.batch_key where l.count_id = ${id} order by b.pick_sequence, b.code, i.code`,
      );
      // A blind count hides the book quantity until it is posted.
      return { ...c, lines: c.blind && c.status === 'open' ? lines.map((l) => ({ ...l, systemQty: null })) : lines };
    });
  }

  record(auth: AuthContext, countId: string, lineId: string, input: z.infer<typeof countLineSchema>) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(wmsBinCounts).where(eq(wmsBinCounts.id, countId));
      if (!c || c.status !== 'open') throw new ConflictException('The count is not open');
      const [l] = await tx.update(wmsBinCountLines).set({ countedQty: n4(input.countedQty), countedBy: auth.userId, countedAt: new Date() }).where(and(eq(wmsBinCountLines.id, lineId), eq(wmsBinCountLines.countId, countId))).returning({ id: wmsBinCountLines.id });
      if (!l) throw new NotFoundException('Line not found');
      return { ok: true };
    });
  }

  /** Something found in a counted bin that the books do not show there. */
  found(auth: AuthContext, countId: string, input: z.infer<typeof foundSchema>) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(wmsBinCounts).where(eq(wmsBinCounts.id, countId));
      if (!c || c.status !== 'open') throw new ConflictException('The count is not open');
      const [b] = await tx.select().from(wmsBins).where(and(eq(wmsBins.id, input.binId), eq(wmsBins.warehouseId, c.warehouseId)));
      if (!b) throw new BadRequestException('The bin is not in this warehouse');
      let batchKey = NIL_BATCH;
      let newBatchNo: string | null = null;
      if (input.batchNo) {
        const [bt] = await tx.select({ id: batches.id }).from(batches).where(and(eq(batches.itemId, input.itemId), eq(batches.batchNo, input.batchNo.toUpperCase())));
        if (bt) batchKey = bt.id;
        else newBatchNo = input.batchNo.toUpperCase();
      }
      const [dup] = await tx.select({ id: wmsBinCountLines.id }).from(wmsBinCountLines).where(and(eq(wmsBinCountLines.countId, countId), eq(wmsBinCountLines.binId, input.binId), eq(wmsBinCountLines.itemId, input.itemId), eq(wmsBinCountLines.batchKey, batchKey)));
      if (dup && !newBatchNo) throw new ConflictException('That item and batch is already on the count for this bin; enter its quantity there');
      return (await tx.insert(wmsBinCountLines).values({ tenantId: auth.tenantId, countId, binId: input.binId, itemId: input.itemId, batchKey, newBatchNo, systemQty: '0', countedQty: n4(input.countedQty), countedBy: auth.userId, countedAt: new Date() }).returning())[0];
    });
  }

  /** Posts the differences (counted − book now) as one adjustment, line by line to the exact bins. */
  post(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(wmsBinCounts).where(eq(wmsBinCounts.id, id)).for('update');
      if (!c) throw new NotFoundException('Count not found');
      if (c.status !== 'open') throw new ConflictException(`The count is ${c.status}`);
      const lines = await many<{ binId: string; itemId: string; batchKey: string; newBatchNo: string | null; batchNo: string | null; countedQty: string | null; bookNow: string }>(
        tx,
        sql`select l.bin_id as "binId", l.item_id as "itemId", l.batch_key as "batchKey", l.new_batch_no as "newBatchNo", bt.batch_no as "batchNo", l.counted_qty::text as "countedQty",
                   coalesce((select s.qty from wms_bin_stock s where s.bin_id = l.bin_id and s.item_id = l.item_id and s.batch_key = l.batch_key), 0)::text as "bookNow"
            from wms_bin_count_lines l left join batches bt on bt.id = l.batch_key where l.count_id = ${id}`,
      );
      if (lines.some((l) => l.countedQty === null)) throw new ConflictException('Count every line first (enter 0 for nothing found)');
      const diffs = lines.map((l) => ({ ...l, diff: Number(l.countedQty) - (l.newBatchNo ? 0 : Number(l.bookNow)) })).filter((l) => Math.abs(l.diff) > 1e-9);
      let entryId: string | null = null;
      if (diffs.length) {
        const entry = (await this.entries.createTx(
          tx,
          auth,
          {
            purpose: 'adjustment',
            toWarehouseId: c.warehouseId,
            reason: `Bin count ${c.number}`,
            reference: c.number,
            lines: diffs.map((d) => ({ itemId: d.itemId, qty: n4(d.diff), rate: null, batchNo: d.newBatchNo ?? d.batchNo, binId: d.binId })),
          } as Parameters<StockEntriesService['createTx']>[2],
          meta,
        )) as { id: string; version: number };
        await this.entries.submitTx(tx, auth, entry.id, entry.version, meta);
        entryId = entry.id;
      }
      const accuracy = lines.length ? ((lines.length - diffs.length) / lines.length) * 100 : 100;
      await tx.update(wmsBinCounts).set({ status: 'posted', entryId, accuracyPct: accuracy.toFixed(2), postedAt: new Date() }).where(eq(wmsBinCounts.id, id));
      const binIds = [...new Set(lines.map((l) => l.binId))];
      const counted = await many<{ binId: string }>(tx, sql`select distinct bin_id as "binId" from wms_bin_count_lines where count_id = ${id}`);
      const all = [...new Set([...binIds, ...counted.map((x) => x.binId)])];
      if (all.length) await tx.update(wmsBins).set({ lastCountedAt: new Date() }).where(inArray(wmsBins.id, all));
      return { ok: true, adjusted: diffs.length, accuracyPct: accuracy.toFixed(2), entryId };
    });
  }

  cancelCount(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.update(wmsBinCounts).set({ status: 'cancelled' }).where(and(eq(wmsBinCounts.id, id), eq(wmsBinCounts.status, 'open'))).returning({ id: wmsBinCounts.id });
      if (!c) throw new ConflictException('Only an open count can be cancelled');
      return { ok: true };
    });
  }

  // ---- replenishment and slotting ------------------------------------------------------------------

  setPickFace(auth: AuthContext, binId: string, input: z.infer<typeof pickFaceSchema>) {
    return this.database.run(auth, async (tx) => {
      const [b] = await tx.select().from(wmsBins).where(eq(wmsBins.id, binId));
      if (!b) throw new NotFoundException('Bin not found');
      if ((input.replenMin !== null || input.replenMax !== null) && !b.fixedItemId) throw new BadRequestException('Give the bin a fixed item first: a pick face holds one item');
      if (input.replenMin !== null && input.replenMax !== null && input.replenMax <= input.replenMin) throw new BadRequestException('Max must be above min');
      return (await tx.update(wmsBins).set({ replenMin: input.replenMin === null ? null : n4(input.replenMin), replenMax: input.replenMax === null ? null : n4(input.replenMax) }).where(eq(wmsBins.id, binId)).returning())[0];
    });
  }

  /** Replenishment tasks for pick faces below their minimum, from reserve bins (FEFO). */
  planReplenishment(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, async (tx) => {
      await this.cfg(tx, warehouseId);
      await tx.execute(sql`select 1 from wms_warehouses where warehouse_id = ${warehouseId} for update`);
      const faces = await many<{ id: string; code: string; itemId: string; min: string; max: string; onHand: string; onTheWay: string }>(
        tx,
        sql`select b.id, b.code, b.fixed_item_id as "itemId", b.replen_min::text as min, b.replen_max::text as max,
                   coalesce((select sum(qty) from wms_bin_stock s where s.bin_id = b.id), 0)::text as "onHand",
                   coalesce((select sum(qty) from wms_tasks t where t.to_bin_id = b.id and t.status = 'open'), 0)::text as "onTheWay"
            from wms_bins b where b.warehouse_id = ${warehouseId} and b.is_active and not b.is_blocked and b.fixed_item_id is not null and b.replen_min is not null and b.replen_max is not null`,
      );
      const reservedRows = await many<{ binId: string; batchId: string | null; qty: string }>(tx, sql`select from_bin_id as "binId", batch_id as "batchId", sum(qty)::text as qty from wms_tasks where warehouse_id = ${warehouseId} and status = 'open' and from_bin_id is not null group by 1, 2`);
      const reserved = new Map(reservedRows.map((r) => [`${r.binId}|${r.batchId ?? ''}`, Number(r.qty)]));
      const today = todayIST();
      const created: { number: string; bin: string; qty: string; from: string }[] = [];
      const short: { bin: string; short: string }[] = [];
      for (const f of faces) {
        const need = replenishQty(Number(f.onHand), Number(f.onTheWay), Number(f.min), Number(f.max));
        if (need <= 0) continue;
        const stock = await many<{ binId: string; code: string; batchId: string | null; expiryDate: string | null; qty: string; pickSequence: number; zoneKind: string; blocked: boolean; held: boolean }>(
          tx,
          sql`select s.bin_id as "binId", b.code, nullif(s.batch_key, ${NIL_BATCH}::uuid) as "batchId", bt.expiry_date::text as "expiryDate", s.qty::text as qty, b.pick_sequence as "pickSequence", z.kind as "zoneKind", b.is_blocked as blocked,
                     coalesce(bt.qc_status in ('quarantine', 'under_test', 'rejected'), false) as held
              from wms_bin_stock s join wms_bins b on b.id = s.bin_id join wms_zones z on z.id = b.zone_id left join batches bt on bt.id = s.batch_key
              where s.warehouse_id = ${warehouseId} and s.item_id = ${f.itemId} and s.qty > 0 and s.bin_id <> ${f.id} and b.is_active`,
        );
        const r = allocate(need, stock.map((s) => ({ ...s, qty: Number(s.qty) })), { today, reserved });
        for (const p of r.picks) {
          const number = await nextCode(tx, auth.tenantId, 'wms_task', 'WT', 6);
          await tx.insert(wmsTasks).values({ tenantId: auth.tenantId, number, warehouseId, kind: 'replenish', itemId: f.itemId, batchId: p.batchId, qty: n4(p.qty), fromBinId: p.binId, toBinId: f.id, reason: `pick face ${f.code} below ${Number(f.min)}`, createdBy: auth.userId });
          created.push({ number, bin: f.code, qty: n4(p.qty), from: p.code });
        }
        if (r.short > 0) short.push({ bin: f.code, short: n4(r.short) });
      }
      return { created, short };
    });
  }

  /**
   * Slotting: items ranked by how often they moved out in the last 90 days. Fast movers sitting far
   * from the dock are paired with the nearest empty storage bins.
   */
  slotting(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, async (tx) => {
      await this.cfg(tx, warehouseId);
      const movers = await many<{ itemId: string; code: string; name: string; picks: number; binId: string; bin: string; pickSequence: number }>(
        tx,
        sql`with velocity as (
              select item_id, count(*)::int as picks from wms_bin_ledger where warehouse_id = ${warehouseId} and qty < 0 and kind in ('pick', 'posting') and created_at > now() - interval '90 days' group by item_id),
            home as (
              select distinct on (s.item_id) s.item_id, b.id as bin_id, b.code, b.pick_sequence from wms_bin_stock s join wms_bins b on b.id = s.bin_id join wms_zones z on z.id = b.zone_id
              where s.warehouse_id = ${warehouseId} and s.qty > 0 and z.kind = 'storage' order by s.item_id, s.qty desc)
            select v.item_id as "itemId", i.code, i.name, v.picks, h.bin_id as "binId", h.code as bin, h.pick_sequence as "pickSequence"
            from velocity v join items i on i.id = v.item_id join home h on h.item_id = v.item_id order by v.picks desc limit 200`,
      );
      const empty = await many<{ id: string; code: string; pickSequence: number }>(
        tx,
        sql`select b.id, b.code, b.pick_sequence as "pickSequence" from wms_bins b join wms_zones z on z.id = b.zone_id
            where b.warehouse_id = ${warehouseId} and b.is_active and not b.is_blocked and z.kind = 'storage' and z.condition = 'ambient' and b.fixed_item_id is null
              and not exists (select 1 from wms_bin_stock s where s.bin_id = b.id and s.qty > 0) order by b.pick_sequence limit 500`,
      );
      const fast = movers.slice(0, Math.max(1, Math.ceil(movers.length * 0.2)));
      const suggestions: { itemId: string; code: string; name: string; picks: number; from: string; to: string; gain: number }[] = [];
      const used = new Set<string>();
      for (const m of fast) {
        const target = empty.find((e) => !used.has(e.id) && e.pickSequence < m.pickSequence);
        if (!target) continue;
        used.add(target.id);
        suggestions.push({ itemId: m.itemId, code: m.code, name: m.name, picks: m.picks, from: m.bin, to: target.code, gain: m.pickSequence - target.pickSequence });
      }
      return { movers, suggestions };
    });
  }

  // ---- tanks ------------------------------------------------------------------------------------

  tanks(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select t.id, t.bin_id as "binId", b.code as bin, t.item_id as "itemId", i.code as "itemCode", i.name as "itemName", t.capacity_litres as "capacityLitres", t.stock_unit as "stockUnit", t.density_kg_per_l as "densityKgPerL",
                   t.tolerance_pct as "tolerancePct", t.calibration, coalesce((select sum(qty) from wms_bin_stock s where s.bin_id = t.bin_id and s.item_id = t.item_id), 0)::text as "bookQty",
                   (select row_to_json(d) from (select dip_mm as "dipMm", litres, measured_qty as "measuredQty", variance, within_tolerance as "withinTolerance", read_at as "readAt" from wms_dips where tank_id = t.id order by read_at desc limit 1) d) as "lastDip"
            from wms_tanks t join wms_bins b on b.id = t.bin_id join items i on i.id = t.item_id where b.warehouse_id = ${warehouseId} order by b.code`,
      ),
    );
  }

  saveTank(auth: AuthContext, input: z.infer<typeof tankSchema>) {
    return this.database.run(auth, async (tx) => {
      const [b] = await tx.select().from(wmsBins).where(eq(wmsBins.id, input.binId));
      if (!b) throw new NotFoundException('Bin not found');
      if (input.stockUnit === 'kg' && !input.densityKgPerL) throw new BadRequestException('Give the density to convert litres to kg');
      const mm = input.calibration.map((p) => p.mm);
      if (mm.some((v, i) => i > 0 && v <= mm[i - 1])) throw new BadRequestException('Calibration points must rise in mm');
      const values = { itemId: input.itemId, capacityLitres: String(input.capacityLitres), stockUnit: input.stockUnit, densityKgPerL: input.densityKgPerL?.toString() ?? null, calibration: input.calibration, tolerancePct: String(input.tolerancePct) };
      await tx.update(wmsBins).set({ binType: 'bulk', fixedItemId: input.itemId }).where(eq(wmsBins.id, b.id));
      return (await tx.insert(wmsTanks).values({ tenantId: auth.tenantId, binId: b.id, ...values }).onConflictDoUpdate({ target: wmsTanks.binId, set: values }).returning())[0];
    });
  }

  /** Records a dip: volume from the chart, stock quantity, variance against the book; optionally posts the variance. */
  dip(auth: AuthContext, tankId: string, input: z.infer<typeof dipSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(wmsTanks).where(eq(wmsTanks.id, tankId));
      if (!t) throw new NotFoundException('Tank not found');
      const [b] = await tx.select().from(wmsBins).where(eq(wmsBins.id, t.binId));
      let litres: number;
      try {
        litres = tankLitres(t.calibration, input.dipMm);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const measured = t.stockUnit === 'kg' ? litres * Number(t.densityKgPerL) : litres;
      const [book] = await many<{ qty: string }>(tx, sql`select coalesce(sum(qty), 0)::text as qty from wms_bin_stock where bin_id = ${t.binId} and item_id = ${t.itemId}`);
      const variance = measured - Number(book.qty);
      const within = Math.abs(variance) <= (Number(t.tolerancePct) / 100) * Math.max(Number(book.qty), measured, 1);
      let entryId: string | null = null;
      if (input.adjust && Math.abs(variance) > 1e-6) {
        const batches_ = await many<{ batchKey: string; qty: string; batchNo: string | null }>(tx, sql`select s.batch_key as "batchKey", s.qty::text as qty, bt.batch_no as "batchNo" from wms_bin_stock s left join batches bt on bt.id = s.batch_key where s.bin_id = ${t.binId} and s.item_id = ${t.itemId} and s.qty > 0 order by bt.expiry_date nulls last`);
        if (batches_.length > 1) throw new BadRequestException('The tank holds more than one batch; adjust it with a bin count instead');
        const entry = (await this.entries.createTx(
          tx,
          auth,
          { purpose: 'adjustment', toWarehouseId: b.warehouseId, reason: `Tank dip ${b.code}: ${input.dipMm} mm`, reference: b.code, lines: [{ itemId: t.itemId, qty: n4(variance), rate: null, batchNo: batches_[0]?.batchNo ?? null, binId: t.binId }] } as Parameters<StockEntriesService['createTx']>[2],
          meta,
        )) as { id: string; version: number };
        await this.entries.submitTx(tx, auth, entry.id, entry.version, meta);
        entryId = entry.id;
      }
      return (
        await tx
          .insert(wmsDips)
          .values({ tenantId: auth.tenantId, tankId, dipMm: String(input.dipMm), temperatureC: input.temperatureC?.toString() ?? null, litres: litres.toFixed(2), measuredQty: n4(measured), bookQty: n4(Number(book.qty)), variance: n4(variance), withinTolerance: within, entryId, readBy: auth.userId })
          .returning()
      )[0];
    });
  }

  dips(auth: AuthContext, tankId: string) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select d.id, d.dip_mm as "dipMm", d.temperature_c as "temperatureC", d.litres, d.measured_qty as "measuredQty", d.book_qty as "bookQty", d.variance, d.within_tolerance as "withinTolerance", d.read_at as "readAt", u.full_name as "readBy", doc.number as "entryNumber" from wms_dips d left join users u on u.id = d.read_by left join documents doc on doc.id = d.entry_id where d.tank_id = ${tankId} order by d.read_at desc limit 100`),
    );
  }

  // ---- returnable packaging -------------------------------------------------------------------

  returnableTypes(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(wmsReturnableTypes).orderBy(wmsReturnableTypes.code));
  }

  saveReturnableType(auth: AuthContext, id: string | null, input: z.infer<typeof returnableTypeSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { code: input.code.toUpperCase(), name: input.name, depositAmount: input.depositAmount?.toString() ?? null, isActive: input.isActive };
      if (id) return (await tx.update(wmsReturnableTypes).set(values).where(eq(wmsReturnableTypes.id, id)).returning())[0];
      const [dup] = await tx.select({ id: wmsReturnableTypes.id }).from(wmsReturnableTypes).where(eq(wmsReturnableTypes.code, values.code));
      if (dup) throw new ConflictException(`${values.code} already exists`);
      return (await tx.insert(wmsReturnableTypes).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  moveReturnable(auth: AuthContext, input: z.infer<typeof returnableMoveSchema>) {
    return this.database.run(auth, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.partyId}:${input.typeId}`}))`);
      if (input.direction === 'back') {
        const [bal] = await many<{ qty: number }>(tx, sql`select coalesce(sum(qty), 0)::int as qty from wms_returnable_moves where party_id = ${input.partyId} and type_id = ${input.typeId}`);
        if (input.qty > bal.qty) throw new BadRequestException(`Only ${bal.qty} are with this party`);
      }
      return (
        await tx
          .insert(wmsReturnableMoves)
          .values({ tenantId: auth.tenantId, typeId: input.typeId, partyId: input.partyId, qty: input.direction === 'out' ? input.qty : -input.qty, date: input.date ?? todayIST(), reference: input.reference ?? null, documentId: input.documentId ?? null, notes: input.notes ?? null, createdBy: auth.userId })
          .returning()
      )[0];
    });
  }

  /** Balance with each party per type, the deposit value and the oldest unreturned dispatch. */
  returnableBalances(auth: AuthContext, partyId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select m.party_id as "partyId", p.name as party, m.type_id as "typeId", t.code, t.name, sum(m.qty)::int as balance, (sum(m.qty) * coalesce(t.deposit_amount, 0))::text as "depositValue",
                   min(m.date) filter (where m.qty > 0) as "firstOut", max(m.date) as "lastMove"
            from wms_returnable_moves m join wms_returnable_types t on t.id = m.type_id join parties p on p.id = m.party_id
            where true ${partyId ? sql`and m.party_id = ${partyId}` : sql``}
            group by m.party_id, p.name, m.type_id, t.code, t.name, t.deposit_amount having sum(m.qty) <> 0 order by p.name, t.code`,
      ),
    );
  }

  returnableMoves(auth: AuthContext, partyId: string) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select m.id, m.date, t.code, m.qty, m.reference, m.notes, d.number as "documentNumber" from wms_returnable_moves m join wms_returnable_types t on t.id = m.type_id left join documents d on d.id = m.document_id where m.party_id = ${partyId} order by m.date desc, m.created_at desc limit 500`),
    );
  }

  // ---- reels (moisture-sensitive parts) ----------------------------------------------------------

  reels(auth: AuthContext, q: { itemId?: string; status?: string }) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<{ mslLevel: string | null; exposedMinutes: number; openedAt: string | null; status: string }>(
        tx,
        sql`select r.id, r.code, r.item_id as "itemId", i.code as "itemCode", i.name as "itemName", bt.batch_no as "batchNo", w.code as warehouse, b.code as bin, r.qty::text as qty, r.msl_level as "mslLevel",
                   r.exposed_minutes as "exposedMinutes", r.opened_at as "openedAt", r.status, r.bake_count as "bakeCount"
            from wms_reels r join items i on i.id = r.item_id left join batches bt on bt.id = r.batch_id left join warehouses w on w.id = r.warehouse_id left join wms_bins b on b.id = r.bin_id
            where true ${q.itemId ? sql`and r.item_id = ${q.itemId}` : sql``} ${q.status ? sql`and r.status = ${q.status}` : sql`and r.status <> 'empty'`} order by r.code limit 500`,
      );
      const now = new Date();
      return rows.map((r) => {
        const f = floorLife(r.mslLevel, r.exposedMinutes, r.openedAt, now);
        return { ...r, ...f, status: r.status === 'open' && f.expired ? 'expired' : r.status };
      });
    });
  }

  createReel(auth: AuthContext, input: z.infer<typeof reelSchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: wmsReels.id }).from(wmsReels).where(eq(wmsReels.code, input.code));
      if (dup) throw new ConflictException(`Reel ${input.code} already exists`);
      let batchId: string | null = null;
      if (input.batchNo) {
        const [bt] = await tx.select({ id: batches.id }).from(batches).where(and(eq(batches.itemId, input.itemId), eq(batches.batchNo, input.batchNo.toUpperCase())));
        if (!bt) throw new BadRequestException(`Batch ${input.batchNo} of this item is not known`);
        batchId = bt.id;
      }
      const [p] = await tx.select({ mslLevel: wmsItemProfiles.mslLevel }).from(wmsItemProfiles).where(eq(wmsItemProfiles.itemId, input.itemId));
      const [r] = await tx.insert(wmsReels).values({ tenantId: auth.tenantId, code: input.code, itemId: input.itemId, batchId, warehouseId: input.warehouseId ?? null, binId: input.binId ?? null, qty: n4(input.qty), mslLevel: input.mslLevel ?? p?.mslLevel ?? null, createdBy: auth.userId }).returning();
      return r;
    });
  }

  /** open / seal (dry pack) / bake (resets floor life) / use (parts taken) / move (to another bin). */
  reelEvent(auth: AuthContext, id: string, input: z.infer<typeof reelEventSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(wmsReels).where(eq(wmsReels.id, id)).for('update');
      if (!r) throw new NotFoundException('Reel not found');
      if (r.status === 'empty') throw new ConflictException('The reel is empty');
      const now = new Date();
      const life = floorLife(r.mslLevel, r.exposedMinutes, r.openedAt, now);
      const set: Partial<typeof wmsReels.$inferInsert> = {};
      switch (input.kind) {
        case 'open':
          if (r.openedAt) throw new ConflictException('The reel is already open');
          if (life.expired || r.mslLevel === '6') throw new ConflictException('Floor life is used up: bake the reel before use');
          set.openedAt = now;
          set.status = 'open';
          break;
        case 'seal':
          if (!r.openedAt) throw new ConflictException('The reel is not open');
          set.exposedMinutes = life.usedMinutes;
          set.openedAt = null;
          set.status = life.expired ? 'expired' : 'sealed';
          break;
        case 'bake':
          if (r.openedAt) throw new ConflictException('Seal the reel before baking (it is still on the floor)');
          set.exposedMinutes = 0;
          set.status = 'sealed';
          set.bakeCount = r.bakeCount + 1;
          break;
        case 'use': {
          if (!input.qty) throw new BadRequestException('Give the quantity used');
          if (life.expired) throw new ConflictException('Floor life is used up: bake the reel before use');
          const left = Number(r.qty) - input.qty;
          if (left < -1e-9) throw new BadRequestException(`Only ${Number(r.qty)} left on the reel`);
          set.qty = n4(Math.max(0, left));
          if (left <= 1e-9) {
            set.status = 'empty';
            set.exposedMinutes = life.usedMinutes;
            set.openedAt = null;
          }
          break;
        }
        case 'move':
          if (!input.binId) throw new BadRequestException('Choose the bin');
          set.binId = input.binId;
          break;
      }
      await tx.update(wmsReels).set(set).where(eq(wmsReels.id, id));
      await tx.insert(wmsReelEvents).values({ tenantId: auth.tenantId, reelId: id, kind: input.kind, qty: input.qty ? n4(input.qty) : null, note: input.note ?? null, by: auth.userId });
      const [after] = await tx.select().from(wmsReels).where(eq(wmsReels.id, id));
      return { ...after, ...floorLife(after.mslLevel, after.exposedMinutes, after.openedAt, new Date()) };
    });
  }

  // ---- consignment ------------------------------------------------------------------------------

  consignments(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select c.id, c.direction, c.party_id as "partyId", p.name as party, c.warehouse_id as "warehouseId", w.code as warehouse, c.notes, c.is_active as "isActive" from wms_consignments c join parties p on p.id = c.party_id join warehouses w on w.id = c.warehouse_id order by p.name`),
    );
  }

  saveConsignment(auth: AuthContext, input: z.infer<typeof consignmentSchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: wmsConsignments.id }).from(wmsConsignments).where(eq(wmsConsignments.warehouseId, input.warehouseId));
      if (dup) throw new ConflictException('That warehouse already holds a consignment');
      return (await tx.insert(wmsConsignments).values({ tenantId: auth.tenantId, ...input, notes: input.notes ?? null }).returning())[0];
    });
  }

  /** Stock in the consignment warehouse now, and what was used (issued out of it) in the period, to bill or be billed. */
  consignmentStatement(auth: AuthContext, id: string, from: string, to: string) {
    return this.database.run(auth, async (tx) => {
      const [c] = await many<{ warehouseId: string }>(tx, sql`select c.id, c.direction, p.name as party, w.code as warehouse, c.warehouse_id as "warehouseId" from wms_consignments c join parties p on p.id = c.party_id join warehouses w on w.id = c.warehouse_id where c.id = ${id}`);
      if (!c) throw new NotFoundException('Consignment not found');
      const stock = await many(tx, sql`select i.code, i.name, sum(b.qty)::text as qty from stock_balances b join items i on i.id = b.item_id where b.warehouse_id = ${c.warehouseId} and b.qty <> 0 group by i.code, i.name order by i.code`);
      const used = await many(
        tx,
        sql`select i.code, i.name, sum(-l.qty)::text as qty, sum(-l.value)::text as value from stock_ledger l join items i on i.id = l.item_id
            where l.warehouse_id = ${c.warehouseId} and l.qty < 0 and l.posting_date between ${from} and ${to}
              and not exists (select 1 from stock_ledger r where r.voucher_id = l.voucher_id and r.is_reversal and r.item_id = l.item_id)
              and not l.is_reversal
            group by i.code, i.name order by i.code`,
      );
      return { ...c, from, to, stock, used };
    });
  }
}
