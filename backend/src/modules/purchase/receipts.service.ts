import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  documents,
  goodsReceiptLines,
  goodsReceipts,
  items,
  parties,
  purchaseOrderLines,
  purchaseOrders,
  type Transaction,
  uoms,
  users,
  warehouses,
} from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { CustomFieldsService } from '../customization/custom-fields.service';
import { PrintService } from '../customization/print.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { StockService, type StockMove } from '../inventory/stock.service';
import type { CreateGrnInput, ListGrnQuery } from './receipts.schemas';

const DOC_TYPE = 'goods_receipt' as const;
const PO_TYPE = 'purchase_order' as const;
type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}
const D = Decimal.from;
const ZERO = D('0');

/**
 * Goods receipt against a purchase order. Accepted quantity goes into stock at the PO's
 * net rate when the GRN is approved; rejected quantity is recorded but not stocked.
 * Receipts may exceed the order only within the PO's tolerance.
 */
@Injectable()
export class ReceiptsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly customFields: CustomFieldsService,
    private readonly stock: StockService,
    private readonly print: PrintService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      amendable: false,
      onApproved: (tx, auth, doc) => this.post(tx, auth, doc),
      onCancelled: (tx, auth, doc) => this.unpost(tx, auth, doc),
    });
    this.print.registerContext(DOC_TYPE, async (tx, auth, id) => {
      const doc = await this.documents.find(tx, id, DOC_TYPE);
      const view = await this.view(tx, auth, doc);
      const [printer] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, auth.userId));
      return { doc: view, company: view.company, branch: view.branch, lines: view.lines, vendor: view.vendor, printedBy: printer?.name ?? '', printedAt: new Date().toISOString() };
    });
  }

  list(auth: AuthContext, q: ListGrnQuery) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const po = sql<string | null>`(select d.number from ${documents} d where d.id = ${goodsReceipts.poId})`;
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          title: documents.title,
          amount: documents.amount,
          poId: goodsReceipts.poId,
          poNumber: po,
          vendor: { id: parties.id, code: parties.code, name: parties.name },
          warehouse: { id: warehouses.id, code: warehouses.code },
          supplierInvoiceNo: goodsReceipts.supplierInvoiceNo,
          createdBy: users.fullName,
        })
        .from(documents)
        .innerJoin(goodsReceipts, eq(goodsReceipts.id, documents.id))
        .innerJoin(parties, eq(parties.id, goodsReceipts.vendorId))
        .innerJoin(warehouses, eq(warehouses.id, goodsReceipts.warehouseId))
        .leftJoin(users, eq(users.id, documents.createdBy))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status) : undefined,
            q.poId ? eq(goodsReceipts.poId, q.poId) : undefined,
            q.vendorId ? eq(goodsReceipts.vendorId, q.vendorId) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(parties.name, `%${term}%`), ilike(goodsReceipts.supplierInvoiceNo, `%${term}%`), ilike(goodsReceipts.challanNo, `%${term}%`)) : undefined,
            q.cursor ? lt(documents.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(documents.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE)));
  }

  create(auth: AuthContext, input: CreateGrnInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const { po, poDoc, warehouseId, lines } = await this.prepare(tx, input);
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields);
      const doc = await this.documents.create(tx, auth, {
        customFields,
        docType: DOC_TYPE,
        companyId: poDoc.companyId,
        branchId: poDoc.branchId,
        docDate: input.docDate ?? todayIST(),
        title: this.title(poDoc.number, lines),
        amount: this.total(lines),
      });
      await tx.insert(goodsReceipts).values({ id: doc.id, tenantId: auth.tenantId, poId: po.id, vendorId: po.vendorId, warehouseId, ...this.headerValues(input) });
      await this.writeLines(tx, auth, doc.id, lines);
      await this.documents.log(tx, auth, doc, 'document.created', meta, { po: poDoc.number, lines: lines.length });
      return this.view(tx, auth, doc);
    });
  }

  update(auth: AuthContext, id: string, input: CreateGrnInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const [current] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, id));
      if (current.poId !== input.poId) fail([{ path: 'poId', message: 'A GRN stays on its purchase order. Delete it and start again.' }]);
      const { poDoc, warehouseId, lines } = await this.prepare(tx, input);
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields, doc.customFields);
      const updated = await this.documents.update(tx, auth, doc, {
        customFields,
        ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}),
        title: this.title(poDoc.number, lines),
        amount: this.total(lines),
      });
      await tx.update(goodsReceipts).set({ warehouseId, ...this.headerValues(input) }).where(eq(goodsReceipts.id, id));
      await tx.delete(goodsReceiptLines).where(eq(goodsReceiptLines.grnId, id));
      await this.writeLines(tx, auth, id, lines);
      await this.documents.activity(tx, auth, id, 'edited', 'Edited the goods receipt');
      await this.documents.log(tx, auth, updated, 'document.updated', meta, { lines: lines.length });
      return this.view(tx, auth, updated);
    });
  }

  remove(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      await this.documents.deleteDraft(tx, auth, doc, meta);
    });
  }

  submit(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      await this.documents.submit(tx, auth, doc, meta);
      return this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE));
    });
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      return this.view(tx, auth, await this.documents.cancel(tx, auth, doc, reason, meta));
    });
  }

  // ---- posting -------------------------------------------------------------------

  private async post(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [grn] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, doc.id));
    // Lock the PO so two GRNs can't both use up the tolerance.
    const poDoc = await this.documents.lock(tx, grn.poId, PO_TYPE);
    if (poDoc.status !== 'approved') throw new ConflictException(`Purchase order ${poDoc.number} is ${poDoc.status.replace('_', ' ')}: goods can no longer be received against it`);
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, grn.poId));
    if (po.closedAt) throw new ConflictException(`Purchase order ${poDoc.number} was short-closed`);
    const lines = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.grnId, doc.id)).orderBy(asc(goodsReceiptLines.lineNo));
    const poLines = await tx.select().from(purchaseOrderLines).where(inArray(purchaseOrderLines.id, lines.map((l) => l.poLineId)));
    const stockItems = new Set(
      (await tx.select({ id: items.id }).from(items).where(and(inArray(items.id, lines.map((l) => l.itemId)), eq(items.isStockItem, true)))).map((i) => i.id),
    );

    const errors: Err[] = [];
    const moves: StockMove[] = [];
    for (const [i, l] of lines.entries()) {
      const pl = poLines.find((p) => p.id === l.poLineId)!;
      const max = D(pl.qty).mul(D('1').add(D(po.tolerancePct).div(D('100'))));
      const after = D(pl.receivedQty).add(D(l.acceptedQty));
      if (after.cmp(max) > 0) {
        errors.push({ path: `lines.${i}.receivedQty`, message: `Line ${pl.lineNo}: ${after.toFixed(4).replace(/\.?0+$/, '')} would be received against ${D(pl.qty).toFixed(4).replace(/\.?0+$/, '')} ordered (tolerance ${D(po.tolerancePct).toFixed(2)}%)` });
      }
      if (stockItems.has(l.itemId) && !D(l.acceptedBaseQty).isZero()) {
        moves.push({
          itemId: l.itemId,
          warehouseId: grn.warehouseId,
          qty: l.acceptedBaseQty,
          // Net PO rate per base unit (GST is recoverable input tax, not cost).
          rate: D(l.rate).div(D(l.conversionFactor)).toFixed(6),
          batchNo: l.batchNo,
          mfgDate: l.mfgDate,
          expiryDate: l.expiryDate,
          serialNos: l.serialNos,
          line: i + 1,
        });
      }
    }
    if (errors.length) fail(errors);
    await this.stock.post(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate }, moves);

    for (const l of lines) {
      await tx
        .update(purchaseOrderLines)
        .set({ receivedQty: sql`${purchaseOrderLines.receivedQty} + ${l.acceptedQty}::numeric`, rejectedQty: sql`${purchaseOrderLines.rejectedQty} + ${l.rejectedQty}::numeric` })
        .where(eq(purchaseOrderLines.id, l.poLineId));
      if (stockItems.has(l.itemId) && !D(l.acceptedQty).isZero()) {
        await tx.update(items).set({ lastPurchaseRate: D(l.rate).div(D(l.conversionFactor)).toFixed(4) }).where(eq(items.id, l.itemId));
      }
    }
    await this.syncOrderStatus(tx, auth, poDoc);
  }

  private async unpost(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [grn] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, doc.id));
    const poDoc = await this.documents.lock(tx, grn.poId, PO_TYPE);
    await this.stock.reverseVoucher(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate });
    const lines = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.grnId, doc.id));
    for (const l of lines) {
      await tx
        .update(purchaseOrderLines)
        .set({ receivedQty: sql`${purchaseOrderLines.receivedQty} - ${l.acceptedQty}::numeric`, rejectedQty: sql`${purchaseOrderLines.rejectedQty} - ${l.rejectedQty}::numeric` })
        .where(eq(purchaseOrderLines.id, l.poLineId));
    }
    await this.syncOrderStatus(tx, auth, poDoc);
  }

  /** Completed when every line is fully received; back to approved when a receipt is cancelled (unless short-closed). */
  private async syncOrderStatus(tx: Transaction, auth: AuthContext, poDoc: DocumentRow) {
    const [po] = await tx.select({ closedAt: purchaseOrders.closedAt }).from(purchaseOrders).where(eq(purchaseOrders.id, poDoc.id));
    if (po.closedAt) return;
    const [{ open }] = await tx
      .select({ open: sql<number>`count(*) filter (where ${purchaseOrderLines.receivedQty} < ${purchaseOrderLines.qty})::int` })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.poId, poDoc.id));
    if (!open && poDoc.status === 'approved') {
      await this.documents.update(tx, auth, poDoc, { status: 'completed' });
      await this.documents.activity(tx, auth, poDoc.id, 'status', 'Fully received');
    } else if (open && poDoc.status === 'completed') {
      await this.documents.update(tx, auth, poDoc, { status: 'approved' });
      await this.documents.activity(tx, auth, poDoc.id, 'status', 'Reopened: a goods receipt was cancelled');
    }
  }

  // ---- helpers -----------------------------------------------------------------------

  private async prepare(tx: Transaction, input: CreateGrnInput) {
    const [poDoc] = await tx.select().from(documents).where(and(eq(documents.id, input.poId), eq(documents.docType, PO_TYPE)));
    if (!poDoc) fail([{ path: 'poId', message: 'Purchase order not found' }]);
    if (poDoc.status !== 'approved') fail([{ path: 'poId', message: `Purchase order ${poDoc.number ?? ''} is ${poDoc.status.replace('_', ' ')}: receive only against approved orders` }]);
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, input.poId));
    if (po.closedAt) fail([{ path: 'poId', message: 'This purchase order was short-closed' }]);
    const warehouseId = input.warehouseId ?? po.deliveryWarehouseId;
    if (!warehouseId) fail([{ path: 'warehouseId', message: 'Choose the receiving warehouse' }]);
    const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, warehouseId));
    if (!wh || !wh.isActive) fail([{ path: 'warehouseId', message: 'Unknown or inactive warehouse' }]);
    if (wh.companyId !== poDoc.companyId) fail([{ path: 'warehouseId', message: `Warehouse ${wh.code} belongs to another company` }]);

    const poLines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
    const itemRows = await tx.select().from(items).where(inArray(items.id, poLines.map((l) => l.itemId)));
    const errors: Err[] = [];
    const seen = new Set<string>();
    const lines = input.lines.map((l, i) => {
      const p = `lines.${i}`;
      const pl = poLines.find((x) => x.id === l.poLineId);
      if (!pl) {
        errors.push({ path: `${p}.poLineId`, message: 'Not a line of this purchase order' });
        return null;
      }
      const it = itemRows.find((x) => x.id === pl.itemId)!;
      const received = D(l.receivedQty);
      const rejected = D(l.rejectedQty);
      const accepted = received.sub(rejected);
      if (received.isZero()) errors.push({ path: `${p}.receivedQty`, message: 'Enter the quantity received' });
      if (accepted.isNegative()) errors.push({ path: `${p}.rejectedQty`, message: 'Rejected cannot exceed received' });
      if (!rejected.isZero() && !l.rejectionReason) errors.push({ path: `${p}.rejectionReason`, message: 'Say why it was rejected' });
      const key = `${pl.id}:${l.batchNo ?? ''}`;
      if (seen.has(key)) errors.push({ path: `${p}.poLineId`, message: `Line ${pl.lineNo} appears twice${l.batchNo ? ` for batch ${l.batchNo}` : ''}` });
      seen.add(key);
      const max = D(pl.qty).mul(D('1').add(D(po.tolerancePct).div(D('100')))).sub(D(pl.receivedQty));
      if (accepted.cmp(max) > 0) errors.push({ path: `${p}.receivedQty`, message: `Only ${(max.isNegative() ? ZERO : max).toFixed(4).replace(/\.?0+$/, '') || '0'} more can be received on line ${pl.lineNo}` });
      if (it.isStockItem) {
        if (it.trackBatch && !accepted.isZero() && !l.batchNo) errors.push({ path: `${p}.batchNo`, message: `${it.code} needs a batch number` });
        if (it.trackSerial && (l.serialNos?.length ?? 0) !== Number(accepted.mul(D(pl.conversionFactor)).toFixed(4))) {
          errors.push({ path: `${p}.serialNos`, message: `Enter one serial number per unit accepted` });
        }
      }
      const rate = D(pl.taxableValue).div(D(pl.qty)).toFixed(4);
      return {
        ...l,
        lineNo: i + 1,
        itemId: pl.itemId,
        uomId: pl.uomId,
        conversionFactor: pl.conversionFactor,
        acceptedQty: accepted.toFixed(4),
        acceptedBaseQty: accepted.mul(D(pl.conversionFactor)).toFixed(4),
        rate,
        amount: accepted.mul(D(rate)).toFixed(2),
        serialNos: l.serialNos?.map((s) => s.trim().toUpperCase()) ?? null,
      };
    });
    // Same PO line split over several batches: check the combined quantity against what is left.
    for (const pl of poLines) {
      const total = lines.filter((l) => l?.poLineId === pl.id).reduce((s, l) => s.add(D(l!.acceptedQty)), ZERO);
      const max = D(pl.qty).mul(D('1').add(D(po.tolerancePct).div(D('100')))).sub(D(pl.receivedQty));
      if (total.cmp(max) > 0 && lines.filter((l) => l?.poLineId === pl.id).length > 1) errors.push({ path: 'lines', message: `Line ${pl.lineNo}: more than the order allows across batches` });
    }
    if (errors.length) fail(errors);
    return { po, poDoc, warehouseId, lines: lines as NonNullable<(typeof lines)[number]>[] };
  }

  private headerValues(input: CreateGrnInput) {
    return {
      supplierInvoiceNo: input.supplierInvoiceNo,
      supplierInvoiceDate: input.supplierInvoiceDate ?? null,
      challanNo: input.challanNo,
      gateEntryNo: input.gateEntryNo,
      vehicleNo: input.vehicleNo ?? null,
      transporter: input.transporter,
      lrNo: input.lrNo,
      notes: input.notes,
    };
  }

  private async writeLines(tx: Transaction, auth: AuthContext, grnId: string, lines: Awaited<ReturnType<ReceiptsService['prepare']>>['lines']) {
    await tx.insert(goodsReceiptLines).values(
      lines.map((l) => ({
        tenantId: auth.tenantId,
        grnId,
        lineNo: l.lineNo,
        poLineId: l.poLineId,
        itemId: l.itemId,
        uomId: l.uomId,
        conversionFactor: l.conversionFactor,
        receivedQty: D(l.receivedQty).toFixed(4),
        rejectedQty: D(l.rejectedQty).toFixed(4),
        acceptedQty: l.acceptedQty,
        acceptedBaseQty: l.acceptedBaseQty,
        rate: l.rate,
        amount: l.amount,
        batchNo: l.batchNo,
        mfgDate: l.mfgDate ?? null,
        expiryDate: l.expiryDate ?? null,
        serialNos: l.serialNos,
        rejectionReason: l.rejectionReason,
        remarks: l.remarks,
      })),
    );
  }

  private title(poNumber: string | null, lines: { lineNo: number }[]) {
    return `Receipt against ${poNumber ?? 'PO'} (${lines.length} line${lines.length === 1 ? '' : 's'})`;
  }

  private total(lines: { amount: string }[]) {
    return Decimal.sum(lines.map((l) => l.amount)).toFixed(2);
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('purchase.receipts.manage'), cancel: perms.has('purchase.receipts.cancel') });
    const [grn] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, doc.id));
    const [po] = await tx.select({ id: documents.id, number: documents.number, status: documents.status }).from(documents).where(eq(documents.id, grn.poId));
    const [vendor] = await tx.select({ id: parties.id, code: parties.code, name: parties.name, gstin: parties.gstin }).from(parties).where(eq(parties.id, grn.vendorId));
    const [wh] = await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, grn.warehouseId));
    const rows = await tx
      .select({
        l: goodsReceiptLines,
        itemCode: items.code,
        itemName: items.name,
        uomCode: uoms.code,
        orderedQty: purchaseOrderLines.qty,
        poLineNo: purchaseOrderLines.lineNo,
        poReceivedQty: purchaseOrderLines.receivedQty,
      })
      .from(goodsReceiptLines)
      .innerJoin(items, eq(items.id, goodsReceiptLines.itemId))
      .innerJoin(uoms, eq(uoms.id, goodsReceiptLines.uomId))
      .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, goodsReceiptLines.poLineId))
      .where(eq(goodsReceiptLines.grnId, doc.id))
      .orderBy(asc(goodsReceiptLines.lineNo));
    const { tenantId: _t, id: _i, poId: _p, vendorId: _v, warehouseId: _w, ...rest } = grn;
    return {
      ...header,
      ...rest,
      purchaseOrder: po,
      vendor,
      warehouse: wh,
      lines: rows.map(({ l: { tenantId: _lt, grnId: _g, ...l }, ...more }) => ({ ...l, ...more })),
    };
  }
}
