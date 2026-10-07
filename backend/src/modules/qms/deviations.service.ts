import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { deviations, documents, items, type Transaction } from '@nextgen/database';
import { and, desc, eq, ilike, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { CapasService } from '../quality/capas.service';
import { riskOf } from '../quality/msa';

const DOC_TYPE = 'deviation' as const;
const rating = z.number().int().min(1).max(5);

const body = {
  kind: z.enum(['planned', 'unplanned']),
  category: z.enum(['process', 'material', 'equipment', 'document', 'environment', 'other']),
  description: z.string().trim().min(3).max(4000),
  itemId: z.uuid().nullable().optional(),
  batchNo: optionalText(40),
  workOrderId: z.uuid().nullable().optional(),
  impact: optionalText(4000),
  severity: rating,
  occurrence: rating,
  detection: rating,
  productImpact: z.boolean().default(false),
  proposedAction: optionalText(4000),
  validUntil: z.iso.date().nullable().optional(),
  docDate: z.iso.date().optional(),
};
export const createDeviationSchema = z.object(body).superRefine((d, ctx) => {
  if (d.kind === 'planned' && !d.validUntil) ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'A planned deviation applies until a date' });
});
export type CreateDeviationInput = z.infer<typeof createDeviationSchema>;
export const updateDeviationSchema = z.object({ ...body, version: z.number().int() });
export const closeDeviationSchema = z.object({ version: z.number().int(), notes: z.string().trim().min(3).max(2000) });

/**
 * Deviations: planned (approved in advance, until a date) or unplanned (found after the
 * fact), with an FMEA-style risk rating. Approval is QA's decision; a CAPA can follow and the
 * deviation is closed with notes.
 */
@Injectable()
export class DeviationsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly capas: CapasService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, { amendable: false });
  }

  list(auth: AuthContext, q: { kind?: string; open?: string; q?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, title: documents.title, kind: deviations.kind, category: deviations.category, rpn: deviations.rpn, riskLevel: deviations.riskLevel, validUntil: deviations.validUntil, closedAt: deviations.closedAt, productImpact: deviations.productImpact })
        .from(documents)
        .innerJoin(deviations, eq(deviations.id, documents.id))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.kind ? eq(deviations.kind, q.kind) : undefined,
            q.open === 'true' ? and(sql`${deviations.closedAt} is null`, sql`${documents.status} not in ('cancelled', 'rejected')`) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(documents.title, `%${term}%`), ilike(deviations.batchNo, `%${term}%`)) : undefined,
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

  create(auth: AuthContext, input: CreateDeviationInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, docDate: input.docDate ?? todayIST(), title: this.title(input), amount: null });
      await tx.insert(deviations).values({ id: doc.id, tenantId: auth.tenantId, ...this.values(input) });
      await this.documents.log(tx, auth, doc, 'document.created', meta, { kind: input.kind });
      return this.view(tx, auth, doc);
    });
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof updateDeviationSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      if (input.kind === 'planned' && !input.validUntil) throw new BadRequestException({ message: 'A planned deviation applies until a date', errors: [{ path: 'validUntil', message: 'Required' }] });
      await tx.update(deviations).set(this.values(input)).where(eq(deviations.id, id));
      const updated = await this.documents.update(tx, auth, doc, { title: this.title(input) });
      await this.documents.log(tx, auth, updated, 'document.updated', meta);
      return this.view(tx, auth, updated);
    });
  }

  remove(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => this.documents.deleteDraft(tx, auth, await this.documents.lock(tx, id, DOC_TYPE, version), meta));
  }

  submit(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.submit(tx, auth, await this.documents.lock(tx, id, DOC_TYPE, version), meta)));
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.cancel(tx, auth, await this.documents.lock(tx, id, DOC_TYPE, version), reason, meta)));
  }

  /** A draft CAPA for the deviation's cause. */
  raiseCapa(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.find(tx, id, DOC_TYPE);
      const [d] = await tx.select().from(deviations).where(eq(deviations.id, id));
      if (d.capaId) throw new ConflictException('A CAPA is already linked');
      const capa = await this.capas.createTx(tx, auth, { kind: 'corrective', source: 'internal', ncrId: null, complaintId: null, itemId: d.itemId, isScar: false, partyId: null, responseDue: null, problem: `${doc.number ?? 'Deviation'}: ${d.description}`.slice(0, 4000), method: '5why', whys: [], fishbone: {}, eightD: {}, rootCause: null, effectivenessDue: null, actions: [] }, meta);
      await tx.update(deviations).set({ capaId: capa.id }).where(eq(deviations.id, id));
      return capa;
    });
  }

  close(auth: AuthContext, id: string, input: z.infer<typeof closeDeviationSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      if (doc.status !== 'approved') throw new ConflictException('Only an approved deviation can be closed');
      const [d] = await tx.select({ closedAt: deviations.closedAt }).from(deviations).where(eq(deviations.id, id));
      if (d.closedAt) throw new ConflictException('Already closed');
      await tx.update(deviations).set({ closedAt: new Date(), closureNotes: input.notes }).where(eq(deviations.id, id));
      const updated = await this.documents.update(tx, auth, doc, {});
      await this.documents.log(tx, auth, updated, 'deviation.closed', meta, { notes: input.notes });
      return this.view(tx, auth, updated);
    });
  }

  private title(input: CreateDeviationInput) {
    return `${input.kind === 'planned' ? 'Planned' : 'Unplanned'} · ${input.category}: ${input.description}`.slice(0, 200);
  }

  private values(input: CreateDeviationInput) {
    const risk = riskOf(input.severity, input.occurrence, input.detection);
    return {
      kind: input.kind,
      category: input.category,
      description: input.description,
      itemId: input.itemId ?? null,
      batchNo: input.batchNo ? input.batchNo.toUpperCase() : null,
      workOrderId: input.workOrderId ?? null,
      impact: input.impact,
      severity: input.severity,
      occurrence: input.occurrence,
      detection: input.detection,
      rpn: risk.rpn,
      riskLevel: risk.level,
      productImpact: input.productImpact,
      proposedAction: input.proposedAction,
      validUntil: input.kind === 'planned' ? (input.validUntil ?? null) : null,
    };
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const manage = perms.has('quality.deviations.manage');
    const header = await this.documents.view(tx, auth, doc, { manage, cancel: manage });
    const [d] = await tx.select().from(deviations).where(eq(deviations.id, doc.id));
    const item = d.itemId ? (await tx.select({ id: items.id, code: items.code, name: items.name }).from(items).where(eq(items.id, d.itemId)))[0] : null;
    const ref = async (id: string | null) => (id ? ((await tx.select({ id: documents.id, number: documents.number, status: documents.status }).from(documents).where(eq(documents.id, id)))[0] ?? null) : null);
    const { tenantId: _t, id: _i, ...rest } = d;
    const expired = d.kind === 'planned' && !!d.validUntil && d.validUntil < todayIST() && !d.closedAt;
    return { ...header, ...rest, item: item ?? null, workOrder: await ref(d.workOrderId), capa: await ref(d.capaId), expired, canClose: manage && doc.status === 'approved' && !d.closedAt };
  }
}
