import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { documents, memberships, sopTrainees, sops, users, type Transaction } from '@nextgen/database';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { many } from '../../common/sql';

const DOC_TYPE = 'sop' as const;

const body = {
  sopCode: z.string().trim().min(2).max(40).transform((v) => v.toUpperCase()),
  title: z.string().trim().min(3).max(200),
  department: optionalText(80),
  purpose: optionalText(2000),
  body: optionalText(100_000),
  effectiveDate: z.iso.date().nullable().optional(),
  reviewDue: z.iso.date().nullable().optional(),
};
export const createSopSchema = z.object(body);
export type CreateSopInput = z.infer<typeof createSopSchema>;
export const updateSopSchema = z.object({ ...body, version: z.number().int() });
export const traineesSchema = z.object({ userIds: z.array(z.uuid()).max(500) });

/**
 * SOPs: versioned documents released through approval. Releasing a version supersedes the
 * previous one and carries its trainees over; each trainee acknowledges having read the
 * current version.
 */
@Injectable()
export class SopsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, { amendable: false, onApproved: (tx, _auth, doc) => this.release(tx, doc) });
  }

  list(auth: AuthContext, q: { current?: string; q?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, s.sop_code as "sopCode", s.sop_version as "sopVersion", s.title, s.department, s.effective_date::text as "effectiveDate", s.review_due::text as "reviewDue",
                   s.superseded_at as "supersededAt", d.status, d.number,
                   (select count(*)::int from sop_trainees t where t.sop_id = s.id) as trainees,
                   (select count(*)::int from sop_trainees t where t.sop_id = s.id and t.acknowledged_at is not null) as acknowledged,
                   (s.review_due is not null and s.review_due <= (now() at time zone 'Asia/Kolkata')::date + 30 and s.superseded_at is null and d.status = 'approved') as "reviewDueSoon"
            from sops s join documents d on d.id = s.id
            where d.status <> 'cancelled'
              ${q.current === 'true' ? sql`and d.status = 'approved' and s.superseded_at is null` : sql``}
              ${q.q ? sql`and (s.sop_code ilike ${`%${q.q}%`} or s.title ilike ${`%${q.q}%`})` : sql``}
            order by s.sop_code, s.sop_version desc`,
      ),
    );
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE)));
  }

  create(auth: AuthContext, input: CreateSopInput, meta: RequestMeta, previous: { id: string; version: number } | null = null) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta, previous));
  }

  private async createTx(tx: Transaction, auth: AuthContext, input: CreateSopInput, meta: RequestMeta, previous: { id: string; version: number } | null) {
    const version = previous ? previous.version + 1 : 1;
    if (!previous) {
      const [dup] = await tx.select({ id: sops.id }).from(sops).innerJoin(documents, eq(documents.id, sops.id)).where(and(sql`${sops.sopCode} = ${input.sopCode}`, ne(documents.status, 'cancelled')));
      if (dup) throw new ConflictException(`SOP ${input.sopCode} already exists: make a new version of it instead`);
    }
    const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, docDate: todayIST(), title: `${input.sopCode} v${version} ${input.title}`.slice(0, 200), amount: null });
    await tx.insert(sops).values({ id: doc.id, tenantId: auth.tenantId, ...input, effectiveDate: input.effectiveDate ?? null, reviewDue: input.reviewDue ?? null, sopVersion: version, previousId: previous?.id ?? null });
    await this.documents.log(tx, auth, doc, 'document.created', meta, { sopCode: input.sopCode, version });
    return this.view(tx, auth, doc);
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof updateSopSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const [cur] = await tx.select().from(sops).where(eq(sops.id, id));
      if (cur.sopCode !== input.sopCode) throw new BadRequestException('The SOP code cannot change');
      const { version: _v, ...values } = input;
      await tx.update(sops).set({ ...values, effectiveDate: values.effectiveDate ?? null, reviewDue: values.reviewDue ?? null }).where(eq(sops.id, id));
      const updated = await this.documents.update(tx, auth, doc, { title: `${input.sopCode} v${cur.sopVersion} ${input.title}`.slice(0, 200) });
      await this.documents.log(tx, auth, updated, 'document.updated', meta);
      return this.view(tx, auth, updated);
    });
  }

  remove(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => this.documents.deleteDraft(tx, auth, await this.documents.lock(tx, id, DOC_TYPE, version), meta));
  }

  submit(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      const [s] = await tx.select({ body: sops.body }).from(sops).where(eq(sops.id, id));
      const [{ files }] = await many<{ files: number }>(tx, sql`select count(*)::int as files from attachments where entity_id = ${id} and deleted_at is null`);
      if (!s.body && !files) throw new BadRequestException('Write the procedure or attach it before release');
      return this.view(tx, auth, await this.documents.submit(tx, auth, doc, meta));
    });
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.cancel(tx, auth, await this.documents.lock(tx, id, DOC_TYPE, version), reason, meta)));
  }

  /** A draft of the next version, copied from the released one. */
  newVersion(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select({ s: sops, status: documents.status }).from(sops).innerJoin(documents, eq(documents.id, sops.id)).where(eq(sops.id, id));
      if (!s) throw new NotFoundException('SOP not found');
      if (s.status !== 'approved' || s.s.supersededAt) throw new ConflictException('Revise the current released version');
      const [open] = await tx.select({ id: sops.id }).from(sops).innerJoin(documents, eq(documents.id, sops.id)).where(and(sql`${sops.sopCode} = ${s.s.sopCode}`, inArray(documents.status, ['draft', 'pending_approval'])));
      if (open) throw new ConflictException('A new version is already being prepared');
      return this.createTx(tx, auth, { sopCode: s.s.sopCode, title: s.s.title, department: s.s.department, purpose: s.s.purpose, body: s.s.body, effectiveDate: null, reviewDue: null }, meta, { id, version: s.s.sopVersion });
    });
  }

  /** Who must read this version (replaces the list; acknowledgements already given are kept). */
  setTrainees(auth: AuthContext, id: string, userIds: string[]) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.find(tx, id, DOC_TYPE);
      const members = userIds.length ? await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, auth.tenantId), inArray(memberships.userId, userIds))) : [];
      const valid = new Set(members.map((m) => m.userId));
      const unknown = userIds.filter((u) => !valid.has(u));
      if (unknown.length) throw new BadRequestException('Some people are not members of this workspace');
      await tx.delete(sopTrainees).where(and(eq(sopTrainees.sopId, id), userIds.length ? sql`${sopTrainees.userId} not in ${userIds}` : undefined));
      if (userIds.length) await tx.insert(sopTrainees).values(userIds.map((userId) => ({ tenantId: auth.tenantId, sopId: id, userId }))).onConflictDoNothing();
      return this.view(tx, auth, doc);
    });
  }

  /** The signed-in user confirms they have read and understood the released version. */
  acknowledge(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.find(tx, id, DOC_TYPE);
      const [s] = await tx.select({ supersededAt: sops.supersededAt }).from(sops).where(eq(sops.id, id));
      if (doc.status !== 'approved' || s.supersededAt) throw new ConflictException('Only the current released version can be acknowledged');
      const [t] = await tx.update(sopTrainees).set({ acknowledgedAt: new Date() }).where(and(eq(sopTrainees.sopId, id), eq(sopTrainees.userId, auth.userId), isNull(sopTrainees.acknowledgedAt))).returning();
      if (!t) {
        const [any] = await tx.select().from(sopTrainees).where(and(eq(sopTrainees.sopId, id), eq(sopTrainees.userId, auth.userId)));
        if (!any) throw new ForbiddenException('You are not on the training list of this SOP');
        throw new ConflictException('Already acknowledged');
      }
      return this.view(tx, auth, doc);
    });
  }

  /** Current SOPs the signed-in user still has to read. */
  pending(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, s.sop_code as "sopCode", s.sop_version as "sopVersion", s.title, s.effective_date::text as "effectiveDate"
            from sop_trainees t join sops s on s.id = t.sop_id join documents d on d.id = s.id
            where t.user_id = ${auth.userId} and t.acknowledged_at is null and d.status = 'approved' and s.superseded_at is null
            order by s.sop_code`,
      ),
    );
  }

  private async release(tx: Transaction, doc: DocumentRow) {
    const [s] = await tx.select().from(sops).where(eq(sops.id, doc.id));
    const now = new Date();
    await tx.update(sops).set({ effectiveDate: s.effectiveDate ?? todayIST() }).where(eq(sops.id, s.id));
    if (s.previousId) {
      await tx.update(sops).set({ supersededAt: now }).where(and(eq(sops.id, s.previousId), isNull(sops.supersededAt)));
      // Everyone trained on the old version must read the new one.
      const [{ n }] = await many<{ n: number }>(tx, sql`select count(*)::int as n from sop_trainees where sop_id = ${s.id}`);
      if (!n) await tx.execute(sql`insert into sop_trainees (tenant_id, sop_id, user_id) select tenant_id, ${s.id}, user_id from sop_trainees where sop_id = ${s.previousId} on conflict do nothing`);
    }
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const manage = perms.has('quality.sops.manage');
    const header = await this.documents.view(tx, auth, doc, { manage, cancel: manage });
    const [s] = await tx.select().from(sops).where(eq(sops.id, doc.id));
    const trainees = await tx.select({ userId: users.id, name: users.fullName, email: users.email, acknowledgedAt: sopTrainees.acknowledgedAt }).from(sopTrainees).innerJoin(users, eq(users.id, sopTrainees.userId)).where(eq(sopTrainees.sopId, doc.id)).orderBy(users.fullName);
    const versions = await many(tx, sql`select s.id, s.sop_version as "sopVersion", d.status, s.effective_date::text as "effectiveDate", s.superseded_at as "supersededAt" from sops s join documents d on d.id = s.id where s.sop_code = ${s.sopCode} order by s.sop_version desc`);
    const { tenantId: _t, id: _i, ...rest } = s;
    const current = doc.status === 'approved' && !s.supersededAt;
    const mine = trainees.find((t) => t.userId === auth.userId);
    return {
      ...header,
      ...rest,
      current,
      trainees,
      versions,
      canAcknowledge: current && !!mine && !mine.acknowledgedAt,
      canRevise: manage && current && !versions.some((v) => v.status === 'draft' || v.status === 'pending_approval'),
      canAssign: manage && doc.status !== 'cancelled' && !s.supersededAt,
    };
  }
}

