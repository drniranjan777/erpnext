import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { companies, documents, items, itemUomConversions, parties, rfqLines, rfqQuotes, rfqs, rfqVendors, type Transaction, uoms, warehouses } from '@nextgen/database';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from './orders.service';
import type { AwardInput, CreateRfqInput, QuoteInput } from './rfqs.schemas';
import { VendorPerformanceService } from './vendor-performance.service';

const DOC_TYPE = 'rfq' as const;
const D = Decimal.from;
type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}

/**
 * Request for quotation: items + invited vendors. Once approved it is "issued": it can be
 * emailed to vendors, their quotes recorded, compared side by side, and awarded line by line
 * (one draft PO per winning vendor).
 */
@Injectable()
export class RfqsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
    private readonly orders: OrdersService,
    private readonly performance: VendorPerformanceService,
  ) {}

  list(auth: AuthContext, q: { status?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          title: documents.title,
          responseDueDate: rfqs.responseDueDate,
          vendors: sql<number>`(select count(*)::int from ${rfqVendors} v where v.rfq_id = ${documents.id})`,
          responded: sql<number>`(select count(*)::int from ${rfqVendors} v where v.rfq_id = ${documents.id} and v.responded_at is not null)`,
          awardedAt: rfqs.awardedAt,
        })
        .from(documents)
        .innerJoin(rfqs, eq(rfqs.id, documents.id))
        .where(and(eq(documents.docType, DOC_TYPE), q.status ? eq(documents.status, q.status as DocumentRow['status']) : undefined, q.cursor ? lt(documents.id, q.cursor) : undefined))
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

  create(auth: AuthContext, input: CreateRfqInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, companyId: input.companyId, branchId: input.branchId, docDate: input.docDate ?? todayIST(), title: null, amount: null });
      const lines = await this.prepareLines(tx, input);
      await this.checkVendors(tx, input.vendorIds);
      await tx.insert(rfqs).values({ id: doc.id, tenantId: auth.tenantId, responseDueDate: input.responseDueDate ?? null, deliveryWarehouseId: input.deliveryWarehouseId ?? null, terms: input.terms, notes: input.notes });
      await this.writeLines(tx, auth, doc.id, lines, input.vendorIds);
      const updated = await this.documents.update(tx, auth, doc, { title: this.title(lines, input.vendorIds.length) });
      await this.documents.log(tx, auth, updated, 'document.created', meta, { lines: lines.length, vendors: input.vendorIds.length });
      return this.view(tx, auth, updated);
    });
  }

  update(auth: AuthContext, id: string, input: CreateRfqInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const lines = await this.prepareLines(tx, input);
      await this.checkVendors(tx, input.vendorIds);
      await tx.update(rfqs).set({ responseDueDate: input.responseDueDate ?? null, deliveryWarehouseId: input.deliveryWarehouseId ?? null, terms: input.terms, notes: input.notes }).where(eq(rfqs.id, id));
      await tx.delete(rfqVendors).where(eq(rfqVendors.rfqId, id));
      await tx.delete(rfqLines).where(eq(rfqLines.rfqId, id));
      await this.writeLines(tx, auth, id, lines, input.vendorIds);
      const updated = await this.documents.update(tx, auth, doc, { ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}), title: this.title(lines, input.vendorIds.length) });
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
      return this.view(tx, auth, await this.documents.submit(tx, auth, doc, meta));
    });
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      return this.view(tx, auth, await this.documents.cancel(tx, auth, doc, reason, meta));
    });
  }

  /** Emails the RFQ to invited vendors that have an email address. */
  send(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.issued(tx, id);
      const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, id));
      const [company] = await tx.select({ name: companies.name }).from(companies).where(eq(companies.id, doc.companyId));
      const lines = await tx
        .select({ description: rfqLines.description, qty: rfqLines.qty, uom: uoms.code })
        .from(rfqLines)
        .innerJoin(uoms, eq(uoms.id, rfqLines.uomId))
        .where(eq(rfqLines.rfqId, id))
        .orderBy(asc(rfqLines.lineNo));
      const vendors = await tx
        .select({ id: rfqVendors.id, email: parties.email, name: parties.name })
        .from(rfqVendors)
        .innerJoin(parties, eq(parties.id, rfqVendors.vendorId))
        .where(eq(rfqVendors.rfqId, id));
      const reachable = vendors.filter((v) => v.email);
      const items = lines.map((l) => `${l.description}: ${D(l.qty).toFixed(4).replace(/\.?0+$/, '')} ${l.uom}`).join('; ');
      for (const v of reachable) {
        await this.notifications.notify(tx, auth.tenantId, 'purchase.rfq_sent', [{ email: v.email!, name: v.name }], {
          companyName: company?.name ?? '',
          number: doc.number ?? '',
          dueDate: rfq.responseDueDate ?? 'at the earliest',
          items,
          contact: rfq.terms ? `Terms: ${rfq.terms}` : '',
        });
        await tx.update(rfqVendors).set({ sentAt: new Date() }).where(eq(rfqVendors.id, v.id));
      }
      await this.documents.activity(tx, auth, id, 'sent', `Emailed to ${reachable.length} vendor${reachable.length === 1 ? '' : 's'}`, { skipped: vendors.filter((v) => !v.email).map((v) => v.name) });
      await this.documents.log(tx, auth, doc, 'purchase.rfq.sent', meta, { vendors: reachable.length });
      return { sent: reachable.length, withoutEmail: vendors.filter((v) => !v.email).map((v) => v.name) };
    });
  }

  /** Records (or replaces) one vendor's quotation. */
  recordQuote(auth: AuthContext, id: string, vendorId: string, input: QuoteInput) {
    return this.database.run(auth, async (tx) => {
      await this.issued(tx, id);
      const [rv] = await tx.select().from(rfqVendors).where(and(eq(rfqVendors.rfqId, id), eq(rfqVendors.vendorId, vendorId)));
      if (!rv) fail([{ path: 'vendorId', message: 'This vendor was not invited to the RFQ' }]);
      const lineIds = new Set((await tx.select({ id: rfqLines.id }).from(rfqLines).where(eq(rfqLines.rfqId, id))).map((l) => l.id));
      const errors = input.lines.flatMap((l, i) => (lineIds.has(l.rfqLineId) ? [] : [{ path: `lines.${i}.rfqLineId`, message: 'Not a line of this RFQ' }]));
      if (errors.length) fail(errors);
      await tx
        .update(rfqVendors)
        .set({
          respondedAt: new Date(),
          quoteRef: input.quoteRef,
          quoteDate: input.quoteDate ?? null,
          validUntil: input.validUntil ?? null,
          paymentTerms: input.paymentTerms,
          creditDays: input.creditDays ?? null,
          deliveryTerms: input.deliveryTerms,
          otherCharges: input.otherCharges ?? '0',
          notes: input.notes,
        })
        .where(eq(rfqVendors.id, rv.id));
      await tx.delete(rfqQuotes).where(eq(rfqQuotes.rfqVendorId, rv.id));
      const quoted = input.lines.filter((l) => l.rate !== null && l.rate !== undefined);
      if (quoted.length) {
        await tx.insert(rfqQuotes).values(
          quoted.map((l) => ({ tenantId: auth.tenantId, rfqVendorId: rv.id, rfqLineId: l.rfqLineId, rate: l.rate!, discountPct: l.discountPct ?? '0', leadTimeDays: l.leadTimeDays ?? null, remarks: l.remarks })),
        );
      }
      await this.documents.activity(tx, auth, id, 'edited', `Quote recorded (${quoted.length} line${quoted.length === 1 ? '' : 's'})`, { vendorId });
      return { ok: true };
    });
  }

  /**
   * Side-by-side comparison. Per line: each vendor's net rate (after discount), lead time and the
   * lowest. Per vendor: total of quoted lines + other charges, and the vendor's track record.
   * The recommendation scores price 70%, quality 20%, delivery 10%.
   */
  comparison(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      await this.documents.find(tx, id, DOC_TYPE);
      const lines = await tx
        .select({ id: rfqLines.id, lineNo: rfqLines.lineNo, itemId: rfqLines.itemId, itemCode: items.code, description: rfqLines.description, qty: rfqLines.qty, uom: uoms.code, gstRate: items.gstRate, awardedVendorId: rfqLines.awardedVendorId })
        .from(rfqLines)
        .innerJoin(items, eq(items.id, rfqLines.itemId))
        .innerJoin(uoms, eq(uoms.id, rfqLines.uomId))
        .where(eq(rfqLines.rfqId, id))
        .orderBy(asc(rfqLines.lineNo));
      const vendors = await tx
        .select({ rfqVendorId: rfqVendors.id, vendorId: rfqVendors.vendorId, name: parties.name, code: parties.code, respondedAt: rfqVendors.respondedAt, quoteRef: rfqVendors.quoteRef, validUntil: rfqVendors.validUntil, paymentTerms: rfqVendors.paymentTerms, creditDays: rfqVendors.creditDays, deliveryTerms: rfqVendors.deliveryTerms, otherCharges: rfqVendors.otherCharges })
        .from(rfqVendors)
        .innerJoin(parties, eq(parties.id, rfqVendors.vendorId))
        .where(eq(rfqVendors.rfqId, id))
        .orderBy(asc(parties.name));
      const quotes = vendors.length ? await tx.select().from(rfqQuotes).where(inArray(rfqQuotes.rfqVendorId, vendors.map((v) => v.rfqVendorId))) : [];
      const scores = await this.performance.scores(tx, vendors.map((v) => v.vendorId));

      const lineView = lines.map((l) => {
        const offers = vendors
          .map((v) => {
            const q = quotes.find((x) => x.rfqVendorId === v.rfqVendorId && x.rfqLineId === l.id);
            if (!q) return null;
            const net = D(q.rate).sub(D(q.rate).mul(D(q.discountPct)).div(D('100')));
            return { vendorId: v.vendorId, rate: q.rate, discountPct: q.discountPct, netRate: net.toFixed(4), amount: net.mul(D(l.qty)).toFixed(2), leadTimeDays: q.leadTimeDays, remarks: q.remarks };
          })
          .filter((o): o is NonNullable<typeof o> => !!o);
        const lowest = offers.reduce<(typeof offers)[number] | null>((best, o) => (!best || D(o.netRate).cmp(D(best.netRate)) < 0 ? o : best), null);
        const ranked = offers.map((o) => {
          const s = scores.find((x) => x.vendorId === o.vendorId);
          const price = lowest ? Number(D(lowest.netRate).mul(D('100')).div(D(o.netRate)).toFixed(2)) : 0;
          const quality = s?.acceptancePct ?? 100;
          const delivery = s?.onTimePct ?? 100;
          return { ...o, lowest: o.vendorId === lowest?.vendorId, score: Math.round(price * 0.7 + quality * 0.2 + delivery * 0.1) };
        });
        const recommended = ranked.reduce<(typeof ranked)[number] | null>((best, o) => (!best || o.score > best.score ? o : best), null);
        return { ...l, offers: ranked, lowestVendorId: lowest?.vendorId ?? null, recommendedVendorId: recommended?.vendorId ?? null };
      });
      const vendorView = vendors.map((v) => {
        const mine = lineView.flatMap((l) => l.offers.filter((o) => o.vendorId === v.vendorId));
        return {
          ...v,
          linesQuoted: mine.length,
          total: D(Decimal.sum(mine.map((o) => o.amount)).toFixed(2)).add(D(v.otherCharges)).toFixed(2),
          linesLowest: lineView.filter((l) => l.lowestVendorId === v.vendorId).length,
          performance: scores.find((s) => s.vendorId === v.vendorId) ?? null,
        };
      });
      return { lines: lineView, vendors: vendorView };
    });
  }

  /** Awards lines to vendors and drafts one purchase order per winning vendor. */
  award(auth: AuthContext, id: string, input: AwardInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.issued(tx, id);
      const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, id));
      const lines = await tx.select().from(rfqLines).where(eq(rfqLines.rfqId, id));
      const vendors = await tx.select().from(rfqVendors).where(eq(rfqVendors.rfqId, id));
      const quotes = vendors.length ? await tx.select().from(rfqQuotes).where(inArray(rfqQuotes.rfqVendorId, vendors.map((v) => v.id))) : [];
      const errors: Err[] = [];
      input.lines.forEach((a, i) => {
        const l = lines.find((x) => x.id === a.rfqLineId);
        const v = vendors.find((x) => x.vendorId === a.vendorId);
        if (!l) errors.push({ path: `lines.${i}.rfqLineId`, message: 'Not a line of this RFQ' });
        else if (!v) errors.push({ path: `lines.${i}.vendorId`, message: 'Vendor was not invited' });
        else if (!quotes.some((q) => q.rfqVendorId === v.id && q.rfqLineId === l.id)) errors.push({ path: `lines.${i}.vendorId`, message: `Line ${l.lineNo}: this vendor did not quote it` });
        else if (l.poId) errors.push({ path: `lines.${i}.rfqLineId`, message: `Line ${l.lineNo} was already awarded` });
      });
      if (errors.length) fail(errors);

      const byVendor = new Map<string, AwardInput['lines']>();
      for (const a of input.lines) byVendor.set(a.vendorId, [...(byVendor.get(a.vendorId) ?? []), a]);
      const created: { vendorId: string; poId: string; number: string | null }[] = [];
      for (const [vendorId, awards] of byVendor) {
        const v = vendors.find((x) => x.vendorId === vendorId)!;
        const po = await this.orders.createTx(
          tx,
          auth,
          {
            companyId: doc.companyId,
            branchId: doc.branchId,
            poType: 'standard',
            vendorId,
            deliveryWarehouseId: rfq.deliveryWarehouseId,
            vendorQuoteRef: v.quoteRef,
            paymentTerms: v.paymentTerms,
            creditDays: v.creditDays,
            terms: rfq.terms,
            notes: `Awarded from ${doc.number}`,
            tolerancePct: null,
            reverseCharge: false,
            lines: awards.map((a) => {
              const l = lines.find((x) => x.id === a.rfqLineId)!;
              const q = quotes.find((x) => x.rfqVendorId === v.id && x.rfqLineId === l.id)!;
              return { itemId: l.itemId, uomId: l.uomId, description: l.description, qty: l.qty, rate: q.rate, discountPct: q.discountPct, deliveryDate: l.requiredBy, requisitionLineId: l.requisitionLineId, remarks: null };
            }),
          },
          meta,
        );
        for (const a of awards) await tx.update(rfqLines).set({ awardedVendorId: vendorId, poId: po.id }).where(eq(rfqLines.id, a.rfqLineId));
        created.push({ vendorId, poId: po.id, number: po.number });
      }
      await tx.update(rfqs).set({ awardedAt: new Date() }).where(eq(rfqs.id, id));
      const open = (await tx.select({ id: rfqLines.id }).from(rfqLines).where(and(eq(rfqLines.rfqId, id), sql`${rfqLines.poId} is null`))).length;
      if (!open) await this.documents.update(tx, auth, doc, { status: 'completed' });
      await this.documents.activity(tx, auth, id, 'status', `Awarded: ${created.length} draft purchase order${created.length === 1 ? '' : 's'} created`, { orders: created.map((c) => c.poId) });
      await this.documents.log(tx, auth, doc, 'purchase.rfq.awarded', meta, { orders: created.length });
      return { orders: created };
    });
  }

  // ---- helpers -----------------------------------------------------------------------

  private async issued(tx: Transaction, id: string) {
    const doc = await this.documents.lock(tx, id, DOC_TYPE);
    if (doc.status !== 'approved') throw new ConflictException(doc.status === 'completed' ? 'This RFQ has been fully awarded' : 'Submit (issue) the RFQ first');
    return doc;
  }

  private async prepareLines(tx: Transaction, input: CreateRfqInput) {
    const ids = [...new Set(input.lines.map((l) => l.itemId))];
    const itemRows = await tx.select().from(items).where(inArray(items.id, ids));
    const convs = await tx.select().from(itemUomConversions).where(inArray(itemUomConversions.itemId, ids));
    const errors: Err[] = [];
    if (input.deliveryWarehouseId) {
      const [wh] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, input.deliveryWarehouseId));
      if (!wh) errors.push({ path: 'deliveryWarehouseId', message: 'Unknown warehouse' });
    }
    const lines = input.lines.map((l, i) => {
      const it = itemRows.find((x) => x.id === l.itemId);
      if (!it) {
        errors.push({ path: `lines.${i}.itemId`, message: 'Unknown item' });
        return null;
      }
      const uomId = l.uomId ?? it.purchaseUomId ?? it.baseUomId;
      if (uomId !== it.baseUomId && !convs.some((c) => c.itemId === it.id && c.uomId === uomId)) errors.push({ path: `lines.${i}.uomId`, message: `${it.code} has no conversion for this unit` });
      return { ...l, uomId, description: l.description || it.name, lineNo: i + 1 };
    });
    if (errors.length) fail(errors);
    return lines as NonNullable<(typeof lines)[number]>[];
  }

  private async checkVendors(tx: Transaction, ids: string[]) {
    if (new Set(ids).size !== ids.length) fail([{ path: 'vendorIds', message: 'A vendor is listed twice' }]);
    const found = await tx.select({ id: parties.id, isVendor: parties.isVendor, name: parties.name }).from(parties).where(inArray(parties.id, ids));
    const bad = found.find((f) => !f.isVendor);
    if (found.length !== ids.length || bad) fail([{ path: 'vendorIds', message: bad ? `${bad.name} is not a vendor` : 'Unknown vendor' }]);
  }

  private async writeLines(tx: Transaction, auth: AuthContext, rfqId: string, lines: Awaited<ReturnType<RfqsService['prepareLines']>>, vendorIds: string[]) {
    await tx.insert(rfqLines).values(lines.map((l) => ({ tenantId: auth.tenantId, rfqId, lineNo: l.lineNo, itemId: l.itemId, description: l.description, uomId: l.uomId, qty: l.qty, requiredBy: l.requiredBy ?? null, requisitionLineId: l.requisitionLineId ?? null })));
    await tx.insert(rfqVendors).values(vendorIds.map((vendorId) => ({ tenantId: auth.tenantId, rfqId, vendorId })));
  }

  private title(lines: { description: string }[], vendors: number) {
    const [first, ...rest] = lines;
    return `${first.description}${rest.length ? ` + ${rest.length} more` : ''} · ${vendors} vendor${vendors === 1 ? '' : 's'}`.slice(0, 200);
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('purchase.rfq.manage'), cancel: perms.has('purchase.rfq.manage') });
    const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, doc.id));
    const lines = await tx
      .select({ id: rfqLines.id, lineNo: rfqLines.lineNo, itemId: rfqLines.itemId, itemCode: items.code, description: rfqLines.description, uomId: rfqLines.uomId, uomCode: uoms.code, qty: rfqLines.qty, requiredBy: rfqLines.requiredBy, requisitionLineId: rfqLines.requisitionLineId, awardedVendorId: rfqLines.awardedVendorId, poId: rfqLines.poId })
      .from(rfqLines)
      .innerJoin(items, eq(items.id, rfqLines.itemId))
      .innerJoin(uoms, eq(uoms.id, rfqLines.uomId))
      .where(eq(rfqLines.rfqId, doc.id))
      .orderBy(asc(rfqLines.lineNo));
    const vendors = await tx
      .select({ vendorId: rfqVendors.vendorId, code: parties.code, name: parties.name, email: parties.email, sentAt: rfqVendors.sentAt, respondedAt: rfqVendors.respondedAt, quoteRef: rfqVendors.quoteRef })
      .from(rfqVendors)
      .innerJoin(parties, eq(parties.id, rfqVendors.vendorId))
      .where(eq(rfqVendors.rfqId, doc.id))
      .orderBy(asc(parties.name));
    const [wh] = rfq.deliveryWarehouseId ? await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, rfq.deliveryWarehouseId)) : [];
    const issued = doc.status === 'approved';
    return {
      ...header,
      responseDueDate: rfq.responseDueDate,
      deliveryWarehouse: wh ?? null,
      terms: rfq.terms,
      notes: rfq.notes,
      awardedAt: rfq.awardedAt,
      lines,
      vendors,
      canQuote: issued && perms.has('purchase.rfq.manage'),
      canAward: issued && perms.has('purchase.rfq.manage') && perms.has('purchase.orders.manage'),
    };
  }
}
