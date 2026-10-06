import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  debitNotes,
  documents,
  goodsReceiptLines,
  goodsReceipts,
  items,
  parties,
  purchaseInvoiceLines,
  purchaseInvoices,
  purchaseOrderLines,
  purchaseOrders,
  type Transaction,
  uoms,
  users,
} from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, lt, ne, notInArray, or, sql } from 'drizzle-orm';
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
import { ownGstRegistration, priceLines, taxHeader } from '../gst/pricing';
import { dueDate, tdsAmount, tdsRate, TDS_SECTIONS } from '../gst/tds';
import { StockService } from '../inventory/stock.service';
import type { CreatePiInput, ListPiQuery } from './invoices.schemas';
import { loadVendor, type VendorSnapshot } from './vendors';

const DOC_TYPE = 'purchase_invoice' as const;
const D = Decimal.from;
const ZERO = D('0');
type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}
const trim = (d: Decimal) => d.toFixed(4).replace(/\.?0+$/, '') || '0';

/**
 * Purchase invoice (vendor bill). Lines are matched three-way (GRN line: quantity received
 * and accepted, rate from the PO), two-way (service PO line) or not at all (expenses).
 * On approval billed quantities are recorded and stock is revalued for rate differences and
 * for GST that can't be claimed as input tax credit.
 */
