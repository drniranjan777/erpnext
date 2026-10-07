import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { boms, documents, drawings, items, type Transaction } from '@nextgen/database';
import { and, desc, eq, ilike, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';

const DOC_TYPE = 'drawing' as const;

const body = {
  drawingNo: z.string().trim().min(1).max(60).transform((v) => v.toUpperCase()),
  revision: z.string().trim().min(1).max(10).transform((v) => v.toUpperCase()).default('A'),
  title: z.string().trim().min(2).max(200),
  itemId: z.uuid().nullable().optional(),
  sheetSize: optionalText(10),
  changeId: z.uuid().nullable().optional(),
  notes: optionalText(2000),
};
export const createDrawingSchema = z.object(body);
export type CreateDrawingInput = z.infer<typeof createDrawingSchema>;
export const updateDrawingSchema = z.object({ ...body, version: z.number().int() });

/** Next revision: A → B … Z → AA, 1 → 2, 09 → 10. */
export function nextRevision(rev: string) {
  if (/^\d+$/.test(rev)) return String(Number(rev) + 1).padStart(rev.length, '0');
  if (/^[A-Z]+$/.test(rev)) {
    const chars = rev.split('');
    let i = chars.length - 1;
    while (i >= 0) {
      if (chars[i] !== 'Z') {
        chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
        return chars.join('');
      }
      chars[i] = 'A';
      i--;
    }
    return `A${chars.join('')}`;
  }
  return `${rev}-1`;
}

/**
 * Drawing register. Each revision is a document: files go on as attachments, approval releases
 * the revision, supersedes the one before and stamps the item's default BOM with it.
 */
@Injectable()
export class DrawingsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, { amendable: false, onApproved: (tx, _auth, doc) => this.release(tx, doc) });
  }

  list(auth: AuthContext, q: { q?: string; itemId?: string; current?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.trim();
      const rows = await tx
        .select({ id: documents.id, number: documents.number, status: documents.status, drawingNo: drawings.drawingNo, revision: drawings.revision, title: drawings.title, sheetSize: drawings.sheetSize, releasedAt: drawings.releasedAt, supersededAt: drawings.supersededAt, item: { id: items.id, code: items.code, name: items.name } })
        .from(drawings)
        .innerJoin(documents, eq(documents.id, drawings.id))
        .leftJoin(items, eq(items.id, drawings.itemId))
        .where(
          and(
            q.current === 'true' ? and(eq(documents.status, 'approved'), isNull(drawings.supersededAt)) : ne(documents.status, 'cancelled'),
            term ? or(ilike(drawings.drawingNo, `%${term}%`), ilike(drawings.title, `%${term}%`), ilike(items.code, `%${term}%`)) : undefined,
            q.itemId ? eq(drawings.itemId, q.itemId) : undefined,
            q.cursor ? lt(documents.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(documents.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      return { items: page.map((r) => ({ ...r, item: r.item?.id ? r.item : null })), nextCursor: hasMore ? page[page.length - 1].id : null };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE)));
  }

  create(auth: AuthContext, input: CreateDrawingInput, meta: RequestMeta, previousId: string | null = null) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta, previousId));
  }

  private async createTx(tx: Transaction, auth: AuthContext, input: CreateDrawingInput, meta: RequestMeta, previousId: string | null) {
    await this.check(tx, input, null);
    const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, docDate: todayIST(), title: `${input.drawingNo} rev ${input.revision}: ${input.title}`.slice(0, 200), amount: null });
    await tx.insert(drawings).values({ id: doc.id, tenantId: auth.tenantId, drawingNo: input.drawingNo, revision: input.revision, title: input.title, itemId: input.itemId ?? null, sheetSize: input.sheetSize, changeId: input.changeId ?? null, notes: input.notes, previousId });
    await this.documents.log(tx, auth, doc, 'document.created', meta, { drawingNo: input.drawingNo, revision: input.revision });
    return this.view(tx, auth, doc);
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof updateDrawingSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      await this.check(tx, input, id);
      await tx.update(drawings).set({ drawingNo: input.drawingNo, revision: input.revision, title: input.title, itemId: input.itemId ?? null, sheetSize: input.sheetSize, changeId: input.changeId ?? null, notes: input.notes }).where(eq(drawings.id, id));
      const updated = await this.documents.update(tx, auth, doc, { title: `${input.drawingNo} rev ${input.revision}: ${input.title}`.slice(0, 200) });
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

  /** A draft of the next revision, copied from a released one. */
  newRevision(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [d] = await tx.select({ g: drawings, status: documents.status }).from(drawings).innerJoin(documents, eq(documents.id, drawings.id)).where(eq(drawings.id, id));
      if (!d) throw new NotFoundException('Drawing not found');
      if (d.status !== 'approved') throw new ConflictException('Only a released revision can be revised');
      const [{ open }] = await tx.select({ open: sql<number>`count(*)::int` }).from(drawings).innerJoin(documents, eq(documents.id, drawings.id)).where(and(sql`${drawings.drawingNo} = ${d.g.drawingNo}`, sql`${documents.status} in ('draft', 'pending_approval')`));
      if (open) throw new ConflictException('A new revision of this drawing is already being prepared');
      const all = await tx.select({ revision: drawings.revision }).from(drawings).where(sql`${drawings.drawingNo} = ${d.g.drawingNo}`);
      let rev = nextRevision(d.g.revision);
      while (all.some((r) => r.revision === rev)) rev = nextRevision(rev);
      return this.createTx(tx, auth, { drawingNo: d.g.drawingNo, revision: rev, title: d.g.title, itemId: d.g.itemId, sheetSize: d.g.sheetSize, changeId: null, notes: null }, meta, id);
    });
  }

  private async check(tx: Transaction, input: CreateDrawingInput, id: string | null) {
    const [dup] = await tx.select({ id: drawings.id }).from(drawings).where(and(sql`${drawings.drawingNo} = ${input.drawingNo}`, eq(drawings.revision, input.revision), id ? ne(drawings.id, id) : undefined));
    if (dup) throw new ConflictException({ message: `${input.drawingNo} revision ${input.revision} already exists`, errors: [{ path: 'revision', message: 'Already exists' }] });
    if (input.itemId) {
      const [it] = await tx.select({ id: items.id }).from(items).where(eq(items.id, input.itemId));
      if (!it) throw new BadRequestException({ message: 'Item not found', errors: [{ path: 'itemId', message: 'Item not found' }] });
    }
  }

  private async release(tx: Transaction, doc: DocumentRow) {
    const [g] = await tx.select().from(drawings).where(eq(drawings.id, doc.id));
    const now = new Date();
    await tx
      .update(drawings)
      .set({ supersededAt: now })
      .where(and(sql`${drawings.drawingNo} = ${g.drawingNo}`, ne(drawings.id, g.id), isNull(drawings.supersededAt), sql`exists (select 1 from documents d where d.id = ${drawings.id} and d.status = 'approved')`));
    await tx.update(drawings).set({ releasedAt: now }).where(eq(drawings.id, g.id));
    if (g.itemId) {
      await tx
        .update(boms)
        .set({ drawingNo: g.drawingNo, drawingRevision: g.revision })
        .where(and(eq(boms.itemId, g.itemId), sql`exists (select 1 from documents d where d.id = ${boms.id} and d.status in ('draft', 'pending_approval', 'approved'))`, or(eq(boms.isDefault, true), sql`exists (select 1 from documents d where d.id = ${boms.id} and d.status = 'draft')`)));
    }
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const manage = perms.has('manufacturing.engineering.manage');
    const header = await this.documents.view(tx, auth, doc, { manage, cancel: manage });
    const [g] = await tx.select({ g: drawings, code: items.code, name: items.name }).from(drawings).leftJoin(items, eq(items.id, drawings.itemId)).where(eq(drawings.id, doc.id));
    const revisions = await tx
      .select({ id: drawings.id, revision: drawings.revision, status: documents.status, releasedAt: drawings.releasedAt, supersededAt: drawings.supersededAt })
      .from(drawings)
      .innerJoin(documents, eq(documents.id, drawings.id))
      .where(sql`${drawings.drawingNo} = ${g.g.drawingNo}`)
      .orderBy(desc(drawings.id));
    // The drawing's revision letter would clash with the document's amendment counter.
    const { tenantId: _t, id: _i, revision: drawingRevision, ...rest } = g.g;
    return {
      ...header,
      ...rest,
      drawingRevision,
      item: g.g.itemId ? { id: g.g.itemId, code: g.code, name: g.name } : null,
      current: doc.status === 'approved' && !g.g.supersededAt,
      revisions,
      canRevise: manage && doc.status === 'approved' && !revisions.some((r) => r.status === 'draft' || r.status === 'pending_approval'),
    };
  }
}
