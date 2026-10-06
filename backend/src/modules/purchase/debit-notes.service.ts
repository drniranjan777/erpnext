import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  companies,
  debitNoteLines,
  debitNotes,
  documents,
  goodsReceiptLines,
  goodsReceipts,
  items,
  parties,
  purchaseInvoiceLines,
  purchaseInvoices,
  type Transaction,
  uoms,
  users,
  warehouses,
} from '@nextgen/database';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { PrintService } from '../customization/print.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { UTGST_STATES, type RegistrationType } from '../gst/gst-engine';
import { ownGstRegistration, priceLines, taxHeader } from '../gst/pricing';
import { StockService, type StockMove } from '../inventory/stock.service';
import type { CreateDnInput } from './invoices.schemas';

const DOC_TYPE = 'debit_note' as const;
const D = Decimal.from;
const ZERO = D('0');
type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}
const trim = (d: Decimal) => d.toFixed(4).replace(/\.?0+$/, '') || '0';

/**
 * Debit note against an approved purchase invoice, with the same GST treatment as the bill.
 * - return: goods go back to the vendor (stock out of the receiving warehouse).
 * - price_adjustment: the vendor over-charged; stock still on hand is revalued down.
 */
@Injectable()
export class DebitNotesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
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
      const [company] = await tx.select({ name: companies.name, legalName: companies.legalName, gstin: companies.gstin }).from(companies).where(eq(companies.id, doc.companyId));
      const [printer] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, auth.userId));
      return { doc: view, company: { ...company, gstin: view.ourGstin ?? company?.gstin }, vendor: view.vendor, lines: view.lines, invoice: view.invoice, stateTaxLabel: view.stateTaxLabel, printedBy: printer?.name ?? '', printedAt: new Date().toISOString() };
    });
  }

  list(auth: AuthContext, q: { status?: string; piId?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          kind: debitNotes.kind,
          reason: debitNotes.reason,
          grandTotal: debitNotes.grandTotal,
          piId: debitNotes.piId,
          supplierInvoiceNo: purchaseInvoices.supplierInvoiceNo,
          vendor: { id: parties.id, name: parties.name },
        })
        .from(documents)
        .innerJoin(debitNotes, eq(debitNotes.id, documents.id))
        .innerJoin(purchaseInvoices, eq(purchaseInvoices.id, debitNotes.piId))
        .innerJoin(parties, eq(parties.id, debitNotes.vendorId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status as DocumentRow['status']) : undefined,
            q.piId ? eq(debitNotes.piId, q.piId) : undefined,
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

  create(auth: AuthContext, input: CreateDnInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const piDoc = await this.invoiceDoc(tx, input.piId);
      const doc = await this.documents.create(tx, auth, {
        docType: DOC_TYPE,
        companyId: piDoc.companyId,
        branchId: piDoc.branchId,
        docDate: input.docDate ?? todayIST(),
        title: null,
        amount: null,
      });
      const prepared = await this.prepare(tx, doc, input);
      await tx.insert(debitNotes).values({ id: doc.id, tenantId: auth.tenantId, ...prepared.header });
      await this.writeLines(tx, auth, doc.id, prepared.lines);
      const updated = await this.documents.update(tx, auth, doc, { title: prepared.title, amount: prepared.header.grandTotal });
      await this.documents.log(tx, auth, updated, 'document.created', meta, { kind: input.kind, invoice: piDoc.number });
      return this.view(tx, auth, updated);
    });
  }

  update(auth: AuthContext, id: string, input: CreateDnInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const [current] = await tx.select().from(debitNotes).where(eq(debitNotes.id, id));
      if (current.piId !== input.piId) fail([{ path: 'piId', message: 'A debit note stays on its bill' }]);
      const scoped = input.docDate && !doc.number ? await this.documents.update(tx, auth, doc, { docDate: input.docDate }) : doc;
      const prepared = await this.prepare(tx, scoped, input);
      await tx.update(debitNotes).set(prepared.header).where(eq(debitNotes.id, id));
      await tx.delete(debitNoteLines).where(eq(debitNoteLines.dnId, id));
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
    const [dn] = await tx.select().from(debitNotes).where(eq(debitNotes.id, doc.id));
    const lines = await tx.select().from(debitNoteLines).where(eq(debitNoteLines.dnId, doc.id)).orderBy(asc(debitNoteLines.lineNo));
    const piLines = await tx.select().from(purchaseInvoiceLines).where(inArray(purchaseInvoiceLines.id, lines.map((l) => l.piLineId))).for('update');
    const stockItems = new Set((await tx.select({ id: items.id }).from(items).where(and(inArray(items.id, lines.map((l) => l.itemId)), eq(items.isStockItem, true)))).map((i) => i.id));
    const voucher = { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate };

    if (dn.kind === 'return') {
      const errors: Err[] = [];
      for (const l of lines) {
        const pl = piLines.find((p) => p.id === l.piLineId)!;
        const open = D(pl.qty).sub(D(pl.returnedQty));
        if (D(l.qty).cmp(open) > 0) errors.push({ path: `lines.${l.lineNo - 1}.qty`, message: `Line ${l.lineNo}: only ${trim(open)} billed and not yet returned` });
      }
      if (errors.length) fail(errors);
      const moves: StockMove[] = lines
        .filter((l) => stockItems.has(l.itemId))
        .map((l) => ({ itemId: l.itemId, warehouseId: dn.warehouseId!, qty: ZERO.sub(D(l.baseQty)).toFixed(4), rate: null, batchNo: l.batchNo, serialNos: l.serialNos, line: l.lineNo, allowExpired: true }));
      await this.stock.post(tx, auth, voucher, moves);
      for (const l of lines) await tx.update(purchaseInvoiceLines).set({ returnedQty: sql`${purchaseInvoiceLines.returnedQty} + ${l.qty}::numeric` }).where(eq(purchaseInvoiceLines.id, l.piLineId));
    } else {
      // Reduce the cost of what is still in stock.
      const whByGrnLine = await this.receivingWarehouses(tx, piLines.map((p) => p.grnLineId).filter((v): v is string => !!v));
      await this.stock.revalue(
        tx,
        auth,
        voucher,
        lines
          .filter((l) => stockItems.has(l.itemId))
          .map((l) => {
            const pl = piLines.find((p) => p.id === l.piLineId)!;
            const wh = pl.grnLineId ? whByGrnLine.get(pl.grnLineId) : null;
            return wh ? { itemId: l.itemId, warehouseId: wh, value: ZERO.sub(D(l.taxableValue)).toFixed(2), basisQty: l.baseQty } : { itemId: l.itemId, warehouseId: '', value: '0' };
          })
          .filter((a) => a.warehouseId),
      );
    }
  }

  private async unpost(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [dn] = await tx.select().from(debitNotes).where(eq(debitNotes.id, doc.id));
    await this.stock.reverseVoucher(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate });
    if (dn.kind === 'return') {
      const lines = await tx.select().from(debitNoteLines).where(eq(debitNoteLines.dnId, doc.id));
      for (const l of lines) await tx.update(purchaseInvoiceLines).set({ returnedQty: sql`${purchaseInvoiceLines.returnedQty} - ${l.qty}::numeric` }).where(eq(purchaseInvoiceLines.id, l.piLineId));
    }
  }

  // ---- helpers -----------------------------------------------------------------------

  private async invoiceDoc(tx: Transaction, piId: string) {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, piId), eq(documents.docType, 'purchase_invoice')));
    if (!doc) fail([{ path: 'piId', message: 'Purchase invoice not found' }]);
    if (doc.status !== 'approved') fail([{ path: 'piId', message: 'Debit notes can only be raised against approved bills' }]);
    return doc;
  }

  private async receivingWarehouses(tx: Transaction, grnLineIds: string[]) {
    if (!grnLineIds.length) return new Map<string, string>();
    const rows = await tx
      .select({ id: goodsReceiptLines.id, warehouseId: goodsReceipts.warehouseId })
      .from(goodsReceiptLines)
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.grnId))
      .where(inArray(goodsReceiptLines.id, grnLineIds));
    return new Map(rows.map((r) => [r.id, r.warehouseId]));
  }

  private async prepare(tx: Transaction, doc: DocumentRow, input: CreateDnInput) {
    const piDoc = await this.invoiceDoc(tx, input.piId);
    const [pi] = await tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, input.piId));
    const piLines = await tx.select().from(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.piId, pi.id));
    const stockItems = new Set((await tx.select({ id: items.id }).from(items).where(and(inArray(items.id, piLines.map((l) => l.itemId)), eq(items.isStockItem, true)))).map((i) => i.id));
    const errors: Err[] = [];
    const isReturn = input.kind === 'return';

    // Returns leave from the warehouse the goods came into (unless told otherwise).
    let warehouseId = input.warehouseId ?? null;
    if (isReturn && !warehouseId) {
      const firstGrn = piLines.find((l) => l.grnLineId)?.grnLineId;
      warehouseId = firstGrn ? ((await this.receivingWarehouses(tx, [firstGrn])).get(firstGrn) ?? null) : null;
    }
    if (isReturn && input.lines.some((l) => stockItems.has(piLines.find((p) => p.id === l.piLineId)?.itemId ?? '')) && !warehouseId) {
      errors.push({ path: 'warehouseId', message: 'Choose the warehouse the goods go back from' });
    }
    if (warehouseId) {
      const [wh] = await tx.select({ companyId: warehouses.companyId }).from(warehouses).where(eq(warehouses.id, warehouseId));
      if (!wh || wh.companyId !== piDoc.companyId) errors.push({ path: 'warehouseId', message: 'Unknown warehouse for this company' });
    }

    const lines = input.lines.map((l, i) => {
      const pl = piLines.find((p) => p.id === l.piLineId);
      if (!pl) {
        errors.push({ path: `lines.${i}.piLineId`, message: 'Not a line of this bill' });
        return null;
      }
      const open = isReturn ? D(pl.qty).sub(D(pl.returnedQty)) : D(pl.qty);
      if (D(l.qty).cmp(open) > 0) errors.push({ path: `lines.${i}.qty`, message: isReturn ? `Only ${trim(open)} billed and not yet returned` : `The bill has ${trim(open)}` });
      // Return: at the bill's net rate unless given. Price adjustment: the reduction per unit is required.
      const netRate = D(pl.taxableValue).div(D(pl.qty)).toFixed(4);
      const rate = l.rate ?? (isReturn ? netRate : null);
      if (!rate) errors.push({ path: `lines.${i}.rate`, message: 'Enter the reduction per unit' });
      else if (D(rate).cmp(D(netRate)) > 0) errors.push({ path: `lines.${i}.rate`, message: `Cannot exceed the billed net rate ${netRate}` });
      return { l, pl, rate: rate ?? '0' };
    });
    if (errors.length) fail(errors);
    const rows = lines as NonNullable<(typeof lines)[number]>[];

    const own = await ownGstRegistration(tx, doc.companyId, doc.branchId);
    const { lines: priced, tax } = await priceLines(
      tx,
      { direction: 'inward', ownStateCode: own.stateCode, partyRegistration: pi.vendorRegistration as RegistrationType, partyStateCode: pi.vendorStateCode, reverseCharge: pi.reverseCharge },
      rows.map((r) => ({ itemId: r.pl.itemId, uomId: r.pl.uomId, qty: r.l.qty, rate: r.rate, description: r.pl.description })),
      { defaultUnit: 'purchase' },
    );
    return {
      title: `${isReturn ? 'Return' : 'Price adjustment'} against bill ${pi.supplierInvoiceNo}`,
      header: {
        piId: pi.id,
        vendorId: pi.vendorId,
        kind: input.kind,
        warehouseId: isReturn ? warehouseId : null,
        reason: input.reason,
        vehicleNo: input.vehicleNo,
        notes: input.notes,
        ...taxHeader(tax),
      },
      lines: priced.map((p, i) => ({ ...p, piLineId: rows[i].pl.id, batchNo: rows[i].l.batchNo ?? null, serialNos: rows[i].l.serialNos ?? null, remarks: rows[i].l.remarks })),
    };
  }

  private async writeLines(tx: Transaction, auth: AuthContext, dnId: string, lines: Awaited<ReturnType<DebitNotesService['prepare']>>['lines']) {
    await tx.insert(debitNoteLines).values(
      lines.map((l) => ({
        tenantId: auth.tenantId,
        dnId,
        lineNo: l.lineNo,
        piLineId: l.piLineId,
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
        serialNos: l.serialNos?.map((s) => s.toUpperCase()) ?? null,
        remarks: l.remarks,
      })),
    );
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('purchase.invoices.manage'), cancel: perms.has('purchase.invoices.cancel') });
    const [dn] = await tx.select().from(debitNotes).where(eq(debitNotes.id, doc.id));
    const [pi] = await tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, dn.piId));
    const [piDoc] = await tx.select({ number: documents.number }).from(documents).where(eq(documents.id, dn.piId));
    const [vendor] = await tx.select({ id: parties.id, code: parties.code, name: parties.name }).from(parties).where(eq(parties.id, dn.vendorId));
    const [wh] = dn.warehouseId ? await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, dn.warehouseId)) : [];
    const rows = await tx
      .select({ l: debitNoteLines, itemCode: items.code, uomCode: uoms.code })
      .from(debitNoteLines)
      .innerJoin(items, eq(items.id, debitNoteLines.itemId))
      .innerJoin(uoms, eq(uoms.id, debitNoteLines.uomId))
      .where(eq(debitNoteLines.dnId, doc.id))
      .orderBy(asc(debitNoteLines.lineNo));
    const own = await ownGstRegistration(tx, doc.companyId, doc.branchId);
    const { tenantId: _t, id: _i, vendorId: _v, warehouseId: _w, ...rest } = dn;
    return {
      ...header,
      ...rest,
      invoice: { id: pi.id, number: piDoc?.number ?? null, supplierInvoiceNo: pi.supplierInvoiceNo, supplierInvoiceDate: pi.supplierInvoiceDate },
      vendor: { ...vendor, gstin: pi.vendorGstin, stateCode: pi.vendorStateCode },
      warehouse: wh ?? null,
      ourGstin: own.gstin,
      stateTaxLabel: dn.placeOfSupply && UTGST_STATES.has(dn.placeOfSupply) ? 'UTGST' : 'SGST',
      lines: rows.map(({ l: { tenantId: _lt, dnId: _d, ...l }, ...more }) => ({ ...l, ...more })),
    };
  }
}
