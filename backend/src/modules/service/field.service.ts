import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { items, parties, svcContracts, svcRmas, svcTicketEvents, svcTickets, svcVisits, svcWarranties, type Transaction } from '@nextgen/database';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService } from '../documents/documents.service';
import { StockEntriesService } from '../inventory/stock-entries.service';
import { permissionsOf } from '../hr/time/people';
import { TicketsService } from './tickets.service';
import { many } from '../../common/sql';

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const addMonths = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export const warrantySchema = z.object({ partyId: z.uuid(), itemId: z.uuid(), serialNo: z.string().trim().min(1).max(60), invoiceId: z.uuid().nullable().optional(), saleDate: z.iso.date().nullable().optional(), startDate: z.iso.date().optional(), months: z.number().int().min(1).max(120).optional() });
export const contractSchema = z
  .object({
    partyId: z.uuid(),
    kind: z.enum(['amc_labour', 'amc_comprehensive', 'warranty_extension']),
    fromDate: z.iso.date(),
    toDate: z.iso.date(),
    value: z.number().min(0).max(1e10).default(0),
    visitsPerYear: z.number().int().min(0).max(52).default(0),
    serials: z.array(z.string().trim().min(1).max(60)).max(500).default([]),
    resolutionMinutes: z.number().int().min(30).max(30_000).nullable().optional(),
    notes: text(2000),
    technicianId: z.uuid().nullable().optional(),
  })
  .refine((c) => c.toDate > c.fromDate, { message: 'The contract must end after it starts', path: ['toDate'] });
export const visitSchema = z.object({
  kind: z.enum(['installation', 'preventive', 'breakdown']),
  partyId: z.uuid().optional(),
  ticketId: z.uuid().nullable().optional(),
  contractId: z.uuid().nullable().optional(),
  itemId: z.uuid().nullable().optional(),
  serialNo: text(60),
  technicianId: z.uuid().nullable().optional(),
  scheduledAt: z.iso.datetime({ offset: true }),
});
export const completeSchema = z.object({
  workDone: z.string().trim().min(3).max(4000),
  checklist: z.array(z.object({ item: z.string().trim().min(1).max(200), ok: z.boolean() })).max(60).default([]),
  spares: z.array(z.object({ itemId: z.uuid(), qty: z.number().positive().max(1e6), batchNo: z.string().trim().max(40).nullable().optional() })).max(50).default([]),
  warehouseId: z.uuid().optional(),
  chargeable: z.boolean().optional(),
  signedBy: z.string().trim().min(2).max(120),
  signature: z.string().startsWith('data:image/png;base64,').max(200_000).nullable().optional(),
  resolveTicket: z.boolean().default(true),
});
export const rmaSchema = z.object({ partyId: z.uuid(), itemId: z.uuid(), serialNo: text(60), ticketId: z.uuid().nullable().optional(), reason: z.string().trim().min(3).max(2000) });
export const rmaStepSchema = z.object({
  step: z.enum(['receive', 'repair', 'repaired', 'replaced', 'return', 'reject']),
  diagnosis: text(2000),
  repairNotes: text(4000),
  replacementSerial: text(60),
  dispatchRef: text(120),
});
const RMA_FLOW: Record<string, { from: string[]; to: string }> = {
  receive: { from: ['authorised'], to: 'received' },
  repair: { from: ['received'], to: 'repairing' },
  repaired: { from: ['repairing'], to: 'repaired' },
  replaced: { from: ['received', 'repairing'], to: 'replaced' },
  return: { from: ['repaired', 'replaced'], to: 'returned' },
  reject: { from: ['authorised', 'received', 'repairing'], to: 'rejected' },
};

/**
 * Installed base and field service: warranty registration by serial, customer service contracts
 * with planned preventive visits, technician visits (spares issued from stock, customer
 * signature; an installation starts the warranty), and RMA / repair of returned units.
 */
