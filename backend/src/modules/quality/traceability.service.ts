import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  batches,
  creditNotes,
  debitNotes,
  deliveryNotes,
  documents,
  goodsReceipts,
  items,
  jobWorkChallans,
  jobWorkReceipts,
  parties,
  productionEntries,
  salesInvoices,
  stockBalances,
  stockEntries,
  stockLedger,
  uoms,
  warehouses,
  workOrders,
  type Transaction,
} from '@nextgen/database';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { DatabaseService } from '../../database/database.service';

const D = Decimal.from;
const ZERO = D('0');
const MAX_DEPTH = 8;

interface Lot {
  itemId: string;
  batchId: string | null;
  serialNo: string | null;
}
type Row = typeof stockLedger.$inferSelect;

export interface TraceNode {
  item: { id: string; code: string; name: string; uom: string };
  batchNo: string | null;
  serialNo: string | null;
  qty: string;
  /** Backward: where the lot came from. Forward: where it went. */
  links: TraceLink[];
}

export interface TraceLink {
  docType: string;
  docId: string;
  number: string | null;
  date: string;
  qty: string;
  party: string | null;
  workOrder?: { id: string; number: string | null };
  /** Lots consumed (backward) or made (forward) by that work order. */
  lots?: TraceNode[];
}

/**
 * Lot and serial genealogy from the stock ledger. Backward: a lot's origin (receipt from a
 * vendor, or the work order that made it, with every lot that order consumed, recursively).
 * Forward: where a lot went (work orders and what they made, deliveries, invoices, returns,
 * job workers). Transfers (between stores, after inspection) are looked through.
 */
@Injectable()
export class TraceabilityService {
  constructor(private readonly database: DatabaseService) {}

  private async resolve(tx: Transaction, itemId: string, batchNo?: string, serialNo?: string): Promise<Lot> {
    const [it] = await tx.select({ trackBatch: items.trackBatch, trackSerial: items.trackSerial }).from(items).where(eq(items.id, itemId));
    if (!it) throw new NotFoundException('Item not found');
    if (serialNo) return { itemId, batchId: null, serialNo: serialNo.trim().toUpperCase() };
    if (!batchNo) throw new BadRequestException(it.trackSerial ? 'Give the serial number' : it.trackBatch ? 'Give the batch number' : 'This item is not batch or serial tracked; trace it through its work orders');
    const [b] = await tx.select({ id: batches.id }).from(batches).where(and(eq(batches.itemId, itemId), sql`${batches.batchNo} = ${batchNo}`));
    if (!b) throw new NotFoundException(`Batch ${batchNo} not found`);
    return { itemId, batchId: b.id, serialNo: null };
  }

  private lotWhere(l: Lot) {
    return and(
      eq(stockLedger.itemId, l.itemId),
      eq(stockLedger.isReversal, false),
      l.batchId ? eq(stockLedger.batchId, l.batchId) : undefined,
      l.serialNo ? sql`exists (select 1 from unnest(${stockLedger.serialNos}) s where upper(s) = ${l.serialNo})` : undefined,
    );
  }

  /** Vouchers that only move a lot between stores. */
  private async transfers(tx: Transaction, rows: Row[]) {
    const ids = rows.filter((r) => r.voucherType === 'stock_entry').map((r) => r.voucherId);
    const out = new Set(rows.filter((r) => r.voucherType === 'quality_inspection').map((r) => r.voucherId));
    if (ids.length) for (const e of await tx.select({ id: stockEntries.id, purpose: stockEntries.purpose }).from(stockEntries).where(inArray(stockEntries.id, ids))) if (e.purpose === 'transfer') out.add(e.id);
    return out;
  }

  private async party(tx: Transaction, voucherId: string) {
    const res = await tx.execute<{ name: string | null }>(sql`
      select p.name from ${parties} p where p.id = coalesce(
        (select ${deliveryNotes.customerId} from ${deliveryNotes} where ${deliveryNotes.id} = ${voucherId}),
        (select ${salesInvoices.customerId} from ${salesInvoices} where ${salesInvoices.id} = ${voucherId}),
        (select ${creditNotes.customerId} from ${creditNotes} where ${creditNotes.id} = ${voucherId}),
        (select ${goodsReceipts.vendorId} from ${goodsReceipts} where ${goodsReceipts.id} = ${voucherId}),
        (select ${debitNotes.vendorId} from ${debitNotes} where ${debitNotes.id} = ${voucherId}),
        (select ${jobWorkChallans.jobWorkerId} from ${jobWorkChallans} where ${jobWorkChallans.id} = ${voucherId}),
        (select ${jobWorkReceipts.jobWorkerId} from ${jobWorkReceipts} where ${jobWorkReceipts.id} = ${voucherId}))`);
    return res.rows[0]?.name ?? null;
  }

