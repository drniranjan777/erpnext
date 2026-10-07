import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { companies, documents, items, parties, salesOrders, salesQuotationLines, salesQuotations, type Transaction, uoms, users } from '@nextgen/database';
import { and, asc, desc, eq, ilike, lt, or } from 'drizzle-orm';
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
import { customerColumns, loadCustomer, priceSelling } from './common';
import { SalesOrdersService } from './orders.service';
import type { CreateQuotationInput, ListQuery, PreviewInput } from './sales.schemas';

const DOC_TYPE = 'sales_quotation' as const;

/** Quotation: priced like an order, valid until a date, approval by discount / margin, converted into a sales order. */
@Injectable()
export class QuotationsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly customFields: CustomFieldsService,
    private readonly print: PrintService,
    private readonly orders: SalesOrdersService,
  ) {}

  onModuleInit() {
    this.print.registerContext(DOC_TYPE, async (tx, auth, id) => {
      const doc = await this.documents.find(tx, id, DOC_TYPE);
      const view = await this.view(tx, auth, doc);
      const [company] = await tx.select({ name: companies.name, legalName: companies.legalName, gstin: companies.gstin, address: companies.address }).from(companies).where(eq(companies.id, doc.companyId));
      const [printer] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, auth.userId));
      return { company, doc: view, customer: view.customer, lines: view.lines, stateTaxLabel: view.stateTaxLabel, printedBy: printer?.name ?? '', printedAt: new Date().toISOString() };
    });
  }

  /** Live pricing for quotation / order / invoice forms (nothing saved). */
  preview(auth: AuthContext, input: PreviewInput) {
    return this.database.run(auth, async (tx) => {
      const customer = await loadCustomer(tx, input.customerId, input.shippingAddressId);
      const companyId = input.companyId ?? (await tx.select({ id: companies.id }).from(companies).orderBy(asc(companies.createdAt)).limit(1))[0].id;
      const priced = await priceSelling(tx, { companyId, branchId: input.branchId ?? null, docDate: todayIST() }, customer, input.lines, input.withLut);
      return { header: priced.header, stateTaxLabel: priced.tax.stateTaxLabel, lines: priced.lines.map(({ item: _i, ...l }) => l) };
    });
  }

  list(auth: AuthContext, q: ListQuery) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          revision: documents.revision,
          status: documents.status,
          docDate: documents.docDate,
          title: documents.title,
          customer: { id: parties.id, name: parties.name },
          validUntil: salesQuotations.validUntil,
          grandTotal: salesQuotations.grandTotal,
          marginPct: salesQuotations.marginPct,
          maxDiscountPct: salesQuotations.maxDiscountPct,
        })
        .from(documents)
        .innerJoin(salesQuotations, eq(salesQuotations.id, documents.id))
        .innerJoin(parties, eq(parties.id, salesQuotations.customerId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status) : undefined,
            q.customerId ? eq(salesQuotations.customerId, q.customerId) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(parties.name, `%${term}%`)) : undefined,
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

  create(auth: AuthContext, input: CreateQuotationInput, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta));
  }

  /** Creates a draft quotation inside the caller's transaction (used by CRM and CPQ). */
  async createTx(tx: Transaction, auth: AuthContext, input: CreateQuotationInput, meta: RequestMeta) {
    {
      const customer = await loadCustomer(tx, input.customerId, input.shippingAddressId);
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields);
      const doc = await this.documents.create(tx, auth, { customFields, docType: DOC_TYPE, companyId: input.companyId, branchId: input.branchId, docDate: input.docDate ?? todayIST(), title: null, amount: null });
      const priced = await priceSelling(tx, doc, customer, input.lines, input.withLut);
      await tx.insert(salesQuotations).values({ id: doc.id, tenantId: auth.tenantId, ...this.header(customer, input), ...priced.header });
      await this.writeLines(tx, auth, doc.id, input, priced.lines);
      const updated = await this.documents.update(tx, auth, doc, { title: `${customer.name}: ${priced.lines[0].description}${priced.lines.length > 1 ? ` + ${priced.lines.length - 1} more` : ''}`.slice(0, 200), amount: priced.header.grandTotal });
      await this.documents.log(tx, auth, updated, 'document.created', meta, { customer: customer.code, amount: updated.amount });
      return this.view(tx, auth, updated);
    }
  }

  update(auth: AuthContext, id: string, input: CreateQuotationInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const customer = await loadCustomer(tx, input.customerId, input.shippingAddressId);
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields, doc.customFields);
      const scoped = await this.documents.update(tx, auth, doc, { customFields, ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}) });
      const priced = await priceSelling(tx, scoped, customer, input.lines, input.withLut);
      await tx.update(salesQuotations).set({ ...this.header(customer, input), ...priced.header }).where(eq(salesQuotations.id, id));
      await tx.delete(salesQuotationLines).where(eq(salesQuotationLines.quotationId, id));
      await this.writeLines(tx, auth, id, input, priced.lines);
      const updated = await this.documents.update(tx, auth, scoped, { amount: priced.header.grandTotal });
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
      const [q] = await tx.select().from(salesQuotations).where(eq(salesQuotations.id, id));
      await this.documents.submit(tx, auth, doc, meta, { maxDiscountPct: q.maxDiscountPct, marginPct: q.marginPct });
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
      const lines = await tx.select().from(salesQuotationLines).where(eq(salesQuotationLines.quotationId, id));
      return this.view(tx, auth, await this.documents.amend(tx, auth, doc, { header: doc, lines } as unknown as Record<string, unknown>, reason, meta));
    });
  }

  /** Draft sales order from an approved quotation; the quotation is then completed. */
  toOrder(auth: AuthContext, id: string, input: { customerPoNo?: string | null; customerPoDate?: string | null }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE);
      if (doc.status !== 'approved') throw new ConflictException(doc.status === 'completed' ? 'This quotation was already converted into an order' : 'Only approved quotations can become orders');
      const [q] = await tx.select().from(salesQuotations).where(eq(salesQuotations.id, id));
      if (q.validUntil && q.validUntil < todayIST()) throw new ConflictException(`This quotation expired on ${q.validUntil}. Amend it with a new validity first.`);
      const lines = await tx.select().from(salesQuotationLines).where(eq(salesQuotationLines.quotationId, id)).orderBy(asc(salesQuotationLines.lineNo));
      const order = await this.orders.createTx(
        tx,
        auth,
        {
          companyId: doc.companyId,
          branchId: doc.branchId,
          customerId: q.customerId,
          withLut: q.withLut,
          quotationId: id,
          customerPoNo: input.customerPoNo ?? null,
          customerPoDate: input.customerPoDate ?? null,
          paymentTerms: q.paymentTerms,
          creditDays: q.creditDays,
          terms: q.terms,
          notes: doc.number ? `Against quotation ${doc.number}` : null,
          lines: lines.map((l) => ({ itemId: l.itemId, uomId: l.uomId, description: l.description, qty: l.qty, rate: l.rate, discountPct: l.discountPct, quotationLineId: l.id, remarks: l.remarks })),
        },
        meta,
      );
      await this.documents.update(tx, auth, doc, { status: 'completed' });
      await this.documents.activity(tx, auth, id, 'status', `Converted into sales order`, { orderId: order.id });
      return order;
    });
  }

  private header(customer: Awaited<ReturnType<typeof loadCustomer>>, input: CreateQuotationInput) {
    return {
      ...customerColumns(customer, input.withLut),
      validUntil: input.validUntil ?? null,
      customerEnquiryRef: input.customerEnquiryRef,
      priceListId: customer.priceListId,
      paymentTerms: input.paymentTerms ?? customer.paymentTerms,
      creditDays: input.creditDays ?? customer.creditDays,
      terms: input.terms,
      notes: input.notes,
    };
  }

  private async writeLines(tx: Transaction, auth: AuthContext, quotationId: string, input: CreateQuotationInput, priced: Awaited<ReturnType<typeof priceSelling>>['lines']) {
    await tx.insert(salesQuotationLines).values(
      priced.map((p, i) => ({
        tenantId: auth.tenantId,
        quotationId,
        lineNo: i + 1,
        itemId: p.itemId,
        description: p.description,
        uomId: p.uomId,
        qty: p.qty,
        conversionFactor: p.conversionFactor,
        baseQty: p.baseQty,
        listRate: p.listRate,
        rate: p.rate,
        discountPct: input.lines[i].discountPct ?? '0',
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
        remarks: input.lines[i].remarks,
      })),
    );
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('sales.quotations.manage'), cancel: perms.has('sales.quotations.manage') });
    const [q] = await tx.select().from(salesQuotations).where(eq(salesQuotations.id, doc.id));
    const [customer] = await tx.select({ id: parties.id, code: parties.code, name: parties.name }).from(parties).where(eq(parties.id, q.customerId));
    const rows = await tx
      .select({ l: salesQuotationLines, itemCode: items.code, uomCode: uoms.code })
      .from(salesQuotationLines)
      .innerJoin(items, eq(items.id, salesQuotationLines.itemId))
      .innerJoin(uoms, eq(uoms.id, salesQuotationLines.uomId))
      .where(eq(salesQuotationLines.quotationId, doc.id))
      .orderBy(asc(salesQuotationLines.lineNo));
    const [order] = await tx.select({ id: documents.id, number: documents.number, status: documents.status }).from(salesOrders).innerJoin(documents, eq(documents.id, salesOrders.id)).where(eq(salesOrders.quotationId, doc.id)).limit(1);
    const { tenantId: _t, id: _i, customerId: _c, ...rest } = q;
    const expired = !!q.validUntil && q.validUntil < todayIST();
    return {
      ...header,
      ...rest,
      customer: { ...customer, gstin: q.customerGstin, stateCode: q.customerStateCode, registration: q.customerRegistration },
      stateTaxLabel: q.placeOfSupply && UTGST_STATES.has(q.placeOfSupply) ? 'UTGST' : 'SGST',
      lines: rows.map(({ l: { tenantId: _lt, quotationId: _q, ...l }, ...more }) => ({ ...l, ...more, marginPct: l.unitCost && Number(l.taxableValue) ? Decimal.from(l.taxableValue).sub(Decimal.from(l.unitCost).mul(Decimal.from(l.qty))).mul(Decimal.from('100')).div(Decimal.from(l.taxableValue)).toFixed(2) : null })),
      order: order ?? null,
      expired,
      canOrder: doc.status === 'approved' && !expired && perms.has('sales.orders.manage'),
    };
  }
}
