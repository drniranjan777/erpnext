import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  batches,
  items,
  serialNumbers,
  stockBalances,
  stockLedger,
  stockValuation,
  type Transaction,
  uoms,
  warehouses,
} from '@nextgen/database';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { issue, receive, revalue, reverse, type Method, type Pool } from './valuation';

export const NO_BATCH = '00000000-0000-0000-0000-000000000000';

/** Vouchers that may move a lot still in quarantine or under test: counts, the inspection itself, returns to the vendor (plus moves marked allowHeld). */
const MOVES_HELD_LOTS = new Set(['stock_count', 'quality_inspection', 'debit_note']);
/** Vouchers that may not take a rejected lot (rework orders may). */
const REJECTED_BLOCKED = new Set(['delivery_note', 'sales_invoice', 'job_work_challan', 'blend']);

/** Why a lot with this QC status cannot leave on this voucher, or null. */
export function qcHold(status: string, voucherType: string, allowHeld = false) {
  if ((status === 'quarantine' || status === 'under_test') && !allowHeld && !MOVES_HELD_LOTS.has(voucherType)) return status === 'quarantine' ? 'in quarantine awaiting QC release' : 'under test and not released by QC';
  if (status === 'rejected' && REJECTED_BLOCKED.has(voucherType)) return 'rejected by QC';
  return null;
}

export interface StockMove {
  itemId: string;
  warehouseId: string;
  /** Signed quantity in the item's base unit (+ in, − out). */
  qty: string;
  /** Incoming rate per base unit. If omitted for an incoming move, the current valuation rate is used. */
  rate?: string | null;
  batchNo?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  serialNos?: string[] | null;
  /** Line number for error messages. */
  line?: number;
  /** Expired batches may only leave via write-offs (adjustments, moves to scrap / rejected). */
  allowExpired?: boolean;
  /** Lots on QC hold may move between stores (transfers, adjustments) but not be issued or sold. */
  allowHeld?: boolean;
}

export interface Voucher {
  id: string;
  type: string;
  number: string | null;
  companyId: string;
  postingDate: string;
}

export interface PostedMove {
  itemId: string;
  warehouseId: string;
  qty: string;
  rate: string;
  value: string;
}

class StockError extends BadRequestException {
  constructor(errors: { path: string; message: string }[]) {
    super({ message: errors[0]?.message ?? 'Stock posting failed', errors });
  }
}

/**
 * The only code that changes stock. Every movement:
 *  1. locks the item+warehouse valuation pool (sorted lock order → no deadlocks),
 *  2. enforces batch / serial / expiry / availability rules,
 *  3. values the movement (weighted average or FIFO),
 *  4. appends an immutable stock_ledger row with the running position.
 * Runs inside the caller's document transaction: all or nothing.
 */
