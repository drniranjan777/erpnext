import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { companies, parties, portalOrders, svcTicketEvents, svcTickets, type Transaction } from '@nextgen/database';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { ReceivablesService } from '../accounting/receivables.service';
import { SchedulesService } from '../crm/schedules.service';
import { claimSchema, DmsService } from '../dms/dms.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SalesOrdersService } from '../sales/orders.service';
import { createOrderSchema } from '../sales/sales.schemas';
import { TicketsService } from '../service/tickets.service';
import type { PortalIdentity } from './portal-auth.service';
import { many } from '../../common/sql';

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const qty = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).refine((v) => /^\d{1,10}(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Quantity must be more than zero');

export const portalOrderSchema = z.object({
  customerPoNo: text(60),
  expectedDate: z.iso.date().nullable().optional(),
  notes: text(2000),
  lines: z.array(z.object({ itemId: z.uuid(), qty, remarks: text(300) })).min(1, 'Add at least one item').max(100),
});
export const portalTicketSchema = z.object({ subject: z.string().trim().min(3).max(200), description: z.string().trim().min(5).max(8000), itemId: z.uuid().nullable().optional(), serialNo: text(60), phone: text(20) });
export const portalMessageSchema = z.object({ body: z.string().trim().min(1).max(8000) });
export const portalClaimSchema = claimSchema.omit({ distributorId: true });
export const decideOrderSchema = z.object({ accept: z.boolean(), reason: text(500), warehouseId: z.uuid().nullable().optional() });

/**
 * What a customer or dealer contact sees on the portal. Every query is filtered to the signed-in
 * contact's party; the existing services are reused under the workspace's RLS with no staff user.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly receivables: ReceivablesService,
    private readonly schedules: SchedulesService,
    private readonly dms: DmsService,
    private readonly tickets: TicketsService,
    private readonly orders: SalesOrdersService,
    private readonly notifications: NotificationsService,
  ) {}

  /** RLS context for reused services: the workspace, no staff user. */
  private as(p: PortalIdentity): AuthContext {
    return { tenantId: p.tenantId, userId: null as unknown as string, membershipId: '', sessionId: `portal:${p.sessionId}` };
  }

  private run<T>(p: PortalIdentity, fn: (tx: Transaction) => Promise<T>) {
    return this.database.run(this.as(p), fn);
  }

  private async distributorId(tx: Transaction, p: PortalIdentity) {
    if (p.kind !== 'dealer') throw new NotFoundException('Only dealers see this');
    const [d] = await many<{ id: string }>(tx, sql`select id from dms_distributors where party_id = ${p.partyId} limit 1`);
    if (!d) throw new NotFoundException('Your distributor account is not set up yet');
    return d.id;
  }

  me(p: PortalIdentity) {
    return this.run(p, async (tx) => {
      const [party] = await tx.select({ name: parties.name, code: parties.code, gstin: parties.gstin }).from(parties).where(eq(parties.id, p.partyId));
      const [co] = await tx.select({ name: companies.name }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
      const today = todayIST();
      const [money] = await many<{ outstanding: string; overdue: string }>(
        tx,
        sql`select coalesce(sum(si.grand_total - si.received_amount - si.credited_amount), 0)::text as outstanding,
                   coalesce(sum(si.grand_total - si.received_amount - si.credited_amount) filter (where si.due_date < ${today}), 0)::text as overdue
            from sales_invoices si join documents d on d.id = si.id where si.customer_id = ${p.partyId} and d.status in ('approved', 'completed')`,
      );
      const [counts] = await many<{ openOrders: number; requests: number; openTickets: number }>(
        tx,
        sql`select (select count(*)::int from sales_orders so join documents d on d.id = so.id where so.customer_id = ${p.partyId} and d.status in ('approved', 'pending_approval') and so.closed_at is null) as "openOrders",
                   (select count(*)::int from portal_orders where party_id = ${p.partyId} and status = 'submitted') as requests,
                   (select count(*)::int from svc_tickets where party_id = ${p.partyId} and status not in ('resolved', 'closed')) as "openTickets"`,
      );
      let dealer: { activeSchemes: number; pendingClaims: number } | null = null;
      if (p.kind === 'dealer') {
        const [d] = await many<{ activeSchemes: number; pendingClaims: number }>(
          tx,
          sql`select (select count(*)::int from dms_schemes where is_active and ${today} between from_date and to_date) as "activeSchemes",
                     (select count(*)::int from dms_claims c join dms_distributors x on x.id = c.distributor_id where x.party_id = ${p.partyId} and c.status = 'submitted') as "pendingClaims"`,
        );
        dealer = d;
      }
      return { name: p.name, kind: p.kind, party, company: co?.name ?? '', ...money, ...counts, dealer };
    });
  }

  // ---- orders ---------------------------------------------------------------------------------

  orderList(p: PortalIdentity) {
    return this.run(p, (tx) =>
      many(
        tx,
        sql`select so.id, d.number, d.doc_date::text as "docDate", d.status, so.grand_total as "grandTotal", so.customer_po_no as "customerPoNo", so.expected_date::text as "expectedDate", so.closed_at as "closedAt",
                   (select coalesce(round(100 * sum(l.delivered_qty) / nullif(sum(l.qty), 0)), 0)::int from sales_order_lines l where l.order_id = so.id) as "deliveredPct"
            from sales_orders so join documents d on d.id = so.id
            where so.customer_id = ${p.partyId} and d.number is not null and d.status <> 'draft'
            order by d.doc_date desc, d.number desc limit 300`,
      ),
    );
  }

  order(p: PortalIdentity, id: string) {
    return this.run(p, async (tx) => {
      const [o] = await many(
        tx,
        sql`select so.id, d.number, d.doc_date::text as "docDate", d.status, so.grand_total as "grandTotal", so.taxable_total as "taxableTotal", so.tax_total as "taxTotal", so.customer_po_no as "customerPoNo", so.expected_date::text as "expectedDate"
            from sales_orders so join documents d on d.id = so.id where so.id = ${id} and so.customer_id = ${p.partyId} and d.number is not null`,
      );
      if (!o) throw new NotFoundException('Order not found');
      const lines = await many(
        tx,
        sql`select l.line_no as "lineNo", i.code as "itemCode", l.description, l.qty, l.delivered_qty as "deliveredQty", l.invoiced_qty as "invoicedQty", l.rate, l.discount_pct as "discountPct", l.line_total as "lineTotal", l.delivery_date::text as "deliveryDate"
            from sales_order_lines l join items i on i.id = l.item_id where l.order_id = ${id} order by l.line_no`,
      );
      return { ...o, lines };
    });
  }

  /** Items a customer can order, with the list selling rate. */
  catalogue(p: PortalIdentity, q?: string) {
    const term = q?.trim() ? `%${q.trim()}%` : null;
    return this.run(p, (tx) =>
      many(
        tx,
        sql`select i.id, i.code, i.name, i.selling_rate as "sellingRate", u.code as uom from items i left join uoms u on u.id = coalesce(i.sales_uom_id, i.base_uom_id)
            where i.is_active and i.deleted_at is null ${term ? sql`and (i.code ilike ${term} or i.name ilike ${term})` : sql``}
            order by i.code limit 100`,
      ),
    );
  }

  requests(p: PortalIdentity) {
    return this.run(p, (tx) =>
      many(
        tx,
        sql`select o.id, o.number, o.status, o.customer_po_no as "customerPoNo", o.expected_date as "expectedDate", o.notes, o.lines, o.reject_reason as "rejectReason", o.created_at as "createdAt", d.number as "salesOrderNumber", o.sales_order_id as "salesOrderId"
            from portal_orders o left join documents d on d.id = o.sales_order_id where o.party_id = ${p.partyId} order by o.created_at desc limit 200`,
      ),
    );
  }

  placeOrder(p: PortalIdentity, input: z.infer<typeof portalOrderSchema>) {
    return this.run(p, async (tx) => {
      const ids = [...new Set(input.lines.map((l) => l.itemId))];
      const found = await many<{ id: string }>(tx, sql`select id from items where id in ${ids} and is_active and deleted_at is null`);
      if (found.length !== ids.length) throw new BadRequestException('One of the items is not available');
      const number = await nextCode(tx, p.tenantId, 'portal_order', 'POR', 6);
      const [o] = await tx
        .insert(portalOrders)
        .values({ tenantId: p.tenantId, number, partyId: p.partyId, portalUserId: p.portalUserId, customerPoNo: input.customerPoNo ?? null, expectedDate: input.expectedDate ?? null, notes: input.notes ?? null, lines: input.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, remarks: l.remarks ?? null })) })
        .returning();
      const [party] = await tx.select({ name: parties.name }).from(parties).where(eq(parties.id, p.partyId));
      const staff = await many<{ userId: string }>(
        tx,
        sql`select distinct m.user_id as "userId" from memberships m join membership_roles mr on mr.membership_id = m.id join role_permissions rp on rp.role_id = mr.role_id
            where m.status = 'active' and rp.permission_code = 'portal.orders.manage'`,
      );
      if (staff.length) await this.notifications.notify(tx, p.tenantId, 'portal.order_placed', staff.map((s) => ({ userId: s.userId })), { number, customer: party?.name ?? '', lines: String(input.lines.length), by: p.name, link: '/sales/portal' });
      return o;
    });
  }

  withdraw(p: PortalIdentity, id: string) {
    return this.run(p, async (tx) => {
      const [o] = await tx.update(portalOrders).set({ status: 'withdrawn' }).where(and(eq(portalOrders.id, id), eq(portalOrders.partyId, p.partyId), eq(portalOrders.status, 'submitted'))).returning({ id: portalOrders.id });
      if (!o) throw new ConflictException('Only an order not yet accepted can be withdrawn');
      return { ok: true };
    });
  }

  // ---- money --------------------------------------------------------------------------------------

  invoices(p: PortalIdentity) {
    const today = todayIST();
    return this.run(p, (tx) =>
      many(
        tx,
        sql`select si.id, d.number, d.doc_date::text as "docDate", si.due_date::text as "dueDate", si.grand_total as "grandTotal", (si.grand_total - si.received_amount - si.credited_amount)::text as outstanding,
                   so.customer_po_no as "customerPoNo", si.irn is not null as "eInvoice", si.eway_bill_no as "ewayBillNo",
                   case when si.grand_total - si.received_amount - si.credited_amount <= 0 then 'paid' when si.due_date < ${today} then 'overdue' when si.received_amount > 0 then 'part paid' else 'open' end as state
            from sales_invoices si join documents d on d.id = si.id left join sales_orders so on so.id = si.order_id
            where si.customer_id = ${p.partyId} and d.status in ('approved', 'completed')
            order by d.doc_date desc, d.number desc limit 500`,
      ),
    );
  }

  invoice(p: PortalIdentity, id: string) {
    return this.run(p, async (tx) => {
      const [h] = await many(
        tx,
        sql`select si.id, d.number, d.doc_date::text as "docDate", si.due_date::text as "dueDate", si.grand_total as "grandTotal", si.taxable_total as "taxableTotal", si.cgst_total as "cgstTotal", si.sgst_total as "sgstTotal", si.igst_total as "igstTotal",
                   (si.grand_total - si.received_amount - si.credited_amount)::text as outstanding, si.irn, si.eway_bill_no as "ewayBillNo", si.vehicle_no as "vehicleNo", si.transporter
            from sales_invoices si join documents d on d.id = si.id where si.id = ${id} and si.customer_id = ${p.partyId} and d.status in ('approved', 'completed')`,
      );
      if (!h) throw new NotFoundException('Invoice not found');
      const lines = await many(
        tx,
        sql`select l.line_no as "lineNo", i.code as "itemCode", l.description, l.hsn_code as "hsnCode", l.qty, l.rate, l.gst_rate as "gstRate", l.taxable_value as "taxableValue", l.line_total as "lineTotal"
            from sales_invoice_lines l join items i on i.id = l.item_id where l.invoice_id = ${id} order by l.line_no`,
      );
      return { ...h, lines };
    });
  }

  payments(p: PortalIdentity) {
    return this.run(p, (tx) =>
      many(
        tx,
        sql`select v.id, d.number, d.doc_date::text as "docDate", v.amount, v.mode, v.instrument_no as "instrumentNo", v.reference, v.tds_deducted as "tdsDeducted"
            from money_vouchers v join documents d on d.id = v.id
            where v.party_id = ${p.partyId} and v.kind = 'receipt' and d.status in ('approved', 'completed')
            order by d.doc_date desc limit 500`,
      ),
    );
  }

  async statement(p: PortalIdentity, from?: string, to?: string) {
    const s = await this.receivables.statement(this.as(p), p.partyId, from, to);
    return { company: s.company, party: { name: s.party.name, code: s.party.code, gstin: s.party.gstin }, from: s.from,
      to: s.to,
      // Only what belongs on a customer's statement: no account names or internal narrations.
      ledger: {
        opening: s.ledger.opening,
        debit: s.ledger.debit,
        credit: s.ledger.credit,
        closing: s.ledger.closing,
        entries: s.ledger.entries.map((e) => ({ postingDate: e.postingDate, voucherType: e.voucherType, voucherNumber: e.voucherNumber, debit: e.debit, credit: e.credit, balance: e.balance })),
      },
      openBills: s.openBills.filter((b) => b.docType === 'sales_invoice').map((b) => ({ id: b.id, number: b.number, docDate: b.docDate, dueDate: b.dueDate, reference: b.reference, total: b.total, outstanding: b.outstanding })),
      advances: s.advances,
    };
  }

  // ---- service ------------------------------------------------------------------------------------

  ticketList(p: PortalIdentity) {
    return this.run(p, (tx) =>
      many(
        tx,
        sql`select t.id, t.number, t.subject, t.status, t.priority, t.category, t.serial_no as "serialNo", t.created_at as "createdAt", t.resolved_at as "resolvedAt", t.rating
            from svc_tickets t where t.party_id = ${p.partyId} order by t.created_at desc limit 300`,
      ),
    );
  }

  ticket(p: PortalIdentity, id: string) {
    return this.run(p, async (tx) => {
      const [t] = await many(
        tx,
        sql`select t.id, t.number, t.subject, t.description, t.status, t.priority, t.category, t.serial_no as "serialNo", t.resolution, t.created_at as "createdAt", t.resolved_at as "resolvedAt", t.rating, i.name as "itemName"
            from svc_tickets t left join items i on i.id = t.item_id where t.id = ${id} and t.party_id = ${p.partyId}`,
      );
      if (!t) throw new NotFoundException('Ticket not found');
      // Internal notes, assignment and escalation stay internal.
      const messages = await many(
        tx,
        sql`select e.id, e.kind, e.body, e.created_at as "createdAt", case when e.kind = 'customer' then null else coalesce(u.full_name, 'Service desk') end as author
            from svc_ticket_events e left join users u on u.id = e.author_id where e.ticket_id = ${id} and e.kind in ('reply', 'customer') order by e.created_at`,
      );
      return { ...t, messages };
    });
  }

  raiseTicket(p: PortalIdentity, input: z.infer<typeof portalTicketSchema>) {
    return this.run(p, async (tx) => {
      const [u] = await many<{ email: string }>(tx, sql`select email from portal_users where id = ${p.portalUserId}`);
      const t = await this.tickets.createTx(tx, p.tenantId, null, {
        partyId: p.partyId,
        contactName: p.name,
        contactEmail: u?.email ?? null,
        contactPhone: input.phone ?? null,
        channel: 'portal',
        subject: input.subject,
        description: input.description,
        itemId: input.itemId ?? null,
        serialNo: input.serialNo ?? null,
      });
      return { id: (t as { id: string }).id, number: (t as { number: string }).number };
    });
  }

  message(p: PortalIdentity, id: string, input: z.infer<typeof portalMessageSchema>) {
    return this.run(p, async (tx) => {
      const [t] = await tx.select().from(svcTickets).where(and(eq(svcTickets.id, id), eq(svcTickets.partyId, p.partyId))).for('update');
      if (!t) throw new NotFoundException('Ticket not found');
      if (t.status === 'closed') throw new ConflictException('This ticket is closed; raise a new one');
      await tx.insert(svcTicketEvents).values({ tenantId: p.tenantId, ticketId: id, kind: 'customer', body: input.body, authorId: null });
      // A customer writing back reopens a ticket that was waiting for them or marked resolved.
      if (['waiting_customer', 'resolved'].includes(t.status)) await tx.update(svcTickets).set({ status: 'open', resolvedAt: null }).where(eq(svcTickets.id, id));
      if (t.assigneeId) {
        await this.notifications.notify(tx, p.tenantId, 'service.customer_message', [{ userId: t.assigneeId }], { number: t.number, subject: t.subject, customer: p.name, link: `/service/tickets/${id}` });
      }
      return { ok: true };
    });
  }

  rate(p: PortalIdentity, id: string, rating: number) {
    return this.run(p, async (tx) => {
      const [t] = await tx
        .update(svcTickets)
        .set({ rating })
        .where(and(eq(svcTickets.id, id), eq(svcTickets.partyId, p.partyId), sql`${svcTickets.status} in ('resolved', 'closed')`))
        .returning({ id: svcTickets.id });
      if (!t) throw new ConflictException('A ticket can be rated once it is resolved');
      return { ok: true };
    });
  }

  articles(p: PortalIdentity, q?: string) {
    return this.run(p, (tx) => this.tickets.search(tx, q ?? '', true));
  }

  article(p: PortalIdentity, id: string) {
    return this.run(p, async (tx) => {
      const [a] = await many(tx, sql`select id, title, body, category, tags from svc_articles where id = ${id} and is_public`);
      if (!a) throw new NotFoundException('Article not found');
      return a;
    });
  }

  // ---- OEM customers: schedules and ASNs ------------------------------------------------------------

  scheduleList(p: PortalIdentity, month?: string) {
    return this.schedules.list(this.as(p), { month, customerId: p.partyId });
  }

  asnList(p: PortalIdentity) {
    return this.schedules.asns(this.as(p), p.partyId);
  }

  // ---- dealers ----------------------------------------------------------------------------------------

  schemes(p: PortalIdentity) {
    const today = todayIST();
    return this.run(p, async (tx) => {
      await this.distributorId(tx, p);
      return many(
        tx,
        sql`select s.id, s.code, s.name, s.kind, s.level, s.slabs, s.from_date::text as "fromDate", s.to_date::text as "toDate",
                   coalesce((select json_agg(i.code order by i.code) from items i where i.id = any(s.item_ids)), '[]'::json) as items
            from dms_schemes s where s.is_active and s.to_date >= ${today} order by s.from_date`,
      );
    });
  }

  async claims(p: PortalIdentity) {
    const distributorId = await this.run(p, (tx) => this.distributorId(tx, p));
    return this.dms.claims(this.as(p), { distributorId });
  }

  async raiseClaim(p: PortalIdentity, input: z.infer<typeof portalClaimSchema>) {
    const distributorId = await this.run(p, (tx) => this.distributorId(tx, p));
    const c = await this.dms.raiseClaim(this.as(p), { ...input, distributorId });
    return { id: c.id, number: c.number, computedAmount: c.computedAmount, status: c.status };
  }

  async stock(p: PortalIdentity) {
    const distributorId = await this.run(p, (tx) => this.distributorId(tx, p));
    return this.dms.stock(this.as(p), distributorId);
  }

  // ---- staff: orders placed on the portal ---------------------------------------------------------

  staffRequests(auth: AuthContext, status?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select o.id, o.number, o.status, o.customer_po_no as "customerPoNo", o.expected_date as "expectedDate", o.notes, o.reject_reason as "rejectReason", o.created_at as "createdAt",
                   p.name as customer, o.party_id as "partyId", u.name as "placedBy", d.number as "salesOrderNumber", o.sales_order_id as "salesOrderId",
                   (select json_agg(json_build_object('itemId', i.id, 'code', i.code, 'name', i.name, 'qty', l->>'qty', 'remarks', l->>'remarks')) from jsonb_array_elements(o.lines) l join items i on i.id = (l->>'itemId')::uuid) as lines
            from portal_orders o join parties p on p.id = o.party_id left join portal_users u on u.id = o.portal_user_id left join documents d on d.id = o.sales_order_id
            where true ${status ? sql`and o.status = ${status}` : sql``} order by o.created_at desc limit 300`,
      ),
    );
  }

  /** Accepting makes a draft sales order at list prices for the sales team to check and submit. */
  decide(auth: AuthContext, id: string, input: z.infer<typeof decideOrderSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [o] = await tx.select().from(portalOrders).where(eq(portalOrders.id, id)).for('update');
      if (!o) throw new NotFoundException('Portal order not found');
      if (o.status !== 'submitted') throw new ConflictException(`This order is already ${o.status}`);
      if (!input.accept) {
        if (!input.reason || input.reason.length < 3) throw new BadRequestException('Give the customer a reason');
        await tx.update(portalOrders).set({ status: 'rejected', rejectReason: input.reason, decidedBy: auth.userId, decidedAt: new Date() }).where(eq(portalOrders.id, id));
        return { status: 'rejected' };
      }
      const so = await this.orders.createTx(
        tx,
        auth,
        createOrderSchema.parse({
          customerId: o.partyId,
          customerPoNo: o.customerPoNo,
          expectedDate: o.expectedDate,
          warehouseId: input.warehouseId ?? null,
          notes: [`Placed on the portal as ${o.number}.`, o.notes].filter(Boolean).join(' '),
          lines: o.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: null, discountPct: null, remarks: l.remarks ?? null })),
        }),
        meta,
      );
      const soId = (so as { id: string }).id;
      await tx.update(portalOrders).set({ status: 'accepted', salesOrderId: soId, decidedBy: auth.userId, decidedAt: new Date() }).where(eq(portalOrders.id, id));
      return { status: 'accepted', salesOrderId: soId };
    });
  }
}
