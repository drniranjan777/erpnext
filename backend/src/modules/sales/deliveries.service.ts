import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  companies,
  deliveryNoteLines,
  deliveryNotes,
  documents,
  items,
  parties,
  salesInvoiceLines,
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
import { PrintService } from '../customization/print.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { StockService, type StockMove } from '../inventory/stock.service';
import { fail, trim, type Err } from './common';
import { SalesOrdersService } from './orders.service';
import type { CreateDeliveryInput, ListQuery } from './sales.schemas';

const DOC_TYPE = 'delivery_note' as const;
const D = Decimal.from;

/** Delivery note / challan: goods leave the warehouse against a sales order when it is approved. */
@Injectable()
export class DeliveriesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly stock: StockService,
    private readonly orders: SalesOrdersService,
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
      const [company] = await tx.select({ name: companies.name, legalName: companies.legalName, gstin: companies.gstin, address: companies.address }).from(companies).where(eq(companies.id, doc.companyId));
      const [printer] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, auth.userId));
      return { company, doc: view, customer: view.customer, lines: view.lines, printedBy: printer?.name ?? '', printedAt: new Date().toISOString() };
    });
  }

  list(auth: AuthContext, q: ListQuery) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const uninvoiced = sql`exists (select 1 from ${deliveryNoteLines} l where l.delivery_id = ${documents.id} and l.invoiced_qty < l.qty)`;
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          title: documents.title,
          orderId: deliveryNotes.orderId,
          orderNumber: sql<string | null>`(select d.number from ${documents} d where d.id = ${deliveryNotes.orderId})`,
          customer: { id: parties.id, name: parties.name },
          warehouse: { id: warehouses.id, code: warehouses.code },
          vehicleNo: deliveryNotes.vehicleNo,
          deliveredAt: deliveryNotes.deliveredAt,
        })
        .from(documents)
        .innerJoin(deliveryNotes, eq(deliveryNotes.id, documents.id))
        .innerJoin(parties, eq(parties.id, deliveryNotes.customerId))
        .innerJoin(warehouses, eq(warehouses.id, deliveryNotes.warehouseId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status) : undefined,
            q.customerId ? eq(deliveryNotes.customerId, q.customerId) : undefined,
            q.pending === 'true' ? and(eq(documents.status, 'approved'), uninvoiced) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(parties.name, `%${term}%`), ilike(deliveryNotes.vehicleNo, `%${term}%`), ilike(deliveryNotes.lrNo, `%${term}%`)) : undefined,
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

  create(auth: AuthContext, input: CreateDeliveryInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const prepared = await this.prepare(tx, input);
      const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, companyId: prepared.orderDoc.companyId, branchId: prepared.orderDoc.branchId, docDate: input.docDate ?? todayIST(), title: prepared.title, amount: null });
      await tx.insert(deliveryNotes).values({ id: doc.id, tenantId: auth.tenantId, ...prepared.header });
      await this.writeLines(tx, auth, doc.id, prepared.lines);
      await this.documents.log(tx, auth, doc, 'document.created', meta, { order: prepared.orderDoc.number, lines: prepared.lines.length });
      return this.view(tx, auth, doc);
    });
  }

  update(auth: AuthContext, id: string, input: CreateDeliveryInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const [current] = await tx.select().from(deliveryNotes).where(eq(deliveryNotes.id, id));
      if (current.orderId !== input.orderId) fail([{ path: 'orderId', message: 'A delivery stays on its order' }]);
      const prepared = await this.prepare(tx, input);
      await tx.update(deliveryNotes).set(prepared.header).where(eq(deliveryNotes.id, id));
      await tx.delete(deliveryNoteLines).where(eq(deliveryNoteLines.deliveryId, id));
      await this.writeLines(tx, auth, id, prepared.lines);
      const updated = await this.documents.update(tx, auth, doc, { title: prepared.title, ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}) });
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

  /** Proof of delivery: when the customer received it. */
  recordPod(auth: AuthContext, id: string, input: { deliveredAt?: string; podNote?: string | null }) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE);
      if (doc.status !== 'approved') throw new ConflictException('Record proof of delivery on a posted delivery note');
      await tx.update(deliveryNotes).set({ deliveredAt: input.deliveredAt ? new Date(input.deliveredAt) : new Date(), podNote: input.podNote ?? null }).where(eq(deliveryNotes.id, id));
      await this.documents.activity(tx, auth, id, 'status', 'Proof of delivery recorded', { note: input.podNote ?? null });
      return this.view(tx, auth, doc);
    });
  }

  // ---- posting -------------------------------------------------------------------

  private async post(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [dn] = await tx.select().from(deliveryNotes).where(eq(deliveryNotes.id, doc.id));
    const orderDoc = await this.documents.lock(tx, dn.orderId, 'sales_order');
    if (orderDoc.status !== 'approved') throw new ConflictException(`Sales order ${orderDoc.number} is ${orderDoc.status.replace('_', ' ')}: nothing more can be delivered`);
    const lines = await tx.select().from(deliveryNoteLines).where(eq(deliveryNoteLines.deliveryId, doc.id)).orderBy(asc(deliveryNoteLines.lineNo));
    const soLines = await tx.select().from(salesOrderLines).where(inArray(salesOrderLines.id, lines.map((l) => l.soLineId))).for('update');
    const errors: Err[] = [];
    for (const [i, l] of lines.entries()) {
      const s = soLines.find((x) => x.id === l.soLineId)!;
      const open = D(s.qty).sub(D(s.deliveredQty));
      const total = lines.filter((x) => x.soLineId === s.id).reduce((t, x) => t.add(D(x.qty)), D('0'));
      if (total.cmp(open) > 0) errors.push({ path: `lines.${i}.qty`, message: `Line ${s.lineNo}: only ${trim(open)} left to deliver` });
    }
    if (errors.length) fail(errors);
    const moves: StockMove[] = lines.map((l) => ({ itemId: l.itemId, warehouseId: dn.warehouseId, qty: D('0').sub(D(l.baseQty)).toFixed(4), rate: null, batchNo: l.batchNo, serialNos: l.serialNos, line: l.lineNo }));
    const posted = await this.stock.post(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate }, moves);
    let cost = D('0');
    for (const [i, l] of lines.entries()) {
      const value = D(posted[i].value.replace('-', ''));
      cost = cost.add(value);
      await tx.update(deliveryNoteLines).set({ costValue: value.toFixed(2) }).where(eq(deliveryNoteLines.id, l.id));
      await tx.update(salesOrderLines).set({ deliveredQty: sql`${salesOrderLines.deliveredQty} + ${l.qty}::numeric` }).where(eq(salesOrderLines.id, l.soLineId));
    }
    await tx.update(documents).set({ amount: cost.toFixed(2) }).where(eq(documents.id, doc.id));
    await this.orders.syncStatus(tx, auth, dn.orderId);
  }

  private async unpost(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const lines = await tx.select().from(deliveryNoteLines).where(eq(deliveryNoteLines.deliveryId, doc.id));
    const [billed] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(salesInvoiceLines)
      .innerJoin(documents, eq(documents.id, salesInvoiceLines.invoiceId))
      .where(and(inArray(salesInvoiceLines.dlvLineId, lines.map((l) => l.id)), ne(documents.status, 'cancelled')));
    if (billed.n) throw new ConflictException('This delivery has been invoiced. Cancel the invoice first.');
    const [dn] = await tx.select().from(deliveryNotes).where(eq(deliveryNotes.id, doc.id));
    await this.stock.reverseVoucher(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate });
    for (const l of lines) await tx.update(salesOrderLines).set({ deliveredQty: sql`${salesOrderLines.deliveredQty} - ${l.qty}::numeric` }).where(eq(salesOrderLines.id, l.soLineId));
    await this.orders.syncStatus(tx, auth, dn.orderId);
  }

  // ---- helpers -----------------------------------------------------------------------

  private async prepare(tx: Transaction, input: CreateDeliveryInput) {
    const [orderDoc] = await tx.select().from(documents).where(and(eq(documents.id, input.orderId), eq(documents.docType, 'sales_order')));
    if (!orderDoc) fail([{ path: 'orderId', message: 'Sales order not found' }]);
    if (orderDoc.status !== 'approved') fail([{ path: 'orderId', message: `Sales order ${orderDoc.number ?? ''} is ${orderDoc.status.replace('_', ' ')}: deliver only against approved orders` }]);
    const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, input.orderId));
    if (so.closedAt) fail([{ path: 'orderId', message: 'This order was short-closed' }]);
    const warehouseId = input.warehouseId ?? so.warehouseId;
    if (!warehouseId) fail([{ path: 'warehouseId', message: 'Choose the dispatch warehouse' }]);
    const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, warehouseId));
    if (!wh || wh.companyId !== orderDoc.companyId) fail([{ path: 'warehouseId', message: 'Unknown warehouse for this company' }]);
    const soLines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, so.id));
    const itemRows = await tx.select().from(items).where(inArray(items.id, soLines.map((l) => l.itemId)));
    const errors: Err[] = [];
    const lines = input.lines.map((l, i) => {
      const s = soLines.find((x) => x.id === l.soLineId);
      if (!s) {
        errors.push({ path: `lines.${i}.soLineId`, message: 'Not a line of this order' });
        return null;
      }
      const it = itemRows.find((x) => x.id === s.itemId)!;
      if (!it.isStockItem) errors.push({ path: `lines.${i}.soLineId`, message: `${it.code} is not a stock item: invoice it directly` });
      const open = D(s.qty).sub(D(s.deliveredQty));
      const total = input.lines.filter((x) => x.soLineId === s.id).reduce((t, x) => t.add(D(x.qty)), D('0'));
      if (total.cmp(open) > 0) errors.push({ path: `lines.${i}.qty`, message: `Only ${trim(open)} left to deliver on line ${s.lineNo}` });
      if (it.trackBatch && !l.batchNo) errors.push({ path: `lines.${i}.batchNo`, message: `${it.code} needs a batch number` });
      const baseQty = D(l.qty).mul(D(s.conversionFactor)).toFixed(4);
      if (it.trackSerial && (l.serialNos?.length ?? 0) !== Number(baseQty)) errors.push({ path: `lines.${i}.serialNos`, message: `Enter ${Number(baseQty)} serial number(s)` });
      return { ...l, lineNo: i + 1, itemId: s.itemId, uomId: s.uomId, conversionFactor: s.conversionFactor, baseQty, serialNos: l.serialNos?.map((x) => x.toUpperCase()) ?? null };
    });
    if (errors.length) fail(errors);
    const [customer] = await tx.select({ name: parties.name }).from(parties).where(eq(parties.id, so.customerId));
    return {
      orderDoc,
      title: `${customer.name}: dispatch against ${orderDoc.number}`,
      header: {
        orderId: so.id,
        customerId: so.customerId,
        warehouseId,
        shippingAddress: so.shippingAddress,
        transporter: input.transporter,
        transporterGstin: input.transporterGstin,
        vehicleNo: input.vehicleNo ?? null,
        lrNo: input.lrNo,
        lrDate: input.lrDate ?? null,
        distanceKm: input.distanceKm ?? null,
        packages: input.packages ?? null,
        grossWeightKg: input.grossWeightKg,
        netWeightKg: input.netWeightKg,
        notes: input.notes,
      },
      lines: lines as NonNullable<(typeof lines)[number]>[],
    };
  }

  private async writeLines(tx: Transaction, auth: AuthContext, deliveryId: string, lines: Awaited<ReturnType<DeliveriesService['prepare']>>['lines']) {
    await tx.insert(deliveryNoteLines).values(
      lines.map((l) => ({ tenantId: auth.tenantId, deliveryId, lineNo: l.lineNo, soLineId: l.soLineId, itemId: l.itemId, uomId: l.uomId, qty: D(l.qty).toFixed(4), conversionFactor: l.conversionFactor, baseQty: l.baseQty, batchNo: l.batchNo, serialNos: l.serialNos, remarks: l.remarks })),
    );
  }

  async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('sales.deliveries.manage'), cancel: perms.has('sales.deliveries.cancel') });
    const [dn] = await tx.select().from(deliveryNotes).where(eq(deliveryNotes.id, doc.id));
    const [order] = await tx.select({ id: documents.id, number: documents.number, customerPoNo: salesOrders.customerPoNo }).from(documents).innerJoin(salesOrders, eq(salesOrders.id, documents.id)).where(eq(documents.id, dn.orderId));
    const [customer] = await tx.select({ id: parties.id, code: parties.code, name: parties.name, gstin: parties.gstin }).from(parties).where(eq(parties.id, dn.customerId));
    const [wh] = await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, dn.warehouseId));
    const rows = await tx
      .select({ l: deliveryNoteLines, itemCode: items.code, itemName: items.name, hsnCode: items.hsnCode, uomCode: uoms.code, soLineNo: salesOrderLines.lineNo, orderedQty: salesOrderLines.qty, rate: salesOrderLines.rate, discountPct: salesOrderLines.discountPct })
      .from(deliveryNoteLines)
      .innerJoin(items, eq(items.id, deliveryNoteLines.itemId))
      .innerJoin(uoms, eq(uoms.id, deliveryNoteLines.uomId))
      .innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryNoteLines.soLineId))
      .where(eq(deliveryNoteLines.deliveryId, doc.id))
      .orderBy(asc(deliveryNoteLines.lineNo));
    const { tenantId: _t, id: _i, orderId: _o, customerId: _c, warehouseId: _w, ...rest } = dn;
    const lines = rows.map(({ l: { tenantId: _lt, deliveryId: _d, ...l }, ...more }) => ({ ...l, ...more }));
    return {
      ...header,
      ...rest,
      order,
      customer,
      warehouse: wh,
      lines,
      canInvoice: doc.status === 'approved' && lines.some((l) => D(l.invoicedQty).cmp(D(l.qty)) < 0) && perms.has('sales.invoices.manage'),
    };
  }
}
