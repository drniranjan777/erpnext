import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { documents, drawings, engineeringChangeItems, engineeringChanges, items, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { riskOf } from '../quality/msa';
import { many } from '../../common/sql';

const DOC_TYPE = 'engineering_change' as const;

const body = {
  kind: z.enum(['bom', 'formula', 'drawing', 'item', 'process', 'facility', 'system']),
  reason: z.string().trim().min(3, 'Say why the change is needed').max(1000),
  description: optionalText(4000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  effectiveDate: z.iso.date().nullable().optional(),
  disposition: z.enum(['use_as_is', 'rework', 'scrap', 'return_to_vendor']).default('use_as_is'),
  /** Change-control risk, 1–5 each (required for process, facility and system changes). */
  severity: z.number().int().min(1).max(5).nullable().optional(),
  occurrence: z.number().int().min(1).max(5).nullable().optional(),
  detection: z.number().int().min(1).max(5).nullable().optional(),
  regulatoryImpact: z.boolean().default(false),
  validationRequired: z.boolean().default(false),
  docDate: z.iso.date().optional(),
  items: z
    .array(
      z.object({
        itemId: z.uuid(),
        /** Current BOM / formula / drawing (blank = the one in use now). */
        fromDocId: z.uuid().nullable().optional(),
        /** The new version that implements the change. */
        toDocId: z.uuid().nullable().optional(),
        remarks: optionalText(500),
      }),
    )
    .min(1, 'Add at least one affected item')
    .max(100),
};
export const createChangeSchema = z.object(body);
export type CreateChangeInput = z.infer<typeof createChangeSchema>;
export const updateChangeSchema = z.object({ ...body, version: z.number().int() });
export const implementSchema = z.object({ notes: optionalText(2000) });

const DISPOSITION: Record<string, string> = { use_as_is: 'Use as is', rework: 'Rework', scrap: 'Scrap', return_to_vendor: 'Return to vendor' };

/**
 * Engineering change: a request (draft, then the approval workflow) that becomes the change
 * notice when approved, and is implemented once its new BOM / formula / drawing versions are
 * approved. The impact on stock and open orders is shown live and frozen at approval.
 */
@Injectable()
export class ChangesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      amendable: false,
      onApproved: async (tx, _auth, doc) => {
        const impact = await this.impact(tx, doc.id);
        await tx.update(engineeringChanges).set({ stage: 'approved', impactSnapshot: impact as unknown as Record<string, unknown> }).where(eq(engineeringChanges.id, doc.id));
      },
    });
  }

  list(auth: AuthContext, q: { stage?: string; q?: string; itemId?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.trim();
      const rows = await tx
        .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, title: documents.title, kind: engineeringChanges.kind, priority: engineeringChanges.priority, stage: engineeringChanges.stage, effectiveDate: engineeringChanges.effectiveDate, items: sql<number>`(select count(*)::int from engineering_change_items x where x.change_id = ${documents.id})` })
        .from(documents)
        .innerJoin(engineeringChanges, eq(engineeringChanges.id, documents.id))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.stage ? eq(engineeringChanges.stage, q.stage) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(documents.title, `%${term}%`)) : undefined,
            q.itemId ? sql`exists (select 1 from engineering_change_items x where x.change_id = ${documents.id} and x.item_id = ${q.itemId})` : undefined,
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

  create(auth: AuthContext, input: CreateChangeInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const lines = await this.prepare(tx, input);
      const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, docDate: input.docDate ?? todayIST(), title: this.title(input, lines), amount: null });
      await tx.insert(engineeringChanges).values({ id: doc.id, tenantId: auth.tenantId, ...this.header(input) });
      await this.writeItems(tx, auth, doc.id, lines);
      await this.documents.log(tx, auth, doc, 'document.created', meta, { items: lines.length });
      return this.view(tx, auth, doc);
    });
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof updateChangeSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const lines = await this.prepare(tx, input);
      await tx.update(engineeringChanges).set(this.header(input)).where(eq(engineeringChanges.id, id));
      await tx.delete(engineeringChangeItems).where(eq(engineeringChangeItems.changeId, id));
      await this.writeItems(tx, auth, id, lines);
      const updated = await this.documents.update(tx, auth, doc, { title: this.title(input, lines), ...(input.docDate ? { docDate: input.docDate } : {}) });
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
      const [c] = await tx.select({ kind: engineeringChanges.kind, rpn: engineeringChanges.rpn }).from(engineeringChanges).where(eq(engineeringChanges.id, id));
      if (['process', 'facility', 'system'].includes(c.kind) && c.rpn === null) throw new BadRequestException({ message: 'Rate the risk (severity, occurrence, detection) before submitting a process, facility or system change', errors: [{ path: 'severity', message: 'Required' }] });
      const submitted = await this.documents.submit(tx, auth, doc, meta);
      return this.view(tx, auth, submitted);
    });
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      const [c] = await tx.select({ stage: engineeringChanges.stage }).from(engineeringChanges).where(eq(engineeringChanges.id, id));
      if (c?.stage === 'implemented') throw new ConflictException('An implemented change cannot be cancelled: raise a new change instead');
      return this.view(tx, auth, await this.documents.cancel(tx, auth, doc, reason, meta));
    });
  }

  /** Marks the change done. Every new version it points at must be approved by then. */
  implement(auth: AuthContext, id: string, version: number, notes: string | null, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      const [c] = await tx.select().from(engineeringChanges).where(eq(engineeringChanges.id, id));
      if (c.stage !== 'approved') throw new ConflictException(c.stage === 'implemented' ? 'The change is already implemented' : 'Only approved changes can be implemented');
      const lines = await tx.select().from(engineeringChangeItems).where(eq(engineeringChangeItems.changeId, id));
      const toIds = lines.map((l) => l.toDocId).filter((v): v is string => !!v);
      const pending = toIds.length ? await tx.select({ number: documents.number, title: documents.title, status: documents.status }).from(documents).where(and(inArray(documents.id, toIds), sql`${documents.status} <> 'approved'`)) : [];
      if (pending.length) throw new ConflictException(`Approve the new version${pending.length === 1 ? '' : 's'} first: ${pending.map((p) => p.number ?? p.title ?? 'draft').join(', ')}`);
      if (toIds.length) await tx.update(drawings).set({ changeId: id }).where(inArray(drawings.id, toIds));
      await tx.update(engineeringChanges).set({ stage: 'implemented', implementedAt: new Date(), implementationNotes: notes }).where(eq(engineeringChanges.id, id));
      const updated = await this.documents.update(tx, auth, doc, {});
      await this.documents.log(tx, auth, updated, 'engineering_change.implemented', meta, { notes });
      return this.view(tx, auth, updated);
    });
  }

  private header(input: CreateChangeInput) {
    const rated = input.severity && input.occurrence && input.detection;
    const risk = rated ? riskOf(input.severity!, input.occurrence!, input.detection!) : null;
    return {
      kind: input.kind,
      reason: input.reason,
      description: input.description,
      priority: input.priority,
      effectiveDate: input.effectiveDate ?? null,
      disposition: input.disposition,
      severity: input.severity ?? null,
      occurrence: input.occurrence ?? null,
      detection: input.detection ?? null,
      rpn: risk?.rpn ?? null,
      riskLevel: risk?.level ?? null,
      regulatoryImpact: input.regulatoryImpact,
      validationRequired: input.validationRequired,
    };
  }

  private title(input: CreateChangeInput, lines: { code: string }[]) {
    const codes = lines.map((l) => l.code);
    return `${input.kind.toUpperCase()}: ${codes.slice(0, 3).join(', ')}${codes.length > 3 ? ` +${codes.length - 3}` : ''}`.slice(0, 200);
  }

  /** Validates items and fills in the version in use now when it was left blank. */
  private async prepare(tx: Transaction, input: CreateChangeInput) {
    const ids = [...new Set(input.items.map((l) => l.itemId))];
    if (ids.length !== input.items.length) throw new BadRequestException('Each item once');
    const its = await tx.select({ id: items.id, code: items.code }).from(items).where(inArray(items.id, ids));
    const errors: { path: string; message: string }[] = [];
    const docIds = input.items.flatMap((l) => [l.fromDocId, l.toDocId]).filter((v): v is string => !!v);
    const docs = docIds.length ? await tx.select({ id: documents.id, docType: documents.docType }).from(documents).where(inArray(documents.id, docIds)) : [];
    const expected = input.kind === 'bom' ? 'bom' : input.kind === 'formula' ? 'formula' : input.kind === 'drawing' ? 'drawing' : null;
    const out: { itemId: string; code: string; fromDocId: string | null; toDocId: string | null; remarks: string | null }[] = [];
    for (const [i, l] of input.items.entries()) {
      const it = its.find((x) => x.id === l.itemId);
      if (!it) {
        errors.push({ path: `items.${i}.itemId`, message: `Line ${i + 1}: item not found` });
        continue;
      }
      for (const k of ['fromDocId', 'toDocId'] as const) {
        const d = l[k] ? docs.find((x) => x.id === l[k]) : null;
        if (l[k] && !d) errors.push({ path: `items.${i}.${k}`, message: `Line ${i + 1}: document not found` });
        else if (d && expected && d.docType !== expected) errors.push({ path: `items.${i}.${k}`, message: `Line ${i + 1}: expected a ${expected}` });
      }
      let from = l.fromDocId ?? null;
      if (!from && expected) from = await this.current(tx, expected, l.itemId);
      out.push({ itemId: l.itemId, code: it.code, fromDocId: from, toDocId: l.toDocId ?? null, remarks: l.remarks });
    }
    if (errors.length) throw new BadRequestException({ message: errors[0].message, errors });
    return out;
  }

  private async current(tx: Transaction, type: 'bom' | 'formula' | 'drawing', itemId: string) {
    const q =
      type === 'bom'
        ? sql`select b.id from boms b join documents d on d.id = b.id where b.item_id = ${itemId} and b.is_default and d.status = 'approved' limit 1`
        : type === 'formula'
          ? sql`select f.id from formulas f join documents d on d.id = f.id where f.item_id = ${itemId} and f.is_default and d.status = 'approved' limit 1`
          : sql`select g.id from drawings g join documents d on d.id = g.id where g.item_id = ${itemId} and d.status = 'approved' and g.superseded_at is null order by g.released_at desc limit 1`;
    const [r] = await many<{ id: string }>(tx, q);
    return r?.id ?? null;
  }

  private async writeItems(tx: Transaction, auth: AuthContext, changeId: string, lines: { itemId: string; fromDocId: string | null; toDocId: string | null; remarks: string | null }[]) {
    await tx.insert(engineeringChangeItems).values(lines.map((l, i) => ({ tenantId: auth.tenantId, changeId, lineNo: i + 1, itemId: l.itemId, fromDocId: l.fromDocId, toDocId: l.toDocId, remarks: l.remarks })));
  }

  /**
   * What the change touches, per item: stock on hand, open orders that make it or use it,
   * stock on order, open sales orders, and the BOMs it is used in.
   */
  async impact(tx: Transaction, changeId: string) {
    const rows = await many<{ item_id: string; code: string; name: string; uom: string; from_doc_id: string | null; stock_qty: string; stock_value: string; wo_make: number; wo_make_qty: string; wo_use: number; wo_use_qty: string; wo_from_doc: number; po_qty: string; so_qty: string; used_in: string[] | null }>(
      tx,
      sql`select x.item_id, i.code, i.name, u.code as uom, x.from_doc_id,
                 coalesce((select sum(sv.qty) from stock_valuation sv where sv.item_id = x.item_id), 0)::text as stock_qty,
                 coalesce((select sum(sv.value) from stock_valuation sv where sv.item_id = x.item_id), 0)::text as stock_value,
                 (select count(*)::int from work_orders w join documents d on d.id = w.id where w.item_id = x.item_id and d.status not in ('cancelled', 'rejected') and w.stage not in ('completed', 'closed')) as wo_make,
                 coalesce((select sum(w.qty - w.produced_qty) from work_orders w join documents d on d.id = w.id where w.item_id = x.item_id and d.status not in ('cancelled', 'rejected') and w.stage not in ('completed', 'closed')), 0)::text as wo_make_qty,
                 (select count(distinct m.work_order_id)::int from work_order_materials m join work_orders w on w.id = m.work_order_id join documents d on d.id = w.id where m.item_id = x.item_id and m.kind = 'component' and d.status not in ('cancelled', 'rejected') and w.stage not in ('completed', 'closed')) as wo_use,
                 coalesce((select sum(greatest(m.required_qty - m.issued_qty, 0)) from work_order_materials m join work_orders w on w.id = m.work_order_id join documents d on d.id = w.id where m.item_id = x.item_id and m.kind = 'component' and d.status not in ('cancelled', 'rejected') and w.stage not in ('completed', 'closed')), 0)::text as wo_use_qty,
                 (select count(*)::int from work_orders w join documents d on d.id = w.id where x.from_doc_id is not null and (w.bom_id = x.from_doc_id or w.formula_id = x.from_doc_id) and d.status not in ('cancelled', 'rejected') and w.stage not in ('completed', 'closed')) as wo_from_doc,
                 coalesce((select sum(greatest(l.qty - l.received_qty, 0) * l.conversion_factor) from purchase_order_lines l join purchase_orders p on p.id = l.po_id join documents d on d.id = p.id where l.item_id = x.item_id and d.status = 'approved' and p.closed_at is null), 0)::text as po_qty,
                 coalesce((select sum(greatest(l.qty - l.delivered_qty, 0) * l.conversion_factor) from sales_order_lines l join sales_orders s on s.id = l.order_id join documents d on d.id = s.id where l.item_id = x.item_id and d.status = 'approved' and s.closed_at is null), 0)::text as so_qty,
                 (select array_agg(distinct pi.code::text) from bom_lines bl join boms b on b.id = bl.bom_id join documents d on d.id = b.id join items pi on pi.id = b.item_id where bl.item_id = x.item_id and b.is_default and d.status = 'approved') as used_in
          from engineering_change_items x join items i on i.id = x.item_id join uoms u on u.id = i.base_uom_id
          where x.change_id = ${changeId}
          order by x.line_no`,
    );
    const lines = rows.map((r) => ({
      itemId: r.item_id,
      code: r.code,
      name: r.name,
      uom: r.uom,
      stockQty: r.stock_qty,
      stockValue: r.stock_value,
      workOrdersMaking: { count: r.wo_make, qty: r.wo_make_qty },
      workOrdersUsing: { count: r.wo_use, qty: r.wo_use_qty },
      workOrdersOnCurrentVersion: r.wo_from_doc,
      onOrder: r.po_qty,
      openSales: r.so_qty,
      usedIn: r.used_in ?? [],
    }));
    return {
      lines,
      totals: {
        stockValue: lines.reduce((s, l) => s + Number(l.stockValue), 0).toFixed(2),
        openWorkOrders: lines.reduce((s, l) => s + l.workOrdersMaking.count + l.workOrdersUsing.count, 0),
        itemsOnOrder: lines.filter((l) => Number(l.onOrder) > 0).length,
        parents: [...new Set(lines.flatMap((l) => l.usedIn))].length,
      },
    };
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const manage = perms.has('manufacturing.engineering.manage');
    const header = await this.documents.view(tx, auth, doc, { manage, cancel: manage });
    const [c] = await tx.select().from(engineeringChanges).where(eq(engineeringChanges.id, doc.id));
    const lines = await many<{ id: string; line_no: number; item_id: string; code: string; name: string; from_doc_id: string | null; from_number: string | null; from_title: string | null; from_status: string | null; from_type: string | null; to_doc_id: string | null; to_number: string | null; to_title: string | null; to_status: string | null; to_type: string | null; remarks: string | null }>(
      tx,
      sql`select x.id, x.line_no, x.item_id, i.code, i.name, x.remarks,
                 x.from_doc_id, fd.number as from_number, fd.title as from_title, fd.status as from_status, fd.doc_type as from_type,
                 x.to_doc_id, td.number as to_number, td.title as to_title, td.status as to_status, td.doc_type as to_type
          from engineering_change_items x join items i on i.id = x.item_id
          left join documents fd on fd.id = x.from_doc_id left join documents td on td.id = x.to_doc_id
          where x.change_id = ${doc.id} order by x.line_no`,
    );
    const ref = (id: string | null, number: string | null, title: string | null, status: string | null, type: string | null) => (id ? { id, number, title, status, docType: type } : null);
    const { tenantId: _t, id: _i, ...rest } = c;
    return {
      ...header,
      ...rest,
      dispositionLabel: DISPOSITION[c.disposition] ?? c.disposition,
      items: lines.map((l) => ({ id: l.id, lineNo: l.line_no, item: { id: l.item_id, code: l.code, name: l.name }, from: ref(l.from_doc_id, l.from_number, l.from_title, l.from_status, l.from_type), to: ref(l.to_doc_id, l.to_number, l.to_title, l.to_status, l.to_type), remarks: l.remarks })),
      impact: c.stage === 'request' ? await this.impact(tx, doc.id) : (c.impactSnapshot ?? (await this.impact(tx, doc.id))),
      liveImpact: c.stage !== 'request' ? await this.impact(tx, doc.id) : null,
      canImplement: manage && c.stage === 'approved',
    };
  }

  /** Changes touching an item (for the item and BOM pages). */
  forItem(auth: AuthContext, itemId: string) {
    return this.database.run(auth, (tx) =>
      tx
        .select({ id: documents.id, number: documents.number, status: documents.status, stage: engineeringChanges.stage, kind: engineeringChanges.kind, title: documents.title, docDate: documents.docDate })
        .from(engineeringChangeItems)
        .innerJoin(engineeringChanges, eq(engineeringChanges.id, engineeringChangeItems.changeId))
        .innerJoin(documents, eq(documents.id, engineeringChanges.id))
        .where(eq(engineeringChangeItems.itemId, itemId))
        .orderBy(desc(documents.id), asc(engineeringChangeItems.lineNo)),
    );
  }
}

