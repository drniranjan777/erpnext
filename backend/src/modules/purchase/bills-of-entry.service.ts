import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { billOfEntryLines, billsOfEntry, companies, documents, goodsReceiptLines, goodsReceipts, items, parties, purchaseInvoices, uoms, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { decimalSchema, optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { StockService } from '../inventory/stock.service';
import { computeDuty } from './customs';

const DOC_TYPE = 'bill_of_entry' as const;
const D = Decimal.from;
const ZERO = D('0');

type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}

const rate = (label: string) => decimalSchema(2, label).refine((v) => v === null || Number(v) <= 100, `${label}: at most 100`);

const boeLineSchema = z.object({
  itemId: z.uuid(),
  description: optionalText(300),
  qty: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Quantity must be more than zero'),
  /** Invoice value of the line in the foreign currency. */
  foreignValue: decimalSchema(2, 'Foreign value'),
  /** Blank = foreign value × exchange rate. */
  assessableValue: decimalSchema(2, 'Assessable value'),
  bcdRate: rate('BCD %'),
  swsRate: rate('SWS %'),
  /** Blank = the item's GST rate. */
  igstRate: rate('IGST %'),
  cessRate: rate('Cess %'),
});

const boeHeader = {
  vendorId: z.uuid(),
  docDate: z.iso.date().optional(),
  boeNo: z.string().trim().regex(/^\d{6,8}$/, 'Bill of Entry numbers are 6–8 digits'),
  boeDate: z.iso.date(),
  portCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[A-Z0-9]{3,4}$/, 'Port code like INNSA1 / INMAA4'),
  boeType: z.enum(['home', 'warehouse', 'ex_bond']).default('home'),
  purchaseInvoiceId: z.uuid().nullable().optional(),
  goodsReceiptId: z.uuid().nullable().optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('USD'),
  exchangeRate: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,8}(\.\d{1,6})?$/.test(v) && Number(v) > 0, 'Enter the customs exchange rate (₹ per unit)'),
  notes: optionalText(1000),
  lines: z.array(boeLineSchema).min(1, 'Add at least one item').max(200),
};
export const createBoeSchema = z.object(boeHeader);
export type CreateBoeInput = z.infer<typeof createBoeSchema>;
export const updateBoeSchema = z.object({ ...boeHeader, version: z.number().int() });

/**
 * Bill of Entry for imported goods: customs duty (BCD + SWS) is a cost and is added to the
 * stock value of the goods received; import IGST and cess are input tax credit.
 */
