import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import {
  branches,
  companies,
  creditNoteLines,
  creditNotes,
  documents,
  ewayBills,
  gstApiLogs,
  items,
  parties,
  salesInvoiceLines,
  salesInvoices,
  uoms,
  type Transaction,
} from '@nextgen/database';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { ownGstRegistration } from '../gst/pricing';
import { JobsService, PermanentJobError } from '../jobs/jobs.service';
import { buildEInvoice, notApplicable, type ESource } from './einvoice-payload';
import { GspService } from './gsp.service';

const QUEUE = 'gst.irn';
const EINVOICE_TYPES = ['sales_invoice', 'credit_note'] as const;
type EInvoiceDocType = (typeof EINVOICE_TYPES)[number];
const CANCEL_WINDOW_MS = 24 * 3600_000;

export const IRN_CANCEL_REASONS = { '1': 'Duplicate', '2': 'Data entry mistake', '3': 'Order cancelled', '4': 'Others' } as const;

/** Header table of an e-invoiceable document. */
const headerOf = (docType: EInvoiceDocType) => (docType === 'sales_invoice' ? salesInvoices : creditNotes);

/**
 * e-Invoicing: registers approved invoices and credit notes on the IRP (through the GSP) and
 * stores the IRN, acknowledgement and signed QR. With auto-IRN on, approval queues the
 * registration (retried with back-off); otherwise users generate it from the document.
 */