@Injectable()
export class StockService {
  async post(tx: Transaction, auth: AuthContext, voucher: Voucher, moves: StockMove[]): Promise<PostedMove[]> {
    if (!moves.length) return [];
    const itemIds = [...new Set(moves.map((m) => m.itemId))];
    const whIds = [...new Set(moves.map((m) => m.warehouseId))];
    const itemRows = await tx
      .select({
        id: items.id,
        code: items.code,
        isStockItem: items.isStockItem,
        trackBatch: items.trackBatch,
        trackSerial: items.trackSerial,
        hasExpiry: items.hasExpiry,
        shelfLifeDays: items.shelfLifeDays,
        valuationMethod: items.valuationMethod,
        standardCost: items.standardCost,
        decimals: uoms.decimals,
      })
      .from(items)
      .innerJoin(uoms, eq(uoms.id, items.baseUomId))
      .where(inArray(items.id, itemIds));
    const itemMap = new Map(itemRows.map((i) => [i.id, i]));
    const whRows = await tx.select().from(warehouses).where(inArray(warehouses.id, whIds));
    const whMap = new Map(whRows.map((w) => [w.id, w]));

    const errors: { path: string; message: string }[] = [];
    for (const m of moves) {
      const it = itemMap.get(m.itemId);
      const wh = whMap.get(m.warehouseId);
      const p = `lines.${(m.line ?? 1) - 1}`;
      if (!it) errors.push({ path: `${p}.itemId`, message: 'Unknown item' });
      else if (!it.isStockItem) errors.push({ path: `${p}.itemId`, message: `${it.code} is not a stock item` });
      if (!wh) errors.push({ path: `${p}.warehouseId`, message: 'Unknown warehouse' });
      else if (!wh.isActive) errors.push({ path: `${p}.warehouseId`, message: `Warehouse ${wh.code} is inactive` });
      if (it && Decimal.from(m.qty).isZero()) errors.push({ path: `${p}.qty`, message: 'Quantity cannot be zero' });
      if (it && it.decimals === 0 && !/^-?\d+(\.0+)?$/.test(m.qty)) errors.push({ path: `${p}.qty`, message: `${it.code} is counted in whole units` });
      if (it?.trackBatch && !m.batchNo) errors.push({ path: `${p}.batchNo`, message: `${it.code} needs a batch number` });
      if (it && !it.trackBatch && m.batchNo) errors.push({ path: `${p}.batchNo`, message: `${it.code} does not track batches` });
      if (it?.trackSerial) {
        const n = Math.abs(Number(m.qty));
        if ((m.serialNos?.length ?? 0) !== n) errors.push({ path: `${p}.serialNos`, message: `${it.code}: enter exactly ${n} serial number(s)` });
        else if (new Set(m.serialNos!.map((s) => s.toUpperCase())).size !== n) errors.push({ path: `${p}.serialNos`, message: 'Duplicate serial numbers' });
      }
    }
    if (errors.length) throw new StockError(errors);

    await this.lockPools(tx, auth.tenantId, moves);
    const posted: PostedMove[] = [];
    for (const m of moves) {
      const it = itemMap.get(m.itemId)!;
      const wh = whMap.get(m.warehouseId)!;
      const p = `lines.${(m.line ?? 1) - 1}`;
      const incoming = !Decimal.from(m.qty).isNegative();
      const absQty = incoming ? m.qty : Decimal.from('0').sub(Decimal.from(m.qty)).toFixed(4);

      // ---- batch ----
      let batchId: string | null = null;
      if (it.trackBatch) {
        batchId = incoming ? await this.receiveBatch(tx, auth, it, m, p) : await this.findBatch(tx, it, m, p, voucher.postingDate, voucher.type);
      }

      // ---- availability (per batch bucket) ----
      const bucket = batchId ?? NO_BATCH;
      if (!incoming && !wh.allowNegativeStock) {
        const [bal] = await tx
          .select({ qty: stockBalances.qty })
          .from(stockBalances)
          .where(and(eq(stockBalances.itemId, m.itemId), eq(stockBalances.warehouseId, m.warehouseId), eq(stockBalances.batchKey, bucket)));
        const available = Decimal.from(bal?.qty ?? '0');
        if (available.cmp(Decimal.from(absQty)) < 0) {
          throw new StockError([
            {
              path: `${p}.qty`,
              message: `Not enough stock of ${it.code} in ${wh.code}${m.batchNo ? ` (batch ${m.batchNo})` : ''}: available ${available.toFixed(it.decimals)}, required ${Decimal.from(absQty).toFixed(it.decimals)}`,
            },
          ]);
        }
      }

      // ---- serials ----
      if (it.trackSerial) await this.moveSerials(tx, auth, it, m, incoming, voucher, p);

      // ---- valuation ----
      const [poolRow] = await tx
        .select()
        .from(stockValuation)
        .where(and(eq(stockValuation.itemId, m.itemId), eq(stockValuation.warehouseId, m.warehouseId)));
      const pool: Pool = { qty: poolRow.qty, value: poolRow.value, layers: poolRow.layers };
      const method = it.valuationMethod as Method;
      let rate = m.rate ?? null;
      if (incoming && rate === null) {
        const current = Decimal.from(pool.qty).isZero() ? null : Decimal.from(pool.value).div(Decimal.from(pool.qty)).toFixed(6);
        rate = current ?? it.standardCost ?? '0';
      }
      const result = incoming ? receive(pool, method, absQty, rate!) : issue(pool, method, absQty);
      await tx
        .update(stockValuation)
        .set({ qty: result.pool.qty, value: result.pool.value, layers: result.pool.layers, updatedAt: new Date() })
        .where(and(eq(stockValuation.itemId, m.itemId), eq(stockValuation.warehouseId, m.warehouseId)));
      await this.addBalance(tx, auth.tenantId, m.itemId, m.warehouseId, bucket, m.qty);

      await tx.insert(stockLedger).values({
        tenantId: auth.tenantId,
        companyId: voucher.companyId,
        postingDate: voucher.postingDate,
        itemId: m.itemId,
        warehouseId: m.warehouseId,
        batchId,
        serialNos: m.serialNos?.map((s) => s.toUpperCase()) ?? null,
        qty: Decimal.from(m.qty).toFixed(4),
        rate: result.rate,
        value: result.value,
        balanceQty: result.pool.qty,
        balanceValue: result.pool.value,
        valuationRate: result.valuationRate,
        voucherType: voucher.type,
        voucherId: voucher.id,
        voucherNumber: voucher.number,
        createdBy: auth.userId,
      });
      posted.push({ itemId: m.itemId, warehouseId: m.warehouseId, qty: Decimal.from(m.qty).toFixed(4), rate: result.rate, value: result.value });
    }
    return posted;
  }

