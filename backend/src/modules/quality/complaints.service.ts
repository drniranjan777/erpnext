import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { customerComplaints, documents, items, ncrs, parties, type Transaction } from '@nextgen/database';
import { and, desc, eq, ilike, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { CapasService } from './capas.service';
import { NcrsService } from './ncrs.service';
import { many } from '../../common/sql';

const DOC_TYPE = 'customer_complaint' as const;

export const complaintSchema = z.object({
  customerId: z.uuid(),
  itemId: z.uuid().nullable().optional(),
  batchNo: optionalText(40),
  qty: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()))
    .refine((v) => v === null || /^\d{1,12}(\.\d{1,4})?$/.test(v), 'Quantity: a number'),
  refDocId: z.uuid().nullable().optional(),
  receivedOn: z.iso.date().optional(),
  channel: z.enum(['email', 'phone', 'visit', 'portal', 'other']).default('email'),
  category: z.string().trim().min(2).max(80),
  severity: z.enum(['minor', 'major', 'critical']).default('major'),
  description: z.string().trim().min(3).max(4000),
  isFieldFailure: z.boolean().default(false),
  warrantyCost: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || String(v).trim() === '' ? '0' : String(v).trim()))
    .refine((v) => /^\d{1,14}(\.\d{1,2})?$/.test(v), 'Warranty cost: an amount'),
  /** Days allowed for the first response (default 7). */
  responseDays: z.number().int().min(1).max(90).default(7),
});
export type ComplaintInput = z.infer<typeof complaintSchema>;
export const respondSchema = z.object({ response: z.string().trim().min(3).max(4000) });

/**
 * Customer complaints: logged straight away (no approval), then investigated (an NCR for the
 * material, an 8D CAPA for the cause), answered and closed. Field failures carry their
 * warranty cost.
 */
