import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { documents, goodsReceipts, items, ncrs, parties, qualityInspections, uoms, type Transaction } from '@nextgen/database';
import { and, desc, eq, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';

const DOC_TYPE = 'ncr' as const;
const D = Decimal.from;
const ZERO = D('0');
const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;

const qty0 = (label: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || String(v).trim() === '' ? '0' : String(v).trim()))
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), `${label}: a number with up to 4 decimals`);
const money0 = (label: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || String(v).trim() === '' ? '0' : String(v).trim()))
    .refine((v) => /^\d{1,14}(\.\d{1,2})?$/.test(v), `${label}: an amount`);

const body = {
  source: z.enum(['incoming', 'in_process', 'final', 'customer', 'supplier', 'internal']),
  severity: z.enum(['minor', 'major', 'critical']).default('major'),
  itemId: z.uuid(),
  batchNo: optionalText(40),
  qtyAffected: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Quantity affected must be more than zero'),
  defectCategory: z.string().trim().min(2).max(80),
  description: z.string().trim().min(3).max(4000),
  partyId: z.uuid().nullable().optional(),
  inspectionId: z.uuid().nullable().optional(),
  workOrderId: z.uuid().nullable().optional(),
  containment: optionalText(2000),
  useAsIsQty: qty0('Use as is'),
  reworkQty: qty0('Rework'),
  scrapQty: qty0('Scrap'),
  returnQty: qty0('Return'),
  sortQty: qty0('Sort'),
  dispositionNotes: optionalText(2000),
  scrapCost: money0('Scrap cost'),
  reworkCost: money0('Rework cost'),
  sortingCost: money0('Sorting cost'),
  otherCost: money0('Other cost'),
  recovered: money0('Recovered'),
  docDate: z.iso.date().optional(),
};
export const createNcrSchema = z.object(body);
export type CreateNcrInput = z.infer<typeof createNcrSchema>;
export const updateNcrSchema = z.object({ ...body, version: z.number().int() });

const DISPOSITIONS = ['useAsIsQty', 'reworkQty', 'scrapQty', 'returnQty', 'sortQty'] as const;

/**
 * Non-conformance reports. The draft records what is wrong and the MRB's disposition of the
 * quantity; submitting checks the disposition covers the quantity, approval is the MRB
 * decision and fixes the cost of poor quality (scrap at the item's valuation rate unless
 * entered, plus rework, sorting and other costs, less recoveries).
 */