  private async node(tx: Transaction, l: Lot, qty: Decimal, links: TraceLink[]): Promise<TraceNode> {
    const [it] = await tx.select({ id: items.id, code: items.code, name: items.name, uom: uoms.code }).from(items).innerJoin(uoms, eq(uoms.id, items.baseUomId)).where(eq(items.id, l.itemId));
    const batchNo = l.batchId ? ((await tx.select({ n: batches.batchNo }).from(batches).where(eq(batches.id, l.batchId)))[0]?.n ?? null) : null;
    return { item: it, batchNo, serialNo: l.serialNo, qty: qty.toFixed(4), links };
  }

  /** Production entries of a work order with their kinds. */
  private async entries(tx: Transaction, woId: string) {
    return tx.select({ id: productionEntries.id, kind: productionEntries.kind }).from(productionEntries).innerJoin(documents, eq(documents.id, productionEntries.id)).where(and(eq(productionEntries.workOrderId, woId), eq(documents.status, 'approved')));
  }

  /** Lots a work order consumed (net of returns) and made, from its stock movements. */
  async lotsOf(tx: Transaction, woId: string) {
    const [wo] = await tx.select({ itemId: workOrders.itemId }).from(workOrders).where(eq(workOrders.id, woId));
    const es = await this.entries(tx, woId);
    const kind = new Map(es.map((e) => [e.id, e.kind]));
    const rows = es.length ? await tx.select().from(stockLedger).where(and(inArray(stockLedger.voucherId, es.map((e) => e.id)), eq(stockLedger.isReversal, false))) : [];
    const consumed = new Map<string, { lot: Lot; qty: Decimal }>();
    const made = new Map<string, { lot: Lot; qty: Decimal }>();
    const add = (m: typeof consumed, l: Lot, q: Decimal) => {
      const k = `${l.itemId}|${l.batchId ?? ''}|${l.serialNo ?? ''}`;
      m.set(k, { lot: l, qty: (m.get(k)?.qty ?? ZERO).add(q) });
    };
    for (const r of rows) {
      const k = kind.get(r.voucherId);
      const q = D(r.qty);
      const isMaterial = k === 'issue' || k === 'return' || (k === 'receipt' && q.isNegative());
      const target = isMaterial ? consumed : r.itemId === wo.itemId ? made : null;
      if (!target) continue;
      const sign = isMaterial ? ZERO.sub(q) : q;
      if (r.serialNos?.length) for (const s of r.serialNos) add(target, { itemId: r.itemId, batchId: r.batchId, serialNo: s.toUpperCase() }, sign.isNegative() ? D('-1') : D('1'));
      else add(target, { itemId: r.itemId, batchId: r.batchId, serialNo: null }, sign);
    }
    const keep = (m: typeof consumed) => [...m.values()].filter((x) => x.qty.cmp(ZERO) > 0);
    return { consumed: keep(consumed), made: keep(made) };
  }

  private async backwardTx(tx: Transaction, l: Lot, depth: number, seen: Set<string>): Promise<TraceNode> {
    const rows = await tx.select().from(stockLedger).where(and(this.lotWhere(l), sql`${stockLedger.qty} > 0`));
    const skip = await this.transfers(tx, rows);
    const ins = rows.filter((r) => !skip.has(r.voucherId));
    const links: TraceLink[] = [];
    let total = ZERO;
    for (const voucherId of [...new Set(ins.map((r) => r.voucherId))]) {
      const vr = ins.filter((r) => r.voucherId === voucherId);
      const q = vr.reduce((s, r) => s.add(l.serialNo ? D('1') : D(r.qty)), ZERO);
      total = total.add(q);
      const link: TraceLink = { docType: vr[0].voucherType, docId: voucherId, number: vr[0].voucherNumber, date: vr[0].postingDate, qty: q.toFixed(4), party: await this.party(tx, voucherId) };
      if (vr[0].voucherType === 'production_entry') {
        const [e] = await tx.select({ woId: productionEntries.workOrderId, number: documents.number }).from(productionEntries).innerJoin(documents, eq(documents.id, productionEntries.workOrderId)).where(eq(productionEntries.id, voucherId));
        link.workOrder = { id: e.woId, number: e.number };
        if (depth < MAX_DEPTH && !seen.has(e.woId)) {
          const next = new Set([...seen, e.woId]);
          const { consumed } = await this.lotsOf(tx, e.woId);
          link.lots = [];
          for (const c of consumed) {
            if (c.lot.batchId || c.lot.serialNo) link.lots.push(await this.backwardTx(tx, c.lot, depth + 1, next).then((n) => ({ ...n, qty: c.qty.toFixed(4) })));
            else link.lots.push(await this.node(tx, c.lot, c.qty, []));
          }
        }
      }
      links.push(link);
    }
    return this.node(tx, l, total, links);
  }

