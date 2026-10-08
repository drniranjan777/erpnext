import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { posSales, posSessions, posTerminals, type Transaction } from '@nextgen/database';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { ApprovalsService } from '../documents/approvals.service';
import { createPartySchema, PartiesService } from '../masters/parties.service';
import { CreditNotesService } from '../sales/credit-notes.service';
import { SalesInvoicesService } from '../sales/invoices.service';
import { createCreditSchema, createInvoiceSchema } from '../sales/sales.schemas';
import { bill, line, r2, TENDERS, tenderProblem, zReport } from './pos-rules';
import { many } from '../../common/sql';

export const terminalSchema = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(2).max(80), warehouseId: z.uuid(), receiptFooter: z.string().trim().max(300).nullable().optional() });
export const openSchema = z.object({ terminalId: z.uuid(), openingCash: z.number().min(0).max(10_000_000).default(0) });
const tender = z.object({ mode: z.enum(TENDERS), amount: z.number().min(0), ref: z.string().trim().max(60).nullable().optional() });
export const saleSchema = z.object({
  clientRef: z.string().trim().min(6).max(80),
  buyerName: z.string().trim().max(120).nullable().optional(),
  buyerMobile: z.string().trim().regex(/^\+?[0-9 ]{10,14}$/, 'Enter a valid mobile number').nullable().optional(),
  buyerGstin: z.string().trim().length(15).nullable().optional(),
  lines: z.array(z.object({ itemId: z.uuid(), qty: z.number().positive(), price: z.number().min(0).optional(), discountPct: z.number().min(0).max(100).default(0) })).min(1).max(200),
  tenders: z.array(tender).min(1).max(5),
});
export const returnSchema = z.object({ clientRef: z.string().trim().min(6).max(80), lines: z.array(z.object({ itemId: z.uuid(), qty: z.number().positive() })).min(1).max(200), refund: z.enum(TENDERS).default('cash'), reason: z.string().trim().min(3).max(300) });
export const closeSchema = z.object({ countedCash: z.number().min(0) });

/**
 * Point of sale for showrooms and factory outlets: tills selling from a warehouse, shifts with an
 * opening float, GST-inclusive sales posted as sales invoices (stock and books follow the normal
 * flow), split tenders with change, returns as credit notes, idempotent sales for tills that were
 * offline, receipts, and the day-close (Z) report with cash to count. Also the owner's mobile summary.
 */