  /** Cancels everything a voucher posted, at the original values. */
  async reverseVoucher(tx: Transaction, auth: AuthContext, voucher: Voucher) {
    const rows = await tx
      .select()
      .from(stockLedger)
      .where(and(eq(stockLedger.voucherId, voucher.id), eq(stockLedger.isReversal, false)))
      .orderBy(desc(stockLedger.id));
    if (!rows.length) return;
    await this.lockPools(tx, auth.tenantId, rows.map((r) => ({ itemId: r.itemId, warehouseId: r.warehouseId, qty: r.qty })));
    const methods = new Map(
      (await tx.select({ id: items.id, method: items.valuationMethod, code: items.code }).from(items).where(inArray(items.id, [...new Set(rows.map((r) => r.itemId))]))).map((i) => [i.id, i]),
    );
    const whs = new Map((await tx.select().from(warehouses).where(inArray(warehouses.id, [...new Set(rows.map((r) => r.warehouseId))]))).map((w) => [w.id, w]));

    for (const r of rows) {
      const item = methods.get(r.itemId)!;
      const wh = whs.get(r.warehouseId)!;
      const bucket = r.batchId ?? NO_BATCH;
      // Value-only rows (landed cost, price difference) have no quantity to check.
      const valueOnly = Decimal.from(r.qty).isZero();
      if (!valueOnly && !Decimal.from(r.qty).isNegative() && !wh.allowNegativeStock) {
        const [bal] = await tx
          .select({ qty: stockBalances.qty })
          .from(stockBalances)
          .where(and(eq(stockBalances.itemId, r.itemId), eq(stockBalances.warehouseId, r.warehouseId), eq(stockBalances.batchKey, bucket)));
        if (Decimal.from(bal?.qty ?? '0').cmp(Decimal.from(r.qty)) < 0) {
          throw new ConflictException(`Can't cancel: ${item.code} received by this entry has already been issued from ${wh.code}. Cancel the later movements first.`);
        }
      }
      const [poolRow] = await tx.select().from(stockValuation).where(and(eq(stockValuation.itemId, r.itemId), eq(stockValuation.warehouseId, r.warehouseId)));
      const pool = { qty: poolRow.qty, value: poolRow.value, layers: poolRow.layers };
      const result = valueOnly
        ? revalue(pool, item.method as Method, Decimal.from('0').sub(Decimal.from(r.value)).toFixed(2))
        : reverse(pool, item.method as Method, r.qty, r.value);
      await tx
        .update(stockValuation)
        .set({ qty: result.pool.qty, value: result.pool.value, layers: result.pool.layers, updatedAt: new Date() })
        .where(and(eq(stockValuation.itemId, r.itemId), eq(stockValuation.warehouseId, r.warehouseId)));
      await this.addBalance(tx, auth.tenantId, r.itemId, r.warehouseId, bucket, Decimal.from('0').sub(Decimal.from(r.qty)).toFixed(4));

      if (r.serialNos?.length) {
        if (Decimal.from(r.qty).isNegative()) {
          await tx
            .update(serialNumbers)
            .set({ status: 'in_stock', warehouseId: r.warehouseId, lastVoucherId: voucher.id, updatedAt: new Date() })
            .where(and(eq(serialNumbers.itemId, r.itemId), inArray(serialNumbers.serialNo, r.serialNos)));
        } else {
          await tx
            .update(serialNumbers)
            .set({ status: 'scrapped', warehouseId: null, lastVoucherId: voucher.id, updatedAt: new Date() })
            .where(and(eq(serialNumbers.itemId, r.itemId), inArray(serialNumbers.serialNo, r.serialNos)));
        }
      }

      await tx.insert(stockLedger).values({
        tenantId: auth.tenantId,
        companyId: r.companyId,
        postingDate: voucher.postingDate,
        itemId: r.itemId,
        warehouseId: r.warehouseId,
        batchId: r.batchId,
        serialNos: r.serialNos,
        qty: Decimal.from('0').sub(Decimal.from(r.qty)).toFixed(4),
        rate: result.rate,
        value: result.value,
        balanceQty: result.pool.qty,
        balanceValue: result.pool.value,
        valuationRate: result.valuationRate,
        voucherType: r.voucherType,
        voucherId: r.voucherId,
        voucherNumber: r.voucherNumber,
        isReversal: true,
        createdBy: auth.userId,
      });
    }
  }