@Injectable()
export class BillsOfEntryService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly stock: StockService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      amendable: false,
      onApproved: (tx, auth, doc) => this.post(tx, auth, doc),
      onCancelled: async (tx, auth, doc) => {
        await this.stock.reverseVoucher(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate });
        await tx.update(billsOfEntry).set({ capitalised: '0' }).where(eq(billsOfEntry.id, doc.id));
      },
    });
  }

  list(auth: AuthContext, q: { status?: string; q?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          vendor: { id: parties.id, name: parties.name },
          boeNo: billsOfEntry.boeNo,
          boeDate: billsOfEntry.boeDate,
          portCode: billsOfEntry.portCode,
          assessableTotal: billsOfEntry.assessableTotal,
          dutyTotal: billsOfEntry.dutyTotal,
          igstTotal: billsOfEntry.igstTotal,
        })
        .from(documents)
        .innerJoin(billsOfEntry, eq(billsOfEntry.id, documents.id))
        .innerJoin(parties, eq(parties.id, billsOfEntry.vendorId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status as 'approved') : undefined,
            term ? or(ilike(billsOfEntry.boeNo, `%${term}%`), ilike(parties.name, `%${term}%`), ilike(documents.number, `%${term}%`)) : undefined,
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

  /** Duty calculation while typing. */
  preview(auth: AuthContext, input: CreateBoeInput) {
    return this.database.run(auth, async (tx) => {
      const p = await this.prepare(tx, input, null);
      return { header: p.totals, lines: p.lines };
    });
  }

  create(auth: AuthContext, input: CreateBoeInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const p = await this.prepare(tx, input, null);
      const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, companyId: p.companyId, branchId: p.branchId, docDate: input.docDate ?? todayIST(), title: p.title, amount: p.totals.dutyTotal });
      await tx.insert(billsOfEntry).values({ id: doc.id, tenantId: auth.tenantId, ...p.header, ...p.totals });
      await tx.insert(billOfEntryLines).values(p.lines.map((l) => ({ ...l, tenantId: auth.tenantId, boeId: doc.id })));
      await this.documents.log(tx, auth, doc, 'document.created', meta, { boeNo: input.boeNo });
      return this.view(tx, auth, doc);
    });
  }

  update(auth: AuthContext, id: string, input: CreateBoeInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const p = await this.prepare(tx, input, id);
      await tx.update(billsOfEntry).set({ ...p.header, ...p.totals }).where(eq(billsOfEntry.id, id));
      await tx.delete(billOfEntryLines).where(eq(billOfEntryLines.boeId, id));
      await tx.insert(billOfEntryLines).values(p.lines.map((l) => ({ ...l, tenantId: auth.tenantId, boeId: id })));
      const updated = await this.documents.update(tx, auth, doc, { title: p.title, amount: p.totals.dutyTotal, ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}) });
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

  private async prepare(tx: Transaction, input: CreateBoeInput, selfId: string | null) {
    const errors: Err[] = [];
    const [vendor] = await tx.select().from(parties).where(eq(parties.id, input.vendorId));
    if (!vendor || !vendor.isVendor) fail([{ path: 'vendorId', message: 'Choose the overseas supplier (a vendor)' }]);
    const [dup] = await tx
      .select({ id: billsOfEntry.id })
      .from(billsOfEntry)
      .innerJoin(documents, eq(documents.id, billsOfEntry.id))
      .where(and(eq(billsOfEntry.portCode, input.portCode), eq(billsOfEntry.boeNo, input.boeNo), ne(documents.status, 'cancelled'), selfId ? ne(billsOfEntry.id, selfId) : undefined));
    if (dup) errors.push({ path: 'boeNo', message: `Bill of Entry ${input.boeNo} at ${input.portCode} is already recorded` });
    let companyId: string | null = null;
    let branchId: string | null = null;
    let grnWarehouse: string | null = null;
    if (input.goodsReceiptId) {
      const [g] = await tx
        .select({ status: documents.status, companyId: documents.companyId, branchId: documents.branchId, vendorId: goodsReceipts.vendorId, warehouseId: goodsReceipts.warehouseId, number: documents.number })
        .from(goodsReceipts)
        .innerJoin(documents, eq(documents.id, goodsReceipts.id))
        .where(eq(goodsReceipts.id, input.goodsReceiptId));
      if (!g) errors.push({ path: 'goodsReceiptId', message: 'Goods receipt not found' });
      else {
        if (g.status !== 'approved' && g.status !== 'completed') errors.push({ path: 'goodsReceiptId', message: `${g.number ?? 'The GRN'} is not posted` });
        if (g.vendorId !== input.vendorId) errors.push({ path: 'goodsReceiptId', message: 'That goods receipt is from another vendor' });
        companyId = g.companyId;
        branchId = g.branchId;
        grnWarehouse = g.warehouseId;
      }
    }
    if (input.purchaseInvoiceId) {
      const [pi] = await tx.select({ vendorId: purchaseInvoices.vendorId, companyId: documents.companyId }).from(purchaseInvoices).innerJoin(documents, eq(documents.id, purchaseInvoices.id)).where(eq(purchaseInvoices.id, input.purchaseInvoiceId));
      if (!pi || pi.vendorId !== input.vendorId) errors.push({ path: 'purchaseInvoiceId', message: 'Purchase invoice not found for this vendor' });
      else companyId ??= pi.companyId;
    }
    if (!companyId) {
      const [c] = await tx.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
      companyId = c?.id ?? null;
    }
    if (!companyId) errors.push({ path: 'vendorId', message: 'No company found' });
    const its = await tx.select({ id: items.id, code: items.code, name: items.name, hsnCode: items.hsnCode, gstRate: items.gstRate, cessRate: items.cessRate, baseUomId: items.baseUomId }).from(items).where(inArray(items.id, input.lines.map((l) => l.itemId)));
    const fx = D(input.exchangeRate);
    let av = ZERO;
    let bcd = ZERO;
    let sws = ZERO;
    let igst = ZERO;
    let cess = ZERO;
    const lines = input.lines.map((l, i) => {
      const it = its.find((x) => x.id === l.itemId);
      if (!it) {
        errors.push({ path: `lines.${i}.itemId`, message: `Line ${i + 1}: item not found` });
        return null;
      }
      const assessable = l.assessableValue ?? (l.foreignValue ? D(l.foreignValue).mul(fx).toFixed(2) : null);
      if (!assessable || Number(assessable) <= 0) errors.push({ path: `lines.${i}.assessableValue`, message: `Line ${i + 1}: enter the foreign value or the assessable value` });
      const duty = computeDuty({ assessableValue: assessable ?? '0', bcdRate: l.bcdRate ?? '0', swsRate: l.swsRate ?? '10', igstRate: l.igstRate ?? it.gstRate ?? '0', cessRate: l.cessRate ?? it.cessRate ?? '0' });
      av = av.add(D(duty.assessableValue));
      bcd = bcd.add(D(duty.bcdAmount));
      sws = sws.add(D(duty.swsAmount));
      igst = igst.add(D(duty.igstAmount));
      cess = cess.add(D(duty.cessAmount));
      return {
        lineNo: i + 1,
        itemId: it.id,
        description: l.description || it.name,
        hsnCode: it.hsnCode,
        qty: l.qty,
        uomId: it.baseUomId,
        foreignValue: l.foreignValue ?? '0',
        assessableValue: duty.assessableValue,
        bcdRate: l.bcdRate ?? '0',
        bcdAmount: duty.bcdAmount,
        swsRate: l.swsRate ?? '10',
        swsAmount: duty.swsAmount,
        igstRate: l.igstRate ?? it.gstRate ?? '0',
        igstAmount: duty.igstAmount,
        cessRate: l.cessRate ?? it.cessRate ?? '0',
        cessAmount: duty.cessAmount,
      };
    });
    if (input.goodsReceiptId && grnWarehouse) {
      const grnItems = new Set((await tx.select({ itemId: goodsReceiptLines.itemId }).from(goodsReceiptLines).where(eq(goodsReceiptLines.grnId, input.goodsReceiptId))).map((r) => r.itemId));
      input.lines.forEach((l, i) => {
        if (!grnItems.has(l.itemId)) errors.push({ path: `lines.${i}.itemId`, message: `Line ${i + 1}: this item is not on the goods receipt` });
      });
    }
    if (errors.length) fail(errors);
    return {
      companyId: companyId!,
      branchId,
      title: `${vendor.name} · BE ${input.boeNo}`,
      header: {
        vendorId: vendor.id,
        boeNo: input.boeNo,
        boeDate: input.boeDate,
        portCode: input.portCode,
        boeType: input.boeType,
        purchaseInvoiceId: input.purchaseInvoiceId ?? null,
        goodsReceiptId: input.goodsReceiptId ?? null,
        currency: input.currency,
        exchangeRate: fx.toFixed(6),
        notes: input.notes,
      },
      totals: {
        assessableTotal: av.toFixed(2),
        bcdTotal: bcd.toFixed(2),
        swsTotal: sws.toFixed(2),
        igstTotal: igst.toFixed(2),
        cessTotal: cess.toFixed(2),
        dutyTotal: bcd.add(sws).add(igst).add(cess).toFixed(2),
      },
      lines: lines.filter((l): l is NonNullable<typeof l> => !!l),
    };
  }

  /** BCD + SWS go into the stock value of the goods on the linked GRN (by item). */
  private async post(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [boe] = await tx.select().from(billsOfEntry).where(eq(billsOfEntry.id, doc.id));
    if (!boe.goodsReceiptId) return;
    const [grn] = await tx.select({ warehouseId: goodsReceipts.warehouseId }).from(goodsReceipts).where(eq(goodsReceipts.id, boe.goodsReceiptId));
    const grnLines = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.grnId, boe.goodsReceiptId));
    const lines = await tx.select().from(billOfEntryLines).where(eq(billOfEntryLines.boeId, doc.id)).orderBy(asc(billOfEntryLines.lineNo));
    const adjustments = lines
      .map((l) => {
        const g = grnLines.find((x) => x.itemId === l.itemId && D(x.acceptedBaseQty).cmp(ZERO) > 0);
        return g ? { itemId: l.itemId, warehouseId: grn.warehouseId, value: D(l.bcdAmount).add(D(l.swsAmount)).toFixed(2), basisQty: g.acceptedBaseQty } : null;
      })
      .filter((a): a is NonNullable<typeof a> => !!a);
    if (!adjustments.length) return;
    const result = await this.stock.revalue(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate }, adjustments);
    const absorbed = result.reduce((s, r) => s.add(D(r.absorbed)), ZERO);
    await tx.update(billsOfEntry).set({ capitalised: absorbed.toFixed(2) }).where(eq(billsOfEntry.id, doc.id));
    if (absorbed.cmp(D(boe.bcdTotal).add(D(boe.swsTotal))) < 0) {
      await this.documents.activity(tx, auth, doc.id, 'status', `Customs duty: ₹${absorbed.toFixed(2)} added to stock on hand; the rest relates to goods already used or sold`);
    }
  }

  async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('purchase.invoices.manage'), cancel: perms.has('purchase.invoices.cancel') });
    const [boe] = await tx.select().from(billsOfEntry).where(eq(billsOfEntry.id, doc.id));
    const [vendor] = await tx.select({ id: parties.id, code: parties.code, name: parties.name }).from(parties).where(eq(parties.id, boe.vendorId));
    const refs = await tx.select({ id: documents.id, number: documents.number, docType: documents.docType }).from(documents).where(inArray(documents.id, [boe.goodsReceiptId, boe.purchaseInvoiceId].filter((v): v is string => !!v)));
    const rows = await tx
      .select({ l: billOfEntryLines, itemCode: items.code, uomCode: uoms.code })
      .from(billOfEntryLines)
      .innerJoin(items, eq(items.id, billOfEntryLines.itemId))
      .innerJoin(uoms, eq(uoms.id, billOfEntryLines.uomId))
      .where(eq(billOfEntryLines.boeId, doc.id))
      .orderBy(asc(billOfEntryLines.lineNo));
    const { tenantId: _t, id: _i, vendorId: _v, ...rest } = boe;
    return {
      ...header,
      ...rest,
      vendor,
      goodsReceipt: refs.find((r) => r.id === boe.goodsReceiptId) ?? null,
      purchaseInvoice: refs.find((r) => r.id === boe.purchaseInvoiceId) ?? null,
      customsDuty: D(boe.bcdTotal).add(D(boe.swsTotal)).toFixed(2),
      itcAvailable: D(boe.igstTotal).add(D(boe.cessTotal)).toFixed(2),
      lines: rows.map(({ l: { tenantId: _lt, boeId: _b, ...l }, ...more }) => ({ ...l, ...more })),
    };
  }
}
