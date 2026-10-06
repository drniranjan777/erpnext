import { BadRequestException, Injectable } from '@nestjs/common';
import { documents, goodsReceiptLines, goodsReceipts, items, itemVendors, parties, purchaseInvoices, purchaseOrderLines, purchaseOrders, type Transaction } from '@nextgen/database';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import type { ItemVendorsInput } from './rfqs.schemas';

export interface VendorScore {
  vendorId: string;
  orders: number;
  orderValue: string;
  receipts: number;
  /** Accepted ÷ received over GRN lines, %. Null without receipts. */
  acceptancePct: number | null;
  /** GRNs on or before the order's expected date, %. Null when no expected dates. */
  onTimePct: number | null;
  avgDelayDays: number | null;
  /** Billed above the order rate, ₹ (positive = vendor charged more). */
  rateVariance: string;
  /** 0–100: 60% quality, 40% delivery (only what is known). */
  score: number | null;
}

/** Vendor scorecards from what actually happened: POs, GRNs (quality, timeliness) and bills. */
@Injectable()
export class VendorPerformanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  report(auth: AuthContext, q: { from?: string; to?: string; vendorId?: string }) {
    return this.database.run(auth, async (tx) => {
      const scores = await this.scores(tx, q.vendorId ? [q.vendorId] : undefined, q.from, q.to);
      const names = scores.length ? await tx.select({ id: parties.id, code: parties.code, name: parties.name, msmeCategory: parties.msmeCategory }).from(parties).where(inArray(parties.id, scores.map((s) => s.vendorId))) : [];
      return scores
        .map((s) => ({ ...s, vendor: names.find((n) => n.id === s.vendorId)! }))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || Number(b.orderValue) - Number(a.orderValue));
    });
  }

  async scores(tx: Transaction, vendorIds?: string[], from?: string, to?: string): Promise<VendorScore[]> {
    const inRange = (col: typeof documents.docDate) => and(from ? gte(col, from) : undefined, to ? lte(col, to) : undefined);
    const orders = await tx
      .select({ vendorId: purchaseOrders.vendorId, n: sql<number>`count(*)::int`, value: sql<string>`coalesce(sum(${purchaseOrders.grandTotal}), 0)::numeric(18,2)::text` })
      .from(purchaseOrders)
      .innerJoin(documents, eq(documents.id, purchaseOrders.id))
      .where(and(inArray(documents.status, ['approved', 'completed']), vendorIds ? inArray(purchaseOrders.vendorId, vendorIds) : undefined, inRange(documents.docDate)))
      .groupBy(purchaseOrders.vendorId);
    // Each GRN: received vs accepted, and its date against the PO's expected date.
    const receipts = await tx
      .select({
        vendorId: goodsReceipts.vendorId,
        n: sql<number>`count(distinct ${goodsReceipts.id})::int`,
        received: sql<string>`coalesce(sum(${goodsReceiptLines.receivedQty} * ${goodsReceiptLines.conversionFactor}), 0)::text`,
        accepted: sql<string>`coalesce(sum(${goodsReceiptLines.acceptedBaseQty}), 0)::text`,
        timed: sql<number>`count(distinct ${goodsReceipts.id}) filter (where ${purchaseOrders.expectedDate} is not null)::int`,
        onTime: sql<number>`count(distinct ${goodsReceipts.id}) filter (where ${purchaseOrders.expectedDate} is not null and ${documents.docDate} <= ${purchaseOrders.expectedDate})::int`,
        delay: sql<string | null>`avg(greatest(${documents.docDate} - ${purchaseOrders.expectedDate}, 0)) filter (where ${purchaseOrders.expectedDate} is not null)::numeric(10,1)::text`,
      })
      .from(goodsReceipts)
      .innerJoin(documents, eq(documents.id, goodsReceipts.id))
      .innerJoin(goodsReceiptLines, eq(goodsReceiptLines.grnId, goodsReceipts.id))
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
      .where(and(eq(documents.status, 'approved'), vendorIds ? inArray(goodsReceipts.vendorId, vendorIds) : undefined, inRange(documents.docDate)))
      .groupBy(goodsReceipts.vendorId);
    const bills = await tx
      .select({ vendorId: purchaseInvoices.vendorId, variance: sql<string>`coalesce(sum(${purchaseInvoices.rateVariance}), 0)::numeric(18,2)::text` })
      .from(purchaseInvoices)
      .innerJoin(documents, eq(documents.id, purchaseInvoices.id))
      .where(and(eq(documents.status, 'approved'), vendorIds ? inArray(purchaseInvoices.vendorId, vendorIds) : undefined, inRange(documents.docDate)))
      .groupBy(purchaseInvoices.vendorId);

    const ids = new Set([...orders.map((o) => o.vendorId), ...receipts.map((r) => r.vendorId), ...(vendorIds ?? [])]);
    return [...ids].map((vendorId) => {
      const o = orders.find((x) => x.vendorId === vendorId);
      const r = receipts.find((x) => x.vendorId === vendorId);
      const received = Number(r?.received ?? 0);
      const acceptancePct = received > 0 ? Math.round((Number(r!.accepted) / received) * 1000) / 10 : null;
      const onTimePct = r && r.timed > 0 ? Math.round((r.onTime / r.timed) * 1000) / 10 : null;
      const parts = [acceptancePct !== null ? { w: 0.6, v: acceptancePct } : null, onTimePct !== null ? { w: 0.4, v: onTimePct } : null].filter((p): p is { w: number; v: number } => !!p);
      const weight = parts.reduce((s, p) => s + p.w, 0);
      return {
        vendorId,
        orders: o?.n ?? 0,
        orderValue: o?.value ?? '0.00',
        receipts: r?.n ?? 0,
        acceptancePct,
        onTimePct,
        avgDelayDays: r?.delay ? Number(r.delay) : null,
        rateVariance: bills.find((b) => b.vendorId === vendorId)?.variance ?? '0.00',
        score: weight ? Math.round(parts.reduce((s, p) => s + p.w * p.v, 0) / weight) : null,
      };
    });
  }

  // ---- Approved vendor list --------------------------------------------------------

  itemVendors(auth: AuthContext, itemId: string) {
    return this.database.run(auth, (tx) =>
      tx
        .select({
          vendorId: itemVendors.vendorId,
          vendorCode: parties.code,
          vendorName: parties.name,
          isApproved: itemVendors.isApproved,
          isPreferred: itemVendors.isPreferred,
          vendorItemCode: itemVendors.vendorItemCode,
          leadTimeDays: itemVendors.leadTimeDays,
          minOrderQty: itemVendors.minOrderQty,
          lastRate: itemVendors.lastRate,
          lastOrderedAt: itemVendors.lastOrderedAt,
          notes: itemVendors.notes,
        })
        .from(itemVendors)
        .innerJoin(parties, eq(parties.id, itemVendors.vendorId))
        .where(eq(itemVendors.itemId, itemId))
        .orderBy(sql`${itemVendors.isPreferred} desc`, asc(parties.name)),
    );
  }

  /** Replaces the vendor list of an item, keeping last-rate history for vendors that stay. */
  saveItemVendors(auth: AuthContext, itemId: string, input: ItemVendorsInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [item] = await tx.select({ id: items.id, code: items.code }).from(items).where(and(eq(items.id, itemId), isNull(items.deletedAt)));
      if (!item) throw new BadRequestException('Item not found');
      const ids = input.vendors.map((v) => v.vendorId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException({ message: 'A vendor is listed twice', errors: [{ path: 'vendors', message: 'A vendor is listed twice' }] });
      if (input.vendors.filter((v) => v.isPreferred).length > 1) throw new BadRequestException({ message: 'Only one preferred vendor', errors: [{ path: 'vendors', message: 'Only one vendor can be preferred' }] });
      const found = ids.length ? await tx.select({ id: parties.id, isVendor: parties.isVendor, name: parties.name }).from(parties).where(inArray(parties.id, ids)) : [];
      const notVendor = found.find((f) => !f.isVendor);
      if (found.length !== ids.length || notVendor) throw new BadRequestException(notVendor ? `${notVendor.name} is not a vendor` : 'Unknown vendor');
      const existing = await tx.select().from(itemVendors).where(eq(itemVendors.itemId, itemId));
      const removed = existing.filter((e) => !ids.includes(e.vendorId)).map((e) => e.id);
      if (removed.length) await tx.delete(itemVendors).where(inArray(itemVendors.id, removed));
      for (const v of input.vendors) {
        const values = { isApproved: v.isApproved, isPreferred: v.isPreferred, vendorItemCode: v.vendorItemCode, leadTimeDays: v.leadTimeDays ?? null, minOrderQty: v.minOrderQty, notes: v.notes };
        await tx
          .insert(itemVendors)
          .values({ tenantId: auth.tenantId, itemId, vendorId: v.vendorId, ...values })
          .onConflictDoUpdate({ target: [itemVendors.tenantId, itemVendors.itemId, itemVendors.vendorId], set: values });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'masters.item.vendors_saved', entityType: 'item', entityId: itemId, metadata: { code: item.code, vendors: ids.length }, ...meta });
      return this.itemVendorsTx(tx, itemId);
    });
  }

  private itemVendorsTx(tx: Transaction, itemId: string) {
    return tx.select().from(itemVendors).where(eq(itemVendors.itemId, itemId));
  }

  /** Warnings for PO lines whose vendor is not on the item's approved vendor list. */
  async avlWarnings(tx: Transaction, vendorId: string, lines: { itemId: string; lineNo: number }[]) {
    const ids = [...new Set(lines.map((l) => l.itemId))];
    if (!ids.length) return [];
    const rows = await tx.select({ itemId: itemVendors.itemId, vendorId: itemVendors.vendorId, isApproved: itemVendors.isApproved }).from(itemVendors).where(inArray(itemVendors.itemId, ids));
    const codes = new Map((await tx.select({ id: items.id, code: items.code }).from(items).where(inArray(items.id, ids))).map((i) => [i.id, i.code]));
    return lines.flatMap((l) => {
      const list = rows.filter((r) => r.itemId === l.itemId && r.isApproved);
      if (!list.length || list.some((r) => r.vendorId === vendorId)) return [];
      return [`Line ${l.lineNo}: this vendor is not on the approved vendor list for ${codes.get(l.itemId)}`];
    });
  }

  /** After a PO is approved: remember the vendor's latest net rate per base unit. */
  async recordOrder(tx: Transaction, vendorId: string, poId: string, docDate: string) {
    const lines = await tx
      .select({ itemId: purchaseOrderLines.itemId, rate: sql<string>`(${purchaseOrderLines.taxableValue} / ${purchaseOrderLines.baseQty})::numeric(18,4)::text` })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.poId, poId));
    for (const l of lines) {
      await tx.update(itemVendors).set({ lastRate: l.rate, lastOrderedAt: docDate }).where(and(eq(itemVendors.itemId, l.itemId), eq(itemVendors.vendorId, vendorId)));
    }
  }
}