  /**
   * Adds (or removes) value without moving quantity: landed cost, purchase price differences,
   * GST that can't be claimed back. Only the share still in stock is absorbed:
   * value × min(1, on hand ÷ quantity it relates to). The rest is returned as unabsorbed
   * (it goes to the cost of goods already consumed; accounting takes it in Phase 4).
   */
  async revalue(
    tx: Transaction,
    auth: AuthContext,
    voucher: Voucher,
    adjustments: { itemId: string; warehouseId: string; value: string; basisQty?: string | null; batchNo?: string | null }[],
  ): Promise<{ absorbed: string; unabsorbed: string }[]> {
    const moves = adjustments.filter((a) => !Decimal.from(a.value).isZero());
    if (!moves.length) return adjustments.map(() => ({ absorbed: '0.00', unabsorbed: '0.00' }));
    await this.lockPools(tx, auth.tenantId, moves);
    const methods = new Map(
      (await tx.select({ id: items.id, method: items.valuationMethod }).from(items).where(inArray(items.id, [...new Set(moves.map((m) => m.itemId))]))).map((i) => [i.id, i.method]),
    );
    const out: { absorbed: string; unabsorbed: string }[] = [];
    for (const a of adjustments) {
      const value = Decimal.from(a.value);
      if (value.isZero()) {
        out.push({ absorbed: '0.00', unabsorbed: '0.00' });
        continue;
      }
      const [poolRow] = await tx.select().from(stockValuation).where(and(eq(stockValuation.itemId, a.itemId), eq(stockValuation.warehouseId, a.warehouseId)));
      const onHand = Decimal.from(poolRow.qty);
      let share = value;
      if (!onHand.isNegative() && !onHand.isZero() && a.basisQty && Decimal.from(a.basisQty).cmp(onHand) > 0) {
        share = value.mul(onHand).div(Decimal.from(a.basisQty));
      }
      if (onHand.isZero() || onHand.isNegative()) share = Decimal.from('0');
      const result = revalue({ qty: poolRow.qty, value: poolRow.value, layers: poolRow.layers }, (methods.get(a.itemId) ?? 'weighted_average') as Method, share.toFixed(2));
      const absorbed = Decimal.from(result.value);
      out.push({ absorbed: absorbed.toFixed(2), unabsorbed: value.sub(absorbed).toFixed(2) });
      if (absorbed.isZero()) continue;
      await tx
        .update(stockValuation)
        .set({ value: result.pool.value, layers: result.pool.layers, updatedAt: new Date() })
        .where(and(eq(stockValuation.itemId, a.itemId), eq(stockValuation.warehouseId, a.warehouseId)));
      await tx.insert(stockLedger).values({
        tenantId: auth.tenantId,
        companyId: voucher.companyId,
        postingDate: voucher.postingDate,
        itemId: a.itemId,
        warehouseId: a.warehouseId,
        batchId: null,
        serialNos: null,
        qty: '0.0000',
        rate: '0',
        value: absorbed.toFixed(2),
        balanceQty: result.pool.qty,
        balanceValue: result.pool.value,
        valuationRate: result.valuationRate,
        voucherType: voucher.type,
        voucherId: voucher.id,
        voucherNumber: voucher.number,
        createdBy: auth.userId,
      });
    }
    return out;
  }

