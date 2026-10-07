import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { warehouses, wmsBins, wmsItemProfiles, wmsTasks, wmsWarehouses, wmsZones, type Transaction } from '@nextgen/database';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import { DatabaseService } from '../../database/database.service';
import { applyBinMove, NIL_BATCH, wmsConfigs, type WmsConfig } from '../inventory/bins';
import { room, suggestPutaway, unsuitable, type CandidateBin, type PutawayItem } from './putaway';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const num = (max: number) => z.number().positive().max(max).nullable().optional();
export const CONDITIONS = ['ambient', 'cold', 'frozen', 'hazardous', 'quarantine', 'bonded'] as const;
const ZONE_KINDS = ['storage', 'receiving', 'dispatch', 'staging', 'quarantine'] as const;
const BIN_TYPES = ['pallet', 'shelf', 'floor', 'bulk', 'staging'] as const;

export const zoneSchema = z.object({ warehouseId: z.uuid(), code: z.string().trim().min(1).max(20), name: z.string().trim().min(2).max(80), kind: z.enum(ZONE_KINDS).default('storage'), condition: z.enum(CONDITIONS).default('ambient'), sequence: z.number().int().min(1).max(999).default(10), isActive: z.boolean().default(true) });
export const binSchema = z.object({
  zoneId: z.uuid(),
  code: z.string().trim().min(1).max(30),
  aisle: text(10),
  rack: text(10),
  shelf: text(10),
  position: text(10),
  binType: z.enum(BIN_TYPES).default('shelf'),
  maxWeightKg: num(1e7),
  maxVolumeM3: num(1e5),
  maxQty: num(1e10),
  pickSequence: z.number().int().min(0).max(100_000_000).default(1000),
  fixedItemId: z.uuid().nullable().optional(),
  gridX: z.number().int().min(0).max(500).nullable().optional(),
  gridY: z.number().int().min(0).max(500).nullable().optional(),
  isActive: z.boolean().default(true),
});
export const generateSchema = z.object({
  zoneId: z.uuid(),
  aisles: z.array(z.string().trim().min(1).max(4)).min(1).max(40),
  racks: z.number().int().min(1).max(99),
  shelves: z.number().int().min(1).max(20),
  positions: z.number().int().min(1).max(20).default(1),
  binType: z.enum(BIN_TYPES).default('shelf'),
  maxWeightKg: num(1e7),
  maxVolumeM3: num(1e5),
});
export const blockSchema = z.object({ blocked: z.boolean(), reason: text(200) });
export const profileSchema = z.object({
  condition: z.enum(CONDITIONS).default('ambient'),
  hazardClass: z.string().trim().regex(/^[1-9](\.[1-6])?$/, 'UN class like 3, 5.1 or 8').nullable().optional(),
  unitWeightKg: num(1e6),
  unitVolumeM3: num(1e4),
  abcClass: z.enum(['A', 'B', 'C']).nullable().optional(),
  minShelfLifeDays: z.number().int().min(0).max(3650).nullable().optional(),
});
export const moveSchema = z.object({ itemId: z.uuid(), batchId: z.uuid().nullable().optional(), fromBinId: z.uuid(), toBinId: z.uuid(), qty: z.number().positive().max(1e10), overrideReason: text(200) });
export const confirmSchema = z.object({ binId: z.uuid().optional(), binCode: z.string().trim().max(30).optional(), qty: z.number().positive().max(1e10), overrideReason: text(200) });

/**
 * Warehouse management: locations (zones, bins), item storage profiles, bin stock lookups, moves
 * between bins, put-away suggestions and tasks, the utilisation heat map and a reconciliation of
 * bins against warehouse stock.
 */
@Injectable()
export class WmsService {
  constructor(private readonly database: DatabaseService) {}

  // ---- setup ------------------------------------------------------------------------------------