@Injectable()
export class EInvoiceService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly jobs: JobsService,
    private readonly gsp: GspService,
  ) {}

  onModuleInit() {
    this.jobs.register(QUEUE, async (payload, ctx) => {
      const auth = { tenantId: ctx.tenantId, userId: String(payload.userId), membershipId: '', sessionId: '' } as AuthContext;
      const last = ctx.attempt >= Number(payload.maxAttempts ?? 5);
      try {
        await this.generate(auth, String(payload.documentId), { auto: true });
      } catch (e) {
        const message = e instanceof Error ? ((e as { response?: { message?: string } }).response?.message ?? e.message) : String(e);
        const permanent = e instanceof UnprocessableEntityException || e instanceof ConflictException || e instanceof NotFoundException;
        if (permanent || last) {
          await this.database.run({ tenantId: ctx.tenantId }, async (tx) => {
            const doc = await this.findDoc(tx, String(payload.documentId));
            if (doc) await tx.update(headerOf(doc.docType)).set({ irnStatus: 'failed', irnError: message }).where(and(eq(headerOf(doc.docType).id, doc.id), isNull(headerOf(doc.docType).irn)));
          });
        }
        if (permanent) throw new PermanentJobError(message);
        throw e;
      }
    });
  }

  // ---- Settings -------------------------------------------------------------------

  async settings(tx: Transaction, companyId: string) {
    const [c] = await tx.select({ s: companies.gstSettings }).from(companies).where(eq(companies.id, companyId));
    return { einvoice: !!c?.s.einvoice, autoIrn: !!c?.s.autoIrn, ewayThreshold: c?.s.ewayThreshold ?? 50000 };
  }

  /** Called when an invoice / credit note is approved: queue the IRN if the company generates them automatically. */
  async onApproved(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const s = await this.settings(tx, doc.companyId);
    if (!s.einvoice || !s.autoIrn) return;
    const src = await this.source(tx, doc);
    if (notApplicable(src)) return;
    const table = headerOf(doc.docType as EInvoiceDocType);
    await tx.update(table).set({ irnStatus: 'pending', irnError: null }).where(eq(table.id, doc.id));
    await this.jobs.enqueue(tx, auth.tenantId, QUEUE, { documentId: doc.id, userId: auth.userId, maxAttempts: 6 }, { maxAttempts: 6, dedupeKey: `irn:${doc.id}` });
  }

  /** Blocks cancelling a document whose IRN is live. */
  async assertCancellable(tx: Transaction, docId: string, docType: EInvoiceDocType) {
    const table = headerOf(docType);
    const [h] = await tx.select({ irn: table.irn, irnStatus: table.irnStatus }).from(table).where(eq(table.id, docId));
    if (h?.irn && h.irnStatus !== 'cancelled') throw new ConflictException('This document has an IRN: cancel the e-invoice first (within 24 hours) or issue a credit note');
  }

  // ---- Preview / generate / cancel ------------------------------------------------------

  /** The INV-01 JSON and any validation errors, without sending anything. */
  preview(auth: AuthContext, documentId: string) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.requireDoc(tx, documentId);
      const src = await this.source(tx, doc);
      const { payload, errors } = buildEInvoice(src);
      return { applicable: !notApplicable(src), reason: notApplicable(src), payload, errors };
    });
  }

  async generate(auth: AuthContext, documentId: string, opts: { auto?: boolean } = {}) {
    // 1. Build and validate (no transaction held during the network call).
    const prepared = await this.database.run(auth, async (tx) => {
      const doc = await this.requireDoc(tx, documentId);
      if (doc.status !== 'approved') throw new ConflictException('Only approved documents can be registered for an IRN');
      const table = headerOf(doc.docType);
      const [h] = await tx.select({ irn: table.irn, irnStatus: table.irnStatus }).from(table).where(eq(table.id, doc.id));
      if (h.irn) {
        if (opts.auto) return null; // already done
        throw new ConflictException(h.irnStatus === 'cancelled' ? 'The IRN of this document was cancelled; the number cannot be registered again' : 'This document already has an IRN');
      }
      const s = await this.settings(tx, doc.companyId);
      if (!s.einvoice) throw new UnprocessableEntityException('e-Invoicing is turned off for this company (Settings → Companies → GST e-compliance)');
      const src = await this.source(tx, doc);
      const { payload, errors } = buildEInvoice(src);
      if (errors.length) {
        await this.log(tx, auth, doc, 'irn', { ok: false, code: 'VALIDATION', message: errors.map((e) => e.message).join('; '), request: payload, response: {} });
        throw new UnprocessableEntityException({ message: errors[0].message, errors });
      }
      return { doc, payload, gstin: src.seller.gstin! };
    });
    if (!prepared) return this.status(auth, documentId);
    const { doc, payload, gstin } = prepared;

    const res = await this.gsp.provider.generateIrn(gstin, payload, doc.docDate);

    // 2. Store the result.
    await this.database.run(auth, async (tx) => {
      const table = headerOf(doc.docType);
      if (!res.ok) {
        await this.log(tx, auth, doc, 'irn', { ok: false, code: res.code, message: res.message, request: payload, response: res.raw });
        if (!opts.auto) await tx.update(table).set({ irnStatus: 'failed', irnError: `${res.code}: ${res.message}` }).where(eq(table.id, doc.id));
        return;
      }
      const [locked] = await tx.select({ irn: table.irn }).from(table).where(eq(table.id, doc.id)).for('update');
      if (locked.irn) return;
      await tx
        .update(table)
        .set({ irn: res.data.irn, ackNo: res.data.ackNo, ackDate: new Date(res.data.ackDate), signedQr: res.data.signedQr, irnStatus: 'generated', irnError: null, irnCancelledAt: null })
        .where(eq(table.id, doc.id));
      await this.log(tx, auth, doc, 'irn', { ok: true, request: payload, response: { Irn: res.data.irn, AckNo: res.data.ackNo, AckDt: res.data.ackDate } });
      await this.documents.activity(tx, auth, doc.id, 'status', `e-Invoice registered: IRN ${res.data.irn.slice(0, 12)}…, Ack ${res.data.ackNo}`);
    });
    if (!res.ok) {
      if (res.transient) throw new Error(`${res.code}: ${res.message}`);
      throw new UnprocessableEntityException({ message: `IRP rejected the invoice: ${res.message} (${res.code})`, errors: [{ path: 'irp', message: res.message }] });
    }
    return this.status(auth, documentId);
  }

  async cancel(auth: AuthContext, documentId: string, reasonCode: keyof typeof IRN_CANCEL_REASONS, remark: string) {
    const prepared = await this.database.run(auth, async (tx) => {
      const doc = await this.requireDoc(tx, documentId);
      const table = headerOf(doc.docType);
      const [h] = await tx.select({ irn: table.irn, ackDate: table.ackDate, irnStatus: table.irnStatus }).from(table).where(eq(table.id, doc.id));
      if (!h.irn || h.irnStatus === 'cancelled') throw new ConflictException('There is no live IRN on this document');
      if (Date.now() - (h.ackDate?.getTime() ?? 0) > CANCEL_WINDOW_MS) throw new ConflictException('An IRN can only be cancelled within 24 hours of generation. Issue a credit note instead.');
      const [ewb] = await tx.select({ ewbNo: ewayBills.ewbNo }).from(ewayBills).where(and(eq(ewayBills.documentId, doc.id), eq(ewayBills.status, 'active')));
      if (ewb) throw new ConflictException(`Cancel e-way bill ${ewb.ewbNo} first`);
      const own = await ownGstRegistration(tx, doc.companyId, doc.branchId);
      return { doc, irn: h.irn, gstin: own.gstin! };
    });
    const res = await this.gsp.provider.cancelIrn(prepared.gstin, prepared.irn, reasonCode, remark);
    await this.database.run(auth, async (tx) => {
      const { doc } = prepared;
      await this.log(tx, auth, doc, 'irn_cancel', res.ok ? { ok: true, request: { Irn: prepared.irn, CnlRsn: reasonCode, CnlRem: remark }, response: res.raw } : { ok: false, code: res.code, message: res.message, request: { Irn: prepared.irn }, response: res.raw });
      if (!res.ok) return;
      const table = headerOf(doc.docType);
      await tx.update(table).set({ irnStatus: 'cancelled', irnCancelledAt: new Date(res.data.cancelledAt) }).where(eq(table.id, doc.id));
      await this.documents.activity(tx, auth, doc.id, 'status', `e-Invoice cancelled (${IRN_CANCEL_REASONS[reasonCode]}): ${remark}`);
    });
    if (!res.ok) throw new UnprocessableEntityException(`IRP refused the cancellation: ${res.message} (${res.code})`);
    return this.status(auth, documentId);
  }

  /** Queues IRN generation for many documents; returns what was queued and what was skipped. */
  bulk(auth: AuthContext, ids: string[]) {
    return this.database.run(auth, async (tx) => {
      const queued: string[] = [];
      const skipped: { id: string; reason: string }[] = [];
      for (const id of ids) {
        const doc = await this.findDoc(tx, id);
        if (!doc) {
          skipped.push({ id, reason: 'Not found' });
          continue;
        }
        const table = headerOf(doc.docType);
        const [h] = await tx.select({ irn: table.irn }).from(table).where(eq(table.id, id));
        const s = await this.settings(tx, doc.companyId);
        const src = await this.source(tx, doc);
        const reason = doc.status !== 'approved' ? 'Not approved' : h.irn ? 'Already has an IRN' : !s.einvoice ? 'e-Invoicing is off for the company' : notApplicable(src);
        if (reason) {
          skipped.push({ id, reason });
          continue;
        }
        await tx.update(table).set({ irnStatus: 'pending', irnError: null }).where(eq(table.id, id));
        // A fresh key each time so a failed document can be retried by hand.
        await this.jobs.enqueue(tx, auth.tenantId, QUEUE, { documentId: id, userId: auth.userId, maxAttempts: 6 }, { maxAttempts: 6, dedupeKey: `irn:${id}:${Date.now()}` });
        queued.push(id);
      }
      return { queued: queued.length, skipped };
    });
  }

  status(auth: AuthContext, documentId: string) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.requireDoc(tx, documentId);
      const table = headerOf(doc.docType);
      const [h] = await tx.select({ irn: table.irn, ackNo: table.ackNo, ackDate: table.ackDate, signedQr: table.signedQr, irnStatus: table.irnStatus, irnError: table.irnError, irnCancelledAt: table.irnCancelledAt }).from(table).where(eq(table.id, doc.id));
      const s = await this.settings(tx, doc.companyId);
      const src = await this.source(tx, doc);
      const logs = await tx
        .select({ id: gstApiLogs.id, action: gstApiLogs.action, ok: gstApiLogs.ok, errorCode: gstApiLogs.errorCode, errorMessage: gstApiLogs.errorMessage, createdAt: gstApiLogs.createdAt })
        .from(gstApiLogs)
        .where(eq(gstApiLogs.documentId, doc.id))
        .orderBy(desc(gstApiLogs.createdAt))
        .limit(20);
      return {
        enabled: s.einvoice,
        applicable: !notApplicable(src),
        reason: notApplicable(src),
        ...h,
        qrDataUri: h.signedQr ? await QRCode.toDataURL(h.signedQr, { errorCorrectionLevel: 'M', margin: 1, scale: 3 }) : null,
        cancellableUntil: h.irn && h.irnStatus !== 'cancelled' && h.ackDate ? new Date(h.ackDate.getTime() + CANCEL_WINDOW_MS).toISOString() : null,
        log: logs,
      };
    });
  }

  /** QR image (data URI) for print formats. */
  qrDataUri(signedQr: string | null) {
    return signedQr ? QRCode.toDataURL(signedQr, { errorCorrectionLevel: 'M', margin: 1, scale: 3 }) : Promise.resolve(null);
  }

  /** Approved invoices / credit notes in e-invoice scope with their IRN state, for the compliance desk. */
  list(auth: AuthContext, q: { status?: 'pending' | 'generated' | 'failed' | 'cancelled' | 'missing'; from?: string; to?: string; limit: number }) {
    return this.database.run(auth, async (tx) => {
      const out: Record<string, unknown>[] = [];
      for (const docType of EINVOICE_TYPES) {
        const t = headerOf(docType);
        const customer = docType === 'sales_invoice' ? salesInvoices.customerId : creditNotes.customerId;
        const statusCond =
          q.status === 'missing'
            ? and(isNull(t.irn), or(isNull(t.irnStatus), eq(t.irnStatus, 'failed')))
            : q.status === 'generated'
              ? eq(t.irnStatus, 'generated')
              : q.status
                ? eq(t.irnStatus, q.status)
                : undefined;
        const rows = await tx
          .select({
            id: documents.id,
            docType: documents.docType,
            number: documents.number,
            docDate: documents.docDate,
            customer: parties.name,
            gstin: docType === 'sales_invoice' ? salesInvoices.customerGstin : sql<string | null>`(select si.customer_gstin from sales_invoices si where si.id = ${creditNotes.invoiceId})`,
            taxKind: t.taxKind,
            grandTotal: t.grandTotal,
            irn: t.irn,
            ackNo: t.ackNo,
            ackDate: t.ackDate,
            irnStatus: t.irnStatus,
            irnError: t.irnError,
          })
          .from(t)
          .innerJoin(documents, eq(documents.id, t.id))
          .innerJoin(parties, eq(parties.id, customer))
          .where(
            and(
              eq(documents.status, 'approved'),
              statusCond,
              q.from ? gte(documents.docDate, q.from) : undefined,
              q.to ? lte(documents.docDate, q.to) : undefined,
              // B2C and bills of supply are out of scope.
              sql`${t.taxKind} <> 'bill_of_supply'`,
            ),
          )
          .orderBy(desc(documents.docDate), desc(documents.id))
          .limit(q.limit);
        out.push(...rows.filter((r) => r.gstin || r.taxKind === 'export' || r.taxKind === 'sez'));
      }
      return { items: out.sort((a, b) => String(b.docDate).localeCompare(String(a.docDate))).slice(0, q.limit) };
    });
  }

  // ---- Source ------------------------------------------------------------------------

  private async findDoc(tx: Transaction, id: string) {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, id), inArray(documents.docType, [...EINVOICE_TYPES])));
    return doc ? (doc as DocumentRow & { docType: EInvoiceDocType }) : null;
  }

  private async requireDoc(tx: Transaction, id: string) {
    const doc = await this.findDoc(tx, id);
    if (!doc) throw new NotFoundException('Invoice or credit note not found');
    return doc;
  }

  /** Seller: the branch registration when it has one, else the company's. */
  async seller(tx: Transaction, companyId: string, branchId: string | null) {
    const own = await ownGstRegistration(tx, companyId, branchId);
    const [c] = await tx.select({ name: companies.name, legalName: companies.legalName, address: companies.address }).from(companies).where(eq(companies.id, companyId));
    const [b] = branchId ? await tx.select({ address: branches.address, gstin: branches.gstin }).from(branches).where(eq(branches.id, branchId)) : [];
    const address = b?.gstin && b.address?.line1 ? b.address : c.address;
    return { gstin: own.gstin, legalName: c.legalName || c.name, tradeName: c.legalName && c.legalName !== c.name ? c.name : null, address: { line1: address.line1, line2: (address as { line2?: string }).line2, city: address.city, pincode: address.pincode }, stateCode: own.stateCode };
  }

  async source(tx: Transaction, doc: DocumentRow): Promise<ESource> {
    const seller = await this.seller(tx, doc.companyId, doc.branchId);
    if (doc.docType === 'sales_invoice') {
      const [inv] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, doc.id));
      const lines = await tx
        .select({ l: salesInvoiceLines, uqc: uoms.uqc, type: items.type })
        .from(salesInvoiceLines)
        .innerJoin(uoms, eq(uoms.id, salesInvoiceLines.uomId))
        .innerJoin(items, eq(items.id, salesInvoiceLines.itemId))
        .where(eq(salesInvoiceLines.invoiceId, doc.id))
        .orderBy(asc(salesInvoiceLines.lineNo));
      return this.compose(tx, doc, seller, inv, inv, lines.map(({ l, uqc, type }) => ({ ...l, uqc, type })), null);
    }
    const [cn] = await tx.select().from(creditNotes).where(eq(creditNotes.id, doc.id));
    const [inv] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, cn.invoiceId));
    const [invDoc] = await tx.select({ number: documents.number, docDate: documents.docDate }).from(documents).where(eq(documents.id, cn.invoiceId));
    const lines = await tx
      .select({ l: creditNoteLines, uqc: uoms.uqc, type: items.type })
      .from(creditNoteLines)
      .innerJoin(uoms, eq(uoms.id, creditNoteLines.uomId))
      .innerJoin(items, eq(items.id, creditNoteLines.itemId))
      .where(eq(creditNoteLines.creditNoteId, doc.id))
      .orderBy(asc(creditNoteLines.lineNo));
    return this.compose(tx, doc, seller, cn, inv, lines.map(({ l, uqc, type }) => ({ ...l, discountPct: '0', uqc, type })), { number: invDoc.number ?? '', date: invDoc.docDate });
  }

  private async compose(
    tx: Transaction,
    doc: DocumentRow,
    seller: ESource['seller'],
    tax: typeof salesInvoices.$inferSelect | typeof creditNotes.$inferSelect,
    inv: typeof salesInvoices.$inferSelect,
    lines: { description: string; hsnCode: string | null; qty: string; rate: string; discountPct: string; taxableValue: string; gstRate: string; cgstAmount: string; sgstAmount: string; igstAmount: string; cessRate: string; cessAmount: string; lineTotal: string; batchNo: string | null; uqc: string; type: string }[],
    preceding: { number: string; date: string } | null,
  ): Promise<ESource> {
    const [cust] = await tx.select({ name: parties.name, legalName: parties.legalName }).from(parties).where(eq(parties.id, inv.customerId));
    const bill = inv.billingAddress;
    const ship = inv.shippingAddress;
    const differentShip = ship && (ship.line1 ?? '') !== (bill.line1 ?? '') && !!ship.pincode;
    return {
      docType: doc.docType === 'credit_note' ? 'CRN' : 'INV',
      number: doc.number ?? '',
      date: doc.docDate,
      taxKind: tax.taxKind,
      withLut: inv.withLut,
      reverseCharge: tax.reverseCharge,
      interState: tax.interState,
      placeOfSupply: tax.placeOfSupply,
      seller,
      buyer: {
        gstin: inv.customerGstin,
        registration: inv.customerRegistration,
        legalName: cust.legalName || cust.name,
        tradeName: cust.legalName && cust.legalName !== cust.name ? cust.name : null,
        address: { line1: bill.line1, line2: bill.line2, city: bill.city, pincode: bill.pincode },
        stateCode: inv.customerStateCode,
      },
      shipTo: differentShip ? { gstin: ship.gstin ?? inv.customerGstin, legalName: ship.name || cust.legalName || cust.name, address: { line1: ship.line1, line2: ship.line2, city: ship.city, pincode: ship.pincode }, stateCode: ship.stateCode ?? inv.customerStateCode } : null,
      lines: lines.map((l) => ({
        description: l.description,
        hsnCode: l.hsnCode,
        isService: l.type === 'service',
        qty: l.qty,
        uqc: l.uqc,
        rate: l.rate,
        taxableValue: l.taxableValue,
        gstRate: l.gstRate,
        cgst: l.cgstAmount,
        sgst: l.sgstAmount,
        igst: l.igstAmount,
        cessRate: l.cessRate,
        cess: l.cessAmount,
        lineTotal: l.lineTotal,
        batchNo: l.batchNo,
      })),
      totals: { taxable: tax.taxableTotal, cgst: tax.cgstTotal, sgst: tax.sgstTotal, igst: tax.igstTotal, cess: tax.cessTotal, roundOff: tax.roundOff, grandTotal: tax.grandTotal },
      preceding,
    };
  }

  async log(
    tx: Transaction,
    auth: AuthContext,
    doc: Pick<DocumentRow, 'id' | 'companyId'> | null,
    action: string,
    r: { ok: boolean; code?: string; message?: string; request: Record<string, unknown>; response: Record<string, unknown>; companyId?: string },
  ) {
    if (!doc && !r.companyId) throw new BadRequestException('log needs a document or company');
    await tx.insert(gstApiLogs).values({
      tenantId: auth.tenantId,
      companyId: doc?.companyId ?? r.companyId!,
      documentId: doc?.id ?? null,
      action,
      provider: this.gsp.provider.name,
      ok: r.ok,
      errorCode: r.code ?? null,
      errorMessage: r.message ?? null,
      request: r.request,
      response: r.response,
      createdBy: auth.userId || null,
    });
  }
}
