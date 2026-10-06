import { ConflictException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  companies,
  deliveryNoteLines,
  deliveryNotes,
  documents,
  items,
  parties,
  purchaseOrderLines,
  purchaseOrders,
  salesInvoiceLines,
  salesInvoices,
  salesOrderLines,
  salesOrders,
  stockBalances,
  stockValuation,
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
import { UTGST_STATES } from '../gst/gst-engine';
import { creditPosition, customerColumns, fail, loadCustomer, priceSelling, trim, type CustomerSnapshot, type Err } from './common';
import type { CreateOrderInput, ListQuery, SellingLineInput } from './sales.schemas';

const DOC_TYPE = 'sales_order' as const;
const D = Decimal.from;
const ZERO = D('0');

/**
 * Sales order. Priced from the customer's price list, GST to the ship-to state, cost and margin
 * kept for approval rules (discount / margin / credit conditions). On submission the customer's
 * credit is checked: over the limit (or with overdue bills) the order needs a credit approval rule,
 * or a user with the credit-override permission and a reason.
 */
@Injectable()
export class SalesOrdersService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly customFields: CustomFieldsService,
    private readonly print: PrintService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      onCancelled: async (tx, _auth, doc) => {
        const [moved] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(salesOrderLines)
          .where(and(eq(salesOrderLines.orderId, doc.id), sql`(${salesOrderLines.deliveredQty} > 0 or ${salesOrderLines.invoicedQty} > 0)`));
        if (moved.n) throw new ConflictException('Goods were delivered or invoiced against this order. Short-close it instead.');
      },
    });
    this.print.registerContext(DOC_TYPE, (tx, auth, id) => this.printContext(tx, auth, id));
  }

  list(auth: AuthContext, q: ListQuery) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const pending = sql`exists (select 1 from ${salesOrderLines} l where l.order_id = ${documents.id} and l.delivered_qty < l.qty)`;
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          revision: documents.revision,
          status: documents.status,
          docDate: documents.docDate,
          title: documents.title,
          customer: { id: parties.id, code: parties.code, name: parties.name },
          customerPoNo: salesOrders.customerPoNo,
          expectedDate: salesOrders.expectedDate,
          grandTotal: salesOrders.grandTotal,
          marginPct: salesOrders.marginPct,
          closedAt: salesOrders.closedAt,
          deliveredPct: sql<number>`(select coalesce(round(100 * sum(least(l.delivered_qty, l.qty)) / nullif(sum(l.qty), 0)), 0)::int from ${salesOrderLines} l where l.order_id = ${documents.id})`,
        })
        .from(documents)
        .innerJoin(salesOrders, eq(salesOrders.id, documents.id))
        .innerJoin(parties, eq(parties.id, salesOrders.customerId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status) : undefined,
            q.customerId ? eq(salesOrders.customerId, q.customerId) : undefined,
            q.pending === 'true' ? and(eq(documents.status, 'approved'), isNull(salesOrders.closedAt), pending) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(parties.name, `%${term}%`), ilike(salesOrders.customerPoNo, `%${term}%`)) : undefined,
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

  create(auth: AuthContext, input: CreateOrderInput, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta));
  }

  async createTx(tx: Transaction, auth: AuthContext, input: CreateOrderInput, meta: RequestMeta) {
    const customer = await loadCustomer(tx, input.customerId, input.shippingAddressId);
    const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields);
    const doc = await this.documents.create(tx, auth, { customFields, docType: DOC_TYPE, companyId: input.companyId, branchId: input.branchId, docDate: input.docDate ?? todayIST(), title: null, amount: null });
    const priced = await priceSelling(tx, doc, customer, input.lines, input.withLut);
    await tx.insert(salesOrders).values({ id: doc.id, tenantId: auth.tenantId, ...(await this.header(tx, doc, customer, input)), ...priced.header });
    await this.writeLines(tx, auth, doc.id, input.lines, priced.lines);
    const updated = await this.documents.update(tx, auth, doc, { title: this.title(customer.name, priced.lines), amount: priced.header.grandTotal });
    await this.documents.log(tx, auth, updated, 'document.created', meta, { customer: customer.code, amount: updated.amount });
    return this.view(tx, auth, updated);
  }

  update(auth: AuthContext, id: string, input: CreateOrderInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const [current] = await tx.select().from(salesOrders).where(eq(salesOrders.id, id));
      if (doc.revision > 0 && current.customerId !== input.customerId) fail([{ path: 'customerId', message: 'The customer of an amended order cannot change' }]);
      const customer = await loadCustomer(tx, input.customerId, input.shippingAddressId);
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields, doc.customFields);
      const scoped = await this.documents.update(tx, auth, doc, {
        customFields,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}),
      });
      const priced = await priceSelling(tx, scoped, customer, input.lines, input.withLut);
      await tx.update(salesOrders).set({ ...(await this.header(tx, scoped, customer, input)), ...priced.header }).where(eq(salesOrders.id, id));
      await this.writeLines(tx, auth, id, input.lines, priced.lines);
      const updated = await this.documents.update(tx, auth, scoped, { title: this.title(customer.name, priced.lines), amount: priced.header.grandTotal });
      await this.documents.activity(tx, auth, id, 'edited', doc.revision ? `Edited amendment (revision ${doc.revision})` : 'Edited the order');
      await this.documents.log(tx, auth, updated, 'document.updated', meta, { amount: { from: doc.amount, to: updated.amount } });
      return this.view(tx, auth, updated);
    });
  }

  remove(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      await this.documents.deleteDraft(tx, auth, doc, meta);
    });
  }

  /** Credit check, then the normal workflow with discount / margin / credit facts for approval rules. */
  submit(auth: AuthContext, id: string, version: number, overrideReason: string | null | undefined, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, id));
      const [cust] = await tx.select({ creditLimit: parties.creditLimit }).from(parties).where(eq(parties.id, so.customerId));
      const credit = await creditPosition(tx, so.customerId, cust.creditLimit, so.grandTotal, id);
      await tx.update(salesOrders).set({ creditCheck: credit as unknown as Record<string, unknown>, creditOverrideReason: null }).where(eq(salesOrders.id, id));
      const facts = { maxDiscountPct: so.maxDiscountPct, marginPct: so.marginPct, creditExceeded: credit.exceeded };
      if (credit.exceeded) {
        const rule = await this.documents.matchApprovalRule(tx, { ...doc, amount: so.grandTotal }, facts);
        const routed = rule?.condition === 'credit_exceeded';
        if (!routed) {
          const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
          if (!perms.has('sales.orders.credit_override')) throw new ConflictException(`Credit check failed: ${credit.reasons.join('; ')}. Ask someone with credit-override rights, or add an approval rule for credit exceptions.`);
          if (!overrideReason) throw new ForbiddenException({ message: `Credit check failed: ${credit.reasons.join('; ')}. Give a reason to override.`, errors: [{ path: 'creditOverrideReason', message: 'Reason needed to override the credit limit' }] });
          await tx.update(salesOrders).set({ creditOverrideReason: overrideReason }).where(eq(salesOrders.id, id));
          await this.documents.activity(tx, auth, id, 'status', `Credit limit overridden: ${overrideReason}`, { credit });
        }
      }
      await this.documents.submit(tx, auth, doc, meta, facts);
      return this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE));
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
      const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, id));
      const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, id));
      return this.view(tx, auth, await this.documents.amend(tx, auth, doc, { header: doc, order: so, lines } as unknown as Record<string, unknown>, reason, meta));
    });
  }

  shortClose(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      if (doc.status !== 'approved') throw new ConflictException('Only approved orders can be short-closed');
      await tx.update(salesOrders).set({ closedAt: new Date(), closeReason: reason }).where(eq(salesOrders.id, id));
      const updated = await this.documents.update(tx, auth, doc, { status: 'completed' });
      await this.documents.activity(tx, auth, id, 'status', 'Short-closed: the rest will not be supplied', { reason });
      await this.documents.log(tx, auth, updated, 'sales.order.short_closed', meta, { reason });
      return this.view(tx, auth, updated);
    });
  }

  /** Lines still to deliver, with what is available in the dispatch warehouse. */
  deliverable(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.find(tx, id, DOC_TYPE);
      const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, id));
      const lines = await this.lineRows(tx, id);
      const stockIds = lines.filter((l) => l.isStockItem).map((l) => l.itemId);
      const onHand = so.warehouseId && stockIds.length
        ? await tx
            .select({ itemId: stockBalances.itemId, qty: sql<string>`sum(${stockBalances.qty})::text` })
            .from(stockBalances)
            .where(and(eq(stockBalances.warehouseId, so.warehouseId), inArray(stockBalances.itemId, stockIds)))
            .groupBy(stockBalances.itemId)
        : [];
      return {
        id,
        number: doc.number,
        status: doc.status,
        closed: !!so.closedAt,
        customerId: so.customerId,
        warehouseId: so.warehouseId,
        lines: lines.map((l) => ({
          ...l,
          pendingQty: maxZero(D(l.qty).sub(D(l.deliveredQty))),
          availableBaseQty: l.isStockItem ? D(onHand.find((o) => o.itemId === l.itemId)?.qty ?? '0').toFixed(4) : null,
        })),
      };
    });
  }

  /**
   * Available to promise per item: on hand in nettable stores (or one warehouse) − reserved for
   * approved orders not yet delivered = available; plus what is on order from vendors.
   */
  atp(auth: AuthContext, itemIds: string[], warehouseId?: string) {
    return this.database.run(auth, async (tx) => {
      if (!itemIds.length) return [];
      const onHand = await tx
        .select({ itemId: stockValuation.itemId, qty: sql<string>`sum(${stockValuation.qty})::text` })
        .from(stockValuation)
        .innerJoin(warehouses, eq(warehouses.id, stockValuation.warehouseId))
        .where(and(inArray(stockValuation.itemId, itemIds), warehouseId ? eq(warehouses.id, warehouseId) : eq(warehouses.isNettable, true)))
        .groupBy(stockValuation.itemId);
      const reserved = await tx
        .select({ itemId: salesOrderLines.itemId, qty: sql<string>`sum(greatest(${salesOrderLines.qty} - ${salesOrderLines.deliveredQty}, 0) * ${salesOrderLines.conversionFactor})::text` })
        .from(salesOrderLines)
        .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
        .innerJoin(documents, eq(documents.id, salesOrders.id))
        .where(and(inArray(salesOrderLines.itemId, itemIds), eq(documents.status, 'approved'), isNull(salesOrders.closedAt), warehouseId ? eq(salesOrders.warehouseId, warehouseId) : undefined))
        .groupBy(salesOrderLines.itemId);
      const incoming = await tx
        .select({ itemId: purchaseOrderLines.itemId, qty: sql<string>`sum(greatest(${purchaseOrderLines.qty} - ${purchaseOrderLines.receivedQty}, 0) * ${purchaseOrderLines.conversionFactor})::text`, nextDate: sql<string | null>`min(${purchaseOrders.expectedDate})::text` })
        .from(purchaseOrderLines)
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId))
        .innerJoin(documents, eq(documents.id, purchaseOrders.id))
        .where(and(inArray(purchaseOrderLines.itemId, itemIds), eq(documents.status, 'approved'), isNull(purchaseOrders.closedAt)))
        .groupBy(purchaseOrderLines.itemId);
      return itemIds.map((itemId) => {
        const h = D(onHand.find((x) => x.itemId === itemId)?.qty ?? '0');
        const r = D(reserved.find((x) => x.itemId === itemId)?.qty ?? '0');
        const inc = incoming.find((x) => x.itemId === itemId);
        return { itemId, onHand: h.toFixed(4), reserved: r.toFixed(4), available: h.sub(r).toFixed(4), onOrder: D(inc?.qty ?? '0').toFixed(4), nextReceipt: inc?.nextDate ?? null };
      });
    });
  }

  /** Recomputes completion: delivered and invoiced in full → completed (unless short-closed). */
  async syncStatus(tx: Transaction, auth: AuthContext, orderId: string) {
    const doc = await this.documents.lock(tx, orderId, DOC_TYPE);
    const [so] = await tx.select({ closedAt: salesOrders.closedAt }).from(salesOrders).where(eq(salesOrders.id, orderId));
    if (so.closedAt) return;
    // Services are never delivered: they are done once invoiced.
    const [{ open }] = await tx
      .select({ open: sql<number>`count(*) filter (where (${items.isStockItem} and ${salesOrderLines.deliveredQty} < ${salesOrderLines.qty}) or ${salesOrderLines.invoicedQty} < ${salesOrderLines.qty})::int` })
      .from(salesOrderLines)
      .innerJoin(items, eq(items.id, salesOrderLines.itemId))
      .where(eq(salesOrderLines.orderId, orderId));
    if (!open && doc.status === 'approved') {
      await this.documents.update(tx, auth, doc, { status: 'completed' });
      await this.documents.activity(tx, auth, orderId, 'status', 'Delivered and invoiced in full');
    } else if (open && doc.status === 'completed') {
      await this.documents.update(tx, auth, doc, { status: 'approved' });
      await this.documents.activity(tx, auth, orderId, 'status', 'Reopened');
    }
  }

  // ---- helpers -----------------------------------------------------------------------

  private async header(tx: Transaction, doc: DocumentRow, customer: CustomerSnapshot, input: CreateOrderInput) {
    let warehouseId = input.warehouseId ?? null;
    if (warehouseId) {
      const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, warehouseId));
      if (!wh || wh.companyId !== doc.companyId) fail([{ path: 'warehouseId', message: 'Unknown warehouse for this company' }]);
    } else {
      const [wh] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, doc.companyId), eq(warehouses.isActive, true), eq(warehouses.isNettable, true)))
        .orderBy(sql`case when ${warehouses.code} = 'MAIN' then 0 else 1 end`, asc(warehouses.code))
        .limit(1);
      warehouseId = wh?.id ?? null;
    }
    return {
      ...customerColumns(customer, input.withLut),
      quotationId: input.quotationId ?? null,
      customerPoNo: input.customerPoNo,
      customerPoDate: input.customerPoDate ?? null,
      warehouseId,
      expectedDate: input.expectedDate ?? null,
      priceListId: customer.priceListId,
      paymentTerms: input.paymentTerms ?? customer.paymentTerms,
      creditDays: input.creditDays ?? customer.creditDays,
      terms: input.terms,
      notes: input.notes,
    };
  }

  /** Upserts by id so amended orders keep deliveries; protects delivered / invoiced quantities. */
  private async writeLines(tx: Transaction, auth: AuthContext, orderId: string, input: SellingLineInput[], priced: Awaited<ReturnType<typeof priceSelling>>['lines']) {
    const existing = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));
    const errors: Err[] = [];
    input.forEach((l, i) => {
      if (!l.id) return;
      const old = existing.find((e) => e.id === l.id);
      if (!old) return errors.push({ path: `lines.${i}.id`, message: 'Line not found on this order' });
      const done = D(old.deliveredQty).cmp(D(old.invoicedQty)) > 0 ? D(old.deliveredQty) : D(old.invoicedQty);
      if (done.cmp(ZERO) > 0) {
        if (old.itemId !== l.itemId || old.uomId !== priced[i].uomId) errors.push({ path: `lines.${i}.itemId`, message: 'Goods were delivered or invoiced on this line: item and unit cannot change' });
        if (D(l.qty).cmp(done) < 0) errors.push({ path: `lines.${i}.qty`, message: `Already ${trim(done)} delivered or invoiced; the quantity cannot be lower` });
      }
    });
    const kept = new Set(input.map((l) => l.id).filter(Boolean));
    const removed = existing.filter((e) => !kept.has(e.id));
    if (removed.length) {
      const used = await tx.select({ id: deliveryNoteLines.soLineId }).from(deliveryNoteLines).where(inArray(deliveryNoteLines.soLineId, removed.map((r) => r.id)));
      const billed = await tx.select({ id: salesInvoiceLines.soLineId }).from(salesInvoiceLines).where(inArray(salesInvoiceLines.soLineId, removed.map((r) => r.id)));
      for (const r of removed) if (used.some((u) => u.id === r.id) || billed.some((b) => b.id === r.id)) errors.push({ path: 'lines', message: `Line ${r.lineNo} (${r.description}) has deliveries or invoices and cannot be removed` });
    }
    if (errors.length) fail(errors);
    if (removed.length) await tx.delete(salesOrderLines).where(inArray(salesOrderLines.id, removed.map((r) => r.id)));
    await tx.update(salesOrderLines).set({ lineNo: sql`${salesOrderLines.lineNo} + 10000` }).where(eq(salesOrderLines.orderId, orderId));
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
        listRate: p.listRate,
        rate: p.rate,
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
        unitCost: p.unitCost,
        deliveryDate: l.deliveryDate ?? null,
        quotationLineId: l.quotationLineId ?? null,
        remarks: l.remarks,
      };
      if (l.id) await tx.update(salesOrderLines).set(values).where(eq(salesOrderLines.id, l.id));
      else await tx.insert(salesOrderLines).values({ ...values, tenantId: auth.tenantId, orderId });
    }
  }

  private title(name: string, lines: { description: string }[]) {
    const [first, ...rest] = lines;
    return `${name}: ${first.description}${rest.length ? ` + ${rest.length} more` : ''}`.slice(0, 200);
  }

  async lineRows(tx: Transaction, orderId: string) {
    const rows = await tx
      .select({ l: salesOrderLines, itemCode: items.code, itemName: items.name, isStockItem: items.isStockItem, trackBatch: items.trackBatch, trackSerial: items.trackSerial, uomCode: uoms.code, uomDecimals: uoms.decimals })
      .from(salesOrderLines)
      .innerJoin(items, eq(items.id, salesOrderLines.itemId))
      .innerJoin(uoms, eq(uoms.id, salesOrderLines.uomId))
      .where(eq(salesOrderLines.orderId, orderId))
      .orderBy(asc(salesOrderLines.lineNo));
    return rows.map(({ l: { tenantId: _t, orderId: _o, ...l }, ...rest }) => ({ ...l, ...rest }));
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('sales.orders.manage'), cancel: perms.has('sales.orders.cancel') });
    const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, doc.id));
    const [customer] = await tx.select({ id: parties.id, code: parties.code, name: parties.name, creditLimit: parties.creditLimit }).from(parties).where(eq(parties.id, so.customerId));
    const [wh] = so.warehouseId ? await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, so.warehouseId)) : [];
    const lines = (await this.lineRows(tx, doc.id)).map((l) => ({ ...l, pendingQty: maxZero(D(l.qty).sub(D(l.deliveredQty))), toInvoiceQty: maxZero(D(l.qty).sub(D(l.invoicedQty))) }));
    const deliveries = await tx
      .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate })
      .from(deliveryNotes)
      .innerJoin(documents, eq(documents.id, deliveryNotes.id))
      .where(eq(deliveryNotes.orderId, doc.id))
      .orderBy(desc(documents.id));
    const invoices = await tx
      .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, amount: salesInvoices.grandTotal })
      .from(salesInvoices)
      .innerJoin(documents, eq(documents.id, salesInvoices.id))
      .where(eq(salesInvoices.orderId, doc.id))
      .orderBy(desc(documents.id));
    const { tenantId: _t, id: _i, customerId: _c, warehouseId: _w, ...rest } = so;
    const open = doc.status === 'approved' && !so.closedAt;
    const pendingDelivery = lines.some((l) => l.isStockItem && Number(l.pendingQty) > 0);
    const pendingInvoice = lines.some((l) => Number(l.toInvoiceQty) > 0);
    return {
      ...header,
      ...rest,
      customer: { ...customer, gstin: so.customerGstin, stateCode: so.customerStateCode, registration: so.customerRegistration },
      warehouse: wh ?? null,
      stateTaxLabel: so.placeOfSupply && UTGST_STATES.has(so.placeOfSupply) ? 'UTGST' : 'SGST',
      lines,
      deliveries,
      invoices,
      canDeliver: open && pendingDelivery && perms.has('sales.deliveries.manage'),
      canInvoice: open && pendingInvoice && perms.has('sales.invoices.manage'),
      canShortClose: open && (pendingDelivery || pendingInvoice) && perms.has('sales.orders.cancel'),
    };
  }

  private async printContext(tx: Transaction, auth: AuthContext, id: string) {
    const doc = await this.documents.find(tx, id, DOC_TYPE);
    const view = await this.view(tx, auth, doc);
    const [company] = await tx.select({ name: companies.name, legalName: companies.legalName, gstin: companies.gstin, address: companies.address }).from(companies).where(eq(companies.id, doc.companyId));
    const [printer] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, auth.userId));
    return { company, doc: view, customer: view.customer, lines: view.lines, stateTaxLabel: view.stateTaxLabel, title: 'Sales Order Confirmation', printedBy: printer?.name ?? '', printedAt: new Date().toISOString() };
  }
}

function maxZero(d: Decimal) {
  return (d.isNegative() ? Decimal.from('0') : d).toFixed(4);
}

export { maxZero };