@Injectable()
export class FieldServiceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tickets: TicketsService,
    private readonly stockEntries: StockEntriesService,
    private readonly documents: DocumentsService,
  ) {}

  // ---- warranties -------------------------------------------------------------------------

  registerWarranty(auth: AuthContext, input: z.infer<typeof warrantySchema>) {
    return this.database.run(auth, async (tx) => {
      const s = await this.tickets.settings(tx, auth.tenantId);
      return this.registerTx(tx, auth, { ...input, months: input.months ?? s.defaultWarrantyMonths });
    });
  }

  private async registerTx(tx: Transaction, auth: AuthContext, input: z.infer<typeof warrantySchema> & { months: number }) {
    const start = input.startDate ?? input.saleDate ?? todayIST();
    const [dup] = await tx.select({ id: svcWarranties.id }).from(svcWarranties).where(and(eq(svcWarranties.itemId, input.itemId), eq(svcWarranties.serialNo, input.serialNo)));
    if (dup) throw new ConflictException(`Serial ${input.serialNo} is already registered`);
    return (
      await tx
        .insert(svcWarranties)
        .values({ tenantId: auth.tenantId, partyId: input.partyId, itemId: input.itemId, serialNo: input.serialNo, invoiceId: input.invoiceId ?? null, saleDate: input.saleDate ?? null, startDate: start, endDate: addMonths(start, input.months), registeredBy: auth.userId })
        .returning()
    )[0];
  }

  /** Registers every serial number billed on a posted sales invoice. */
  fromInvoice(auth: AuthContext, invoiceId: string) {
    return this.database.run(auth, async (tx) => {
      const lines = await many<{ itemId: string; serials: string[] | null; customerId: string; docDate: string; status: string }>(
        tx,
        sql`select l.item_id as "itemId", l.serial_nos as serials, i.customer_id as "customerId", d.doc_date::text as "docDate", d.status
            from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id join documents d on d.id = i.id where i.id = ${invoiceId}`,
      );
      if (!lines.length) throw new NotFoundException('Invoice not found');
      if (lines[0].status !== 'approved') throw new BadRequestException('Post the invoice first');
      const s = await this.tickets.settings(tx, auth.tenantId);
      let registered = 0;
      let skipped = 0;
      for (const l of lines)
        for (const serial of l.serials ?? []) {
          const [dup] = await tx.select({ id: svcWarranties.id }).from(svcWarranties).where(and(eq(svcWarranties.itemId, l.itemId), eq(svcWarranties.serialNo, serial)));
          if (dup) {
            skipped++;
            continue;
          }
          await this.registerTx(tx, auth, { partyId: l.customerId, itemId: l.itemId, serialNo: serial, invoiceId, saleDate: l.docDate, months: s.defaultWarrantyMonths });
          registered++;
        }
      return { registered, alreadyRegistered: skipped };
    });
  }

  /** Everything known about a machine: warranty, contract, tickets, visits and RMAs. */
  lookup(auth: AuthContext, serialNo: string) {
    return this.database.run(auth, async (tx) => {
      const [w] = await many(
        tx,
        sql`select w.*, w.serial_no as "serialNo", w.start_date::text as "startDate", w.end_date::text as "endDate", w.party_id as "partyId", w.item_id as "itemId", p.name as customer, i.code as "itemCode", i.name as "itemName",
                   ((now() at time zone 'Asia/Kolkata')::date between w.start_date and w.end_date and w.status = 'active') as "inWarranty"
            from svc_warranties w join parties p on p.id = w.party_id join items i on i.id = w.item_id where w.serial_no = ${serialNo} limit 1`,
      );
      const cover = await this.tickets.coverage(tx, (w as { partyId?: string } | undefined)?.partyId ?? null, (w as { itemId?: string } | undefined)?.itemId ?? null, serialNo);
      const tickets = await many(tx, sql`select id, number, subject, status, created_at as "createdAt" from svc_tickets where serial_no = ${serialNo} order by created_at desc`);
      const visits = await many(tx, sql`select id, number, kind, status, scheduled_at as "scheduledAt", completed_at as "completedAt" from svc_visits where serial_no = ${serialNo} order by scheduled_at desc`);
      const rmas = await many(tx, sql`select id, number, status, reason, created_at as "createdAt" from svc_rmas where serial_no = ${serialNo} order by created_at desc`);
      return { serialNo, warranty: w ?? null, contract: cover.contract, tickets, visits, rmas };
    });
  }

  // ---- contracts --------------------------------------------------------------------------

  contracts(auth: AuthContext, partyId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select c.id, c.number, c.kind, c.from_date::text as "fromDate", c.to_date::text as "toDate", c.value, c.visits_per_year as "visitsPerYear", c.serials, c.status, p.name as customer, c.party_id as "partyId",
                   ((now() at time zone 'Asia/Kolkata')::date > c.to_date) as expired,
                   (select count(*)::int from svc_visits v where v.contract_id = c.id and v.status = 'done') as "visitsDone",
                   (select count(*)::int from svc_visits v where v.contract_id = c.id and v.status = 'scheduled') as "visitsPlanned"
            from svc_contracts c join parties p on p.id = c.party_id where true ${partyId ? sql`and c.party_id = ${partyId}` : sql``} order by c.to_date desc limit 500`,
      ),
    );
  }

  /** A contract and its preventive visits spread evenly over the term. */
  createContract(auth: AuthContext, input: z.infer<typeof contractSchema>) {
    return this.database.run(auth, async (tx) => {
      const [p] = await tx.select({ isCustomer: parties.isCustomer }).from(parties).where(eq(parties.id, input.partyId));
      if (!p?.isCustomer) throw new BadRequestException('Choose a customer');
      const number = await nextCode(tx, auth.tenantId, 'svc_contract', 'AMC', 5);
      const [c] = await tx
        .insert(svcContracts)
        .values({ tenantId: auth.tenantId, number, partyId: input.partyId, kind: input.kind, fromDate: input.fromDate, toDate: input.toDate, value: input.value.toFixed(2), visitsPerYear: input.visitsPerYear, serials: input.serials, resolutionMinutes: input.resolutionMinutes ?? null, notes: input.notes ?? null })
        .returning();
      const days = (Date.parse(input.toDate) - Date.parse(input.fromDate)) / 86_400_000 + 1;
      const visits = Math.round((input.visitsPerYear * days) / 365);
      for (let k = 0; k < visits; k++) {
        // In the middle of each equal slice of the term, at 10:00.
        const offset = Math.floor((days * (k + 0.5)) / visits);
        const day = new Date(Date.parse(`${input.fromDate}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
        const vn = await nextCode(tx, auth.tenantId, 'svc_visit', 'FSV', 6);
        await tx.insert(svcVisits).values({ tenantId: auth.tenantId, number: vn, kind: 'preventive', partyId: input.partyId, contractId: c.id, technicianId: input.technicianId ?? null, scheduledAt: new Date(`${day}T10:00:00+05:30`) });
      }
      return { ...c, visitsPlanned: visits };
    });
  }

  cancelContract(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.update(svcContracts).set({ status: 'cancelled' }).where(eq(svcContracts.id, id)).returning();
      if (!c) throw new NotFoundException('Contract not found');
      await tx.update(svcVisits).set({ status: 'cancelled' }).where(and(eq(svcVisits.contractId, id), eq(svcVisits.status, 'scheduled')));
      return c;
    });
  }

  // ---- visits -----------------------------------------------------------------------------

  visits(auth: AuthContext, q: { mine?: boolean; status?: string; from?: string; to?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select v.id, v.number, v.kind, v.status, v.scheduled_at as "scheduledAt", v.completed_at as "completedAt", v.serial_no as "serialNo", p.name as customer, v.party_id as "partyId",
                   u.full_name as technician, v.technician_id as "technicianId", t.number as "ticketNumber", v.ticket_id as "ticketId", c.number as "contractNumber", i.name as "itemName", v.chargeable
            from svc_visits v join parties p on p.id = v.party_id left join users u on u.id = v.technician_id left join svc_tickets t on t.id = v.ticket_id
            left join svc_contracts c on c.id = v.contract_id left join items i on i.id = v.item_id
            where true ${q.mine ? sql`and v.technician_id = ${auth.userId}` : sql``} ${q.status ? sql`and v.status = ${q.status}` : sql``}
              ${q.from ? sql`and v.scheduled_at >= ${q.from}::date` : sql``} ${q.to ? sql`and v.scheduled_at < ${q.to}::date + 1` : sql``}
            order by v.scheduled_at limit 500`,
      ),
    );
  }

  visit(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [v] = await many(tx, sql`select v.*, v.party_id as "partyId", v.ticket_id as "ticketId", v.contract_id as "contractId", v.item_id as "itemId", v.serial_no as "serialNo", v.technician_id as "technicianId", v.scheduled_at as "scheduledAt", v.started_at as "startedAt", v.completed_at as "completedAt", v.work_done as "workDone", v.stock_entry_id as "stockEntryId", v.signed_by as "signedBy", p.name as customer, u.full_name as technician from svc_visits v join parties p on p.id = v.party_id left join users u on u.id = v.technician_id where v.id = ${id}`);
      if (!v) throw new NotFoundException('Visit not found');
      return v;
    });
  }

  scheduleVisit(auth: AuthContext, input: z.infer<typeof visitSchema>) {
    return this.database.run(auth, async (tx) => {
      let partyId = input.partyId ?? null;
      let itemId = input.itemId ?? null;
      let serialNo = input.serialNo ?? null;
      if (input.ticketId) {
        const [t] = await tx.select().from(svcTickets).where(eq(svcTickets.id, input.ticketId));
        if (!t) throw new NotFoundException('Ticket not found');
        partyId ??= t.partyId;
        itemId ??= t.itemId;
        serialNo ??= t.serialNo;
        await tx.insert(svcTicketEvents).values({ tenantId: auth.tenantId, ticketId: t.id, kind: 'status', body: `${input.kind} visit scheduled for ${new Date(input.scheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}`, authorId: auth.userId });
        await tx.update(svcTickets).set({ status: t.status === 'open' ? 'in_progress' : t.status, firstResponseAt: t.firstResponseAt ?? new Date() }).where(eq(svcTickets.id, t.id));
      }
      if (!partyId) throw new BadRequestException('Choose the customer');
      const number = await nextCode(tx, auth.tenantId, 'svc_visit', 'FSV', 6);
      return (
        await tx
          .insert(svcVisits)
          .values({ tenantId: auth.tenantId, number, kind: input.kind, partyId, ticketId: input.ticketId ?? null, contractId: input.contractId ?? null, itemId, serialNo, technicianId: input.technicianId ?? null, scheduledAt: new Date(input.scheduledAt) })
          .returning()
      )[0];
    });
  }

  private async ownVisit(tx: Transaction, auth: AuthContext, id: string) {
    const [v] = await tx.select().from(svcVisits).where(eq(svcVisits.id, id)).for('update');
    if (!v) throw new NotFoundException('Visit not found');
    if (v.technicianId && v.technicianId !== auth.userId) {
      const perms = await permissionsOf(this.database, auth);
      if (!perms.has('service.tickets.manage')) throw new ForbiddenException('This visit is assigned to another technician');
    }
    return v;
  }

  start(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const v = await this.ownVisit(tx, auth, id);
      if (v.status !== 'scheduled') throw new ConflictException(`The visit is ${v.status}`);
      await tx.update(svcVisits).set({ status: 'in_progress', startedAt: new Date(), technicianId: v.technicianId ?? auth.userId }).where(eq(svcVisits.id, id));
      return { status: 'in_progress' };
    });
  }

  /**
   * Finishes a visit: spares issued from stock (one stock entry), chargeable unless the machine is
   * under warranty or a comprehensive contract, the customer's signature, an installation starting
   * the warranty, and the linked ticket resolved.
   */
  complete(auth: AuthContext, id: string, input: z.infer<typeof completeSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const v = await this.ownVisit(tx, auth, id);
      if (!['scheduled', 'in_progress'].includes(v.status)) throw new ConflictException(`The visit is ${v.status}`);
      const now = new Date();
      const cover = await this.tickets.coverage(tx, v.partyId, v.itemId, v.serialNo);
      const covered = !!cover.warranty || cover.contract?.kind === 'amc_comprehensive' || cover.contract?.kind === 'warranty_extension';
      let stockEntryId: string | null = null;
      if (input.spares.length) {
        if (!input.warehouseId) throw new BadRequestException('Choose the warehouse the spares come from');
        const [p] = await tx.select({ name: parties.name }).from(parties).where(eq(parties.id, v.partyId));
        const entry = await this.stockEntries.createTx(
          tx,
          auth,
          { purpose: 'material_issue', fromWarehouseId: input.warehouseId, reason: `Service visit ${v.number}`, reference: `${v.number} ${p?.name ?? ''}`.slice(0, 100), lines: input.spares.map((s) => ({ itemId: s.itemId, qty: String(s.qty), batchNo: s.batchNo ?? null, rate: null })) } as Parameters<StockEntriesService['createTx']>[2],
          meta,
        );
        const entryId = (entry as { id: string }).id;
        await this.documents.submit(tx, auth, await this.documents.find(tx, entryId, 'stock_entry'), meta);
        stockEntryId = entryId;
      }
      await tx
        .update(svcVisits)
        .set({ status: 'done', startedAt: v.startedAt ?? now, completedAt: now, workDone: input.workDone, checklist: input.checklist, spares: input.spares.map((s) => ({ itemId: s.itemId, qty: String(s.qty), batchNo: s.batchNo ?? null })), stockEntryId, chargeable: input.chargeable ?? !covered, signedBy: input.signedBy, signature: input.signature ?? null, technicianId: v.technicianId ?? auth.userId })
        .where(eq(svcVisits.id, id));
      let warrantyId: string | null = null;
      if (v.kind === 'installation' && v.itemId && v.serialNo) {
        // The warranty runs from installation.
        const s = await this.tickets.settings(tx, auth.tenantId);
        const today = todayIST();
        const [w] = await tx.select().from(svcWarranties).where(and(eq(svcWarranties.itemId, v.itemId), eq(svcWarranties.serialNo, v.serialNo)));
        if (w) {
          const months = Math.max(1, Math.round((Date.parse(w.endDate) - Date.parse(w.startDate)) / (30.44 * 86_400_000)));
          await tx.update(svcWarranties).set({ startDate: today, endDate: addMonths(today, months) }).where(eq(svcWarranties.id, w.id));
          warrantyId = w.id;
        } else warrantyId = (await this.registerTx(tx, auth, { partyId: v.partyId, itemId: v.itemId, serialNo: v.serialNo, startDate: today, months: s.defaultWarrantyMonths })).id;
      }
      if (v.ticketId) {
        await tx.insert(svcTicketEvents).values({ tenantId: auth.tenantId, ticketId: v.ticketId, kind: 'status', body: `Visit ${v.number} done: ${input.workDone}${input.spares.length ? ` (${input.spares.length} spare line(s) issued)` : ''}. Signed by ${input.signedBy}.`, authorId: auth.userId });
        if (input.resolveTicket) await tx.update(svcTickets).set({ status: 'resolved', resolvedAt: now, resolution: input.workDone, firstResponseAt: sql`coalesce(${svcTickets.firstResponseAt}, now())` }).where(and(eq(svcTickets.id, v.ticketId), sql`${svcTickets.status} not in ('resolved', 'closed')`));
      }
      return { status: 'done', stockEntryId, chargeable: input.chargeable ?? !covered, warrantyId };
    });
  }

  cancelVisit(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [v] = await tx.update(svcVisits).set({ status: 'cancelled' }).where(and(eq(svcVisits.id, id), eq(svcVisits.status, 'scheduled'))).returning();
      if (!v) throw new ConflictException('Only a scheduled visit can be cancelled');
      return v;
    });
  }

  // ---- RMA --------------------------------------------------------------------------------

  rmas(auth: AuthContext, status?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select r.id, r.number, r.serial_no as "serialNo", r.reason, r.under_warranty as "underWarranty", r.status, r.diagnosis, r.repair_notes as "repairNotes", r.replacement_serial as "replacementSerial",
                   r.dispatch_ref as "dispatchRef", r.created_at as "createdAt", r.received_at as "receivedAt", r.returned_at as "returnedAt", p.name as customer, i.code as "itemCode", i.name as "itemName", t.number as "ticketNumber"
            from svc_rmas r join parties p on p.id = r.party_id join items i on i.id = r.item_id left join svc_tickets t on t.id = r.ticket_id
            where true ${status ? sql`and r.status = ${status}` : sql``} order by r.created_at desc limit 500`,
      ),
    );
  }

  authoriseRma(auth: AuthContext, input: z.infer<typeof rmaSchema>) {
    return this.database.run(auth, async (tx) => {
      const [it] = await tx.select({ id: items.id }).from(items).where(eq(items.id, input.itemId));
      if (!it) throw new NotFoundException('Item not found');
      const [open] = input.serialNo ? await many(tx, sql`select number from svc_rmas where serial_no = ${input.serialNo} and status not in ('returned', 'rejected') limit 1`) : [];
      if (open) throw new ConflictException(`RMA ${(open as { number: string }).number} is already open for this serial`);
      const cover = await this.tickets.coverage(tx, input.partyId, input.itemId, input.serialNo ?? null);
      const number = await nextCode(tx, auth.tenantId, 'svc_rma', 'RMA', 5);
      return (
        await tx
          .insert(svcRmas)
          .values({ tenantId: auth.tenantId, number, partyId: input.partyId, itemId: input.itemId, serialNo: input.serialNo ?? null, ticketId: input.ticketId ?? null, reason: input.reason, underWarranty: !!cover.warranty || cover.contract?.kind === 'amc_comprehensive', createdBy: auth.userId })
          .returning()
      )[0];
    });
  }

  rmaStep(auth: AuthContext, id: string, input: z.infer<typeof rmaStepSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(svcRmas).where(eq(svcRmas.id, id)).for('update');
      if (!r) throw new NotFoundException('RMA not found');
      const f = RMA_FLOW[input.step];
      if (!f.from.includes(r.status)) throw new ConflictException(`An RMA that is ${r.status} cannot be marked ${f.to}`);
      if (input.step === 'replaced' && !input.replacementSerial) throw new BadRequestException('Give the serial number of the replacement');
      if (input.step === 'return' && !input.dispatchRef) throw new BadRequestException('Give the dispatch reference (DC / courier)');
      const now = new Date();
      await tx
        .update(svcRmas)
        .set({
          status: f.to,
          receivedAt: input.step === 'receive' ? now : r.receivedAt,
          diagnosis: input.diagnosis ?? r.diagnosis,
          repairNotes: input.repairNotes ?? r.repairNotes,
          replacementSerial: input.replacementSerial ?? r.replacementSerial,
          dispatchRef: input.dispatchRef ?? r.dispatchRef,
          returnedAt: input.step === 'return' ? now : r.returnedAt,
        })
        .where(eq(svcRmas.id, id));
      // A replacement under warranty carries the remaining warranty to the new serial.
      if (input.step === 'replaced' && r.serialNo) {
        const [w] = await tx.select().from(svcWarranties).where(and(eq(svcWarranties.itemId, r.itemId), eq(svcWarranties.serialNo, r.serialNo)));
        if (w) {
          await tx.update(svcWarranties).set({ status: 'void' }).where(eq(svcWarranties.id, w.id));
          await tx.insert(svcWarranties).values({ tenantId: auth.tenantId, partyId: w.partyId, itemId: w.itemId, serialNo: input.replacementSerial!, invoiceId: w.invoiceId, saleDate: w.saleDate, startDate: todayIST(), endDate: w.endDate, registeredBy: auth.userId }).onConflictDoNothing();
        }
      }
      if (r.ticketId) await tx.insert(svcTicketEvents).values({ tenantId: auth.tenantId, ticketId: r.ticketId, kind: 'status', body: `RMA ${r.number}: ${f.to}`, authorId: auth.userId });
      return { status: f.to };
    });
  }
}