@Injectable()
export class NcrsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, { amendable: false, onApproved: (tx, _auth, doc) => this.cost(tx, doc) });
  }

  list(auth: AuthContext, q: { status?: string; source?: string; itemId?: string; partyId?: string; q?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, source: ncrs.source, severity: ncrs.severity, defectCategory: ncrs.defectCategory, qtyAffected: ncrs.qtyAffected, batchNo: ncrs.batchNo, copq: ncrs.copq, closedAt: ncrs.closedAt, item: { id: items.id, code: items.code, name: items.name }, party: parties.name })
        .from(documents)
        .innerJoin(ncrs, eq(ncrs.id, documents.id))
        .innerJoin(items, eq(items.id, ncrs.itemId))
        .leftJoin(parties, eq(parties.id, ncrs.partyId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status as 'approved') : undefined,
            q.source ? eq(ncrs.source, q.source) : undefined,
            q.itemId ? eq(ncrs.itemId, q.itemId) : undefined,
            q.partyId ? eq(ncrs.partyId, q.partyId) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(items.code, `%${term}%`), ilike(ncrs.defectCategory, `%${term}%`), ilike(ncrs.batchNo, `%${term}%`)) : undefined,
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

  create(auth: AuthContext, input: CreateNcrInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const code = await this.check(tx, input);
      const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, docDate: input.docDate ?? todayIST(), title: `${code} · ${input.defectCategory}`.slice(0, 200), amount: null });
      await tx.insert(ncrs).values({ id: doc.id, tenantId: auth.tenantId, ...this.values(input) });
      await this.documents.log(tx, auth, doc, 'document.created', meta, { source: input.source });
      return this.view(tx, auth, doc);
    });
  }

  /** A draft NCR from a rejected (or partly rejected) inspection lot. */
  fromInspection(auth: AuthContext, inspectionId: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [qi] = await tx.select({ qi: qualityInspections, status: documents.status, number: documents.number }).from(qualityInspections).innerJoin(documents, eq(documents.id, qualityInspections.id)).where(eq(qualityInspections.id, inspectionId));
      if (!qi) throw new NotFoundException('Inspection not found');
      const bad = D(qi.qi.rejectedQty).add(D(qi.qi.reworkQty));
      const qty = bad.cmp(ZERO) > 0 ? bad : D(qi.qi.lotQty);
      if (bad.isZero() && qi.qi.suggestion !== 'reject') throw new ConflictException('Nothing was rejected in this inspection');
      let partyId = qi.qi.partyId;
      if (!partyId && qi.qi.stage === 'incoming' && qi.qi.sourceDocId) partyId = (await tx.select({ v: goodsReceipts.vendorId }).from(goodsReceipts).where(eq(goodsReceipts.id, qi.qi.sourceDocId)))[0]?.v ?? null;
      const input = createNcrSchema.parse({
        source: qi.qi.stage,
        severity: 'major',
        itemId: qi.qi.itemId,
        batchNo: qi.qi.batchNo,
        qtyAffected: qty.toFixed(4),
        defectCategory: 'Inspection rejection',
        description: `${qi.number ?? 'Inspection'}: ${qi.qi.defectives} defective${qi.qi.defectives === 1 ? '' : 's'} in a sample of ${qi.qi.sampleSize}.${qi.qi.remarks ? ` ${qi.qi.remarks}` : ''}`,
        partyId,
        inspectionId,
        workOrderId: qi.qi.workOrderId,
        reworkQty: qi.qi.reworkQty,
        returnQty: qi.qi.stage === 'incoming' ? qi.qi.rejectedQty : '0',
        scrapQty: qi.qi.stage === 'incoming' ? '0' : qi.qi.rejectedQty,
      });
      const code = await this.check(tx, input);
      const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, docDate: todayIST(), title: `${code} · ${input.defectCategory}`, amount: null });
      await tx.insert(ncrs).values({ id: doc.id, tenantId: auth.tenantId, ...this.values(input) });
      await this.documents.log(tx, auth, doc, 'document.created', meta, { inspectionId });
      return this.view(tx, auth, doc);
    });
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof updateNcrSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const code = await this.check(tx, input);
      await tx.update(ncrs).set(this.values(input)).where(eq(ncrs.id, id));
      const updated = await this.documents.update(tx, auth, doc, { title: `${code} · ${input.defectCategory}`.slice(0, 200), ...(input.docDate ? { docDate: input.docDate } : {}) });
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
      const [n] = await tx.select().from(ncrs).where(eq(ncrs.id, id));
      const total = DISPOSITIONS.reduce((s, k) => s.add(D(n[k])), ZERO);
      if (total.cmp(D(n.qtyAffected)) !== 0) throw new BadRequestException({ message: `The disposition (${Number(total.toFixed(4))}) must cover the ${Number(n.qtyAffected)} affected`, errors: [{ path: 'useAsIsQty', message: 'Disposition must add up to the quantity affected' }] });
      return this.view(tx, auth, await this.documents.submit(tx, auth, doc, meta));
    });
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      return this.view(tx, auth, await this.documents.cancel(tx, auth, doc, reason, meta));
    });
  }

  /** Closes an approved NCR once the disposition has been carried out. */
  close(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      if (doc.status !== 'approved') throw new ConflictException('Only an approved NCR can be closed');
      const [n] = await tx.select({ closedAt: ncrs.closedAt }).from(ncrs).where(eq(ncrs.id, id));
      if (n.closedAt) throw new ConflictException('The NCR is already closed');
      await tx.update(ncrs).set({ closedAt: new Date() }).where(eq(ncrs.id, id));
      const updated = await this.documents.update(tx, auth, doc, {});
      await this.documents.log(tx, auth, updated, 'ncr.closed', meta);
      return this.view(tx, auth, updated);
    });
  }

  private values(input: CreateNcrInput) {
    const { docDate: _d, ...v } = input;
    return { ...v, batchNo: v.batchNo ? v.batchNo.toUpperCase() : null, partyId: v.partyId ?? null, inspectionId: v.inspectionId ?? null, workOrderId: v.workOrderId ?? null };
  }

  private async check(tx: Transaction, input: CreateNcrInput) {
    const [it] = await tx.select({ code: items.code }).from(items).where(eq(items.id, input.itemId));
    if (!it) throw new BadRequestException({ message: 'Item not found', errors: [{ path: 'itemId', message: 'Item not found' }] });
    const total = DISPOSITIONS.reduce((s, k) => s.add(D(input[k])), ZERO);
    if (total.cmp(D(input.qtyAffected)) > 0) throw new BadRequestException({ message: 'The disposition is more than the quantity affected', errors: [{ path: 'useAsIsQty', message: 'More than the quantity affected' }] });
    return it.code;
  }

  /** At the MRB decision: value the scrap and total the cost of poor quality. */
  private async cost(tx: Transaction, doc: DocumentRow) {
    const [n] = await tx.select().from(ncrs).where(eq(ncrs.id, doc.id));
    let scrap = D(n.scrapCost);
    if (scrap.isZero() && D(n.scrapQty).cmp(ZERO) > 0) {
      const [r] = await many<{ rate: string | null }>(
        tx,
        sql`select coalesce((select case when sum(qty) > 0 then sum(value) / sum(qty) end from stock_valuation where item_id = ${n.itemId}), (select coalesce(standard_cost, last_purchase_rate) from items where id = ${n.itemId}))::text as rate`,
      );
      scrap = D(n.scrapQty).mul(D(r?.rate ?? '0')).round(2);
    }
    const copq = scrap.add(D(n.reworkCost)).add(D(n.sortingCost)).add(D(n.otherCost)).sub(D(n.recovered));
    await tx.update(ncrs).set({ scrapCost: scrap.toFixed(2), copq: copq.toFixed(2) }).where(eq(ncrs.id, doc.id));
    await tx.update(documents).set({ amount: copq.toFixed(2) }).where(eq(documents.id, doc.id));
  }

  /** Cost of poor quality from approved NCRs, by month, defect, source and vendor / customer. */
  copq(auth: AuthContext, q: { from: string; to: string }) {
    return this.database.run(auth, async (tx) => {
      const base = sql`from ncrs n join documents d on d.id = n.id left join parties p on p.id = n.party_id where d.status = 'approved' and d.doc_date between ${q.from}::date and ${q.to}::date`;
      const sums = sql`count(*)::int as count, sum(n.copq)::text as copq, sum(n.scrap_cost)::text as scrap, sum(n.rework_cost)::text as rework, sum(n.sorting_cost + n.other_cost)::text as other, sum(n.recovered)::text as recovered, sum(n.qty_affected)::text as qty`;
      const [totals] = await many(tx, sql`select ${sums} ${base}`);
      const byMonth = await many(tx, sql`select to_char(d.doc_date, 'YYYY-MM') as key, ${sums} ${base} group by 1 order by 1`);
      const byCategory = await many(tx, sql`select n.defect_category as key, ${sums} ${base} group by 1 order by sum(n.copq) desc`);
      const bySource = await many(tx, sql`select n.source as key, ${sums} ${base} group by 1 order by sum(n.copq) desc`);
      const byParty = await many(tx, sql`select coalesce(p.name, '—') as key, ${sums} ${base} group by 1 order by sum(n.copq) desc limit 20`);
      return { from: q.from, to: q.to, totals, byMonth, byCategory, bySource, byParty };
    });
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const manage = perms.has('quality.ncr.manage');
    const header = await this.documents.view(tx, auth, doc, { manage, cancel: manage });
    const [n] = await tx.select({ n: ncrs, code: items.code, name: items.name, uom: uoms.code }).from(ncrs).innerJoin(items, eq(items.id, ncrs.itemId)).innerJoin(uoms, eq(uoms.id, items.baseUomId)).where(eq(ncrs.id, doc.id));
    const party = n.n.partyId ? (await tx.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.id, n.n.partyId)))[0] : null;
    const inspection = n.n.inspectionId ? (await tx.select({ id: documents.id, number: documents.number }).from(documents).where(eq(documents.id, n.n.inspectionId)))[0] : null;
    const workOrder = n.n.workOrderId ? (await tx.select({ id: documents.id, number: documents.number }).from(documents).where(eq(documents.id, n.n.workOrderId)))[0] : null;
    const { tenantId: _t, id: _i, ...rest } = n.n;
    return { ...header, ...rest, item: { id: n.n.itemId, code: n.code, name: n.name, uom: n.uom }, party: party ?? null, inspection: inspection ?? null, workOrder: workOrder ?? null, canClose: manage && doc.status === 'approved' && !n.n.closedAt };
  }
}