@Injectable()
export class InvoicesService implements OnModuleInit {
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
      return { doc: view, company: view.company, vendor: view.vendor, lines: view.lines, stateTaxLabel: view.stateTaxLabel, printedBy: printer?.name ?? '', printedAt: new Date().toISOString() };
    });
  }

  tdsSections() {
    return Object.entries(TDS_SECTIONS).map(([code, s]) => ({ code, ...s }));
  }

  list(auth: AuthContext, q: ListPiQuery) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const outstanding = sql<string>`(${purchaseInvoices.netPayable} - ${purchaseInvoices.paidAmount})`;
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          vendor: { id: parties.id, code: parties.code, name: parties.name },
          supplierInvoiceNo: purchaseInvoices.supplierInvoiceNo,
          supplierInvoiceDate: purchaseInvoices.supplierInvoiceDate,
          matchType: purchaseInvoices.matchType,
          grandTotal: purchaseInvoices.grandTotal,
          tdsAmount: purchaseInvoices.tdsAmount,
          netPayable: purchaseInvoices.netPayable,
          outstanding: sql<string>`${outstanding}::numeric(18,2)::text`,
          dueDate: purchaseInvoices.dueDate,
          vendorMsme: purchaseInvoices.vendorMsme,
          rateVariance: purchaseInvoices.rateVariance,
        })
        .from(documents)
        .innerJoin(purchaseInvoices, eq(purchaseInvoices.id, documents.id))
        .innerJoin(parties, eq(parties.id, purchaseInvoices.vendorId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status) : undefined,
            q.vendorId ? eq(purchaseInvoices.vendorId, q.vendorId) : undefined,
            q.outstanding === 'true' ? and(eq(documents.status, 'approved'), sql`${outstanding} > 0`) : undefined,
            q.msme === 'true' ? inArray(purchaseInvoices.vendorMsme, ['micro', 'small']) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(parties.name, `%${term}%`), ilike(purchaseInvoices.supplierInvoiceNo, `%${term}%`)) : undefined,
            q.cursor ? lt(documents.id, q.cursor) : undefined,
          ),
        )
        .orderBy(q.outstanding === 'true' ? asc(purchaseInvoices.dueDate) : desc(documents.id), desc(documents.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      const today = todayIST();
      return {
        items: page.map((r) => ({ ...r, daysToDue: r.dueDate ? Math.round((Date.parse(r.dueDate) - Date.parse(today)) / 86_400_000) : null })),
        nextCursor: hasMore ? page[page.length - 1].id : null,
      };
    });
  }

  /** What can still be billed for a vendor: accepted GRN lines, and service PO lines. */
  billable(auth: AuthContext, vendorId: string, poId?: string) {
    return this.database.run(auth, async (tx) => {
      const grnLines = await tx
        .select({
          grnLineId: goodsReceiptLines.id,
          grnId: goodsReceipts.id,
          grnNumber: documents.number,
          grnDate: documents.docDate,
          supplierInvoiceNo: goodsReceipts.supplierInvoiceNo,
          poId: goodsReceipts.poId,
          poLineId: goodsReceiptLines.poLineId,
          itemId: goodsReceiptLines.itemId,
          itemCode: items.code,
          itemName: items.name,
          uomId: goodsReceiptLines.uomId,
          uomCode: uoms.code,
          pendingQty: sql<string>`(${goodsReceiptLines.acceptedQty} - ${goodsReceiptLines.billedQty})::text`,
          rate: goodsReceiptLines.rate,
        })
        .from(goodsReceiptLines)
        .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.grnId))
        .innerJoin(documents, eq(documents.id, goodsReceipts.id))
        .innerJoin(items, eq(items.id, goodsReceiptLines.itemId))
        .innerJoin(uoms, eq(uoms.id, goodsReceiptLines.uomId))
        .where(
          and(
            eq(goodsReceipts.vendorId, vendorId),
            eq(documents.status, 'approved'),
            poId ? eq(goodsReceipts.poId, poId) : undefined,
            sql`${goodsReceiptLines.acceptedQty} > ${goodsReceiptLines.billedQty}`,
          ),
        )
        .orderBy(asc(documents.docDate), asc(goodsReceiptLines.lineNo));
      const poDocs = tx.$with('po_docs').as(tx.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.status, ['approved', 'completed'])));
      const poLines = await tx
        .with(poDocs)
        .select({
          poLineId: purchaseOrderLines.id,
          poId: purchaseOrderLines.poId,
          poNumber: poDocs.number,
          itemId: purchaseOrderLines.itemId,
          itemCode: items.code,
          itemName: items.name,
          description: purchaseOrderLines.description,
          uomId: purchaseOrderLines.uomId,
          uomCode: uoms.code,
          pendingQty: sql<string>`(${purchaseOrderLines.qty} - ${purchaseOrderLines.billedQty})::text`,
          rate: sql<string>`(${purchaseOrderLines.taxableValue} / ${purchaseOrderLines.qty})::numeric(18,4)::text`,
        })
        .from(purchaseOrderLines)
        .innerJoin(poDocs, eq(poDocs.id, purchaseOrderLines.poId))
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId))
        .innerJoin(items, eq(items.id, purchaseOrderLines.itemId))
        .innerJoin(uoms, eq(uoms.id, purchaseOrderLines.uomId))
        .where(
          and(
            eq(purchaseOrders.vendorId, vendorId),
            eq(items.isStockItem, false),
            poId ? eq(purchaseOrderLines.poId, poId) : undefined,
            sql`${purchaseOrderLines.qty} > ${purchaseOrderLines.billedQty}`,
          ),
        )
        .orderBy(asc(purchaseOrderLines.lineNo));
      const poNumbers = new Map(
        (grnLines.length ? await tx.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.id, [...new Set(grnLines.map((l) => l.poId))])) : []).map((d) => [d.id, d.number]),
      );
      return { grnLines: grnLines.map((l) => ({ ...l, poNumber: poNumbers.get(l.poId) ?? null })), poLines };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE)));
  }

  create(auth: AuthContext, input: CreatePiInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const vendor = await loadVendor(tx, input.vendorId);
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
      const prepared = await this.prepare(tx, doc, vendor, input);
      await tx.insert(purchaseInvoices).values({ id: doc.id, tenantId: auth.tenantId, ...prepared.header });
      await this.writeLines(tx, auth, doc.id, prepared.lines);
      const updated = await this.documents.update(tx, auth, doc, { title: `${vendor.name}: bill ${input.supplierInvoiceNo}`, amount: prepared.header.netPayable });
      await this.documents.log(tx, auth, updated, 'document.created', meta, { vendor: vendor.code, supplierInvoiceNo: input.supplierInvoiceNo, amount: prepared.header.grandTotal });
      return this.view(tx, auth, updated);
    });
  }

  update(auth: AuthContext, id: string, input: CreatePiInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const vendor = await loadVendor(tx, input.vendorId);
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields, doc.customFields);
      const scoped = await this.documents.update(tx, auth, doc, {
        customFields,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}),
      });
      const prepared = await this.prepare(tx, scoped, vendor, input);
      await tx.update(purchaseInvoices).set(prepared.header).where(eq(purchaseInvoices.id, id));
      await tx.delete(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.piId, id));
      await this.writeLines(tx, auth, id, prepared.lines);
      const updated = await this.documents.update(tx, auth, scoped, { title: `${vendor.name}: bill ${input.supplierInvoiceNo}`, amount: prepared.header.netPayable });
      await this.documents.activity(tx, auth, id, 'edited', 'Edited the bill');
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

  submit(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      const [pi] = await tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, id));
      const lines = await tx.select().from(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.piId, id));
      const flagged = lines.filter((l) => this.outOfTolerance(l, pi.rateTolerancePct));
      if (flagged.length && !pi.varianceNote) {
        fail(flagged.map((l) => ({ path: `lines.${l.lineNo - 1}.rate`, message: `Line ${l.lineNo}: billed rate differs from the order by more than ${D(pi.rateTolerancePct).toFixed(2)}%. Explain the difference before submitting.` })));
      }
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
    const [pi] = await tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, doc.id));
    const lines = await tx.select().from(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.piId, doc.id)).orderBy(asc(purchaseInvoiceLines.lineNo));
    await this.assertNotDuplicate(tx, pi.vendorId, pi.supplierInvoiceNo, doc.id);

    // Lock what is being billed, then make sure nothing is billed twice.
    const grnIds = lines.map((l) => l.grnLineId).filter((v): v is string => !!v);
    const poIds = lines.map((l) => l.poLineId).filter((v): v is string => !!v);
    const grnLines = grnIds.length ? await tx.select().from(goodsReceiptLines).where(inArray(goodsReceiptLines.id, grnIds)).for('update') : [];
    const poLines = poIds.length ? await tx.select().from(purchaseOrderLines).where(inArray(purchaseOrderLines.id, poIds)).for('update') : [];
    const errors: Err[] = [];
    for (const l of lines) {
      if (l.grnLineId) {
        const g = grnLines.find((x) => x.id === l.grnLineId)!;
        const open = D(g.acceptedQty).sub(D(g.billedQty));
        const billing = lines.filter((x) => x.grnLineId === g.id).reduce((s, x) => s.add(D(x.qty)), ZERO);
        if (billing.cmp(open) > 0) errors.push({ path: `lines.${l.lineNo - 1}.qty`, message: `Line ${l.lineNo}: only ${trim(open)} received and not yet billed` });
      } else if (l.poLineId) {
        const p = poLines.find((x) => x.id === l.poLineId)!;
        const open = D(p.qty).sub(D(p.billedQty));
        if (D(l.qty).cmp(open) > 0) errors.push({ path: `lines.${l.lineNo - 1}.qty`, message: `Line ${l.lineNo}: only ${trim(open)} ordered and not yet billed` });
      }
    }
    if (errors.length) fail(errors);

    for (const l of lines) {
      if (l.grnLineId) {
        await tx.update(goodsReceiptLines).set({ billedQty: sql`${goodsReceiptLines.billedQty} + ${l.qty}::numeric` }).where(eq(goodsReceiptLines.id, l.grnLineId));
        const g = grnLines.find((x) => x.id === l.grnLineId)!;
        await tx.update(purchaseOrderLines).set({ billedQty: sql`${purchaseOrderLines.billedQty} + ${l.qty}::numeric` }).where(eq(purchaseOrderLines.id, g.poLineId));
      } else if (l.poLineId) {
        await tx.update(purchaseOrderLines).set({ billedQty: sql`${purchaseOrderLines.billedQty} + ${l.qty}::numeric` }).where(eq(purchaseOrderLines.id, l.poLineId));
      }
    }

    // Stock cost = what we actually pay and can't recover: rate difference + GST without ITC.
    const grnHeaders = grnLines.length
      ? await tx.select({ id: goodsReceipts.id, warehouseId: goodsReceipts.warehouseId }).from(goodsReceipts).where(inArray(goodsReceipts.id, [...new Set(grnLines.map((g) => g.grnId))]))
      : [];
    const adjustments = lines
      .filter((l) => l.grnLineId)
      .map((l) => {
        const g = grnLines.find((x) => x.id === l.grnLineId)!;
        const tax = l.itcEligible ? ZERO : this.lineTax(l, pi.reverseCharge);
        return {
          itemId: l.itemId,
          warehouseId: grnHeaders.find((h) => h.id === g.grnId)!.warehouseId,
          value: D(l.rateVariance).add(tax).toFixed(2),
          basisQty: l.baseQty,
        };
      });
    await this.stock.revalue(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate }, adjustments);
  }

  private async unpost(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [notes] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(debitNotes)
      .innerJoin(documents, eq(documents.id, debitNotes.id))
      .where(and(eq(debitNotes.piId, doc.id), ne(documents.status, 'cancelled')));
    if (notes.n) throw new ConflictException('Cancel the debit notes against this bill first');
    const lines = await tx.select().from(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.piId, doc.id));
    for (const l of lines) {
      if (l.grnLineId) {
        await tx.update(goodsReceiptLines).set({ billedQty: sql`${goodsReceiptLines.billedQty} - ${l.qty}::numeric` }).where(eq(goodsReceiptLines.id, l.grnLineId));
        const [g] = await tx.select({ poLineId: goodsReceiptLines.poLineId }).from(goodsReceiptLines).where(eq(goodsReceiptLines.id, l.grnLineId));
        await tx.update(purchaseOrderLines).set({ billedQty: sql`${purchaseOrderLines.billedQty} - ${l.qty}::numeric` }).where(eq(purchaseOrderLines.id, g.poLineId));
      } else if (l.poLineId) {
        await tx.update(purchaseOrderLines).set({ billedQty: sql`${purchaseOrderLines.billedQty} - ${l.qty}::numeric` }).where(eq(purchaseOrderLines.id, l.poLineId));
      }
    }
    await this.stock.reverseVoucher(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate });
  }

  // ---- preparation -----------------------------------------------------------------

  private async prepare(tx: Transaction, doc: DocumentRow, vendor: VendorSnapshot, input: CreatePiInput) {
    const errors: Err[] = [];
    if (input.supplierInvoiceDate > todayIST()) errors.push({ path: 'supplierInvoiceDate', message: 'The bill date cannot be in the future' });
    await this.assertNotDuplicate(tx, vendor.id, input.supplierInvoiceNo, doc.id);

    const grnIds = input.lines.map((l) => l.grnLineId).filter((v): v is string => !!v);
    const poIds = input.lines.map((l) => l.poLineId).filter((v): v is string => !!v);
    const grnLines = grnIds.length
      ? await tx
          .select({ l: goodsReceiptLines, vendorId: goodsReceipts.vendorId, status: documents.status, poId: goodsReceipts.poId })
          .from(goodsReceiptLines)
          .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.grnId))
          .innerJoin(documents, eq(documents.id, goodsReceipts.id))
          .where(inArray(goodsReceiptLines.id, grnIds))
      : [];
    const poLines = poIds.length
      ? await tx
          .select({ l: purchaseOrderLines, vendorId: purchaseOrders.vendorId, status: documents.status, creditDays: purchaseOrders.creditDays })
          .from(purchaseOrderLines)
          .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId))
          .innerJoin(documents, eq(documents.id, purchaseOrderLines.poId))
          .where(inArray(purchaseOrderLines.id, poIds))
      : [];
    const itemRows = await tx.select({ id: items.id, code: items.code, isStockItem: items.isStockItem }).from(items).where(inArray(items.id, [...new Set(input.lines.map((l) => l.itemId))]));

    const expected: (string | null)[] = [];
    const lines = input.lines.map((l, i) => {
      const p = `lines.${i}`;
      const it = itemRows.find((x) => x.id === l.itemId);
      let uomId = l.uomId ?? null;
      let exp: string | null = null;
      let poLineId = l.poLineId ?? null;
      if (l.grnLineId) {
        const g = grnLines.find((x) => x.l.id === l.grnLineId);
        if (!g) errors.push({ path: `${p}.grnLineId`, message: 'Goods receipt line not found' });
        else {
          if (g.vendorId !== vendor.id) errors.push({ path: `${p}.grnLineId`, message: 'That goods receipt is from another vendor' });
          if (g.status !== 'approved') errors.push({ path: `${p}.grnLineId`, message: 'Bill only posted goods receipts' });
          if (g.l.itemId !== l.itemId) errors.push({ path: `${p}.itemId`, message: 'Item differs from the goods receipt' });
          if (uomId && uomId !== g.l.uomId) errors.push({ path: `${p}.uomId`, message: 'Bill in the unit the goods were received in' });
          const open = D(g.l.acceptedQty).sub(D(g.l.billedQty));
          if (D(l.qty).cmp(open) > 0) errors.push({ path: `${p}.qty`, message: `Only ${trim(open)} received and not yet billed` });
          uomId = g.l.uomId;
          exp = g.l.rate;
          poLineId = g.l.poLineId;
        }
      } else if (l.poLineId) {
        const o = poLines.find((x) => x.l.id === l.poLineId);
        if (!o) errors.push({ path: `${p}.poLineId`, message: 'Order line not found' });
        else {
          if (o.vendorId !== vendor.id) errors.push({ path: `${p}.poLineId`, message: 'That order is for another vendor' });
          if (!['approved', 'completed'].includes(o.status)) errors.push({ path: `${p}.poLineId`, message: 'Bill only approved orders' });
          if (o.l.itemId !== l.itemId) errors.push({ path: `${p}.itemId`, message: 'Item differs from the order' });
          if (it?.isStockItem) errors.push({ path: `${p}.poLineId`, message: `${it.code} is a stock item: bill it against its goods receipt` });
          const open = D(o.l.qty).sub(D(o.l.billedQty));
          if (D(l.qty).cmp(open) > 0) errors.push({ path: `${p}.qty`, message: `Only ${trim(open)} ordered and not yet billed` });
          uomId = o.l.uomId;
          exp = D(o.l.taxableValue).div(D(o.l.qty)).toFixed(4);
        }
      } else if (it?.isStockItem) {
        errors.push({ path: `${p}.itemId`, message: `${it.code} is a stock item: receive it with a GRN, then bill the GRN` });
      }
      expected.push(exp);
      return { ...l, uomId, poLineId };
    });
    if (errors.length) fail(errors);

    const own = await ownGstRegistration(tx, doc.companyId, doc.branchId);
    const { lines: priced, tax } = await priceLines(
      tx,
      { direction: 'inward', ownStateCode: own.stateCode, partyRegistration: vendor.registration, partyStateCode: vendor.stateCode, reverseCharge: input.reverseCharge },
      lines.map((l) => ({ itemId: l.itemId, uomId: l.uomId, qty: l.qty, rate: l.rate, discountPct: l.discountPct, description: l.description })),
      { defaultUnit: 'purchase' },
    );

    let eligible = ZERO;
    let ineligible = ZERO;
    let variance = ZERO;
    const out = priced.map((pl, i) => {
      const lineTax = D(pl.cgstAmount).add(D(pl.sgstAmount)).add(D(pl.igstAmount)).add(D(pl.cessAmount));
      if (lines[i].itcEligible) eligible = eligible.add(lineTax);
      else ineligible = ineligible.add(lineTax);
      const exp = expected[i];
      const v = exp ? D(pl.taxableValue).sub(D(D(lines[i].qty).mul(D(exp)).toFixed(2))) : ZERO;
      variance = variance.add(v);
      return { ...pl, itcEligible: lines[i].itcEligible, grnLineId: lines[i].grnLineId ?? null, poLineId: lines[i].poLineId, expectedRate: exp, rateVariance: v.toFixed(2), remarks: lines[i].remarks, foreignRate: lines[i].foreignRate ?? null };
    });

    const kinds = new Set(out.map((l) => (l.grnLineId ? 'three_way' : l.poLineId ? 'two_way' : 'none')));
    const matchType = kinds.has('none') ? 'none' : kinds.has('two_way') ? 'two_way' : 'three_way';
    const poIdsUsed = new Set([...grnLines.map((g) => g.poId), ...poLines.map((o) => o.l.poId)]);
    const section = input.tdsSection ?? vendor.tdsSection ?? null;
    const rate = input.tdsRate ?? tdsRate(section, vendor.pan);
    const tds = tdsAmount(tax.totals.taxable, rate);
    const credit = input.creditDays ?? poLines[0]?.creditDays ?? vendor.creditDays;
    const due = dueDate(input.supplierInvoiceDate, credit, vendor.msmeCategory);
    return {
      header: {
        vendorId: vendor.id,
        vendorGstin: vendor.gstin,
        vendorStateCode: vendor.stateCode,
        vendorRegistration: vendor.registration,
        vendorMsme: vendor.msmeCategory,
        supplierInvoiceNo: input.supplierInvoiceNo.trim(),
        supplierInvoiceDate: input.supplierInvoiceDate,
        poId: poIdsUsed.size === 1 ? [...poIdsUsed][0] : null,
        matchType: matchType as 'three_way' | 'two_way' | 'none',
        ...taxHeader(tax),
        itcEligibleTax: eligible.toFixed(2),
        itcIneligibleTax: ineligible.toFixed(2),
        tdsSection: section,
        tdsRate: rate ?? '0',
        tdsAmount: tds,
        netPayable: D(tax.totals.grandTotal).sub(D(tds)).toFixed(2),
        dueDate: due.dueDate,
        rateTolerancePct: input.rateTolerancePct ?? '1',
        currency: input.currency,
        exchangeRate: input.exchangeRate ?? '1',
        capture: input.capture ?? null,
        rateVariance: variance.toFixed(2),
        varianceNote: input.varianceNote,
        notes: input.notes,
      },
      lines: out,
    };
  }

  private async assertNotDuplicate(tx: Transaction, vendorId: string, supplierInvoiceNo: string, selfId: string) {
    const [dup] = await tx
      .select({ number: documents.number })
      .from(purchaseInvoices)
      .innerJoin(documents, eq(documents.id, purchaseInvoices.id))
      .where(
        and(
          eq(purchaseInvoices.vendorId, vendorId),
          sql`upper(${purchaseInvoices.supplierInvoiceNo}) = upper(${supplierInvoiceNo.trim()})`,
          ne(purchaseInvoices.id, selfId),
          notInArray(documents.status, ['cancelled']),
        ),
      );
    if (dup) fail([{ path: 'supplierInvoiceNo', message: `This vendor's bill ${supplierInvoiceNo} is already entered${dup.number ? ` as ${dup.number}` : ' (draft)'}` }]);
  }

  private lineTax(l: { cgstAmount: string; sgstAmount: string; igstAmount: string; cessAmount: string }, _reverseCharge: boolean) {
    return D(l.cgstAmount).add(D(l.sgstAmount)).add(D(l.igstAmount)).add(D(l.cessAmount));
  }

  private outOfTolerance(l: { qty: string; expectedRate: string | null; rateVariance: string }, tolerancePct: string) {
    if (!l.expectedRate) return false;
    const base = D(l.qty).mul(D(l.expectedRate));
    if (base.isZero()) return !D(l.rateVariance).isZero();
    const v = D(l.rateVariance);
    const pct = (v.isNegative() ? ZERO.sub(v) : v).mul(D('100')).div(base);
    return pct.cmp(D(tolerancePct)) > 0;
  }

  private async writeLines(tx: Transaction, auth: AuthContext, piId: string, lines: Awaited<ReturnType<InvoicesService['prepare']>>['lines']) {
    await tx.insert(purchaseInvoiceLines).values(
      lines.map((l) => ({
        tenantId: auth.tenantId,
        piId,
        lineNo: l.lineNo,
        itemId: l.itemId,
        description: l.description,
        uomId: l.uomId,
        qty: l.qty,
        conversionFactor: l.conversionFactor,
        baseQty: l.baseQty,
        rate: l.rate,
        foreignRate: l.foreignRate,
        discountPct: l.discountPct ?? '0',
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
        itcEligible: l.itcEligible,
        poLineId: l.poLineId,
        grnLineId: l.grnLineId,
        expectedRate: l.expectedRate,
        rateVariance: l.rateVariance,
        remarks: l.remarks,
      })),
    );
  }

  async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('purchase.invoices.manage'), cancel: perms.has('purchase.invoices.cancel') });
    const [pi] = await tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, doc.id));
    const [vendor] = await tx.select({ id: parties.id, code: parties.code, name: parties.name }).from(parties).where(eq(parties.id, pi.vendorId));
    const rows = await tx
      .select({ l: purchaseInvoiceLines, itemCode: items.code, isStockItem: items.isStockItem, uomCode: uoms.code, grnNumber: sql<string | null>`(select d.number from ${goodsReceiptLines} g join ${documents} d on d.id = g.grn_id where g.id = ${purchaseInvoiceLines.grnLineId})` })
      .from(purchaseInvoiceLines)
      .innerJoin(items, eq(items.id, purchaseInvoiceLines.itemId))
      .innerJoin(uoms, eq(uoms.id, purchaseInvoiceLines.uomId))
      .where(eq(purchaseInvoiceLines.piId, doc.id))
      .orderBy(asc(purchaseInvoiceLines.lineNo));
    const lines = rows.map(({ l: { tenantId: _t, piId: _p, ...l }, ...more }) => ({ ...l, ...more, outOfTolerance: this.outOfTolerance(l, pi.rateTolerancePct) }));
    const [po] = pi.poId ? await tx.select({ id: documents.id, number: documents.number }).from(documents).where(eq(documents.id, pi.poId)) : [];
    const notes = await tx
      .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, amount: documents.amount, kind: debitNotes.kind })
      .from(debitNotes)
      .innerJoin(documents, eq(documents.id, debitNotes.id))
      .where(eq(debitNotes.piId, doc.id))
      .orderBy(desc(documents.id));
    const own = await ownGstRegistration(tx, doc.companyId, doc.branchId);
    const { tenantId: _t, id: _i, vendorId: _v, poId: _p, ...rest } = pi;
    const today = todayIST();
    return {
      ...header,
      ...rest,
      vendor: { ...vendor, gstin: pi.vendorGstin, stateCode: pi.vendorStateCode, registration: pi.vendorRegistration, msme: pi.vendorMsme },
      purchaseOrder: po ?? null,
      ourGstin: own.gstin,
      stateTaxLabel: pi.placeOfSupply && UTGST_STATES.has(pi.placeOfSupply) ? 'UTGST' : 'SGST',
      outstanding: D(pi.netPayable).sub(D(pi.paidAmount)).toFixed(2),
      daysToDue: pi.dueDate ? Math.round((Date.parse(pi.dueDate) - Date.parse(today)) / 86_400_000) : null,
      varianceNeedsNote: lines.some((l) => l.outOfTolerance) && !pi.varianceNote,
      lines,
      debitNotes: notes,
      canDebitNote: doc.status === 'approved' && perms.has('purchase.invoices.manage'),
    };
  }
}