  warehouses(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select w.id, w.code, w.name, w.allow_negative_stock as "allowNegativeStock", coalesce(x.enabled, false) as wms, x.receiving_bin_id as "receivingBinId", x.dispatch_bin_id as "dispatchBinId",
                   (select count(*)::int from wms_bins b where b.warehouse_id = w.id and b.is_active) as bins,
                   (select count(*)::int from wms_tasks t where t.warehouse_id = w.id and t.status = 'open') as "openTasks"
            from warehouses w left join wms_warehouses x on x.warehouse_id = w.id where w.is_active order by w.code`,
      ),
    );
  }

  /** Switches bins on: creates receiving and dispatch bins and puts the current stock in receiving. */
  enable(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, async (tx) => {
      const [w] = await tx.select().from(warehouses).where(eq(warehouses.id, warehouseId)).for('update');
      if (!w) throw new NotFoundException('Warehouse not found');
      if (w.allowNegativeStock) throw new BadRequestException(`${w.code} allows negative stock; turn that off before running it with bins`);
      const [existing] = await tx.select().from(wmsWarehouses).where(eq(wmsWarehouses.warehouseId, warehouseId));
      if (existing?.enabled) throw new ConflictException(`${w.code} already runs with bins`);
      if (existing) throw new ConflictException(`${w.code} ran with bins before; ask support to switch it back on`);
      const zone = async (code: string, name: string, kind: string, sequence: number) =>
        (await tx.insert(wmsZones).values({ tenantId: auth.tenantId, warehouseId, code, name, kind, sequence }).onConflictDoNothing().returning())[0] ??
        (await tx.select().from(wmsZones).where(and(eq(wmsZones.warehouseId, warehouseId), eq(wmsZones.code, code))))[0];
      const recvZone = await zone('RECV', 'Receiving', 'receiving', 1);
      const dispZone = await zone('DISP', 'Dispatch', 'dispatch', 2);
      const bin = async (zoneId: string, code: string) =>
        (await tx.insert(wmsBins).values({ tenantId: auth.tenantId, warehouseId, zoneId, code, binType: 'staging', pickSequence: 0 }).returning())[0];
      const recv = await bin(recvZone.id, 'RECV');
      const disp = await bin(dispZone.id, 'DISP');
      await tx.insert(wmsWarehouses).values({ tenantId: auth.tenantId, warehouseId, receivingBinId: recv.id, dispatchBinId: disp.id, enabledBy: auth.userId });
      const stock = await many<{ itemId: string; batchKey: string; qty: string }>(tx, sql`select item_id as "itemId", batch_key as "batchKey", qty::text as qty from stock_balances where warehouse_id = ${warehouseId} and qty <> 0`);
      if (stock.some((s) => Number(s.qty) < 0)) throw new ConflictException(`${w.code} has negative stock; correct it before switching bins on`);
      const cfg: WmsConfig = { warehouseId, receivingBinId: recv.id, dispatchBinId: disp.id };
      for (const s of stock) await applyBinMove(tx, auth.tenantId, auth.userId, cfg, { warehouseId, itemId: s.itemId, batchId: s.batchKey === NIL_BATCH ? null : s.batchKey, qty: s.qty, binId: recv.id, kind: 'enable' });
      return { warehouseId, receivingBinId: recv.id, dispatchBinId: disp.id, linesMoved: stock.length };
    });
  }

  zones(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select z.id, z.code, z.name, z.kind, z.condition, z.sequence, z.is_active as "isActive", (select count(*)::int from wms_bins b where b.zone_id = z.id and b.is_active) as bins
            from wms_zones z where z.warehouse_id = ${warehouseId} order by z.sequence, z.code`,
      ),
    );
  }

  saveZone(auth: AuthContext, id: string | null, input: z.infer<typeof zoneSchema>) {
    return this.database.run(auth, async (tx) => {
      await this.requireWms(tx, input.warehouseId);
      if (id) {
        const [z0] = await tx.select().from(wmsZones).where(eq(wmsZones.id, id));
        if (!z0) throw new NotFoundException('Zone not found');
        if (['receiving', 'dispatch'].includes(z0.kind) && z0.kind !== input.kind) throw new BadRequestException('The receiving and dispatch zones keep their use');
        const [u] = await tx.update(wmsZones).set({ code: input.code, name: input.name, kind: input.kind, condition: input.condition, sequence: input.sequence, isActive: input.isActive }).where(eq(wmsZones.id, id)).returning();
        return u;
      }
      const [dup] = await tx.select({ id: wmsZones.id }).from(wmsZones).where(and(eq(wmsZones.warehouseId, input.warehouseId), eq(wmsZones.code, input.code)));
      if (dup) throw new ConflictException(`Zone ${input.code} already exists`);
      return (await tx.insert(wmsZones).values({ tenantId: auth.tenantId, ...input }).returning())[0];
    });
  }

  bins(auth: AuthContext, warehouseId: string, q: { zoneId?: string; q?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select b.id, b.code, b.zone_id as "zoneId", z.code as zone, z.kind as "zoneKind", z.condition, b.aisle, b.rack, b.shelf, b.position, b.bin_type as "binType",
                   b.max_weight_kg as "maxWeightKg", b.max_volume_m3 as "maxVolumeM3", b.max_qty as "maxQty", b.pick_sequence as "pickSequence", b.fixed_item_id as "fixedItemId", i.code as "fixedItem",
                   b.is_blocked as "isBlocked", b.block_reason as "blockReason", b.is_active as "isActive", b.grid_x as "gridX", b.grid_y as "gridY",
                   (select count(distinct s.item_id)::int from wms_bin_stock s where s.bin_id = b.id and s.qty > 0) as items
            from wms_bins b join wms_zones z on z.id = b.zone_id left join items i on i.id = b.fixed_item_id
            where b.warehouse_id = ${warehouseId} ${q.zoneId ? sql`and b.zone_id = ${q.zoneId}` : sql``} ${q.q ? sql`and b.code ilike ${`%${q.q}%`}` : sql``}
            order by z.sequence, b.pick_sequence, b.code limit 2000`,
      ),
    );
  }

  saveBin(auth: AuthContext, id: string | null, input: z.infer<typeof binSchema>) {
    return this.database.run(auth, async (tx) => {
      const [zone] = await tx.select().from(wmsZones).where(eq(wmsZones.id, input.zoneId));
      if (!zone) throw new NotFoundException('Zone not found');
      await this.requireWms(tx, zone.warehouseId);
      const values = {
        zoneId: input.zoneId,
        code: input.code.toUpperCase(),
        aisle: input.aisle ?? null,
        rack: input.rack ?? null,
        shelf: input.shelf ?? null,
        position: input.position ?? null,
        binType: input.binType,
        maxWeightKg: input.maxWeightKg?.toString() ?? null,
        maxVolumeM3: input.maxVolumeM3?.toString() ?? null,
        maxQty: input.maxQty?.toString() ?? null,
        pickSequence: input.pickSequence,
        fixedItemId: input.fixedItemId ?? null,
        gridX: input.gridX ?? null,
        gridY: input.gridY ?? null,
        isActive: input.isActive,
      };
      if (id) {
        const [b] = await tx.select().from(wmsBins).where(eq(wmsBins.id, id));
        if (!b) throw new NotFoundException('Bin not found');
        if (b.warehouseId !== zone.warehouseId) throw new BadRequestException('A bin cannot move to another warehouse');
        if (!input.isActive && b.isActive) await this.requireEmpty(tx, id, b.code);
        return (await tx.update(wmsBins).set(values).where(eq(wmsBins.id, id)).returning())[0];
      }
      const [dup] = await tx.select({ id: wmsBins.id }).from(wmsBins).where(and(eq(wmsBins.warehouseId, zone.warehouseId), eq(wmsBins.code, values.code)));
      if (dup) throw new ConflictException(`Bin ${values.code} already exists`);
      return (await tx.insert(wmsBins).values({ tenantId: auth.tenantId, warehouseId: zone.warehouseId, ...values }).returning())[0];
    });
  }

  /**
   * Creates a block of bins: aisle-rack-shelf(-position), e.g. A-01-1 or A-01-1-2. Pick sequence
   * follows a serpentine walk: up one aisle and down the next.
   */
  generateBins(auth: AuthContext, input: z.infer<typeof generateSchema>) {
    return this.database.run(auth, async (tx) => {
      const [zone] = await tx.select().from(wmsZones).where(eq(wmsZones.id, input.zoneId));
      if (!zone) throw new NotFoundException('Zone not found');
      await this.requireWms(tx, zone.warehouseId);
      const total = input.aisles.length * input.racks * input.shelves * input.positions;
      if (total > 5000) throw new BadRequestException(`That is ${total} bins; create at most 5000 at a time`);
      const rows = [];
      for (const [ai, aisle] of input.aisles.entries()) {
        for (let r = 1; r <= input.racks; r++) {
          const walk = ai % 2 === 0 ? r : input.racks + 1 - r;
          for (let s = 1; s <= input.shelves; s++) {
            for (let p = 1; p <= input.positions; p++) {
              const code = [aisle.toUpperCase(), String(r).padStart(2, '0'), String(s), ...(input.positions > 1 ? [String(p)] : [])].join('-');
              rows.push({
                tenantId: auth.tenantId,
                warehouseId: zone.warehouseId,
                zoneId: zone.id,
                code,
                aisle: aisle.toUpperCase(),
                rack: String(r).padStart(2, '0'),
                shelf: String(s),
                position: input.positions > 1 ? String(p) : null,
                binType: input.binType,
                maxWeightKg: input.maxWeightKg?.toString() ?? null,
                maxVolumeM3: input.maxVolumeM3?.toString() ?? null,
                pickSequence: zone.sequence * 100_000 + ai * 1000 + walk * 10 + s,
                gridX: ai * 2,
                gridY: walk - 1,
              });
            }
          }
        }
      }
      const created = await tx.insert(wmsBins).values(rows).onConflictDoNothing().returning({ id: wmsBins.id });
      return { created: created.length, skipped: rows.length - created.length };
    });
  }

  block(auth: AuthContext, id: string, input: z.infer<typeof blockSchema>) {
    return this.database.run(auth, async (tx) => {
      const [b] = await tx.update(wmsBins).set({ isBlocked: input.blocked, blockReason: input.blocked ? (input.reason ?? null) : null }).where(eq(wmsBins.id, id)).returning();
      if (!b) throw new NotFoundException('Bin not found');
      return b;
    });
  }

  profile(auth: AuthContext, itemId: string) {
    return this.database.run(auth, async (tx) => (await tx.select().from(wmsItemProfiles).where(eq(wmsItemProfiles.itemId, itemId)))[0] ?? null);
  }

  saveProfile(auth: AuthContext, itemId: string, input: z.infer<typeof profileSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = {
        condition: input.condition,
        hazardClass: input.hazardClass ?? null,
        unitWeightKg: input.unitWeightKg?.toString() ?? null,
        unitVolumeM3: input.unitVolumeM3?.toString() ?? null,
        abcClass: input.abcClass ?? null,
        minShelfLifeDays: input.minShelfLifeDays ?? null,
        updatedAt: new Date(),
      };
      return (
        await tx
          .insert(wmsItemProfiles)
          .values({ tenantId: auth.tenantId, itemId, ...values })
          .onConflictDoUpdate({ target: wmsItemProfiles.itemId, set: values })
          .returning()
      )[0];
    });
  }

  // ---- lookups ------------------------------------------------------------------------------

  /** A bin and what is in it (by id, or by the code scanned from its label). */
  bin(auth: AuthContext, warehouseId: string, key: string) {
    return this.database.run(auth, async (tx) => {
      const [b] = await many<{ id: string }>(
        tx,
        sql`select b.id, b.code, z.code as zone, z.kind as "zoneKind", z.condition, b.bin_type as "binType", b.is_blocked as "isBlocked", b.block_reason as "blockReason", b.max_weight_kg as "maxWeightKg", b.max_volume_m3 as "maxVolumeM3", b.max_qty as "maxQty", i.code as "fixedItem"
            from wms_bins b join wms_zones z on z.id = b.zone_id left join items i on i.id = b.fixed_item_id
            where b.warehouse_id = ${warehouseId} and ${/^[0-9a-f-]{36}$/i.test(key) ? sql`b.id = ${key}` : sql`b.code = ${key.toUpperCase()}`}`,
      );
      if (!b) throw new NotFoundException(`No bin ${key} in this warehouse`);
      const contents = await many(
        tx,
        sql`select s.item_id as "itemId", i.code, i.name, s.batch_key as "batchKey", bt.batch_no as "batchNo", bt.expiry_date::text as "expiryDate", bt.qc_status as "qcStatus", s.qty::text as qty, u.code as uom
            from wms_bin_stock s join items i on i.id = s.item_id join uoms u on u.id = i.base_uom_id left join batches bt on bt.id = s.batch_key
            where s.bin_id = ${b.id} and s.qty <> 0 order by i.code, bt.expiry_date nulls last`,
      );
      return { ...b, contents };
    });
  }

  /** Where an item is, bin by bin. */
  locations(auth: AuthContext, itemId: string, warehouseId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.warehouse_id as "warehouseId", w.code as warehouse, s.bin_id as "binId", b.code as bin, z.kind as "zoneKind", z.condition, s.batch_key as "batchKey", bt.batch_no as "batchNo", bt.expiry_date::text as "expiryDate", s.qty::text as qty, b.is_blocked as "isBlocked"
            from wms_bin_stock s join wms_bins b on b.id = s.bin_id join wms_zones z on z.id = b.zone_id join warehouses w on w.id = s.warehouse_id left join batches bt on bt.id = s.batch_key
            where s.item_id = ${itemId} and s.qty <> 0 ${warehouseId ? sql`and s.warehouse_id = ${warehouseId}` : sql``}
            order by w.code, bt.expiry_date nulls last, b.pick_sequence`,
      ),
    );
  }

  // ---- moves and put-away ----------------------------------------------------------------------

  private async requireWms(tx: Transaction, warehouseId: string) {
    const cfg = (await wmsConfigs(tx, [warehouseId])).get(warehouseId);
    if (!cfg) throw new BadRequestException('This warehouse does not run with bins');
    return cfg;
  }

  private async requireEmpty(tx: Transaction, binId: string, code: string) {
    const [s] = await many(tx, sql`select 1 from wms_bin_stock where bin_id = ${binId} and qty <> 0 limit 1`);
    if (s) throw new ConflictException(`Bin ${code} still holds stock; move it out first`);
  }

  /** Storage needs of an item (and whether its lot is on QC hold). */
  private async itemFacts(tx: Transaction, itemId: string, batchId: string | null, qty: number): Promise<PutawayItem & { code: string }> {
    const [r] = await many<{ code: string; condition: string | null; hazardClass: string | null; unitWeightKg: string | null; unitVolumeM3: string | null; abcClass: string | null; qcStatus: string | null }>(
      tx,
      sql`select i.code, p.condition, p.hazard_class as "hazardClass", p.unit_weight_kg::text as "unitWeightKg", p.unit_volume_m3::text as "unitVolumeM3", p.abc_class as "abcClass",
                 (select qc_status from batches where id = ${batchId ?? NIL_BATCH}) as "qcStatus"
          from items i left join wms_item_profiles p on p.item_id = i.id where i.id = ${itemId}`,
    );
    if (!r) throw new NotFoundException('Item not found');
    return {
      code: r.code,
      itemId,
      batchKey: batchId ?? NIL_BATCH,
      qty,
      condition: r.condition ?? 'ambient',
      hazardClass: r.hazardClass,
      unitWeightKg: r.unitWeightKg ? Number(r.unitWeightKg) : null,
      unitVolumeM3: r.unitVolumeM3 ? Number(r.unitVolumeM3) : null,
      abcClass: r.abcClass,
      held: r.qcStatus === 'quarantine' || r.qcStatus === 'under_test',
    };
  }

  /** Active, unblocked bins of the warehouse with what they hold. */
  private async candidates(tx: Transaction, warehouseId: string, onlyBinId?: string): Promise<CandidateBin[]> {
    const bins = await many<{ id: string; code: string; zoneKind: string; condition: string; pickSequence: number; fixedItemId: string | null; maxWeightKg: string | null; maxVolumeM3: string | null; maxQty: string | null }>(
      tx,
      sql`select b.id, b.code, z.kind as "zoneKind", z.condition, b.pick_sequence as "pickSequence", b.fixed_item_id as "fixedItemId", b.max_weight_kg::text as "maxWeightKg", b.max_volume_m3::text as "maxVolumeM3", b.max_qty::text as "maxQty"
          from wms_bins b join wms_zones z on z.id = b.zone_id
          where b.warehouse_id = ${warehouseId} and b.is_active and not b.is_blocked and z.is_active ${onlyBinId ? sql`and b.id = ${onlyBinId}` : sql``}`,
    );
    const contents = await many<{ binId: string; itemId: string; batchKey: string; qty: string; hazardClass: string | null; unitWeightKg: string | null; unitVolumeM3: string | null }>(
      tx,
      sql`select s.bin_id as "binId", s.item_id as "itemId", s.batch_key as "batchKey", s.qty::text as qty, p.hazard_class as "hazardClass", p.unit_weight_kg::text as "unitWeightKg", p.unit_volume_m3::text as "unitVolumeM3"
          from wms_bin_stock s left join wms_item_profiles p on p.item_id = s.item_id where s.warehouse_id = ${warehouseId} and s.qty > 0 ${onlyBinId ? sql`and s.bin_id = ${onlyBinId}` : sql``}`,
    );
    // Quantities already on their way to a bin count as taken.
    const incoming = await many<{ binId: string; itemId: string; batchKey: string; qty: string; hazardClass: string | null; unitWeightKg: string | null; unitVolumeM3: string | null }>(
      tx,
      sql`select t.to_bin_id as "binId", t.item_id as "itemId", coalesce(t.batch_id, ${NIL_BATCH}::uuid) as "batchKey", t.qty::text as qty, p.hazard_class as "hazardClass", p.unit_weight_kg::text as "unitWeightKg", p.unit_volume_m3::text as "unitVolumeM3"
          from wms_tasks t left join wms_item_profiles p on p.item_id = t.item_id where t.warehouse_id = ${warehouseId} and t.status = 'open' and t.to_bin_id is not null`,
    );
    const n = (v: string | null) => (v === null ? null : Number(v));
    return bins.map((b) => ({
      id: b.id,
      code: b.code,
      zoneKind: b.zoneKind,
      condition: b.condition,
      pickSequence: b.pickSequence,
      fixedItemId: b.fixedItemId,
      maxWeightKg: n(b.maxWeightKg),
      maxVolumeM3: n(b.maxVolumeM3),
      maxQty: n(b.maxQty),
      contents: [...contents, ...incoming].filter((c) => c.binId === b.id).map((c) => ({ itemId: c.itemId, batchKey: c.batchKey, qty: Number(c.qty), hazardClass: c.hazardClass, unitWeightKg: n(c.unitWeightKg), unitVolumeM3: n(c.unitVolumeM3) })),
    }));
  }

  /** Refuses a bin that cannot take the item; capacity can be overridden with a reason. */
  private async checkTarget(tx: Transaction, warehouseId: string, binId: string, it: PutawayItem & { code: string }, overrideReason: string | null | undefined) {
    const [bin] = await this.candidates(tx, warehouseId, binId);
    if (!bin) throw new BadRequestException('That bin is blocked, inactive or not in this warehouse');
    if (['receiving', 'dispatch', 'staging'].includes(bin.zoneKind)) return bin;
    const quarantine = (await many(tx, sql`select 1 from wms_zones where warehouse_id = ${warehouseId} and kind = 'quarantine' and is_active limit 1`)).length > 0;
    const why = unsuitable(bin, it, quarantine);
    if (why) throw new BadRequestException(`${it.code} cannot go to ${bin.code}: ${why}`);
    if (room(bin, it) < it.qty && !overrideReason) throw new BadRequestException(`${bin.code} has room for ${room(bin, it)} only; give a reason to overfill it`);
    return bin;
  }

  /** Moves stock between two bins of one warehouse (no value change). */
  move(auth: AuthContext, input: z.infer<typeof moveSchema>) {
    return this.database.run(auth, async (tx) => {
      const [from] = await tx.select().from(wmsBins).where(eq(wmsBins.id, input.fromBinId));
      const [to] = await tx.select().from(wmsBins).where(eq(wmsBins.id, input.toBinId));
      if (!from || !to) throw new NotFoundException('Bin not found');
      if (from.warehouseId !== to.warehouseId) throw new BadRequestException('Both bins must be in the same warehouse; use a stock transfer between warehouses');
      if (from.id === to.id) throw new BadRequestException('Choose a different bin');
      const cfg = await this.requireWms(tx, from.warehouseId);
      const it = await this.itemFacts(tx, input.itemId, input.batchId ?? null, input.qty);
      await this.checkTarget(tx, from.warehouseId, to.id, it, input.overrideReason);
      const qty = input.qty.toFixed(4);
      await applyBinMove(tx, auth.tenantId, auth.userId, cfg, { warehouseId: from.warehouseId, itemId: input.itemId, batchId: input.batchId ?? null, qty: `-${qty}`, binId: from.id, kind: 'move', label: it.code });
      await applyBinMove(tx, auth.tenantId, auth.userId, cfg, { warehouseId: from.warehouseId, itemId: input.itemId, batchId: input.batchId ?? null, qty, binId: to.id, kind: 'move', label: it.code });
      return { ok: true };
    });
  }

  /** Put-away tasks for everything in the receiving bin not already planned. */
  planPutaway(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, async (tx) => {
      const cfg = await this.requireWms(tx, warehouseId);
      await tx.execute(sql`select 1 from wms_warehouses where warehouse_id = ${warehouseId} for update`);
      const waiting = await many<{ itemId: string; batchKey: string; qty: string }>(
        tx,
        sql`select s.item_id as "itemId", s.batch_key as "batchKey", (s.qty - coalesce((select sum(t.qty) from wms_tasks t where t.warehouse_id = ${warehouseId} and t.status = 'open' and t.kind = 'putaway'
                    and t.item_id = s.item_id and coalesce(t.batch_id, ${NIL_BATCH}::uuid) = s.batch_key), 0))::text as qty
            from wms_bin_stock s where s.bin_id = ${cfg.receivingBinId} and s.qty > 0`,
      );
      const created: (typeof wmsTasks.$inferSelect)[] = [];
      // Cross-docking: what open sales orders still need beyond the stock already in storage and dispatch goes straight to dispatch.
      const backorders = new Map(
        (
          await many<{ itemId: string; short: string }>(
            tx,
            sql`with demand as (
                  select l.item_id, sum(greatest(0, l.qty - l.delivered_qty) * l.conversion_factor) as qty
                  from sales_order_lines l join sales_orders so on so.id = l.order_id join documents d on d.id = so.id
                  where d.status = 'approved' and so.closed_at is null and (so.warehouse_id = ${warehouseId} or so.warehouse_id is null) group by l.item_id),
                have as (
                  select item_id, sum(qty) as qty from wms_bin_stock where warehouse_id = ${warehouseId} and bin_id <> ${cfg.receivingBinId} group by item_id)
                select d.item_id as "itemId", (d.qty - coalesce(h.qty, 0) - coalesce((select sum(t.qty) from wms_tasks t where t.warehouse_id = ${warehouseId} and t.status = 'open' and t.kind = 'putaway' and t.item_id = d.item_id and t.to_bin_id = ${cfg.dispatchBinId}), 0))::text as short
                from demand d left join have h on h.item_id = d.item_id`,
          )
        ).map((r) => [r.itemId, Number(r.short)]),
      );
      for (const w of waiting.filter((x) => Number(x.qty) > 0)) {
        const batchId = w.batchKey === NIL_BATCH ? null : w.batchKey;
        let qty = Number(w.qty);
        const add = async (qty: number, toBinId: string | null, reason: string) => {
          const number = await nextCode(tx, auth.tenantId, 'wms_task', 'WT', 6);
          const [t] = await tx
            .insert(wmsTasks)
            .values({ tenantId: auth.tenantId, number, warehouseId, kind: 'putaway', itemId: w.itemId, batchId, qty: qty.toFixed(4), fromBinId: cfg.receivingBinId, toBinId, reason, createdBy: auth.userId })
            .returning();
          created.push(t);
        };
        const it0 = await this.itemFacts(tx, w.itemId, batchId, qty);
        const cross = it0.held ? 0 : Math.min(qty, Math.max(0, backorders.get(w.itemId) ?? 0));
        if (cross > 0) {
          await add(cross, cfg.dispatchBinId, `cross-dock: ${cross} waiting on open sales orders`);
          backorders.set(w.itemId, (backorders.get(w.itemId) ?? 0) - cross);
          qty = Math.round((qty - cross) * 10_000) / 10_000;
          if (qty <= 0) continue;
        }
        const plan = suggestPutaway({ ...it0, qty }, await this.candidates(tx, warehouseId));
        for (const p of plan.placements) await add(p.qty, p.binId, p.reason);
        if (plan.unplaced > 0) await add(plan.unplaced, null, 'no bin has room or suits this item; choose one when putting it away');
      }
      return { created: created.length, tasks: created };
    });
  }

  tasks(auth: AuthContext, q: { warehouseId?: string; kind?: string; status?: string; mine?: boolean }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select t.id, t.number, t.kind, t.status, t.warehouse_id as "warehouseId", w.code as warehouse, t.item_id as "itemId", i.code as "itemCode", i.name as "itemName", t.batch_id as "batchId", bt.batch_no as "batchNo",
                   t.qty::text as qty, t.from_bin_id as "fromBinId", fb.code as "fromBin", t.to_bin_id as "toBinId", tb.code as "toBin", t.reason, t.done_qty::text as "doneQty", db.code as "doneBin", t.override_reason as "overrideReason",
                   t.assignee_id as "assigneeId", u.full_name as assignee, t.created_at as "createdAt", t.done_at as "doneAt"
            from wms_tasks t join warehouses w on w.id = t.warehouse_id join items i on i.id = t.item_id left join batches bt on bt.id = t.batch_id
            left join wms_bins fb on fb.id = t.from_bin_id left join wms_bins tb on tb.id = t.to_bin_id left join wms_bins db on db.id = t.done_bin_id left join users u on u.id = t.assignee_id
            where true ${q.warehouseId ? sql`and t.warehouse_id = ${q.warehouseId}` : sql``} ${q.kind ? sql`and t.kind = ${q.kind}` : sql``} ${q.status ? sql`and t.status = ${q.status}` : sql``}
              ${q.mine ? sql`and (t.assignee_id = ${auth.userId} or t.assignee_id is null)` : sql``}
            order by t.status = 'open' desc, coalesce(tb.pick_sequence, 0), t.created_at limit 500`,
      ),
    );
  }

  /** Confirms a task by scanning the bin the goods were put in (or taken from, for picks). */
  confirm(auth: AuthContext, id: string, input: z.infer<typeof confirmSchema>) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(wmsTasks).where(eq(wmsTasks.id, id)).for('update');
      if (!t) throw new NotFoundException('Task not found');
      if (t.kind === 'pick') throw new BadRequestException('Confirm picks from the wave');
      if (t.status !== 'open') throw new ConflictException(`Task ${t.number} is already ${t.status}`);
      if (input.qty > Number(t.qty)) throw new BadRequestException(`The task is for ${Number(t.qty)} only`);
      const cfg = await this.requireWms(tx, t.warehouseId);
      const [scanned] = input.binId
        ? await tx.select().from(wmsBins).where(and(eq(wmsBins.id, input.binId), eq(wmsBins.warehouseId, t.warehouseId)))
        : await tx.select().from(wmsBins).where(and(eq(wmsBins.code, (input.binCode ?? '').toUpperCase()), eq(wmsBins.warehouseId, t.warehouseId)));
      if (!scanned) throw new BadRequestException('Scan a bin of this warehouse');
      const qty = input.qty.toFixed(4);
      // Closed first, so the task's own reservation of its suggested bin does not count against it.
      await tx.update(wmsTasks).set({ status: 'done', doneQty: qty, doneBinId: scanned.id, overrideReason: input.overrideReason ?? null, doneAt: new Date(), doneBy: auth.userId }).where(eq(wmsTasks.id, id));
      const it = await this.itemFacts(tx, t.itemId, t.batchId, input.qty);
      await this.checkTarget(tx, t.warehouseId, scanned.id, it, input.overrideReason);
      await applyBinMove(tx, auth.tenantId, auth.userId, cfg, { warehouseId: t.warehouseId, itemId: t.itemId, batchId: t.batchId, qty: `-${qty}`, binId: t.fromBinId, kind: t.kind as 'putaway', taskId: t.id, label: it.code });
      await applyBinMove(tx, auth.tenantId, auth.userId, cfg, { warehouseId: t.warehouseId, itemId: t.itemId, batchId: t.batchId, qty, binId: scanned.id, kind: t.kind as 'putaway', taskId: t.id, label: it.code });
      return { ok: true, bin: scanned.code, differentBin: !!t.toBinId && t.toBinId !== scanned.id };
    });
  }

  cancelTask(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.update(wmsTasks).set({ status: 'cancelled', doneAt: new Date(), doneBy: auth.userId }).where(and(eq(wmsTasks.id, id), eq(wmsTasks.status, 'open'))).returning({ id: wmsTasks.id });
      if (!t) throw new ConflictException('Only an open task can be cancelled');
      return { ok: true };
    });
  }

  // ---- views ----------------------------------------------------------------------------------

  /** Fill of each bin (the highest of weight, volume and quantity use) and its movements in 30 days. */
  heatmap(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select b.id, b.code, z.code as zone, z.condition, b.aisle, b.rack, b.shelf, b.grid_x as "gridX", b.grid_y as "gridY", b.is_blocked as "isBlocked",
                   coalesce(sum(s.qty * p.unit_weight_kg), 0)::float8 as "weightKg", coalesce(sum(s.qty * p.unit_volume_m3), 0)::float8 as "volumeM3", coalesce(sum(s.qty), 0)::float8 as qty,
                   greatest(
                     case when b.max_weight_kg > 0 then coalesce(sum(s.qty * p.unit_weight_kg), 0) / b.max_weight_kg end,
                     case when b.max_volume_m3 > 0 then coalesce(sum(s.qty * p.unit_volume_m3), 0) / b.max_volume_m3 end,
                     case when b.max_qty > 0 then coalesce(sum(s.qty), 0) / b.max_qty end
                   )::float8 as fill,
                   (select count(*)::int from wms_bin_ledger l where l.bin_id = b.id and l.created_at > now() - interval '30 days' and l.kind <> 'enable') as moves30,
                   count(distinct s.item_id) filter (where s.qty > 0)::int as items
            from wms_bins b join wms_zones z on z.id = b.zone_id left join wms_bin_stock s on s.bin_id = b.id and s.qty > 0 left join wms_item_profiles p on p.item_id = s.item_id
            where b.warehouse_id = ${warehouseId} and b.is_active and z.kind = 'storage'
            group by b.id, z.code, z.condition, z.sequence order by z.sequence, b.pick_sequence`,
      ),
    );
  }

  /** Differences between bin stock and warehouse stock (there should be none). */
  reconcile(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`with b as (select item_id, batch_key, sum(qty) as qty from wms_bin_stock where warehouse_id = ${warehouseId} group by item_id, batch_key),
                 w as (select item_id, batch_key, qty from stock_balances where warehouse_id = ${warehouseId})
            select coalesce(b.item_id, w.item_id) as "itemId", i.code, coalesce(b.batch_key, w.batch_key) as "batchKey", coalesce(w.qty, 0)::text as "warehouseQty", coalesce(b.qty, 0)::text as "binQty"
            from b full join w on w.item_id = b.item_id and w.batch_key = b.batch_key join items i on i.id = coalesce(b.item_id, w.item_id)
            where coalesce(b.qty, 0) <> coalesce(w.qty, 0) order by i.code`,
      ),
    );
  }
}