  /** Current valuation rate per base unit (for pricing issues / previews). */
  async valuationRate(tx: Transaction, itemId: string, warehouseId: string): Promise<string | null> {
    const [row] = await tx.select().from(stockValuation).where(and(eq(stockValuation.itemId, itemId), eq(stockValuation.warehouseId, warehouseId)));
    if (!row || Decimal.from(row.qty).isZero()) return null;
    return Decimal.from(row.value).div(Decimal.from(row.qty)).toFixed(6);
  }

  // ---- helpers ------------------------------------------------------------------

  private async lockPools(tx: Transaction, tenantId: string, moves: Pick<StockMove, 'itemId' | 'warehouseId'>[]) {
    const keys = [...new Map(moves.map((m) => [`${m.itemId}:${m.warehouseId}`, m])).values()].sort((a, b) =>
      `${a.itemId}:${a.warehouseId}`.localeCompare(`${b.itemId}:${b.warehouseId}`),
    );
    for (const k of keys) {
      await tx.insert(stockValuation).values({ tenantId, itemId: k.itemId, warehouseId: k.warehouseId }).onConflictDoNothing();
      await tx
        .select({ q: stockValuation.qty })
        .from(stockValuation)
        .where(and(eq(stockValuation.itemId, k.itemId), eq(stockValuation.warehouseId, k.warehouseId)))
        .for('update');
    }
  }

  private async addBalance(tx: Transaction, tenantId: string, itemId: string, warehouseId: string, batchKey: string, qty: string) {
    await tx
      .insert(stockBalances)
      .values({ tenantId, itemId, warehouseId, batchKey, qty })
      .onConflictDoUpdate({
        target: [stockBalances.itemId, stockBalances.warehouseId, stockBalances.batchKey],
        set: { qty: sql`${stockBalances.qty} + ${qty}::numeric`, updatedAt: new Date() },
      });
  }

