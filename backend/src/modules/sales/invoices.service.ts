import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  companies,
  creditNotes,
  deliveryNoteLines,
  deliveryNotes,
  documents,
  items,
  parties,
  salesInvoiceLines,
  salesInvoices,
  salesOrderLines,
  salesOrders,
  type Transaction,
  uoms,
  users,
  warehouses,
} from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { CustomFieldsService } from '../customization/custom-fields.service';
import { EInvoiceService } from '../compliance/einvoice.service';
import { assertNoActiveEwb } from '../compliance/guards';
import { PrintService } from '../customization/print.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { GST_STATE_NAME, UTGST_STATES } from '../gst/gst-engine';
import { ownGstRegistration } from '../gst/pricing';
import { dueDate } from '../gst/tds';
import { StockService, type StockMove } from '../inventory/stock.service';
import { customerColumns, fail, loadCustomer, priceSelling, trim, type CustomerSnapshot, type Err } from './common';
import { SalesOrdersService } from './orders.service';
import type { CreateInvoiceInput, InvoiceLineInput, ListQuery } from './sales.schemas';

const DOC_TYPE = 'sales_invoice' as const;
const D = Decimal.from;
const ZERO = D('0');

/**
 * Tax invoice / bill of supply / export invoice. Lines bill a posted delivery (goods already
 * out), an order line (services, or goods dispatched with the invoice), or nothing (direct sale).
 * Goods not yet delivered leave stock when the invoice is approved (invoice-cum-challan).
 */
