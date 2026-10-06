import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  companies,
  documents,
  goodsReceiptLines,
  goodsReceipts,
  items,
  itemUomConversions,
  parties,
  partyAddresses,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequisitionLines,
  purchaseRequisitions,
  type Transaction,
  uoms,
  users,
  warehouses,
} from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { CustomFieldsService } from '../customization/custom-fields.service';
import { PrintService } from '../customization/print.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import type { RegistrationType } from '../gst/gst-engine';
import { ownGstRegistration, priceLines, taxHeader, type PricedLine } from '../gst/pricing';
import { VendorPerformanceService } from './vendor-performance.service';
import type { CreatePoInput, FromRequisitionInput, ListPoQuery, PoLineInput, PreviewTaxInput, UpdatePoInput } from './orders.schemas';

const DOC_TYPE = 'purchase_order' as const;
type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly customFields: CustomFieldsService,
    private readonly print: PrintService,
    private readonly performance: VendorPerformanceService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      onApproved: async (tx, _auth, doc) => {
        await this.syncRequisitions(tx, doc.id);
        const [po] = await tx.select({ vendorId: purchaseOrders.vendorId }).from(purchaseOrders).where(eq(purchaseOrders.id, doc.id));
        await this.performance.recordOrder(tx, po.vendorId, doc.id, doc.docDate);
      },
      onAmended: (tx, _auth, doc) => this.syncRequisitions(tx, doc.id),
      onCancelled: async (tx, _auth, doc) => {
        const [received] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(purchaseOrderLines)
          .where(and(eq(purchaseOrderLines.poId, doc.id), sql`${purchaseOrderLines.receivedQty} > 0`));
        if (received.n) throw new ConflictException('Goods have been received against this order. Short-close it instead, or cancel its GRNs first.');
        await this.syncRequisitions(tx, doc.id);
      },
    });
    this.print.registerContext(DOC_TYPE, (tx, auth, id) => this.printContext(tx, auth, id));
  }

  list(auth: AuthContext, q: ListPoQuery) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const pending = sql`exists (select 1 from ${purchaseOrderLines} l where l.po_id = ${documents.id} and l.received_qty < l.qty)`;
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          revision: documents.revision,
          status: documents.status,
          docDate: documents.docDate,
          title: documents.title,
          vendor: { id: parties.id, code: parties.code, name: parties.name },
          poType: purchaseOrders.poType,
          expectedDate: purchaseOrders.expectedDate,
          grandTotal: purchaseOrders.grandTotal,
          closedAt: purchaseOrders.closedAt,
          receivedPct: sql<number>`(select coalesce(round(100 * sum(least(l.received_qty, l.qty)) / nullif(sum(l.qty), 0)), 0)::int from ${purchaseOrderLines} l where l.po_id = ${documents.id})`,
          createdBy: users.fullName,
        })
        .from(documents)
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, documents.id))
        .innerJoin(parties, eq(parties.id, purchaseOrders.vendorId))
        .leftJoin(users, eq(users.id, documents.createdBy))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status) : undefined,
            q.vendorId ? eq(purchaseOrders.vendorId, q.vendorId) : undefined,
            q.pendingReceipt === 'true' ? and(eq(documents.status, 'approved'), isNull(purchaseOrders.closedAt), pending) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(parties.name, `%${term}%`), ilike(purchaseOrders.vendorQuoteRef, `%${term}%`)) : undefined,
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

  /** GST preview while the order is being typed (nothing saved). */
  previewTax(auth: AuthContext, input: PreviewTaxInput) {
    return this.database.run(auth, async (tx) => {
      const vendor = await this.vendor(tx, input.vendorId);
      const companyId = input.companyId ?? (await this.defaultCompany(tx));
      const own = await ownGstRegistration(tx, companyId, input.branchId ?? null);
      const { lines, tax } = await priceLines(
        tx,
        { direction: 'inward', ownStateCode: own.stateCode, partyRegistration: vendor.registration, partyStateCode: vendor.stateCode, reverseCharge: input.reverseCharge },
        input.lines.map((l) => ({ ...l, discountPct: l.discountPct ?? null })),
        { defaultUnit: 'purchase' },
      );
      return { tax: taxHeader(tax), stateTaxLabel: tax.stateTaxLabel, lines: lines.map(({ item: _i, ...l }) => l) };
    });
  }

  create(auth: AuthContext, input: CreatePoInput, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta));
  }

  async createTx(tx: Transaction, auth: AuthContext, input: CreatePoInput, meta: RequestMeta) {
    const vendor = await this.vendor(tx, input.vendorId);
    const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields);
    const doc = await this.documents.create(tx, auth, {
      customFields,
      docType: DOC_TYPE,
      companyId: input.companyId,
      branchId: input.branchId,
      docDate: input.docDate ?? todayIST(),
      title: null,
      amount: null,
    });
    const priced = await this.price(tx, doc, vendor, input);
    await tx.insert(purchaseOrders).values({ id: doc.id, tenantId: auth.tenantId, ...(await this.headerValues(tx, doc, vendor, input)), ...taxHeader(priced.tax) });
    await this.writeLines(tx, auth, doc.id, input.lines, priced.lines);
    const updated = await this.documents.update(tx, auth, doc, { title: this.title(vendor.name, priced.lines), amount: priced.tax.totals.grandTotal });
    await this.documents.log(tx, auth, updated, 'document.created', meta, { vendor: vendor.code, lines: input.lines.length, amount: updated.amount });
    return this.view(tx, auth, updated);
  }

  update(auth: AuthContext, id: string, input: UpdatePoInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const vendor = await this.vendor(tx, input.vendorId);
      const [current] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
      if (doc.revision > 0 && current.vendorId !== input.vendorId) fail([{ path: 'vendorId', message: 'The vendor of an amended order cannot change' }]);
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields, doc.customFields);
      const scoped = await this.documents.update(tx, auth, doc, {
        customFields,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}),
      });
      const priced = await this.price(tx, scoped, vendor, input);
      await tx
        .update(purchaseOrders)
        .set({ ...(await this.headerValues(tx, scoped, vendor, input)), ...taxHeader(priced.tax) })
        .where(eq(purchaseOrders.id, id));
      await this.writeLines(tx, auth, id, input.lines, priced.lines);
      const updated = await this.documents.update(tx, auth, scoped, { title: this.title(vendor.name, priced.lines), amount: priced.tax.totals.grandTotal });
      await this.documents.activity(tx, auth, id, 'edited', doc.revision ? `Edited amendment (revision ${doc.revision})` : 'Edited the order');
      await this.documents.log(tx, auth, updated, 'document.updated', meta, { lines: input.lines.length, amount: { from: doc.amount, to: updated.amount } });
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
      return this.view(tx, auth, await this.documents.submit(tx, auth, doc, meta));
    });
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      return this.view(tx, auth, await this.documents.cancel(tx, auth, doc, reason, meta));
    });
  }

  amend(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
      const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, id)).orderBy(asc(purchaseOrderLines.lineNo));
      return this.view(tx, auth, await this.documents.amend(tx, auth, doc, { header: doc, order: po, lines } as unknown as Record<string, unknown>, reason, meta));
    });
  }

  /** Closes an approved order that won't be received in full. */
  shortClose(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      if (doc.status !== 'approved') throw new ConflictException('Only approved orders can be short-closed');
      await tx.update(purchaseOrders).set({ closedAt: new Date(), closeReason: reason }).where(eq(purchaseOrders.id, id));
      const updated = await this.documents.update(tx, auth, doc, { status: 'completed' });
      await this.documents.activity(tx, auth, id, 'status', 'Short-closed: the remaining quantity will not be received', { reason });
      await this.documents.log(tx, auth, updated, 'purchase.order.short_closed', meta, { reason });
      return this.view(tx, auth, updated);
    });
  }

  /** Draft PO from an approved requisition's outstanding lines. */
  fromRequisition(auth: AuthContext, input: FromRequisitionInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [pr] = await tx
        .select({ id: documents.id, status: documents.status, number: documents.number, companyId: documents.companyId, branchId: documents.branchId })
        .from(documents)
        .innerJoin(purchaseRequisitions, eq(purchaseRequisitions.id, documents.id))
        .where(eq(documents.id, input.requisitionId));
      if (!pr) throw new BadRequestException('Requisition not found');
      if (pr.status !== 'approved') throw new ConflictException('Only approved requisitions can be turned into purchase orders');
      const prLines = await tx
        .select()
        .from(purchaseRequisitionLines)
        .where(and(eq(purchaseRequisitionLines.requisitionId, pr.id), input.lineIds?.length ? inArray(purchaseRequisitionLines.id, input.lineIds) : undefined))
        .orderBy(asc(purchaseRequisitionLines.lineNo));
      const open = prLines.filter((l) => Decimal.from(l.quantity).sub(Decimal.from(l.orderedQty)).cmp(Decimal.from('0')) > 0);
      if (!open.length) throw new ConflictException('Everything on this requisition has already been ordered');
      const unlinked = open.filter((l) => !l.itemId);
      if (unlinked.length) {
        throw new BadRequestException(`Link these lines to items before ordering: ${unlinked.map((l) => `#${l.lineNo} ${l.description}`).join(', ')}`);
      }
      const itemRows = await tx.select().from(items).where(inArray(items.id, open.map((l) => l.itemId!)));
      const convs = await tx.select().from(itemUomConversions).where(inArray(itemUomConversions.itemId, open.map((l) => l.itemId!)));
      const lines: PoLineInput[] = open.map((l) => {
        const it = itemRows.find((x) => x.id === l.itemId)!;
        const uomId = l.uomId ?? it.purchaseUomId ?? it.baseUomId;
        const factor = uomId === it.baseUomId ? '1' : (convs.find((c) => c.itemId === it.id && c.uomId === uomId)?.factor ?? '1');
        const baseRate = it.lastPurchaseRate ?? it.standardCost;
        const rate = l.estimatedRate ?? (baseRate ? Decimal.from(baseRate).mul(Decimal.from(factor)).toFixed(4) : '0');
        return {
          itemId: it.id,
          uomId,
          description: l.description,
          qty: Decimal.from(l.quantity).sub(Decimal.from(l.orderedQty)).toFixed(4),
          rate,
          discountPct: null,
          deliveryDate: l.requiredBy,
          requisitionLineId: l.id,
          remarks: l.remarks,
          foreignRate: null,
        };
      });
      return this.createTx(
        tx,
        auth,
        {
          companyId: pr.companyId,
          branchId: pr.branchId,
          poType: 'standard',
          vendorId: input.vendorId,
          deliveryWarehouseId: input.deliveryWarehouseId ?? null,
          vendorQuoteRef: null,
          paymentTerms: null,
          terms: null,
          notes: pr.number ? `Against requisition ${pr.number}` : null,
          tolerancePct: null,
          reverseCharge: false,
          currency: 'INR',
          exchangeRate: '1',
          lines,
        },
        meta,
      );
    });
  }

  /** Lines still to receive, for the GRN form. */
  receivable(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.find(tx, id, DOC_TYPE);
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
      const lines = await this.lineRows(tx, id);
      return {
        id,
        number: doc.number,
        status: doc.status,
        closed: !!po.closedAt,
        vendorId: po.vendorId,
        deliveryWarehouseId: po.deliveryWarehouseId,
        tolerancePct: po.tolerancePct,
        lines: lines.map((l) => {
          const max = Decimal.from(l.qty).mul(Decimal.from('1').add(Decimal.from(po.tolerancePct).div(Decimal.from('100'))));
          return { ...l, pendingQty: maxZero(Decimal.from(l.qty).sub(Decimal.from(l.receivedQty))), maxReceivableQty: maxZero(max.sub(Decimal.from(l.receivedQty))) };
        }),
      };
    });
  }

  // ---- helpers -----------------------------------------------------------------------

  private async vendor(tx: Transaction, vendorId: string) {
    const [v] = await tx.select().from(parties).where(and(eq(parties.id, vendorId), isNull(parties.deletedAt)));
    if (!v) fail([{ path: 'vendorId', message: 'Vendor not found' }]);
    if (!v.isVendor) fail([{ path: 'vendorId', message: `${v.name} is not set up as a vendor` }]);
    if (!v.isActive) fail([{ path: 'vendorId', message: `${v.name} is inactive` }]);
    const addresses = await tx.select().from(partyAddresses).where(eq(partyAddresses.partyId, v.id));
    const billing = addresses.find((a) => a.isDefault && a.type !== 'shipping') ?? addresses.find((a) => a.type !== 'shipping') ?? addresses[0];
    const stateCode = v.stateCode ?? (v.gstin ? v.gstin.slice(0, 2) : null) ?? billing?.stateCode ?? null;
    return {
      id: v.id,
      code: v.code,
      name: v.name,
      gstin: v.gstin,
      registration: v.gstRegistrationType as RegistrationType,
      stateCode,
      creditDays: v.creditDays,
      paymentTerms: v.paymentTerms,
      address: billing ? { line1: billing.line1, line2: billing.line2 ?? undefined, city: billing.city, stateCode: billing.stateCode, pincode: billing.pincode ?? undefined } : {},
    };
  }

  private async defaultCompany(tx: Transaction) {
    const [c] = await tx.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
    if (!c) throw new BadRequestException('Create a company first');
    return c.id;
  }

  private async price(tx: Transaction, doc: DocumentRow, vendor: Awaited<ReturnType<OrdersService['vendor']>>, input: CreatePoInput) {
    const own = await ownGstRegistration(tx, doc.companyId, doc.branchId);
    return priceLines(
      tx,
      { direction: 'inward', ownStateCode: own.stateCode, partyRegistration: vendor.registration, partyStateCode: vendor.stateCode, reverseCharge: input.reverseCharge },
      input.lines.map((l) => ({ itemId: l.itemId, uomId: l.uomId, qty: l.qty, rate: l.rate, discountPct: l.discountPct, description: l.description })),
      { defaultUnit: 'purchase' },
    );
  }

  private async headerValues(tx: Transaction, doc: DocumentRow, vendor: Awaited<ReturnType<OrdersService['vendor']>>, input: CreatePoInput) {
    let warehouseId = input.deliveryWarehouseId ?? null;
    if (warehouseId) {
      const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, warehouseId));
      if (!wh) fail([{ path: 'deliveryWarehouseId', message: 'Unknown warehouse' }]);
      if (wh.companyId !== doc.companyId) fail([{ path: 'deliveryWarehouseId', message: `Warehouse ${wh.code} belongs to another company` }]);
    } else if (input.poType === 'standard') {
      const [wh] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, doc.companyId), eq(warehouses.isActive, true), eq(warehouses.isNettable, true)))
        .orderBy(sql`case when ${warehouses.code} = 'MAIN' then 0 else 1 end`, asc(warehouses.code))
        .limit(1);
      warehouseId = wh?.id ?? null;
    }
    return {
      poType: input.poType,
      vendorId: vendor.id,
      vendorGstin: vendor.gstin,
      vendorStateCode: vendor.stateCode,
      vendorRegistration: vendor.registration,
      vendorAddress: vendor.address,
      deliveryWarehouseId: warehouseId,
      expectedDate: input.expectedDate ?? null,
      vendorQuoteRef: input.vendorQuoteRef,
      paymentTerms: input.paymentTerms ?? vendor.paymentTerms,
      creditDays: input.creditDays ?? vendor.creditDays,
      tolerancePct: input.tolerancePct ?? '0',
      currency: input.currency,
      exchangeRate: input.exchangeRate ?? '1',
      terms: input.terms,
      notes: input.notes,
    };
  }

  /**
   * Upserts lines by id so amended orders keep their receipts. Lines with receipts can't be removed,
   * change item/unit, or drop below what has been received.
   */
  private async writeLines(tx: Transaction, auth: AuthContext, poId: string, input: PoLineInput[], priced: PricedLine[]) {
    const existing = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId));
    const errors: Err[] = [];
    const referenced = new Set(
      (existing.length ? await tx.select({ id: goodsReceiptLines.poLineId }).from(goodsReceiptLines).where(inArray(goodsReceiptLines.poLineId, existing.map((l) => l.id))) : []).map((r) => r.id),
    );
    input.forEach((l, i) => {
      if (!l.id) return;
      const old = existing.find((e) => e.id === l.id);
      if (!old) return errors.push({ path: `lines.${i}.id`, message: 'Line not found on this order' });
      const received = Decimal.from(old.receivedQty);
      if (received.cmp(Decimal.from('0')) > 0) {
        if (old.itemId !== l.itemId || old.uomId !== priced[i].uomId) errors.push({ path: `lines.${i}.itemId`, message: 'Goods were received on this line: item and unit cannot change' });
        if (Decimal.from(l.qty).cmp(received) < 0) errors.push({ path: `lines.${i}.qty`, message: `Already received ${received.toFixed(4).replace(/\.?0+$/, '')}; the quantity cannot be lower` });
      }
    });
    const kept = new Set(input.map((l) => l.id).filter(Boolean));
    for (const old of existing.filter((e) => !kept.has(e.id))) {
      if (referenced.has(old.id)) errors.push({ path: 'lines', message: `Line ${old.lineNo} (${old.description}) has goods receipts and cannot be removed` });
    }
    // Requisition links must point at approved requisitions for the same item.
    const prLineIds = input.map((l) => l.requisitionLineId).filter((v): v is string => !!v);
    if (prLineIds.length) {
      const prLines = await tx
        .select({ id: purchaseRequisitionLines.id, itemId: purchaseRequisitionLines.itemId, status: documents.status })
        .from(purchaseRequisitionLines)
        .innerJoin(documents, eq(documents.id, purchaseRequisitionLines.requisitionId))
        .where(inArray(purchaseRequisitionLines.id, prLineIds));
      input.forEach((l, i) => {
        if (!l.requisitionLineId) return;
        const pl = prLines.find((p) => p.id === l.requisitionLineId);
        if (!pl || pl.status !== 'approved') errors.push({ path: `lines.${i}.requisitionLineId`, message: 'Requisition line not found on an approved requisition' });
        else if (pl.itemId && pl.itemId !== l.itemId) errors.push({ path: `lines.${i}.requisitionLineId`, message: 'The requisition line is for a different item' });
      });
    }
    if (errors.length) fail(errors);

    const removed = existing.filter((e) => !kept.has(e.id)).map((e) => e.id);
    if (removed.length) await tx.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.id, removed));
    // Move surviving lines out of the way so line numbers can be reassigned without clashes.
    await tx.update(purchaseOrderLines).set({ lineNo: sql`${purchaseOrderLines.lineNo} + 10000` }).where(eq(purchaseOrderLines.poId, poId));
    for (const [i, l] of input.entries()) {
      const p = priced[i];
      const values = {
        lineNo: i + 1,
        itemId: l.itemId,
        description: p.description,
        uomId: p.uomId,
        qty: l.qty,
        conversionFactor: p.conversionFactor,
        baseQty: p.baseQty,
        rate: l.rate,
        foreignRate: l.foreignRate ?? null,
        discountPct: l.discountPct ?? '0',
        hsnCode: p.hsnCode,
        gstRate: p.gstRate,
        cessRate: p.cessRate,
        taxability: p.taxability,
        taxableValue: p.taxableValue,
        cgstAmount: p.cgstAmount,
        sgstAmount: p.sgstAmount,
        igstAmount: p.igstAmount,
        cessAmount: p.cessAmount,
        lineTotal: p.lineTotal,
        deliveryDate: l.deliveryDate ?? null,
        requisitionLineId: l.requisitionLineId ?? null,
        remarks: l.remarks,
      };
      if (l.id) await tx.update(purchaseOrderLines).set(values).where(eq(purchaseOrderLines.id, l.id));
      else await tx.insert(purchaseOrderLines).values({ ...values, tenantId: auth.tenantId, poId });
    }
  }

  /** Requisition "ordered" quantities = sum of approved / completed PO lines (in the requisition's unit). */
  private async syncRequisitions(tx: Transaction, poId: string) {
    const linked = await tx
      .select({ id: purchaseOrderLines.requisitionLineId })
      .from(purchaseOrderLines)
      .where(and(eq(purchaseOrderLines.poId, poId), sql`${purchaseOrderLines.requisitionLineId} is not null`));
    const ids = [...new Set(linked.map((l) => l.id!))];
    if (!ids.length) return;
    const prLines = await tx.select().from(purchaseRequisitionLines).where(inArray(purchaseRequisitionLines.id, ids));
    const ordered = await tx
      .select({ id: purchaseOrderLines.requisitionLineId, base: sql<string>`sum(${purchaseOrderLines.baseQty})::text` })
      .from(purchaseOrderLines)
      .innerJoin(documents, eq(documents.id, purchaseOrderLines.poId))
      .where(and(inArray(purchaseOrderLines.requisitionLineId, ids), inArray(documents.status, ['approved', 'completed'])))
      .groupBy(purchaseOrderLines.requisitionLineId);
    const itemIds = prLines.map((l) => l.itemId).filter((v): v is string => !!v);
    const itemRows = itemIds.length ? await tx.select({ id: items.id, baseUomId: items.baseUomId }).from(items).where(inArray(items.id, itemIds)) : [];
    const convs = itemIds.length ? await tx.select().from(itemUomConversions).where(inArray(itemUomConversions.itemId, itemIds)) : [];
    for (const l of prLines) {
      const base = Decimal.from(ordered.find((o) => o.id === l.id)?.base ?? '0');
      const it = itemRows.find((x) => x.id === l.itemId);
      const factor = !it || !l.uomId || l.uomId === it.baseUomId ? '1' : (convs.find((c) => c.itemId === it.id && c.uomId === l.uomId)?.factor ?? '1');
      await tx.update(purchaseRequisitionLines).set({ orderedQty: base.div(Decimal.from(factor)).toFixed(4) }).where(eq(purchaseRequisitionLines.id, l.id));
    }
  }

  private title(vendorName: string, lines: PricedLine[]) {
    const [first, ...rest] = lines;
    return `${vendorName}: ${first.description}${rest.length ? ` + ${rest.length} more` : ''}`.slice(0, 200);
  }

  private async lineRows(tx: Transaction, poId: string) {
    const rows = await tx
      .select({ l: purchaseOrderLines, itemCode: items.code, itemName: items.name, isStockItem: items.isStockItem, trackBatch: items.trackBatch, trackSerial: items.trackSerial, hasExpiry: items.hasExpiry, uomCode: uoms.code, uomDecimals: uoms.decimals })
      .from(purchaseOrderLines)
      .innerJoin(items, eq(items.id, purchaseOrderLines.itemId))
      .innerJoin(uoms, eq(uoms.id, purchaseOrderLines.uomId))
      .where(eq(purchaseOrderLines.poId, poId))
      .orderBy(asc(purchaseOrderLines.lineNo));
    return rows.map(({ l: { tenantId: _t, poId: _p, ...l }, ...rest }) => ({ ...l, ...rest }));
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('purchase.orders.manage'), cancel: perms.has('purchase.orders.cancel') });
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, doc.id));
    const [vendor] = await tx.select({ id: parties.id, code: parties.code, name: parties.name, email: parties.email, phone: parties.phone }).from(parties).where(eq(parties.id, po.vendorId));
    const [wh] = po.deliveryWarehouseId ? await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, address: warehouses.address }).from(warehouses).where(eq(warehouses.id, po.deliveryWarehouseId)) : [];
    const lines = (await this.lineRows(tx, doc.id)).map((l) => ({ ...l, pendingQty: maxZero(Decimal.from(l.qty).sub(Decimal.from(l.receivedQty))) }));
    const receipts = await tx
      .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, amount: documents.amount })
      .from(goodsReceipts)
      .innerJoin(documents, eq(documents.id, goodsReceipts.id))
      .where(eq(goodsReceipts.poId, doc.id))
      .orderBy(desc(documents.id));
    const own = await ownGstRegistration(tx, doc.companyId, doc.branchId);
    const { tenantId: _t, id: _i, vendorId: _v, deliveryWarehouseId: _w, ...rest } = po;
    const pending = lines.some((l) => Decimal.from(l.pendingQty).cmp(Decimal.from('0')) > 0);
    return {
      ...header,
      ...rest,
      vendor: { ...vendor, gstin: po.vendorGstin, stateCode: po.vendorStateCode, registration: po.vendorRegistration, address: po.vendorAddress },
      deliveryWarehouse: wh ?? null,
      ourGstin: own.gstin,
      ourStateCode: own.stateCode,
      stateTaxLabel: po.placeOfSupply && ['04', '25', '26', '31', '35', '38', '97'].includes(po.placeOfSupply) ? 'UTGST' : 'SGST',
      lines,
      receipts,
      /** Lines whose vendor isn't on the item's approved vendor list. */
      warnings: await this.performance.avlWarnings(tx, po.vendorId, lines),
      canReceive: doc.status === 'approved' && !po.closedAt && pending && perms.has('purchase.receipts.manage'),
      canShortClose: doc.status === 'approved' && !po.closedAt && pending && perms.has('purchase.orders.cancel'),
    };
  }

  private async printContext(tx: Transaction, auth: AuthContext, id: string) {
    const doc = await this.documents.find(tx, id, DOC_TYPE);
    const view = await this.view(tx, auth, doc);
    const [company] = await tx.select({ name: companies.name, legalName: companies.legalName, gstin: companies.gstin, address: companies.address }).from(companies).where(eq(companies.id, doc.companyId));
    const [printer] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, auth.userId));
    const defs = await this.customFields.definitions(tx, DOC_TYPE, true);
    return {
      company: { ...company, gstin: view.ourGstin ?? company?.gstin },
      branch: view.branch,
      doc: view,
      vendor: view.vendor,
      deliveryWarehouse: view.deliveryWarehouse,
      lines: view.lines,
      stateTaxLabel: view.stateTaxLabel,
      customFields: defs
        .filter((f) => f.showInPrint)
        .map((f) => ({ label: f.label, value: view.customFields[f.key] === undefined || view.customFields[f.key] === null || view.customFields[f.key] === '' ? '—' : String(view.customFields[f.key]) })),
      approvals: view.approvals.filter((s) => s.status === 'approved'),
      printedBy: printer?.name ?? '',
      printedAt: new Date().toISOString(),
    };
  }
}

function maxZero(d: Decimal) {
  return (d.isNegative() ? Decimal.from('0') : d).toFixed(4);
}