@Injectable()
export class PosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly invoices: SalesInvoicesService,
    private readonly credits: CreditNotesService,
    private readonly parties: PartiesService,
    private readonly approvals: ApprovalsService,
  ) {}

  // ---- tills and shifts --------------------------------------------------------------------------

  terminals(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select t.id, t.code, t.name, t.warehouse_id as "warehouseId", w.name as warehouse, t.status, t.receipt_footer as "receiptFooter",
                   (select s.id from pos_sessions s where s.terminal_id = t.id and s.status = 'open' limit 1) as "openSessionId"
            from pos_terminals t join warehouses w on w.id = t.warehouse_id order by t.code`,
      ),
    );
  }

  async createTerminal(auth: AuthContext, input: z.infer<typeof terminalSchema>, meta: RequestMeta) {
    const customerId = await this.walkIn(auth, input.code, meta);
    return this.database.run(auth, async (tx) => {
      const [r] = await tx
        .insert(posTerminals)
        .values({ tenantId: auth.tenantId, ...input, receiptFooter: input.receiptFooter ?? null, customerId })
        .onConflictDoNothing()
        .returning();
      if (!r) throw new ConflictException('A till with this code exists');
      return r;
    });
  }

  /** The till's walk-in customer (a consumer party), billed for every sale without a named customer. */
  private async walkIn(auth: AuthContext, code: string, meta: RequestMeta) {
    const name = `Walk-in customer (till ${code})`;
    const [p] = await this.database.run(auth, (tx) => many<{ id: string }>(tx, sql`select id from parties where name = ${name} limit 1`));
    if (p) return p.id;
    const [co] = await this.database.run(auth, (tx) => many<{ stateCode: string | null; city: string | null; pincode: string | null }>(tx, sql`select state_code as "stateCode", address->>'city' as city, address->>'pincode' as pincode from companies where deleted_at is null order by created_at limit 1`));
    const created = (await this.parties.create(auth, createPartySchema.parse({ name, isCustomer: true, gstRegistrationType: 'consumer', notes: 'Point-of-sale walk-in sales', addresses: co?.pincode && co.stateCode ? [{ type: 'both', line1: 'Showroom counter', city: co.city || 'Counter', stateCode: co.stateCode, pincode: co.pincode, isDefault: true }] : [] }), meta)) as { id: string };
    return created.id;
  }

  open(auth: AuthContext, input: z.infer<typeof openSchema>) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(posTerminals).where(eq(posTerminals.id, input.terminalId));
      if (!t || t.status !== 'active') throw new NotFoundException('Till not found');
      const [busy] = await tx.select({ id: posSessions.id }).from(posSessions).where(and(eq(posSessions.terminalId, t.id), eq(posSessions.status, 'open')));
      if (busy) throw new ConflictException('This till already has an open shift');
      const [s] = await tx.insert(posSessions).values({ tenantId: auth.tenantId, terminalId: t.id, openedBy: auth.userId, openingCash: input.openingCash }).returning();
      return s;
    });
  }

  private async session(tx: Transaction, id: string) {
    const [s] = await tx.select().from(posSessions).where(eq(posSessions.id, id));
    if (!s) throw new NotFoundException('Shift not found');
    const [t] = await tx.select().from(posTerminals).where(eq(posTerminals.id, s.terminalId));
    return { s, t };
  }

  async getSession(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const { s, t } = await this.session(tx, id);
      const sales = await tx.select().from(posSales).where(and(eq(posSales.sessionId, id), isNotNull(posSales.documentId))).orderBy(desc(posSales.soldAt));
      const live = s.status === 'open' ? zReport(s.openingCash, sales, 0) : null;
      return { ...s, terminal: { id: t.id, code: t.code, name: t.name, warehouseId: t.warehouseId, receiptFooter: t.receiptFooter }, sales, summary: s.zReport ?? live };
    });
  }

  sessions(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, t.code as terminal, s.status, s.opening_cash as "openingCash", s.opened_at as "openedAt", s.closed_at as "closedAt", u.full_name as "openedBy", s.z_report as "zReport",
                   (select count(*)::int from pos_sales x where x.session_id = s.id and x.kind = 'sale' and x.document_id is not null) as sales,
                   (select coalesce(sum(case when x.kind = 'sale' then x.total else -x.total end), 0)::float8 from pos_sales x where x.session_id = s.id and x.document_id is not null) as net
            from pos_sessions s join pos_terminals t on t.id = s.terminal_id left join users u on u.id = s.opened_by order by s.opened_at desc limit 100`,
      ),
    );
  }

  /** Items for the till: by barcode, code or name, with the GST-inclusive price and stock at the till's warehouse. */
  items(auth: AuthContext, terminalId: string, q: string) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(posTerminals).where(eq(posTerminals.id, terminalId));
      if (!t) throw new NotFoundException('Till not found');
      const term = q.trim();
      return many(
        tx,
        sql`select i.id, i.code, i.name, u.code as uom, coalesce(i.gst_rate, 0)::float8 as "gstRate",
                   coalesce(i.mrp, i.selling_rate * (1 + coalesce(i.gst_rate, 0) / 100), 0)::float8 as price,
                   coalesce((select sum(b.qty) from stock_balances b where b.item_id = i.id and b.warehouse_id = ${t.warehouseId}), 0)::float8 as stock,
                   exists (select 1 from item_barcodes x where x.item_id = i.id and x.barcode = ${term}) as "barcodeMatch"
            from items i join uoms u on u.id = i.base_uom_id
            where i.is_active and i.type not in ('service', 'asset', 'scrap')
              and (exists (select 1 from item_barcodes x where x.item_id = i.id and x.barcode = ${term}) or i.code ilike ${`${term}%`} or i.name ilike ${`%${term}%`})
            order by "barcodeMatch" desc, i.code limit 20`,
      );
    });
  }

  // ---- selling -----------------------------------------------------------------------------------

  /**
   * A till's reference is claimed before anything is posted, so a sale sent twice at the same moment
   * (a retry after a network drop) posts one invoice: the second request finds the claim, waits for
   * the first to finish and returns the same sale.
   */
  private async replay(auth: AuthContext, clientRef: string) {
    for (let i = 0; i < 40; i++) {
      const [x] = await this.database.run(auth, (tx) => tx.select().from(posSales).where(eq(posSales.clientRef, clientRef)));
      if (!x) return null;
      if (x.documentId) return { ...x, replayed: true };
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new ConflictException('This sale is still being recorded; try again in a moment');
  }

  /** Releases a claim whose invoice or credit note could not be posted, so the till can retry. */
  private release(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => tx.delete(posSales).where(and(eq(posSales.id, id), isNull(posSales.documentId))));
  }

  /** A sale: priced with GST included, paid by one or more tenders, posted as a submitted sales invoice. */
  async sell(auth: AuthContext, sessionId: string, input: z.infer<typeof saleSchema>, meta: RequestMeta) {
    const dup = await this.replay(auth, input.clientRef);
    if (dup) return dup;
    const { s, t, items } = await this.database.run(auth, async (tx) => {
      const { s, t } = await this.session(tx, sessionId);
      if (s.status !== 'open') throw new ConflictException('The shift is closed');
      const ids = input.lines.map((l) => l.itemId);
      const items = await many<{ id: string; code: string; name: string; gstRate: number; price: number }>(tx, sql`select id, code, name, coalesce(gst_rate, 0)::float8 as "gstRate", coalesce(mrp, selling_rate * (1 + coalesce(gst_rate, 0) / 100), 0)::float8 as price from items where id in ${ids}`);
      return { s, t, items };
    });
    const lines = input.lines.map((l) => {
      const it = items.find((i) => i.id === l.itemId);
      if (!it) throw new BadRequestException('Unknown item on the bill');
      return line({ itemId: it.id, code: it.code, name: it.name, qty: l.qty, price: l.price ?? it.price, discountPct: l.discountPct, gstRate: it.gstRate });
    });
    const b = bill(lines);
    const pay = tenderProblem(b.total, input.tenders);
    if (pay.problem) throw new BadRequestException(pay.problem);
    const [claim] = await this.database.run(auth, (tx) =>
      tx
        .insert(posSales)
        .values({ tenantId: auth.tenantId, sessionId: s.id, kind: 'sale', number: input.clientRef, clientRef: input.clientRef, buyerName: input.buyerName ?? null, buyerMobile: input.buyerMobile ?? null, buyerGstin: input.buyerGstin ?? null, lines, taxable: b.taxable, tax: b.tax, total: b.total, tenders: input.tenders, change: pay.change, soldBy: auth.userId })
        .onConflictDoNothing()
        .returning({ id: posSales.id }),
    );
    if (!claim) return (await this.replay(auth, input.clientRef))!;
    try {
      const buyer = [input.buyerName, input.buyerMobile, input.buyerGstin ? `GSTIN ${input.buyerGstin}` : null].filter(Boolean).join(' · ');
      const inv = (await this.invoices.create(
        auth,
        createInvoiceSchema.parse({ customerId: t.customerId, warehouseId: t.warehouseId, notes: `POS ${t.code}${buyer ? ` · ${buyer}` : ''}`, lines: lines.map((l) => ({ itemId: l.itemId, qty: String(l.qty), rate: (l.taxable / l.qty).toFixed(4), description: l.name })) }),
        meta,
      )) as { id: string; version: number };
      const posted = (await this.invoices.submit(auth, inv.id, inv.version, meta)) as { number: string | null };
      return this.database.run(auth, async (tx) => {
        const [r] = await tx.update(posSales).set({ number: posted.number ?? inv.id, documentId: inv.id }).where(eq(posSales.id, claim.id)).returning();
        return { ...r, roundOff: b.roundOff };
      });
    } catch (err) {
      await this.release(auth, claim.id);
      throw err;
    }
  }

  /** A return against a sale of this or an earlier shift: a submitted credit note, refunded in one tender. */
  async refund(auth: AuthContext, sessionId: string, saleId: string, input: z.infer<typeof returnSchema>, meta: RequestMeta) {
    const dup = await this.replay(auth, input.clientRef);
    if (dup) return dup;
    // Checked and claimed with the sale locked, so two returns at once cannot exceed what was sold.
    const { t, sale, lines, b, claimId } = await this.database.run(auth, async (tx) => {
      const { s, t } = await this.session(tx, sessionId);
      if (s.status !== 'open') throw new ConflictException('The shift is closed');
      const [sale] = await tx.select().from(posSales).where(eq(posSales.id, saleId)).for('update');
      if (!sale || sale.kind !== 'sale' || !sale.documentId) throw new NotFoundException('Sale not found');
      const already = (await tx.select().from(posSales).where(eq(posSales.returnOfId, saleId))).flatMap((r) => r.lines);
      const lines = input.lines.map((l) => {
        const sold = sale.lines.find((x) => x.itemId === l.itemId);
        if (!sold) throw new BadRequestException('The item is not on this sale');
        const returned = already.filter((x) => x.itemId === l.itemId).reduce((a, x) => a + x.qty, 0);
        if (l.qty > sold.qty - returned + 1e-9) throw new BadRequestException(`At most ${sold.qty - returned} of ${sold.code} can be returned`);
        return line({ itemId: sold.itemId, code: sold.code, name: sold.name, qty: l.qty, price: sold.price, discountPct: sold.discountPct, gstRate: sold.gstRate });
      });
      const b = bill(lines);
      const [claim] = await tx
        .insert(posSales)
        .values({ tenantId: auth.tenantId, sessionId: s.id, kind: 'return', number: input.clientRef, clientRef: input.clientRef, lines, taxable: b.taxable, tax: b.tax, total: b.total, tenders: [{ mode: input.refund, amount: b.total }], returnOfId: sale.id, soldBy: auth.userId })
        .onConflictDoNothing()
        .returning({ id: posSales.id });
      return { t, sale, lines, b, claimId: claim?.id ?? null };
    });
    if (!claimId) return (await this.replay(auth, input.clientRef))!;
    try {
      const invoice = (await this.invoices.get(auth, sale.documentId!)) as unknown as { lines: { id: string; itemId: string }[] };
      const cn = (await this.credits.create(
        auth,
        createCreditSchema.parse({ invoiceId: sale.documentId, kind: 'return', reason: input.reason, warehouseId: t.warehouseId, lines: lines.map((l) => ({ invoiceLineId: invoice.lines.find((x) => x.itemId === l.itemId)!.id, qty: String(l.qty) })) }),
        meta,
      )) as { id: string; version: number };
      const posted = (await this.credits.submit(auth, cn.id, cn.version, meta)) as { number: string | null };
      return this.database.run(auth, async (tx) => {
        const [r] = await tx.update(posSales).set({ number: posted.number ?? cn.id, documentId: cn.id }).where(eq(posSales.id, claimId)).returning();
        return { ...r, roundOff: b.roundOff };
      });
    } catch (err) {
      await this.release(auth, claimId);
      throw err;
    }
  }

  close(auth: AuthContext, sessionId: string, input: z.infer<typeof closeSchema>) {
    return this.database.run(auth, async (tx) => {
      const { s } = await this.session(tx, sessionId);
      if (s.status !== 'open') throw new ConflictException('The shift is already closed');
      const sales = await tx.select().from(posSales).where(and(eq(posSales.sessionId, sessionId), isNotNull(posSales.documentId)));
      const z = zReport(s.openingCash, sales, input.countedCash);
      const [r] = await tx.update(posSessions).set({ status: 'closed', closedBy: auth.userId, closedAt: new Date(), zReport: z }).where(eq(posSessions.id, sessionId)).returning();
      return r;
    });
  }

  receipt(auth: AuthContext, saleId: string) {
    return this.database.run(auth, async (tx) => {
      const [x] = await tx.select().from(posSales).where(eq(posSales.id, saleId));
      if (!x) throw new NotFoundException('Sale not found');
      const { t } = await this.session(tx, x.sessionId);
      const [co] = await many<{ name: string; gstin: string | null; address: string | null }>(tx, sql`select coalesce(legal_name, name) as name, gstin, concat_ws(', ', address->>'line1', address->>'city', address->>'pincode') as address from companies where deleted_at is null order by created_at limit 1`);
      return { ...x, terminal: { code: t.code, name: t.name, receiptFooter: t.receiptFooter }, company: co ?? null, roundOff: bill(x.lines).roundOff };
    });
  }

  // ---- owner's mobile summary --------------------------------------------------------------------

  async ownerSummary(auth: AuthContext) {
    const today = todayIST();
    const month = `${today.slice(0, 7)}-01`;
    const figures = await this.database.runRead(auth, async (tx) => {
      const [f] = await many<{ today: number; month: number; receivable: number; overdue: number; payable7: number; cashBank: number; posToday: number }>(
        tx,
        sql`select
              (select coalesce(sum(si.taxable_total), 0) from sales_invoices si join documents d on d.id = si.id where d.status not in ('draft', 'cancelled') and d.doc_date = ${today}::date)::float8 as today,
              (select coalesce(sum(si.taxable_total), 0) from sales_invoices si join documents d on d.id = si.id where d.status not in ('draft', 'cancelled') and d.doc_date >= ${month}::date)::float8 as month,
              (select coalesce(sum(greatest(si.grand_total - si.received_amount - si.credited_amount, 0)), 0) from sales_invoices si join documents d on d.id = si.id where d.status in ('approved', 'completed'))::float8 as receivable,
              (select coalesce(sum(greatest(si.grand_total - si.received_amount - si.credited_amount, 0)), 0) from sales_invoices si join documents d on d.id = si.id where d.status in ('approved', 'completed') and si.due_date < ${today}::date)::float8 as overdue,
              (select coalesce(sum(greatest(pi.grand_total - pi.paid_amount, 0)), 0) from purchase_invoices pi join documents d on d.id = pi.id where d.status in ('approved', 'completed') and pi.due_date <= ${today}::date + 7)::float8 as payable7,
              (select coalesce(sum(g.debit - g.credit), 0) from gl_entries g join accounts a on a.id = g.account_id where a.account_type in ('bank', 'cash') or a.system_key = 'cash')::float8 as "cashBank",
              (select coalesce(sum(case when x.kind = 'sale' then x.total else -x.total end), 0) from pos_sales x where x.document_id is not null and x.sold_at >= (${today}::date - interval '5 hours 30 minutes'))::float8 as "posToday"`,
      );
      return f;
    });
    const inbox = (await this.approvals.inbox(auth)) as unknown[];
    return { date: today, ...Object.fromEntries(Object.entries(figures).map(([k, v]) => [k, r2(Number(v))])), approvalsPending: inbox.length };
  }
}
