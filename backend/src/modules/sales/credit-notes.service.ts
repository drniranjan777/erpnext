import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  companies,
  creditNoteLines,
  creditNotes,
  deliveryNoteLines,
  deliveryNotes,
  documents,
  items,
  parties,
  salesInvoiceLines,
  salesInvoices,
  type Transaction,
  uoms,
  users,
  warehouses,
} from '@nextgen/database';
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { EInvoiceService } from '../compliance/einvoice.service';
import { PrintService } from '../customization/print.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { UTGST_STATES, type RegistrationType } from '../gst/gst-engine';
import { ownGstRegistration, priceLines, taxHeader } from '../gst/pricing';
import { StockService, type StockMove } from '../inventory/stock.service';
import { fail, trim, type Err } from './common';
import type { CreateCreditInput, ListQuery } from './sales.schemas';

const DOC_TYPE = 'credit_note' as const;
const D = Decimal.from;

/**
 * Credit note against an approved invoice, with the invoice's own GST treatment (place of supply,
 * LUT). Returns bring goods back into a chosen warehouse (quality hold, scrap...) at the cost they
 * left at; price adjustments only reduce what the customer owes.
 */
@Injectable()
export class CreditNotesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly stock: StockService,
    private readonly print: PrintService,
    private readonly einvoice: EInvoiceService,
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
      const [cn] = await tx.select({ irn: creditNotes.irn, ackNo: creditNotes.ackNo, ackDate: creditNotes.ackDate, signedQr: creditNotes.signedQr, irnStatus: creditNotes.irnStatus }).from(creditNotes).where(eq(creditNotes.id, id));
      const einvoice = cn.irn && cn.irnStatus === 'generated' ? { irn: cn.irn, ackNo: cn.ackNo, ackDate: cn.ackDate?.toISOString(), qr: await this.einvoice.qrDataUri(cn.signedQr) } : null;
      return { company: { ...company, gstin: view.ourGstin ?? company?.gstin }, doc: view, customer: view.customer, invoice: view.invoice, lines: view.lines, stateTaxLabel: view.stateTaxLabel, einvoice, printedBy: printer?.name ?? '', printedAt: new Date().toISOString() };
    });
  }

  list(auth: AuthContext, q: ListQuery) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, kind: creditNotes.kind, reason: creditNotes.reason, grandTotal: creditNotes.grandTotal, invoiceId: creditNotes.invoiceId, invoiceNumber: sql<string | null>`(select d.number from ${documents} d where d.id = ${creditNotes.invoiceId})`, customer: { id: parties.id, name: parties.name } })
        .from(documents)
        .innerJoin(creditNotes, eq(creditNotes.id, documents.id))
        .innerJoin(parties, eq(parties.id, creditNotes.customerId))
        .where(and(eq(documents.docType, DOC_TYPE), q.status ? eq(documents.status, q.status) : undefined, q.customerId ? eq(creditNotes.customerId, q.customerId) : undefined, q.cursor ? lt(documents.id, q.cursor) : undefined))
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

  create(auth: AuthContext, input: CreateCreditInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const invDoc = await this.invoiceDoc(tx, input.invoiceId);
      const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, companyId: invDoc.companyId, branchId: invDoc.branchId, docDate: input.docDate ?? todayIST(), title: null, amount: null });
      const prepared = await this.prepare(tx, doc, input);
      await tx.insert(creditNotes).values({ id: doc.id, tenantId: auth.tenantId, ...prepared.header });
      await this.writeLines(tx, auth, doc.id, prepared.lines);
      const updated = await this.documents.update(tx, auth, doc, { title: prepared.title, amount: prepared.header.grandTotal });
      await this.documents.log(tx, auth, updated, 'document.created', meta, { kind: input.kind, invoice: invDoc.number });
      return this.view(tx, auth, updated);
    });
  }

  update(auth: AuthContext, id: string, input: CreateCreditInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const [current] = await tx.select().from(creditNotes).where(eq(creditNotes.id, id));
      if (current.invoiceId !== input.invoiceId) fail([{ path: 'invoiceId', message: 'A credit note stays on its invoice' }]);
      const prepared = await this.prepare(tx, doc, input);
      await tx.update(creditNotes).set(prepared.header).where(eq(creditNotes.id, id));
      await tx.delete(creditNoteLines).where(eq(creditNoteLines.creditNoteId, id));
      await this.writeLines(tx, auth, id, prepared.lines);
      const updated = await this.documents.update(tx, auth, doc, { title: prepared.title, amount: prepared.header.grandTotal });
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

  /** Receivables by customer, aged on due date: not due, 1–30, 31–60, 61–90, over 90 days. */
  receivables(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const today = todayIST();
      const due = sql<string>`(${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount})`;
      const days = sql`(${today}::date - ${salesInvoices.dueDate})`;
      const bucket = (cond: ReturnType<typeof sql>) => sql<string>`coalesce(sum(${due}) filter (where ${cond}), 0)::numeric(18,2)::text`;
      const rows = await tx
        .select({
          customerId: salesInvoices.customerId,
          name: parties.name,
          code: parties.code,
          creditLimit: parties.creditLimit,
          invoices: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(${due}), 0)::numeric(18,2)::text`,
          notDue: bucket(sql`${days} <= 0`),
          d30: bucket(sql`${days} between 1 and 30`),
          d60: bucket(sql`${days} between 31 and 60`),
          d90: bucket(sql`${days} between 61 and 90`),
          over90: bucket(sql`${days} > 90`),
          oldestDue: sql<string | null>`min(${salesInvoices.dueDate})::text`,
        })
        .from(salesInvoices)
        .innerJoin(documents, eq(documents.id, salesInvoices.id))
        .innerJoin(parties, eq(parties.id, salesInvoices.customerId))
        .where(and(eq(documents.status, 'approved'), gt(due, sql`0`)))
        .groupBy(salesInvoices.customerId, parties.name, parties.code, parties.creditLimit)
        .orderBy(sql`sum(${due}) desc`);
      const sum = (k: 'total' | 'notDue' | 'd30' | 'd60' | 'd90' | 'over90') => Decimal.sum(rows.map((r) => r[k])).toFixed(2);
      return { customers: rows, totals: { total: sum('total'), notDue: sum('notDue'), d30: sum('d30'), d60: sum('d60'), d90: sum('d90'), over90: sum('over90') } };
    });
  }

  // ---- posting -------------------------------------------------------------------

  private async post(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [cn] = await tx.select().from(creditNotes).where(eq(creditNotes.id, doc.id));
    const lines = await tx.select().from(creditNoteLines).where(eq(creditNoteLines.creditNoteId, doc.id)).orderBy(asc(creditNoteLines.lineNo));
    const invLines = await tx.select().from(salesInvoiceLines).where(inArray(salesInvoiceLines.id, lines.map((l) => l.invoiceLineId))).for('update');
    if (cn.kind === 'return') {
      const errors: Err[] = [];
      for (const l of lines) {
        const il = invLines.find((x) => x.id === l.invoiceLineId)!;
        const open = D(il.qty).sub(D(il.returnedQty));
        if (D(l.qty).cmp(open) > 0) errors.push({ path: `lines.${l.lineNo - 1}.qty`, message: `Line ${l.lineNo}: only ${trim(open)} invoiced and not yet returned` });
      }
      if (errors.length) fail(errors);
      const stockItems = new Set((await tx.select({ id: items.id }).from(items).where(and(inArray(items.id, lines.map((l) => l.itemId)), eq(items.isStockItem, true)))).map((i) => i.id));
      const moves: StockMove[] = lines
        .filter((l) => stockItems.has(l.itemId))
        .map((l) => {
          const il = invLines.find((x) => x.id === l.invoiceLineId)!;
          // Back in at the cost it left at (per base unit).
          const costPerBase = D(il.costValue).isZero() ? null : D(il.costValue).div(D(il.baseQty)).toFixed(6);
          return { itemId: l.itemId, warehouseId: cn.warehouseId!, qty: D(l.baseQty).toFixed(4), rate: costPerBase, batchNo: l.batchNo, serialNos: l.serialNos, line: l.lineNo };
        });
      await this.stock.post(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate }, moves);
      for (const l of lines) await tx.update(salesInvoiceLines).set({ returnedQty: sql`${salesInvoiceLines.returnedQty} + ${l.qty}::numeric` }).where(eq(salesInvoiceLines.id, l.invoiceLineId));
    }
    await tx.update(salesInvoices).set({ creditedAmount: sql`${salesInvoices.creditedAmount} + ${cn.grandTotal}::numeric` }).where(eq(salesInvoices.id, cn.invoiceId));
    await this.einvoice.onApproved(tx, auth, doc);
  }

  private async unpost(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    await this.einvoice.assertCancellable(tx, doc.id, DOC_TYPE);
    const [cn] = await tx.select().from(creditNotes).where(eq(creditNotes.id, doc.id));
    await this.stock.reverseVoucher(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate });
    if (cn.kind === 'return') {
      const lines = await tx.select().from(creditNoteLines).where(eq(creditNoteLines.creditNoteId, doc.id));
      for (const l of lines) await tx.update(salesInvoiceLines).set({ returnedQty: sql`${salesInvoiceLines.returnedQty} - ${l.qty}::numeric` }).where(eq(salesInvoiceLines.id, l.invoiceLineId));
    }
    await tx.update(salesInvoices).set({ creditedAmount: sql`${salesInvoices.creditedAmount} - ${cn.grandTotal}::numeric` }).where(eq(salesInvoices.id, cn.invoiceId));
  }

  // ---- helpers -----------------------------------------------------------------------

  private async invoiceDoc(tx: Transaction, invoiceId: string) {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, invoiceId), eq(documents.docType, 'sales_invoice')));
    if (!doc) fail([{ path: 'invoiceId', message: 'Invoice not found' }]);
    if (doc.status !== 'approved') fail([{ path: 'invoiceId', message: 'Credit notes can only be issued against approved invoices' }]);
    return doc;
  }

  private async prepare(tx: Transaction, doc: DocumentRow, input: CreateCreditInput) {
    const invDoc = await this.invoiceDoc(tx, input.invoiceId);
    const [inv] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, input.invoiceId));
    const invLines = await tx.select().from(salesInvoiceLines).where(eq(salesInvoiceLines.invoiceId, inv.id));
    const stockItems = new Set((await tx.select({ id: items.id }).from(items).where(and(inArray(items.id, invLines.map((l) => l.itemId)), eq(items.isStockItem, true)))).map((i) => i.id));
    const isReturn = input.kind === 'return';
    const errors: Err[] = [];

    // Returns come back to the warehouse they left from unless told otherwise.
    let warehouseId = input.warehouseId ?? null;
    if (isReturn && !warehouseId) {
      warehouseId = inv.warehouseId;
      const dl = invLines.find((l) => l.dlvLineId)?.dlvLineId;
      if (!warehouseId && dl) {
        const [d] = await tx.select({ warehouseId: deliveryNotes.warehouseId }).from(deliveryNoteLines).innerJoin(deliveryNotes, eq(deliveryNotes.id, deliveryNoteLines.deliveryId)).where(eq(deliveryNoteLines.id, dl));
        warehouseId = d?.warehouseId ?? null;
      }
    }
    if (isReturn && input.lines.some((l) => stockItems.has(invLines.find((x) => x.id === l.invoiceLineId)?.itemId ?? '')) && !warehouseId) errors.push({ path: 'warehouseId', message: 'Choose the warehouse the goods come back into' });
    if (warehouseId) {
      const [wh] = await tx.select({ companyId: warehouses.companyId }).from(warehouses).where(eq(warehouses.id, warehouseId));
      if (!wh || wh.companyId !== invDoc.companyId) errors.push({ path: 'warehouseId', message: 'Unknown warehouse for this company' });
    }
    const rows = input.lines.map((l, i) => {
      const il = invLines.find((x) => x.id === l.invoiceLineId);
      if (!il) {
        errors.push({ path: `lines.${i}.invoiceLineId`, message: 'Not a line of this invoice' });
        return null;
      }
      const open = isReturn ? D(il.qty).sub(D(il.returnedQty)) : D(il.qty);
      if (D(l.qty).cmp(open) > 0) errors.push({ path: `lines.${i}.qty`, message: isReturn ? `Only ${trim(open)} invoiced and not yet returned` : `The invoice has ${trim(open)}` });
      const netRate = D(il.taxableValue).div(D(il.qty)).toFixed(4);
      const rate = l.rate ?? (isReturn ? netRate : null);
      if (!rate) errors.push({ path: `lines.${i}.rate`, message: 'Enter the reduction per unit' });
      else if (D(rate).cmp(D(netRate)) > 0) errors.push({ path: `lines.${i}.rate`, message: `Cannot exceed the invoiced net rate ${netRate}` });
      return { l, il, rate: rate ?? '0' };
    });
    if (errors.length) fail(errors);
    const valid = rows as NonNullable<(typeof rows)[number]>[];
    const own = await ownGstRegistration(tx, doc.companyId, doc.branchId);
    const { lines: priced, tax } = await priceLines(
      tx,
      { direction: 'outward', ownStateCode: own.stateCode, partyRegistration: inv.customerRegistration as RegistrationType, partyStateCode: inv.customerStateCode, placeOfSupply: inv.placeOfSupply, withLut: inv.withLut },
      valid.map((r) => ({ itemId: r.il.itemId, uomId: r.il.uomId, qty: r.l.qty, rate: r.rate, description: r.il.description })),
      { defaultUnit: 'sales' },
    );
    const [customer] = await tx.select({ name: parties.name }).from(parties).where(eq(parties.id, inv.customerId));
    return {
      title: `${customer.name}: ${isReturn ? 'sales return' : 'price adjustment'} on ${invDoc.number}`,
      header: { invoiceId: inv.id, customerId: inv.customerId, kind: input.kind, warehouseId: isReturn ? warehouseId : null, reason: input.reason, notes: input.notes, ...taxHeader(tax) },
      lines: priced.map((p, i) => ({ ...p, invoiceLineId: valid[i].il.id, batchNo: valid[i].l.batchNo ?? valid[i].il.batchNo, serialNos: valid[i].l.serialNos?.map((s) => s.toUpperCase()) ?? null, remarks: valid[i].l.remarks })),
    };
  }

  private async writeLines(tx: Transaction, auth: AuthContext, creditNoteId: string, lines: Awaited<ReturnType<CreditNotesService['prepare']>>['lines']) {
    await tx.insert(creditNoteLines).values(
      lines.map((l) => ({
        tenantId: auth.tenantId,
        creditNoteId,
        lineNo: l.lineNo,
        invoiceLineId: l.invoiceLineId,
        itemId: l.itemId,
        description: l.description,
        uomId: l.uomId,
        qty: l.qty,
        conversionFactor: l.conversionFactor,
        baseQty: l.baseQty,
        rate: l.rate,
        hsnCode: l.hsnCode,
        gstRate: l.gstRate,
        cessRate: l.cessRate,
        taxability: l.taxability,
        taxableValue: l.taxableValue,
        cgstAmount: l.cgstAmount,
        sgstAmount: l.sgstAmount,
        igstAmount: l.igstAmount,
        cessAmount: l.cessAmount,
        lineTotal: l.lineTotal,
        batchNo: l.batchNo,
        serialNos: l.serialNos,
        remarks: l.remarks,
      })),
    );
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('sales.invoices.manage'), cancel: perms.has('sales.invoices.cancel') });
    const [cn] = await tx.select().from(creditNotes).where(eq(creditNotes.id, doc.id));
    const [inv] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, cn.invoiceId));
    const [invDoc] = await tx.select({ number: documents.number, docDate: documents.docDate }).from(documents).where(eq(documents.id, cn.invoiceId));
    const [customer] = await tx.select({ id: parties.id, code: parties.code, name: parties.name }).from(parties).where(eq(parties.id, cn.customerId));
    const [wh] = cn.warehouseId ? await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, cn.warehouseId)) : [];
    const rows = await tx
      .select({ l: creditNoteLines, itemCode: items.code, uomCode: uoms.code })
      .from(creditNoteLines)
      .innerJoin(items, eq(items.id, creditNoteLines.itemId))
      .innerJoin(uoms, eq(uoms.id, creditNoteLines.uomId))
      .where(eq(creditNoteLines.creditNoteId, doc.id))
      .orderBy(asc(creditNoteLines.lineNo));
    const own = await ownGstRegistration(tx, doc.companyId, doc.branchId);
    const { tenantId: _t, id: _i, customerId: _c, warehouseId: _w, ...rest } = cn;
    return {
      ...header,
      ...rest,
      invoice: { id: inv.id, number: invDoc?.number ?? null, docDate: invDoc?.docDate ?? null, irn: inv.irn },
      customer: { ...customer, gstin: inv.customerGstin, stateCode: inv.customerStateCode },
      warehouse: wh ?? null,
      ourGstin: own.gstin,
      stateTaxLabel: cn.placeOfSupply && UTGST_STATES.has(cn.placeOfSupply) ? 'UTGST' : 'SGST',
      lines: rows.map(({ l: { tenantId: _lt, creditNoteId: _cn, ...l }, ...more }) => ({ ...l, ...more })),
    };
  }
}
