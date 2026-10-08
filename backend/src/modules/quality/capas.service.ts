import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { capaActions, capas, customerComplaints, documents, items, ncrs, parties, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';

const DOC_TYPE = 'capa' as const;
const FISHBONE = ['man', 'machine', 'method', 'material', 'measurement', 'environment'] as const;
const EIGHT_D = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'] as const;

const action = z.object({
  kind: z.enum(['containment', 'corrective', 'preventive']).default('corrective'),
  action: z.string().trim().min(3).max(1000),
  owner: optionalText(120),
  dueDate: z.iso.date().nullable().optional(),
});

const body = {
  kind: z.enum(['corrective', 'preventive']).default('corrective'),
  source: z.enum(['ncr', 'complaint', 'audit', 'internal', 'supplier']),
  ncrId: z.uuid().nullable().optional(),
  complaintId: z.uuid().nullable().optional(),
  itemId: z.uuid().nullable().optional(),
  isScar: z.boolean().default(false),
  partyId: z.uuid().nullable().optional(),
  responseDue: z.iso.date().nullable().optional(),
  problem: z.string().trim().min(3).max(4000),
  method: z.enum(['5why', 'fishbone', '8d']).default('5why'),
  whys: z.array(z.string().trim().max(500)).max(10).default([]),
  fishbone: z.partialRecord(z.enum(FISHBONE), z.array(z.string().trim().min(1).max(300)).max(20)).default({}),
  eightD: z.partialRecord(z.enum(EIGHT_D), z.string().trim().max(4000)).default({}),
  rootCause: optionalText(4000),
  effectivenessDue: z.iso.date().nullable().optional(),
  actions: z.array(action).max(50).default([]),
  docDate: z.iso.date().optional(),
};
export const createCapaSchema = z.object(body).superRefine((c, ctx) => {
  if (c.isScar && !c.partyId) ctx.addIssue({ code: 'custom', path: ['partyId'], message: 'A SCAR goes to a supplier: choose the vendor' });
  if (c.source === 'ncr' && !c.ncrId) ctx.addIssue({ code: 'custom', path: ['ncrId'], message: 'Link the NCR' });
  if (c.source === 'complaint' && !c.complaintId) ctx.addIssue({ code: 'custom', path: ['complaintId'], message: 'Link the complaint' });
});
export type CreateCapaInput = z.infer<typeof createCapaSchema>;
export const updateCapaSchema = z.object({ ...body, version: z.number().int() });
export const actionSchema = action;
export const actionUpdateSchema = z.object({ done: z.boolean(), notes: optionalText(1000) });
export const verifySchema = z.object({ version: z.number().int(), effective: z.boolean(), notes: z.string().trim().min(3, 'Say how effectiveness was checked').max(2000) });

/**
 * CAPA: problem, root cause (5-Why, fishbone or 8D) and actions. Approval accepts the plan;
 * actions are then completed and can still be added. When all are done the CAPA is verified:
 * effective closes it, not effective sends it back to open for more actions. A SCAR is a CAPA
 * the supplier must answer by a due date.
 */
@Injectable()
export class CapasService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      amendable: false,
      // Nothing left to do (e.g. a SCAR answered in full): straight to verification.
      onApproved: async (tx, _auth, doc) => {
        const [{ open }] = await tx.select({ open: sql<number>`count(*)::int` }).from(capaActions).where(and(eq(capaActions.capaId, doc.id), isNull(capaActions.doneOn)));
        if (!open) await tx.update(capas).set({ stage: 'verification' }).where(eq(capas.id, doc.id));
      },
    });
  }

  list(auth: AuthContext, q: { stage?: string; scar?: string; partyId?: string; q?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          title: documents.title,
          kind: capas.kind,
          source: capas.source,
          isScar: capas.isScar,
          stage: capas.stage,
          responseDue: capas.responseDue,
          effectivenessDue: capas.effectivenessDue,
          party: parties.name,
          openActions: sql<number>`(select count(*)::int from capa_actions a where a.capa_id = ${capas.id} and a.done_on is null)`,
          overdueActions: sql<number>`(select count(*)::int from capa_actions a where a.capa_id = ${capas.id} and a.done_on is null and a.due_date < (now() at time zone 'Asia/Kolkata')::date)`,
        })
        .from(documents)
        .innerJoin(capas, eq(capas.id, documents.id))
        .leftJoin(parties, eq(parties.id, capas.partyId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.stage ? eq(capas.stage, q.stage) : undefined,
            q.scar === 'true' ? eq(capas.isScar, true) : undefined,
            q.partyId ? eq(capas.partyId, q.partyId) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(documents.title, `%${term}%`)) : undefined,
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

  create(auth: AuthContext, input: CreateCapaInput, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta));
  }

  async createTx(tx: Transaction, auth: AuthContext, input: CreateCapaInput, meta: RequestMeta) {
    await this.check(tx, input);
    const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, docDate: input.docDate ?? todayIST(), title: this.title(input), amount: null });
    await tx.insert(capas).values({ id: doc.id, tenantId: auth.tenantId, ...this.values(input) });
    await this.writeActions(tx, auth, doc.id, input.actions);
    if (input.complaintId) await tx.update(customerComplaints).set({ capaId: doc.id }).where(and(eq(customerComplaints.id, input.complaintId), isNull(customerComplaints.capaId)));
    await this.documents.log(tx, auth, doc, 'document.created', meta, { source: input.source });
    return this.view(tx, auth, doc);
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof updateCapaSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      await this.check(tx, input);
      await tx.update(capas).set(this.values(input)).where(eq(capas.id, id));
      await tx.delete(capaActions).where(eq(capaActions.capaId, id));
      await this.writeActions(tx, auth, id, input.actions);
      const updated = await this.documents.update(tx, auth, doc, { title: this.title(input) });
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
      const [c] = await tx.select().from(capas).where(eq(capas.id, id));
      const acts = await tx.select({ id: capaActions.id }).from(capaActions).where(eq(capaActions.capaId, id));
      if (!c.rootCause && !c.isScar) throw new BadRequestException({ message: 'State the root cause before submitting', errors: [{ path: 'rootCause', message: 'Required' }] });
      if (!acts.length && !c.isScar) throw new BadRequestException({ message: 'Add at least one action', errors: [{ path: 'actions', message: 'Required' }] });
      return this.view(tx, auth, await this.documents.submit(tx, auth, doc, meta));
    });
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      return this.view(tx, auth, await this.documents.cancel(tx, auth, doc, reason, meta));
    });
  }

  /** More actions after approval (e.g. when a check found the fix was not effective). */
  addAction(auth: AuthContext, id: string, input: z.infer<typeof actionSchema>) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.find(tx, id, DOC_TYPE);
      const [c] = await tx.select({ stage: capas.stage }).from(capas).where(eq(capas.id, id));
      if (doc.status === 'cancelled' || c.stage === 'closed') throw new ConflictException('The CAPA is closed');
      await this.writeActions(tx, auth, id, [input]);
      if (c.stage === 'verification') await tx.update(capas).set({ stage: 'open' }).where(eq(capas.id, id));
      return this.view(tx, auth, doc);
    });
  }

  /** Marks an action done (or not). When the last one is done the CAPA waits for verification. */
  completeAction(auth: AuthContext, id: string, actionId: string, input: z.infer<typeof actionUpdateSchema>) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.find(tx, id, DOC_TYPE);
      if (doc.status !== 'approved') throw new ConflictException('Actions are carried out once the CAPA is approved');
      const [c] = await tx.select({ stage: capas.stage }).from(capas).where(eq(capas.id, id));
      if (c.stage === 'closed') throw new ConflictException('The CAPA is closed');
      const [a] = await tx.update(capaActions).set({ doneOn: input.done ? todayIST() : null, notes: input.notes }).where(and(eq(capaActions.id, actionId), eq(capaActions.capaId, id))).returning();
      if (!a) throw new NotFoundException('Action not found');
      const [{ open }] = await tx.select({ open: sql<number>`count(*)::int` }).from(capaActions).where(and(eq(capaActions.capaId, id), isNull(capaActions.doneOn)));
      await tx.update(capas).set({ stage: open ? 'open' : 'verification' }).where(eq(capas.id, id));
      return this.view(tx, auth, doc);
    });
  }

  /** Effectiveness check: closes the CAPA, or reopens it for more actions. */
  verify(auth: AuthContext, id: string, input: z.infer<typeof verifySchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      const [c] = await tx.select({ stage: capas.stage }).from(capas).where(eq(capas.id, id));
      if (doc.status !== 'approved' || c.stage !== 'verification') throw new ConflictException('Complete all actions before checking effectiveness');
      await tx
        .update(capas)
        .set({ effectivenessResult: input.effective ? 'effective' : 'not_effective', effectivenessNotes: input.notes, verifiedBy: auth.userId, stage: input.effective ? 'closed' : 'open', closedAt: input.effective ? new Date() : null })
        .where(eq(capas.id, id));
      const updated = await this.documents.update(tx, auth, doc, {});
      await this.documents.log(tx, auth, updated, input.effective ? 'capa.closed' : 'capa.reopened', meta, { notes: input.notes });
      return this.view(tx, auth, updated);
    });
  }

  private title(input: CreateCapaInput) {
    return `${input.isScar ? 'SCAR' : input.kind === 'preventive' ? 'PA' : 'CA'}: ${input.problem}`.slice(0, 200);
  }

  private values(input: CreateCapaInput) {
    return {
      kind: input.kind,
      source: input.source,
      ncrId: input.ncrId ?? null,
      complaintId: input.complaintId ?? null,
      itemId: input.itemId ?? null,
      isScar: input.isScar,
      partyId: input.partyId ?? null,
      responseDue: input.responseDue ?? null,
      problem: input.problem,
      method: input.method,
      whys: input.whys.filter((w) => w),
      fishbone: input.fishbone,
      eightD: input.eightD,
      rootCause: input.rootCause,
      effectivenessDue: input.effectivenessDue ?? null,
    };
  }

  private async check(tx: Transaction, input: CreateCapaInput) {
    if (input.ncrId) {
      const [n] = await tx.select({ id: ncrs.id }).from(ncrs).where(eq(ncrs.id, input.ncrId));
      if (!n) throw new BadRequestException({ message: 'NCR not found', errors: [{ path: 'ncrId', message: 'Not found' }] });
    }
    if (input.complaintId) {
      const [c] = await tx.select({ id: customerComplaints.id }).from(customerComplaints).where(eq(customerComplaints.id, input.complaintId));
      if (!c) throw new BadRequestException({ message: 'Complaint not found', errors: [{ path: 'complaintId', message: 'Not found' }] });
    }
  }

  private async writeActions(tx: Transaction, auth: AuthContext, capaId: string, actions: z.infer<typeof actionSchema>[]) {
    if (actions.length) await tx.insert(capaActions).values(actions.map((a) => ({ tenantId: auth.tenantId, capaId, kind: a.kind, action: a.action, owner: a.owner, dueDate: a.dueDate ?? null })));
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const manage = perms.has('quality.capa.manage');
    const header = await this.documents.view(tx, auth, doc, { manage, cancel: manage });
    const [c] = await tx.select().from(capas).where(eq(capas.id, doc.id));
    const acts = await tx.select().from(capaActions).where(eq(capaActions.capaId, doc.id)).orderBy(asc(capaActions.id));
    const party = c.partyId ? (await tx.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.id, c.partyId)))[0] : null;
    const item = c.itemId ? (await tx.select({ id: items.id, code: items.code, name: items.name }).from(items).where(eq(items.id, c.itemId)))[0] : null;
    const ref = async (id: string | null) => (id ? ((await tx.select({ id: documents.id, number: documents.number }).from(documents).where(eq(documents.id, id)))[0] ?? null) : null);
    const { tenantId: _t, id: _i, ...rest } = c;
    return {
      ...header,
      ...rest,
      party: party ?? null,
      item: item ?? null,
      ncr: await ref(c.ncrId),
      complaint: await ref(c.complaintId),
      actions: acts.map(({ tenantId: _at, capaId: _c, ...a }) => a),
      canAct: manage && doc.status === 'approved' && c.stage !== 'closed',
      canVerify: manage && doc.status === 'approved' && c.stage === 'verification',
    };
  }
}