  private async receiveBatch(
    tx: Transaction,
    auth: AuthContext,
    it: { id: string; code: string; hasExpiry: boolean; shelfLifeDays: number | null },
    m: StockMove,
    p: string,
  ): Promise<string> {
    const [existing] = await tx.select().from(batches).where(and(eq(batches.itemId, it.id), sql`${batches.batchNo} = ${m.batchNo}`));
    if (existing) {
      if (m.expiryDate && existing.expiryDate && m.expiryDate !== existing.expiryDate) {
        throw new StockError([{ path: `${p}.expiryDate`, message: `Batch ${m.batchNo} already exists with expiry ${existing.expiryDate}` }]);
      }
      return existing.id;
    }
    let expiry = m.expiryDate ?? null;
    if (it.hasExpiry && !expiry) {
      if (m.mfgDate && it.shelfLifeDays) {
        const d = new Date(`${m.mfgDate}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + it.shelfLifeDays);
        expiry = d.toISOString().slice(0, 10);
      } else {
        throw new StockError([{ path: `${p}.expiryDate`, message: `${it.code} needs an expiry date (or a manufacturing date to calculate it)` }]);
      }
    }
    if (m.mfgDate && expiry && expiry <= m.mfgDate) throw new StockError([{ path: `${p}.expiryDate`, message: 'Expiry must be after the manufacturing date' }]);
    const [row] = await tx
      .insert(batches)
      .values({ tenantId: auth.tenantId, itemId: it.id, batchNo: m.batchNo!.trim().toUpperCase(), mfgDate: m.mfgDate ?? null, expiryDate: expiry })
      .returning({ id: batches.id });
    return row.id;
  }

  private async findBatch(tx: Transaction, it: { id: string; code: string }, m: StockMove, p: string, postingDate: string, voucherType: string): Promise<string> {
    const [b] = await tx.select().from(batches).where(and(eq(batches.itemId, it.id), sql`${batches.batchNo} = ${m.batchNo}`));
    if (!b) throw new StockError([{ path: `${p}.batchNo`, message: `Batch ${m.batchNo} of ${it.code} not found` }]);
    const hold = qcHold(b.qcStatus, voucherType, m.allowHeld);
    if (hold) throw new StockError([{ path: `${p}.batchNo`, message: `Batch ${m.batchNo} of ${it.code} is ${hold}` }]);
    if (b.expiryDate && b.expiryDate < postingDate && !m.allowExpired) {
      throw new StockError([{ path: `${p}.batchNo`, message: `Batch ${m.batchNo} expired on ${b.expiryDate}. Write it off or move it to a scrap / rejected location.` }]);
    }
    return b.id;
  }

  private async moveSerials(tx: Transaction, auth: AuthContext, it: { id: string; code: string }, m: StockMove, incoming: boolean, voucher: Voucher, p: string) {
    const serials = m.serialNos!.map((s) => s.trim().toUpperCase());
    const existing = await tx.select().from(serialNumbers).where(and(eq(serialNumbers.itemId, it.id), inArray(serialNumbers.serialNo, serials)));
    if (incoming) {
      const clash = existing.filter((s) => s.status === 'in_stock');
      if (clash.length) throw new StockError([{ path: `${p}.serialNos`, message: `Serial ${clash[0].serialNo} of ${it.code} is already in stock` }]);
      for (const s of serials) {
        await tx
          .insert(serialNumbers)
          .values({ tenantId: auth.tenantId, itemId: it.id, serialNo: s, status: 'in_stock', warehouseId: m.warehouseId, lastVoucherId: voucher.id })
          .onConflictDoUpdate({
            target: [serialNumbers.tenantId, serialNumbers.itemId, serialNumbers.serialNo],
            set: { status: 'in_stock', warehouseId: m.warehouseId, lastVoucherId: voucher.id, updatedAt: new Date() },
          });
      }
    } else {
      const missing = serials.filter((s) => !existing.some((e) => e.serialNo.toUpperCase() === s && e.status === 'in_stock' && e.warehouseId === m.warehouseId));
      if (missing.length) throw new StockError([{ path: `${p}.serialNos`, message: `Serial ${missing[0]} of ${it.code} is not in stock at this warehouse` }]);
      await tx
        .update(serialNumbers)
        .set({ status: 'consumed', warehouseId: null, lastVoucherId: voucher.id, updatedAt: new Date() })
        .where(and(eq(serialNumbers.itemId, it.id), inArray(serialNumbers.serialNo, serials)));
    }
  }

  /** Batches with stock in a warehouse, earliest expiry first (FEFO suggestion). */
  async availableBatches(tx: Transaction, itemId: string, warehouseId: string) {
    return tx
      .select({ batchId: batches.id, batchNo: batches.batchNo, expiryDate: batches.expiryDate, mfgDate: batches.mfgDate, qty: stockBalances.qty })
      .from(stockBalances)
      .innerJoin(batches, eq(batches.id, stockBalances.batchKey))
      .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.warehouseId, warehouseId), sql`${stockBalances.qty} > 0`))
      .orderBy(sql`${batches.expiryDate} nulls last`, asc(batches.createdAt));
  }
}