@Injectable()
export class SalesInvoicesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly customFields: CustomFieldsService,
    private readonly stock: StockService,
    private readonly orders: SalesOrdersService,
    private readonly print: PrintService,
    private readonly einvoice: EInvoiceService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      amendable: false,
      onApproved: (tx, auth, doc) => this.post(tx, auth, doc),
      onCancelled: (tx, auth, doc) => this.unpost(tx, auth, doc),
    });
    this.print.registerContext(DOC_TYPE, (tx, auth, id) => this.printContext(tx, auth, id));
  }

  list(auth: AuthContext, q: ListQuery) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const outstanding = sql<string>`(${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount})`;
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          customer: { id: parties.id, code: parties.code, name: parties.name },
          taxKind: salesInvoices.taxKind,
          grandTotal: salesInvoices.grandTotal,
          outstanding: sql<string>`${outstanding}::numeric(18,2)::text`,
          dueDate: salesInvoices.dueDate,
          irn: salesInvoices.irn,
          ewayBillNo: salesInvoices.ewayBillNo,
        })
        .from(documents)
        .innerJoin(salesInvoices, eq(salesInvoices.id, documents.id))
        .innerJoin(parties, eq(parties.id, salesInvoices.customerId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status) : undefined,
            q.customerId ? eq(salesInvoices.customerId, q.customerId) : undefined,
            q.pending === 'true' ? and(eq(documents.status, 'approved'), sql`${outstanding} > 0`) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(parties.name, `%${term}%`), ilike(salesInvoices.customerPoNo, `%${term}%`)) : undefined,
            q.cursor ? lt(documents.id, q.cursor) : undefined,
          ),
        )
        .orderBy(q.pending === 'true' ? asc(salesInvoices.dueDate) : desc(documents.id), desc(documents.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      const today = todayIST();
      return { items: page.map((r) => ({ ...r, daysToDue: r.dueDate ? Math.round((Date.parse(r.dueDate) - Date.parse(today)) / 86_400_000) : null })), nextCursor: hasMore ? page[page.length - 1].id : null };
    });
  }

  /** What can be invoiced for a customer: posted deliveries not yet billed, and order lines for services. */
  billable(auth: AuthContext, customerId: string, orderId?: string) {
    return this.database.run(auth, async (tx) => {
      const deliveryLines = await tx
        .select({
          dlvLineId: deliveryNoteLines.id,
          deliveryId: deliveryNotes.id,
          deliveryNumber: documents.number,
          deliveryDate: documents.docDate,
          orderId: deliveryNotes.orderId,
          soLineId: deliveryNoteLines.soLineId,
          itemId: deliveryNoteLines.itemId,
          itemCode: items.code,
          itemName: items.name,
          uomId: deliveryNoteLines.uomId,
          uomCode: uoms.code,
          pendingQty: sql<string>`(${deliveryNoteLines.qty} - ${deliveryNoteLines.invoicedQty})::text`,
          rate: salesOrderLines.rate,
          discountPct: salesOrderLines.discountPct,
          batchNo: deliveryNoteLines.batchNo,
        })
        .from(deliveryNoteLines)
        .innerJoin(deliveryNotes, eq(deliveryNotes.id, deliveryNoteLines.deliveryId))
        .innerJoin(documents, eq(documents.id, deliveryNotes.id))
        .innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryNoteLines.soLineId))
        .innerJoin(items, eq(items.id, deliveryNoteLines.itemId))
        .innerJoin(uoms, eq(uoms.id, deliveryNoteLines.uomId))
        .where(and(eq(deliveryNotes.customerId, customerId), eq(documents.status, 'approved'), orderId ? eq(deliveryNotes.orderId, orderId) : undefined, sql`${deliveryNoteLines.qty} > ${deliveryNoteLines.invoicedQty}`))
        .orderBy(asc(documents.docDate), asc(deliveryNoteLines.lineNo));
      const orderLines = await tx
        .select({
          soLineId: salesOrderLines.id,
          orderId: salesOrders.id,
          orderNumber: documents.number,
          itemId: salesOrderLines.itemId,
          itemCode: items.code,
          itemName: items.name,
          isStockItem: items.isStockItem,
          description: salesOrderLines.description,
          uomId: salesOrderLines.uomId,
          uomCode: uoms.code,
          /** Services: not yet invoiced. Goods: not yet delivered (invoice-cum-challan). */
          pendingQty: sql<string>`(case when ${items.isStockItem} then ${salesOrderLines.qty} - greatest(${salesOrderLines.deliveredQty}, ${salesOrderLines.invoicedQty}) else ${salesOrderLines.qty} - ${salesOrderLines.invoicedQty} end)::text`,
          rate: salesOrderLines.rate,
          discountPct: salesOrderLines.discountPct,
        })
        .from(salesOrderLines)
        .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
        .innerJoin(documents, eq(documents.id, salesOrders.id))
        .innerJoin(items, eq(items.id, salesOrderLines.itemId))
        .innerJoin(uoms, eq(uoms.id, salesOrderLines.uomId))
        .where(
          and(
            eq(salesOrders.customerId, customerId),
            eq(documents.status, 'approved'),
            sql`${salesOrders.closedAt} is null`,
            orderId ? eq(salesOrders.id, orderId) : undefined,
            sql`(case when ${items.isStockItem} then ${salesOrderLines.qty} - greatest(${salesOrderLines.deliveredQty}, ${salesOrderLines.invoicedQty}) else ${salesOrderLines.qty} - ${salesOrderLines.invoicedQty} end) > 0`,
          ),
        )
        .orderBy(asc(documents.docDate), asc(salesOrderLines.lineNo));
      return { deliveryLines, orderLines };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE)));
  }

  create(auth: AuthContext, input: CreateInvoiceInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const customer = await loadCustomer(tx, input.customerId, input.shippingAddressId);
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields);
      const doc = await this.documents.create(tx, auth, { customFields, docType: DOC_TYPE, companyId: input.companyId, branchId: input.branchId, docDate: input.docDate ?? todayIST(), title: null, amount: null });
      const prepared = await this.prepare(tx, doc, customer, input);
      await tx.insert(salesInvoices).values({ id: doc.id, tenantId: auth.tenantId, ...prepared.header });
      await this.writeLines(tx, auth, doc.id, prepared.lines);
      const updated = await this.documents.update(tx, auth, doc, { title: prepared.title, amount: prepared.header.grandTotal });
      await this.documents.log(tx, auth, updated, 'document.created', meta, { customer: customer.code, amount: updated.amount });
      return this.view(tx, auth, updated);
    });
  }

  update(auth: AuthContext, id: string, input: CreateInvoiceInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const customer = await loadCustomer(tx, input.customerId, input.shippingAddressId);
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields, doc.customFields);
      const scoped = await this.documents.update(tx, auth, doc, { customFields, ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}) });
      const prepared = await this.prepare(tx, scoped, customer, input);
      await tx.update(salesInvoices).set(prepared.header).where(eq(salesInvoices.id, id));
      await tx.delete(salesInvoiceLines).where(eq(salesInvoiceLines.invoiceId, id));
      await this.writeLines(tx, auth, id, prepared.lines);
      const updated = await this.documents.update(tx, auth, scoped, { title: prepared.title, amount: prepared.header.grandTotal });
      await this.documents.log(tx, auth, updated, 'document.updated', meta);
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
    const [inv] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, doc.id));
    const lines = await tx.select().from(salesInvoiceLines).where(eq(salesInvoiceLines.invoiceId, doc.id)).orderBy(asc(salesInvoiceLines.lineNo));
    const dlvLines = await this.lockDelivery(tx, lines);
    const soIds = [...new Set(lines.map((l) => l.soLineId).filter((v): v is string => !!v))];
    const soLines = soIds.length ? await tx.select().from(salesOrderLines).where(inArray(salesOrderLines.id, soIds)).for('update') : [];
    const stockItems = new Set((await tx.select({ id: items.id }).from(items).where(and(inArray(items.id, lines.map((l) => l.itemId)), eq(items.isStockItem, true)))).map((i) => i.id));

    const errors: Err[] = [];
    for (const [i, l] of lines.entries()) {
      if (l.dlvLineId) {
        const dl = dlvLines.find((d) => d.id === l.dlvLineId)!;
        const open = D(dl.qty).sub(D(dl.invoicedQty));
        if (D(l.qty).cmp(open) > 0) errors.push({ path: `lines.${i}.qty`, message: `Line ${l.lineNo}: only ${trim(open)} delivered and not yet invoiced` });
      } else if (l.soLineId) {
        const s = soLines.find((x) => x.id === l.soLineId)!;
        const done = stockItems.has(l.itemId) ? (D(s.deliveredQty).cmp(D(s.invoicedQty)) > 0 ? D(s.deliveredQty) : D(s.invoicedQty)) : D(s.invoicedQty);
        const open = D(s.qty).sub(done);
        if (D(l.qty).cmp(open) > 0) errors.push({ path: `lines.${i}.qty`, message: `Line ${l.lineNo}: only ${trim(open)} left on the order` });
      }
    }
    if (errors.length) fail(errors);

    // Goods not delivered yet leave stock with the invoice.
    const direct = lines.filter((l) => !l.dlvLineId && stockItems.has(l.itemId));
    if (direct.length && !inv.warehouseId) fail([{ path: 'warehouseId', message: 'Choose the warehouse the goods leave from' }]);
    const moves: StockMove[] = direct.map((l) => ({ itemId: l.itemId, warehouseId: inv.warehouseId!, qty: ZERO.sub(D(l.baseQty)).toFixed(4), rate: null, batchNo: l.batchNo, serialNos: l.serialNos, line: l.lineNo }));
    const posted = await this.stock.post(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate }, moves);

    let cost = ZERO;
    for (const l of lines) {
      let lineCost = ZERO;
      if (l.dlvLineId) {
        const dl = dlvLines.find((d) => d.id === l.dlvLineId)!;
        lineCost = D(dl.costValue).mul(D(l.qty)).div(D(dl.qty));
        await tx.update(deliveryNoteLines).set({ invoicedQty: sql`${deliveryNoteLines.invoicedQty} + ${l.qty}::numeric` }).where(eq(deliveryNoteLines.id, l.dlvLineId));
        await tx.update(salesOrderLines).set({ invoicedQty: sql`${salesOrderLines.invoicedQty} + ${l.qty}::numeric` }).where(eq(salesOrderLines.id, dl.soLineId));
      } else {
        const i = direct.findIndex((x) => x.id === l.id);
        if (i >= 0) lineCost = D(posted[i].value.replace('-', ''));
        if (l.soLineId) {
          await tx
            .update(salesOrderLines)
            .set({ invoicedQty: sql`${salesOrderLines.invoicedQty} + ${l.qty}::numeric`, ...(stockItems.has(l.itemId) ? { deliveredQty: sql`${salesOrderLines.deliveredQty} + ${l.qty}::numeric` } : {}) })
            .where(eq(salesOrderLines.id, l.soLineId));
        }
      }
      cost = cost.add(lineCost);
      await tx.update(salesInvoiceLines).set({ costValue: lineCost.toFixed(2) }).where(eq(salesInvoiceLines.id, l.id));
    }
    await tx.update(salesInvoices).set({ costTotal: cost.toFixed(2) }).where(eq(salesInvoices.id, doc.id));
    for (const orderId of await this.ordersOf(tx, lines)) await this.orders.syncStatus(tx, auth, orderId);
    await this.einvoice.onApproved(tx, auth, doc);
  }

  private async unpost(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [notes] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(creditNotes)
      .innerJoin(documents, eq(documents.id, creditNotes.id))
      .where(and(eq(creditNotes.invoiceId, doc.id), ne(documents.status, 'cancelled')));
    if (notes.n) throw new ConflictException('Cancel the credit notes against this invoice first');
    const [inv] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, doc.id));
    if (D(inv.receivedAmount).cmp(ZERO) > 0) throw new ConflictException('Payment has been received against this invoice');
    await this.einvoice.assertCancellable(tx, doc.id, DOC_TYPE);
    await assertNoActiveEwb(tx, doc.id);
    const lines = await tx.select().from(salesInvoiceLines).where(eq(salesInvoiceLines.invoiceId, doc.id));
    const stockItems = new Set((await tx.select({ id: items.id }).from(items).where(and(inArray(items.id, lines.map((l) => l.itemId)), eq(items.isStockItem, true)))).map((i) => i.id));
    await this.stock.reverseVoucher(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate });
    for (const l of lines) {
      if (l.dlvLineId) {
        const [dl] = await tx.select({ soLineId: deliveryNoteLines.soLineId }).from(deliveryNoteLines).where(eq(deliveryNoteLines.id, l.dlvLineId));
        await tx.update(deliveryNoteLines).set({ invoicedQty: sql`${deliveryNoteLines.invoicedQty} - ${l.qty}::numeric` }).where(eq(deliveryNoteLines.id, l.dlvLineId));
        await tx.update(salesOrderLines).set({ invoicedQty: sql`${salesOrderLines.invoicedQty} - ${l.qty}::numeric` }).where(eq(salesOrderLines.id, dl.soLineId));
      } else if (l.soLineId) {
        await tx
          .update(salesOrderLines)
          .set({ invoicedQty: sql`${salesOrderLines.invoicedQty} - ${l.qty}::numeric`, ...(stockItems.has(l.itemId) ? { deliveredQty: sql`${salesOrderLines.deliveredQty} - ${l.qty}::numeric` } : {}) })
          .where(eq(salesOrderLines.id, l.soLineId));
      }
    }
    for (const orderId of await this.ordersOf(tx, lines)) await this.orders.syncStatus(tx, auth, orderId);
  }

  private async lockDelivery(tx: Transaction, lines: { dlvLineId: string | null }[]) {
    const ids = lines.map((l) => l.dlvLineId).filter((v): v is string => !!v);
    return ids.length ? tx.select().from(deliveryNoteLines).where(inArray(deliveryNoteLines.id, ids)).for('update') : Promise.resolve([] as (typeof deliveryNoteLines.$inferSelect)[]);
  }

  private async ordersOf(tx: Transaction, lines: { soLineId: string | null; dlvLineId: string | null }[]) {
    const soLineIds = new Set(lines.map((l) => l.soLineId).filter((v): v is string => !!v));
    const dl = lines.map((l) => l.dlvLineId).filter((v): v is string => !!v);
    if (dl.length) for (const r of await tx.select({ id: deliveryNoteLines.soLineId }).from(deliveryNoteLines).where(inArray(deliveryNoteLines.id, dl))) soLineIds.add(r.id);
    if (!soLineIds.size) return [];
    return [...new Set((await tx.select({ orderId: salesOrderLines.orderId }).from(salesOrderLines).where(inArray(salesOrderLines.id, [...soLineIds]))).map((r) => r.orderId))];
  }

  // ---- preparation -----------------------------------------------------------------

  private async prepare(tx: Transaction, doc: DocumentRow, customer: CustomerSnapshot, input: CreateInvoiceInput) {
    const errors: Err[] = [];
    const dlvIds = input.lines.map((l) => l.dlvLineId).filter((v): v is string => !!v);
    const soIds = input.lines.map((l) => l.soLineId).filter((v): v is string => !!v);
    const dlv = dlvIds.length
      ? await tx
          .select({ l: deliveryNoteLines, customerId: deliveryNotes.customerId, status: documents.status, warehouseId: deliveryNotes.warehouseId, rate: salesOrderLines.rate, discountPct: salesOrderLines.discountPct, orderId: salesOrderLines.orderId })
          .from(deliveryNoteLines)
          .innerJoin(deliveryNotes, eq(deliveryNotes.id, deliveryNoteLines.deliveryId))
          .innerJoin(documents, eq(documents.id, deliveryNotes.id))
          .innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryNoteLines.soLineId))
          .where(inArray(deliveryNoteLines.id, dlvIds))
      : [];
    const so = soIds.length
      ? await tx
          .select({ l: salesOrderLines, customerId: salesOrders.customerId, status: documents.status, closedAt: salesOrders.closedAt, warehouseId: salesOrders.warehouseId })
          .from(salesOrderLines)
          .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
          .innerJoin(documents, eq(documents.id, salesOrders.id))
          .where(inArray(salesOrderLines.id, soIds))
      : [];
    const itemRows = await tx.select({ id: items.id, code: items.code, isStockItem: items.isStockItem, trackBatch: items.trackBatch, trackSerial: items.trackSerial }).from(items).where(inArray(items.id, [...new Set(input.lines.map((l) => l.itemId))]));

    const lines: (InvoiceLineInput & { soLineId: string | null })[] = input.lines.map((l, i) => {
      const p = `lines.${i}`;
      const it = itemRows.find((x) => x.id === l.itemId);
      if (l.dlvLineId) {
        const d = dlv.find((x) => x.l.id === l.dlvLineId);
        if (!d) {
          errors.push({ path: `${p}.dlvLineId`, message: 'Delivery line not found' });
          return { ...l, soLineId: null };
        }
        if (d.customerId !== customer.id) errors.push({ path: `${p}.dlvLineId`, message: 'That delivery is for another customer' });
        if (d.status !== 'approved') errors.push({ path: `${p}.dlvLineId`, message: 'Invoice only posted deliveries' });
        if (d.l.itemId !== l.itemId) errors.push({ path: `${p}.itemId`, message: 'Item differs from the delivery' });
        const open = D(d.l.qty).sub(D(d.l.invoicedQty));
        if (D(l.qty).cmp(open) > 0) errors.push({ path: `${p}.qty`, message: `Only ${trim(open)} delivered and not yet invoiced` });
        return { ...l, uomId: d.l.uomId, rate: l.rate ?? d.rate, discountPct: l.discountPct ?? d.discountPct, batchNo: d.l.batchNo, serialNos: d.l.serialNos, soLineId: d.l.soLineId };
      }
      if (l.soLineId) {
        const s = so.find((x) => x.l.id === l.soLineId);
        if (!s) {
          errors.push({ path: `${p}.soLineId`, message: 'Order line not found' });
          return { ...l, soLineId: null };
        }
        if (s.customerId !== customer.id) errors.push({ path: `${p}.soLineId`, message: 'That order is for another customer' });
        if (s.status !== 'approved' || s.closedAt) errors.push({ path: `${p}.soLineId`, message: 'Invoice only open, approved orders' });
        if (s.l.itemId !== l.itemId) errors.push({ path: `${p}.itemId`, message: 'Item differs from the order' });
        const done = it?.isStockItem ? (D(s.l.deliveredQty).cmp(D(s.l.invoicedQty)) > 0 ? D(s.l.deliveredQty) : D(s.l.invoicedQty)) : D(s.l.invoicedQty);
        const open = D(s.l.qty).sub(done);
        if (D(l.qty).cmp(open) > 0) errors.push({ path: `${p}.qty`, message: `Only ${trim(open)} left on the order` });
        return { ...l, uomId: s.l.uomId, rate: l.rate ?? s.l.rate, discountPct: l.discountPct ?? s.l.discountPct, soLineId: s.l.id };
      }
      return { ...l, soLineId: null };
    });
    // Stock leaving with the invoice needs batch / serial details.
    lines.forEach((l, i) => {
      const it = itemRows.find((x) => x.id === l.itemId);
      if (!it || l.dlvLineId || !it.isStockItem) return;
      if (it.trackBatch && !l.batchNo) errors.push({ path: `lines.${i}.batchNo`, message: `${it.code} needs a batch number` });
    });
    if (errors.length) fail(errors);

    const orderIds = new Set([...dlv.map((d) => d.orderId), ...so.map((s) => s.l.orderId)]);
    const [order] = orderIds.size === 1 ? await tx.select().from(salesOrders).where(eq(salesOrders.id, [...orderIds][0])) : [];
    const needsWarehouse = lines.some((l) => !l.dlvLineId && itemRows.find((x) => x.id === l.itemId)?.isStockItem);
    let warehouseId = input.warehouseId ?? (needsWarehouse ? (order?.warehouseId ?? null) : null);
    if (needsWarehouse && !warehouseId) {
      const [wh] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.companyId, doc.companyId), eq(warehouses.isActive, true), eq(warehouses.isNettable, true))).orderBy(sql`case when ${warehouses.code} = 'MAIN' then 0 else 1 end`).limit(1);
      warehouseId = wh?.id ?? null;
    }
    const withLut = input.withLut || (order?.withLut ?? false);
    const priced = await priceSelling(tx, doc, customer, lines, withLut);
    const credit = input.creditDays ?? order?.creditDays ?? customer.creditDays;
    return {
      title: `${customer.name}: ${priced.lines[0].description}${priced.lines.length > 1 ? ` + ${priced.lines.length - 1} more` : ''}`.slice(0, 200),
      header: {
        ...customerColumns(customer, withLut),
        orderId: order?.id ?? null,
        customerPoNo: input.customerPoNo ?? order?.customerPoNo ?? null,
        customerPoDate: input.customerPoDate ?? order?.customerPoDate ?? null,
        warehouseId,
        paymentTerms: input.paymentTerms ?? order?.paymentTerms ?? customer.paymentTerms,
        creditDays: credit,
        dueDate: dueDate(doc.docDate, credit, null).dueDate,
        transporter: input.transporter,
        vehicleNo: input.vehicleNo?.toUpperCase().replace(/[\s-]/g, '') ?? null,
        lrNo: input.lrNo,
        terms: input.terms,
        notes: input.notes,
        ...priced.header,
      },
      lines: priced.lines.map((p, i) => ({ ...p, discountPct: lines[i].discountPct ?? '0', soLineId: lines[i].soLineId, dlvLineId: lines[i].dlvLineId ?? null, batchNo: lines[i].batchNo ?? null, serialNos: lines[i].serialNos?.map((s) => s.toUpperCase()) ?? null, remarks: lines[i].remarks ?? null })),
    };
  }

  private async writeLines(tx: Transaction, auth: AuthContext, invoiceId: string, lines: Awaited<ReturnType<SalesInvoicesService['prepare']>>['lines']) {
    await tx.insert(salesInvoiceLines).values(
      lines.map((p) => ({
        tenantId: auth.tenantId,
        invoiceId,
        lineNo: p.lineNo,
        itemId: p.itemId,
        description: p.description,
        uomId: p.uomId,
        qty: p.qty,
        conversionFactor: p.conversionFactor,
        baseQty: p.baseQty,
        listRate: p.listRate,
        rate: p.rate,
        discountPct: p.discountPct ?? '0',
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
        soLineId: p.soLineId,
        dlvLineId: p.dlvLineId,
        batchNo: p.batchNo,
        serialNos: p.serialNos,
        remarks: p.remarks,
      })),
    );
  }

  async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('sales.invoices.manage'), cancel: perms.has('sales.invoices.cancel') });
    const [inv] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, doc.id));
    const [customer] = await tx.select({ id: parties.id, code: parties.code, name: parties.name, legalName: parties.legalName }).from(parties).where(eq(parties.id, inv.customerId));
    const [order] = inv.orderId ? await tx.select({ id: documents.id, number: documents.number }).from(documents).where(eq(documents.id, inv.orderId)) : [];
    const [wh] = inv.warehouseId ? await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, inv.warehouseId)) : [];
    const rows = await tx
      .select({ l: salesInvoiceLines, itemCode: items.code, isStockItem: items.isStockItem, uomCode: uoms.code, uqc: uoms.uqc, deliveryNumber: sql<string | null>`(select d.number from ${deliveryNoteLines} x join ${documents} d on d.id = x.delivery_id where x.id = ${salesInvoiceLines.dlvLineId})` })
      .from(salesInvoiceLines)
      .innerJoin(items, eq(items.id, salesInvoiceLines.itemId))
      .innerJoin(uoms, eq(uoms.id, salesInvoiceLines.uomId))
      .where(eq(salesInvoiceLines.invoiceId, doc.id))
      .orderBy(asc(salesInvoiceLines.lineNo));
    const notes = await tx
      .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, amount: creditNotes.grandTotal, kind: creditNotes.kind })
      .from(creditNotes)
      .innerJoin(documents, eq(documents.id, creditNotes.id))
      .where(eq(creditNotes.invoiceId, doc.id))
      .orderBy(desc(documents.id));
    const own = await ownGstRegistration(tx, doc.companyId, doc.branchId);
    const { tenantId: _t, id: _i, customerId: _c, orderId: _o, warehouseId: _w, ...rest } = inv;
    const taxable = D(inv.taxableTotal);
    const today = todayIST();
    return {
      ...header,
      ...rest,
      customer: { ...customer, gstin: inv.customerGstin, stateCode: inv.customerStateCode, registration: inv.customerRegistration },
      order: order ?? null,
      warehouse: wh ?? null,
      ourGstin: own.gstin,
      ourStateCode: own.stateCode,
      placeOfSupplyName: inv.placeOfSupply ? (GST_STATE_NAME[inv.placeOfSupply] ?? inv.placeOfSupply) : null,
      stateTaxLabel: inv.placeOfSupply && UTGST_STATES.has(inv.placeOfSupply) ? 'UTGST' : 'SGST',
      marginPct: taxable.isZero() || doc.status !== 'approved' ? null : taxable.sub(D(inv.costTotal)).mul(D('100')).div(taxable).toFixed(2),
      outstanding: D(inv.grandTotal).sub(D(inv.receivedAmount)).sub(D(inv.creditedAmount)).toFixed(2),
      daysToDue: inv.dueDate ? Math.round((Date.parse(inv.dueDate) - Date.parse(today)) / 86_400_000) : null,
      lines: rows.map(({ l: { tenantId: _lt, invoiceId: _iv, ...l }, ...more }) => ({ ...l, ...more })),
      creditNotes: notes,
      canCreditNote: doc.status === 'approved' && perms.has('sales.invoices.manage'),
    };
  }

  private async printContext(tx: Transaction, auth: AuthContext, id: string) {
    const doc = await this.documents.find(tx, id, DOC_TYPE);
    const view = await this.view(tx, auth, doc);
    const [company] = await tx.select({ name: companies.name, legalName: companies.legalName, gstin: companies.gstin, pan: companies.pan, address: companies.address }).from(companies).where(eq(companies.id, doc.companyId));
    const [printer] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, auth.userId));
    const title = view.taxKind === 'bill_of_supply' ? 'Bill of Supply' : view.taxKind === 'export' ? 'Tax Invoice (Export)' : view.taxKind === 'sez' ? 'Tax Invoice (SEZ supply)' : 'Tax Invoice';
    // HSN-wise summary (required on invoices).
    const hsn = new Map<string, { hsn: string; gstRate: string; taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal; cess: Decimal }>();
    for (const l of view.lines) {
      const key = `${l.hsnCode}|${l.gstRate}`;
      const h = hsn.get(key) ?? { hsn: l.hsnCode ?? '', gstRate: l.gstRate, taxable: ZERO, cgst: ZERO, sgst: ZERO, igst: ZERO, cess: ZERO };
      h.taxable = h.taxable.add(D(l.taxableValue));
      h.cgst = h.cgst.add(D(l.cgstAmount));
      h.sgst = h.sgst.add(D(l.sgstAmount));
      h.igst = h.igst.add(D(l.igstAmount));
      h.cess = h.cess.add(D(l.cessAmount));
      hsn.set(key, h);
    }
    return {
      title,
      company: { ...company, gstin: view.ourGstin ?? company?.gstin, stateCode: view.ourStateCode, stateName: view.ourStateCode ? GST_STATE_NAME[view.ourStateCode] : null },
      doc: view,
      customer: view.customer,
      lines: view.lines,
      hsnSummary: [...hsn.values()].map((h) => ({ hsn: h.hsn, gstRate: h.gstRate, taxable: h.taxable.toFixed(2), cgst: h.cgst.toFixed(2), sgst: h.sgst.toFixed(2), igst: h.igst.toFixed(2), cess: h.cess.toFixed(2), total: h.cgst.add(h.sgst).add(h.igst).add(h.cess).toFixed(2) })),
      stateTaxLabel: view.stateTaxLabel,
      einvoice: view.irn && view.irnStatus === 'generated' ? { irn: view.irn, ackNo: view.ackNo, ackDate: view.ackDate?.toISOString(), qr: await this.einvoice.qrDataUri(view.signedQr) } : null,
      printedBy: printer?.name ?? '',
      printedAt: new Date().toISOString(),
    };
  }
}
