import { BadRequestException } from '@nestjs/common';
import { wmsBinLedger, wmsBins, wmsBinStock, wmsWarehouses, type Transaction } from '@nextgen/database';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Decimal } from '../../common/decimal';

export const NIL_BATCH = '00000000-0000-0000-0000-000000000000';

export interface WmsConfig {
  warehouseId: string;
  receivingBinId: string;
  dispatchBinId: string;
}

export interface BinMove {
  warehouseId: string;
  itemId: string;
  batchId: string | null;
  /** Signed quantity in base units (+ in, − out). */
  qty: string;
  /** Bin named on the move; otherwise receiving (in) or dispatch-then-storage (out). */
  binId?: string | null;
  /** Bins to take from first when allocating an issue (e.g. where a reversed receipt was put). */
  prefer?: string[];
  kind: 'posting' | 'reversal' | 'move' | 'putaway' | 'pick' | 'replenish' | 'enable';
  voucherType?: string | null;
  voucherId?: string | null;
  taskId?: string | null;
  label?: string;
}

/** WMS settings of the given warehouses that run with bins. */
export async function wmsConfigs(tx: Transaction, warehouseIds: string[]): Promise<Map<string, WmsConfig>> {
  if (!warehouseIds.length) return new Map();
  const rows = await tx
    .select({ warehouseId: wmsWarehouses.warehouseId, receivingBinId: wmsWarehouses.receivingBinId, dispatchBinId: wmsWarehouses.dispatchBinId })
    .from(wmsWarehouses)
    .where(and(inArray(wmsWarehouses.warehouseId, [...new Set(warehouseIds)]), eq(wmsWarehouses.enabled, true)));
  return new Map(rows.map((r) => [r.warehouseId, { warehouseId: r.warehouseId, receivingBinId: r.receivingBinId!, dispatchBinId: r.dispatchBinId! }]));
}

async function addBinStock(tx: Transaction, tenantId: string, warehouseId: string, binId: string, itemId: string, batchKey: string, qty: string) {
  await tx
    .insert(wmsBinStock)
    .values({ tenantId, warehouseId, binId, itemId, batchKey, qty })
    .onConflictDoUpdate({ target: [wmsBinStock.binId, wmsBinStock.itemId, wmsBinStock.batchKey], set: { qty: sql`${wmsBinStock.qty} + ${qty}`, updatedAt: new Date() } });
}

/**
 * Applies one movement to bin stock and records it. Incoming quantities go to one bin; outgoing
 * quantities may be taken from several. Returns the bins and quantities touched.
 */