  private async forwardTx(tx: Transaction, l: Lot, depth: number, seen: Set<string>): Promise<TraceNode & { onHand: { warehouse: string; qty: string }[] }> {
    const rows = await tx.select().from(stockLedger).where(and(this.lotWhere(l), sql`${stockLedger.qty} < 0`));
    const skip = await this.transfers(tx, rows);
    const outs = rows.filter((r) => !skip.has(r.voucherId));
    const links: TraceLink[] = [];
    for (const voucherId of [...new Set(outs.map((r) => r.voucherId))]) {
      const vr = outs.filter((r) => r.voucherId === voucherId);
      const q = vr.reduce((s, r) => s.add(l.serialNo ? D('1') : ZERO.sub(D(r.qty))), ZERO);
      const link: TraceLink = { docType: vr[0].voucherType, docId: voucherId, number: vr[0].voucherNumber, date: vr[0].postingDate, qty: q.toFixed(4), party: await this.party(tx, voucherId) };
      if (vr[0].voucherType === 'production_entry') {
        const [e] = await tx.select({ woId: productionEntries.workOrderId, number: documents.number }).from(productionEntries).innerJoin(documents, eq(documents.id, productionEntries.workOrderId)).where(eq(productionEntries.id, voucherId));
        // Several entries of one order: link the order once.
        if (links.some((x) => x.workOrder?.id === e.woId)) {
          const prev = links.find((x) => x.workOrder?.id === e.woId)!;
          prev.qty = D(prev.qty).add(q).toFixed(4);
          continue;
        }
        link.workOrder = { id: e.woId, number: e.number };
        if (depth < MAX_DEPTH && !seen.has(e.woId)) {
          const next = new Set([...seen, e.woId]);
          const { made } = await this.lotsOf(tx, e.woId);
          link.lots = [];
          for (const m of made) {
            if (m.lot.batchId || m.lot.serialNo) link.lots.push(await this.forwardTx(tx, m.lot, depth + 1, next).then((n) => ({ ...n, qty: m.qty.toFixed(4) })));
            else link.lots.push(await this.node(tx, m.lot, m.qty, []));
          }
        }
      }
      links.push(link);
    }
    const onHand = await this.onHand(tx, l);
    const total = await tx.select({ q: sql<string>`coalesce(sum(${stockLedger.qty}) filter (where ${stockLedger.qty} > 0), 0)::text` }).from(stockLedger).where(this.lotWhere(l));
    return { ...(await this.node(tx, l, l.serialNo ? D('1') : D(total[0].q), links)), onHand };
  }

  private async onHand(tx: Transaction, l: Lot) {
    if (l.serialNo) {
      const res = await tx.execute<{ code: string }>(sql`select w.code from serial_numbers s join ${warehouses} w on w.id = s.warehouse_id where s.item_id = ${l.itemId} and upper(s.serial_no) = ${l.serialNo} and s.status = 'in_stock'`);
      return res.rows.map((r) => ({ warehouse: r.code, qty: '1.0000' }));
    }
    const rows = await tx
      .select({ warehouse: warehouses.code, qty: stockBalances.qty })
      .from(stockBalances)
      .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
      .where(and(eq(stockBalances.itemId, l.itemId), eq(stockBalances.batchKey, l.batchId!), sql`${stockBalances.qty} > 0`));
    return rows;
  }

  backward(auth: AuthContext, q: { itemId: string; batchNo?: string; serialNo?: string }) {
    return this.database.run(auth, async (tx) => this.backwardTx(tx, await this.resolve(tx, q.itemId, q.batchNo, q.serialNo), 0, new Set()));
  }

  forward(auth: AuthContext, q: { itemId: string; batchNo?: string; serialNo?: string }) {
    return this.database.run(auth, async (tx) => this.forwardTx(tx, await this.resolve(tx, q.itemId, q.batchNo, q.serialNo), 0, new Set()));
  }

  /** As-built record of a work order: the lots and serials that went in and came out. */
  asBuilt(auth: AuthContext, woId: string) {
    return this.database.run(auth, async (tx) => {
      const [wo] = await tx.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.id, woId));
      if (!wo) throw new NotFoundException('Work order not found');
      const { consumed, made } = await this.lotsOf(tx, woId);
      const nodes = async (xs: typeof consumed) => Promise.all(xs.map((x) => this.node(tx, x.lot, x.qty, [])));
      const sort = (a: TraceNode, b: TraceNode) => a.item.code.localeCompare(b.item.code) || (a.batchNo ?? a.serialNo ?? '').localeCompare(b.batchNo ?? b.serialNo ?? '');
      return { consumed: (await nodes(consumed)).sort(sort), made: (await nodes(made)).sort(sort) };
    });
  }
}