@Injectable()
export class ComplaintsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly ncrsService: NcrsService,
    private readonly capasService: CapasService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, { amendable: false });
  }

  list(auth: AuthContext, q: { stage?: string; customerId?: string; q?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({ id: documents.id, number: documents.number, docDate: documents.docDate, receivedOn: customerComplaints.receivedOn, category: customerComplaints.category, severity: customerComplaints.severity, stage: customerComplaints.stage, responseDue: customerComplaints.responseDue, isFieldFailure: customerComplaints.isFieldFailure, customer: parties.name, item: { code: items.code, name: items.name } })
        .from(documents)
        .innerJoin(customerComplaints, eq(customerComplaints.id, documents.id))
        .innerJoin(parties, eq(parties.id, customerComplaints.customerId))
        .leftJoin(items, eq(items.id, customerComplaints.itemId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            sql`${documents.status} <> 'cancelled'`,
            q.stage ? eq(customerComplaints.stage, q.stage) : undefined,
            q.customerId ? eq(customerComplaints.customerId, q.customerId) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(parties.name, `%${term}%`), ilike(customerComplaints.category, `%${term}%`)) : undefined,
            q.cursor ? lt(documents.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(documents.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      return { items: page.map((r) => ({ ...r, item: r.item?.code ? r.item : null })), nextCursor: hasMore ? page[page.length - 1].id : null };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE)));
  }

  /** Logs the complaint; it is a record, not a request, so it is approved at once. */
  create(auth: AuthContext, input: ComplaintInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select({ name: parties.name, isCustomer: parties.isCustomer }).from(parties).where(eq(parties.id, input.customerId));
      if (!c || !c.isCustomer) throw new BadRequestException({ message: 'Choose a customer', errors: [{ path: 'customerId', message: 'Not a customer' }] });
      const received = input.receivedOn ?? todayIST();
      const due = new Date(`${received}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + input.responseDays);
      const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, docDate: received, title: `${c.name}: ${input.category}`.slice(0, 200), amount: input.isFieldFailure ? input.warrantyCost : null });
      const { responseDays: _r, receivedOn: _ro, ...rest } = input;
      await tx.insert(customerComplaints).values({ id: doc.id, tenantId: auth.tenantId, ...rest, itemId: rest.itemId ?? null, refDocId: rest.refDocId ?? null, batchNo: rest.batchNo ? rest.batchNo.toUpperCase() : null, receivedOn: received, responseDue: due.toISOString().slice(0, 10) });
      await this.documents.log(tx, auth, doc, 'document.created', meta, { category: input.category });
      await this.documents.submit(tx, auth, doc, meta);
      return this.view(tx, auth, await this.documents.find(tx, doc.id, DOC_TYPE));
    });
  }

  /** A draft NCR for the complained material (customer source). */
  async raiseNcr(auth: AuthContext, id: string, meta: RequestMeta) {
    const c = await this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(customerComplaints).where(eq(customerComplaints.id, id));
      if (!r) throw new BadRequestException('Complaint not found');
      if (r.ncrId) throw new ConflictException('An NCR is already linked');
      if (!r.itemId || !r.qty) throw new BadRequestException('Record the item and quantity on the complaint first');
      return r;
    });
    const ncr = await this.ncrsService.create(auth, { source: 'customer', severity: c.severity as 'major', itemId: c.itemId!, batchNo: c.batchNo, qtyAffected: c.qty!, defectCategory: c.category, description: c.description, partyId: c.customerId, inspectionId: null, workOrderId: null, containment: null, useAsIsQty: '0', reworkQty: '0', scrapQty: '0', returnQty: '0', sortQty: '0', dispositionNotes: null, scrapCost: '0', reworkCost: '0', sortingCost: '0', otherCost: '0', recovered: '0' }, meta);
    await this.database.run(auth, async (tx) => {
      await tx.update(customerComplaints).set({ ncrId: ncr.id, stage: sql`case when ${customerComplaints.stage} = 'open' then 'investigating' else ${customerComplaints.stage} end` }).where(eq(customerComplaints.id, id));
    });
    return ncr;
  }

  /** A draft 8D CAPA for the cause, with D2 (problem) filled in. */
  raiseCapa(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(customerComplaints).where(eq(customerComplaints.id, id));
      if (!r) throw new BadRequestException('Complaint not found');
      if (r.capaId) throw new ConflictException('A CAPA is already linked');
      const capa = await this.capasService.createTx(
        tx,
        auth,
        { kind: 'corrective', source: 'complaint', complaintId: id, ncrId: r.ncrId, itemId: r.itemId, isScar: false, partyId: null, responseDue: r.responseDue, problem: r.description, method: '8d', whys: [], fishbone: {}, eightD: { d2: r.description }, rootCause: null, effectivenessDue: null, actions: [] },
        meta,
      );
      await tx.update(customerComplaints).set({ capaId: capa.id, stage: sql`case when ${customerComplaints.stage} = 'open' then 'investigating' else ${customerComplaints.stage} end` }).where(eq(customerComplaints.id, id));
      return capa;
    });
  }

  respond(auth: AuthContext, id: string, input: z.infer<typeof respondSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.find(tx, id, DOC_TYPE);
      const [r] = await tx.select({ stage: customerComplaints.stage }).from(customerComplaints).where(eq(customerComplaints.id, id));
      if (r.stage === 'closed') throw new ConflictException('The complaint is closed');
      await tx.update(customerComplaints).set({ response: input.response, respondedAt: new Date(), stage: 'responded' }).where(eq(customerComplaints.id, id));
      await this.documents.log(tx, auth, doc, 'complaint.responded', meta);
      return this.view(tx, auth, doc);
    });
  }

  close(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.find(tx, id, DOC_TYPE);
      const [r] = await tx.select({ stage: customerComplaints.stage }).from(customerComplaints).where(eq(customerComplaints.id, id));
      if (r.stage !== 'responded') throw new ConflictException(r.stage === 'closed' ? 'Already closed' : 'Respond to the customer before closing');
      await tx.update(customerComplaints).set({ stage: 'closed', closedAt: new Date() }).where(eq(customerComplaints.id, id));
      await this.documents.log(tx, auth, doc, 'complaint.closed', meta);
      return this.view(tx, auth, doc);
    });
  }

  /** Complaints by category, item and customer; response times; field failures and warranty cost. */
  analysis(auth: AuthContext, q: { from: string; to: string }) {
    return this.database.run(auth, async (tx) => {
      const base = sql`from customer_complaints c join documents d on d.id = c.id left join items i on i.id = c.item_id join parties p on p.id = c.customer_id
                       where d.status <> 'cancelled' and c.received_on between ${q.from}::date and ${q.to}::date`;
      const [totals] = await many(
        tx,
        sql`select count(*)::int as count, count(*) filter (where c.stage <> 'closed')::int as open,
                   count(*) filter (where c.stage in ('open', 'investigating') and c.response_due < (now() at time zone 'Asia/Kolkata')::date)::int as overdue,
                   count(*) filter (where c.is_field_failure)::int as "fieldFailures", coalesce(sum(c.warranty_cost), 0)::text as "warrantyCost",
                   round(avg(extract(epoch from (c.responded_at - c.received_on::timestamptz)) / 86400)::numeric, 1)::text as "avgResponseDays" ${base}`,
      );
      const byCategory = await many(tx, sql`select c.category as key, count(*)::int as count ${base} group by 1 order by 2 desc`);
      const byItem = await many(tx, sql`select coalesce(i.code::text, '—') as key, count(*)::int as count ${base} group by 1 order by 2 desc limit 10`);
      const byCustomer = await many(tx, sql`select p.name as key, count(*)::int as count ${base} group by 1 order by 2 desc limit 10`);
      return { from: q.from, to: q.to, totals, byCategory, byItem, byCustomer };
    });
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const manage = perms.has('quality.complaints.manage');
    const header = await this.documents.view(tx, auth, doc, { manage: false, cancel: manage });
    const [c] = await tx.select().from(customerComplaints).where(eq(customerComplaints.id, doc.id));
    const [customer] = await tx.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.id, c.customerId));
    const item = c.itemId ? (await tx.select({ id: items.id, code: items.code, name: items.name }).from(items).where(eq(items.id, c.itemId)))[0] : null;
    const ref = async (id: string | null) => (id ? ((await tx.select({ id: documents.id, number: documents.number, docType: documents.docType, status: documents.status }).from(documents).where(eq(documents.id, id)))[0] ?? null) : null);
    const ncr = c.ncrId ? (await tx.select({ copq: ncrs.copq }).from(ncrs).where(eq(ncrs.id, c.ncrId)))[0] : null;
    const { tenantId: _t, id: _i, ...rest } = c;
    const overdue = !['responded', 'closed'].includes(c.stage) && !!c.responseDue && c.responseDue < todayIST();
    return { ...header, ...rest, customer, item: item ?? null, refDoc: await ref(c.refDocId), ncr: c.ncrId ? { ...(await ref(c.ncrId)), copq: ncr?.copq ?? '0' } : null, capa: await ref(c.capaId), overdue, canManage: manage && c.stage !== 'closed' };
  }
}