export async function applyBinMove(tx: Transaction, tenantId: string, userId: string | null, cfg: WmsConfig, m: BinMove): Promise<{ binId: string; qty: string }[]> {
  const q = Decimal.from(m.qty);
  if (q.isZero()) return [];
  const batchKey = m.batchId ?? NIL_BATCH;
  const label = m.label ?? 'line';
  const record = async (binId: string, qty: string) => {
    await addBinStock(tx, tenantId, m.warehouseId, binId, m.itemId, batchKey, qty);
    await tx.insert(wmsBinLedger).values({ tenantId, warehouseId: m.warehouseId, binId, itemId: m.itemId, batchId: m.batchId, qty, kind: m.kind, voucherType: m.voucherType ?? null, voucherId: m.voucherId ?? null, taskId: m.taskId ?? null, createdBy: userId });
  };

  if (!q.isNegative()) {
    const binId = m.binId ?? cfg.receivingBinId;
    if (m.binId) {
      const [b] = await tx.select({ warehouseId: wmsBins.warehouseId, code: wmsBins.code, isActive: wmsBins.isActive, isBlocked: wmsBins.isBlocked }).from(wmsBins).where(eq(wmsBins.id, m.binId));
      if (!b || b.warehouseId !== m.warehouseId) throw new BadRequestException(`${label}: the bin is not in this warehouse`);
      if (!b.isActive || b.isBlocked) throw new BadRequestException(`${label}: bin ${b.code} is ${b.isActive ? 'blocked' : 'inactive'}`);
    }
    await record(binId, q.toFixed(4));
    return [{ binId, qty: q.toFixed(4) }];
  }

  let need = Decimal.from('0').sub(q);
  const rows = await tx.execute<{ binId: string; qty: string; code: string }>(sql`
    select s.bin_id as "binId", s.qty::text as qty, b.code
    from wms_bin_stock s join wms_bins b on b.id = s.bin_id join wms_zones z on z.id = b.zone_id
    where s.warehouse_id = ${m.warehouseId} and s.item_id = ${m.itemId} and s.batch_key = ${batchKey} and s.qty > 0
      ${m.binId ? sql`and s.bin_id = ${m.binId}` : sql``}
    order by ${m.prefer?.length ? sql`(s.bin_id in ${m.prefer}) desc,` : sql``}
             (s.bin_id = ${cfg.dispatchBinId}) desc,
             (z.kind = 'quarantine' or b.is_blocked) asc, (s.bin_id = ${cfg.receivingBinId}) asc, b.pick_sequence, b.code
    for update of s`);
  const taken: { binId: string; qty: string }[] = [];
  for (const r of rows.rows) {
    if (need.isZero() || need.isNegative()) break;
    const have = Decimal.from(r.qty);
    const take = have.cmp(need) < 0 ? have : need;
    await record(r.binId, Decimal.from('0').sub(take).toFixed(4));
    taken.push({ binId: r.binId, qty: take.toFixed(4) });
    need = need.sub(take);
  }
  if (!need.isZero() && !need.isNegative()) {
    if (m.binId) {
      const [b] = await tx.select({ code: wmsBins.code }).from(wmsBins).where(eq(wmsBins.id, m.binId));
      throw new BadRequestException(`${label}: bin ${b?.code ?? ''} does not hold enough (short by ${need.toFixed(4).replace(/\.?0+$/, '')})`);
    }
    throw new BadRequestException(`${label}: the bins of this warehouse do not hold enough of this item; record the missing stock with a bin count first`);
  }
  return taken;
}

/**
 * Puts the bin side of a voucher back (called when the voucher is cancelled): whatever the voucher
 * still nets per bin is undone, so running it again changes nothing.
 */
export async function reverseBinPostings(tx: Transaction, tenantId: string, userId: string | null, voucherId: string) {
  const nets = (
    await tx.execute<{ warehouseId: string; binId: string; itemId: string; batchId: string | null; voucherType: string | null; qty: string }>(sql`
      select warehouse_id as "warehouseId", bin_id as "binId", item_id as "itemId", batch_id as "batchId", max(voucher_type) as "voucherType", sum(qty)::text as qty
      from wms_bin_ledger where voucher_id = ${voucherId} and kind in ('posting', 'reversal')
      group by warehouse_id, bin_id, item_id, batch_id having sum(qty) <> 0
      order by sum(qty) desc`)
  ).rows;
  if (!nets.length) return;
  const cfgs = await wmsConfigs(tx, nets.map((r) => r.warehouseId));
  for (const r of nets) {
    const cfg = cfgs.get(r.warehouseId);
    if (!cfg) continue;
    const back = Decimal.from('0').sub(Decimal.from(r.qty)).toFixed(4);
    const outgoing = Decimal.from(back).isNegative();
    // An issue goes back to the bin it came from; a receipt is taken out wherever it now is, its own bin first.
    const [bin] = outgoing ? [] : await tx.select({ ok: wmsBins.isActive, blocked: wmsBins.isBlocked }).from(wmsBins).where(eq(wmsBins.id, r.binId));
    await applyBinMove(tx, tenantId, userId, cfg, {
      warehouseId: r.warehouseId,
      itemId: r.itemId,
      batchId: r.batchId,
      qty: back,
      binId: outgoing ? null : bin?.ok && !bin.blocked ? r.binId : cfg.receivingBinId,
      prefer: [r.binId],
      kind: 'reversal',
      voucherType: r.voucherType,
      voucherId,
    });
  }
}
