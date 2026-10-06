import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  branches,
  companies,
  DOC_TYPES,
  documentActivity,
  documentApprovals,
  documentRevisions,
  documents,
  isDocType,
  type DocType,
  type Transaction,
  users,
} from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { WebhooksService, type WebhookEvent } from '../integrations/webhooks.service';
import { NotificationsService, type Recipient } from '../notifications/notifications.service';
import { ApprovalsService, type ApprovalStepView } from './approvals.service';
import { NumberingService } from './numbering.service';

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentStatus = DocumentRow['status'];

export interface DocumentCapabilities {
  edit: boolean;
  delete: boolean;
  submit: boolean;
  approve: boolean;
  reject: boolean;
  cancel: boolean;
  amend: boolean;
}

/** Header + workflow state returned with every document. */
export interface DocumentView {
  id: string;
  docType: string;
  docTypeLabel: string;
  number: string | null;
  displayNumber: string;
  fiscalYear: string | null;
  docDate: string;
  status: DocumentStatus;
  revision: number;
  title: string | null;
  amount: string | null;
  currency: string;
  company: { id: string; name: string };
  branch: { id: string; code: string; name: string } | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  version: number;
  customFields: Record<string, unknown>;
  approvals: ApprovalStepView[];
  can: DocumentCapabilities;
}

export interface ModulePermissions {
  manage: boolean;
  cancel: boolean;
}

const EDITABLE: DocumentStatus[] = ['draft', 'rejected'];

/** Side effects a module attaches to its document type (stock / ledger posting). */
export interface DocumentHooks {
  /** Runs in the same transaction when the document becomes approved. Throwing aborts the approval. */
  onApproved?: (tx: Transaction, auth: AuthContext, doc: DocumentRow) => Promise<void>;
  /** Runs when an approved document is cancelled: undo whatever onApproved posted. */
  onCancelled?: (tx: Transaction, auth: AuthContext, doc: DocumentRow) => Promise<void>;
  /** Runs when an approved document goes back to draft for amendment. */
  onAmended?: (tx: Transaction, auth: AuthContext, doc: DocumentRow) => Promise<void>;
  /** Posted documents that move stock/money are cancelled and re-created, not amended. */
  amendable?: boolean;
}

@Injectable()
export class DocumentsService {
  private readonly hooks = new Map<string, DocumentHooks>();

  constructor(
    private readonly database: DatabaseService,
    private readonly numbering: NumberingService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  registerHooks(docType: DocType, hooks: DocumentHooks) {
    this.hooks.set(docType, hooks);
  }

  // ---- Lifecycle (call inside the module's transaction) ---------------------------

  async create(
    tx: Transaction,
    auth: AuthContext,
    input: {
      docType: DocType;
      companyId?: string;
      branchId?: string | null;
      docDate: string;
      title: string | null;
      amount: string | null;
      customFields?: Record<string, unknown>;
    },
  ): Promise<DocumentRow> {
    const { companyId, branchId } = await this.resolveScope(tx, input.companyId, input.branchId);
    const [doc] = await tx
      .insert(documents)
      .values({
        tenantId: auth.tenantId,
        companyId,
        branchId,
        docType: input.docType,
        docDate: input.docDate,
        title: input.title,
        amount: input.amount,
        customFields: input.customFields ?? {},
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })
      .returning();
    await this.activity(tx, auth, doc.id, 'created', 'Created the draft');
    return doc;
  }

  /** Reads a document of the given type without locking. */
  async find(tx: Transaction, id: string, docType: DocType): Promise<DocumentRow> {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.docType, docType)));
    if (!doc) throw new NotFoundException(`${DOC_TYPES[docType].label} not found`);
    return doc;
  }

  /** Locks the row (SELECT … FOR UPDATE) and checks type + optimistic version. */
  async lock(tx: Transaction, id: string, docType: DocType, expectedVersion?: number): Promise<DocumentRow> {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.docType, docType))).for('update');
    if (!doc) throw new NotFoundException(`${DOC_TYPES[docType].label} not found`);
    if (expectedVersion !== undefined && expectedVersion !== doc.version) {
      throw new ConflictException('This document was changed by someone else. Reload to see the latest version.');
    }
    return doc;
  }

  assertEditable(doc: DocumentRow) {
    if (!EDITABLE.includes(doc.status)) throw new ConflictException(`A document that is ${label(doc.status)} can't be edited`);
  }

  /** Applies header changes and bumps the version. */
  async update(tx: Transaction, auth: AuthContext, doc: DocumentRow, patch: Partial<Omit<DocumentRow, 'id' | 'tenantId' | 'version'>>) {
    if (patch.companyId || patch.branchId !== undefined) {
      const scope = await this.resolveScope(tx, patch.companyId ?? doc.companyId, patch.branchId ?? doc.branchId);
      patch = { ...patch, ...scope };
    }
    const [row] = await tx
      .update(documents)
      .set({ ...patch, updatedBy: auth.userId, version: doc.version + 1 })
      .where(and(eq(documents.id, doc.id), eq(documents.version, doc.version)))
      .returning();
    if (!row) throw new ConflictException('This document was changed by someone else. Reload to see the latest version.');
    return row;
  }

  async submit(tx: Transaction, auth: AuthContext, doc: DocumentRow, meta: RequestMeta): Promise<DocumentRow> {
    this.assertEditable(doc);
    if (!isDocType(doc.docType)) throw new BadRequestException('Unknown document type');
    let { number, fiscalYear, seriesId } = doc;
    if (!number) {
      const allocation = await this.numbering.allocate(tx, auth, { docType: doc.docType, companyId: doc.companyId, branchId: doc.branchId, docDate: doc.docDate });
      ({ number, fiscalYear, seriesId } = allocation);
    }
    const withNumber = { ...doc, number, fiscalYear, seriesId };
    const flow = await this.approvals.start(tx, auth, withNumber);
    const now = new Date();
    const updated = await this.update(tx, auth, doc, {
      number,
      fiscalYear,
      seriesId,
      status: flow.required ? 'pending_approval' : 'approved',
      currentStep: flow.required ? 1 : null,
      submittedAt: now,
      submittedBy: auth.userId,
      approvedAt: flow.required ? null : now,
    });
    if (!flow.required) await this.hooks.get(doc.docType)?.onApproved?.(tx, auth, updated);
    await this.activity(
      tx,
      auth,
      doc.id,
      'submitted',
      flow.required ? `Submitted for approval (${flow.ruleName})` : 'Submitted. No approval required, so it was approved automatically.',
      { number, round: flow.round },
    );
    await this.log(tx, auth, updated, 'document.submitted', meta, { number, approvalRequired: flow.required });
    if (flow.required) await this.notifyPendingApprovers(tx, auth, updated);
    await this.emitWebhook(tx, auth, updated, 'document.submitted');
    if (!flow.required) await this.emitWebhook(tx, auth, updated, 'document.approved');
    return updated;
  }

  async decide(tx: Transaction, auth: AuthContext, doc: DocumentRow, decision: 'approved' | 'rejected', comment: string | undefined, meta: RequestMeta) {
    const result = await this.approvals.decide(tx, auth, doc, decision, comment);
    const now = new Date();
    const updated = await this.update(tx, auth, doc, {
      status: result.status,
      currentStep: result.nextStep,
      approvedAt: result.status === 'approved' ? now : null,
    });
    if (result.status === 'approved') await this.hooks.get(doc.docType)?.onApproved?.(tx, auth, updated);
    const verb = decision === 'approved' ? 'Approved' : 'Rejected';
    await this.activity(tx, auth, doc.id, decision === 'approved' ? 'approved' : 'rejected', `${verb} level ${result.step.stepNo}: ${result.step.name}`, {
      comment: comment ?? null,
      stepNo: result.step.stepNo,
    });
    if (result.status === 'approved') await this.activity(tx, auth, doc.id, 'status', 'Fully approved');
    await this.log(tx, auth, updated, decision === 'approved' ? 'document.approved' : 'document.rejected', meta, {
      stepNo: result.step.stepNo,
      comment: comment ?? null,
    });
    if (result.status !== 'pending_approval') await this.emitWebhook(tx, auth, updated, result.status === 'approved' ? 'document.approved' : 'document.rejected');
    if (result.status === 'pending_approval') {
      await this.notifyPendingApprovers(tx, auth, updated);
    } else if (updated.submittedBy) {
      const event = result.status === 'approved' ? 'document.approved' : 'document.rejected';
      await this.notifications.notify(tx, auth.tenantId, event, [{ userId: updated.submittedBy }], await this.messageData(tx, auth, updated, { comment }));
    }
    return updated;
  }

  async cancel(tx: Transaction, auth: AuthContext, doc: DocumentRow, reason: string, meta: RequestMeta) {
    if (!doc.number) throw new ConflictException('Drafts are deleted, not cancelled');
    if (!['pending_approval', 'approved', 'rejected'].includes(doc.status)) {
      throw new ConflictException(`A document that is ${label(doc.status)} can't be cancelled`);
    }
    await this.approvals.closeOpen(tx, doc.id);
    const updated = await this.update(tx, auth, doc, { status: 'cancelled', currentStep: null, cancelledAt: new Date(), cancelReason: reason });
    if (doc.status === 'approved') await this.hooks.get(doc.docType)?.onCancelled?.(tx, auth, updated);
    await this.activity(tx, auth, doc.id, 'cancelled', 'Cancelled', { reason });
    await this.log(tx, auth, updated, 'document.cancelled', meta, { reason });
    await this.emitWebhook(tx, auth, updated, 'document.cancelled');
    return updated;
  }

  /** Approved → new draft revision. The previous state is kept as a snapshot. */
  async amend(tx: Transaction, auth: AuthContext, doc: DocumentRow, snapshot: Record<string, unknown>, reason: string, meta: RequestMeta) {
    if (doc.status !== 'approved') throw new ConflictException('Only approved documents can be amended');
    if (this.hooks.get(doc.docType)?.amendable === false) {
      throw new ConflictException('Posted documents can’t be amended. Cancel it and create a new one.');
    }
    await tx.insert(documentRevisions).values({
      tenantId: auth.tenantId,
      documentId: doc.id,
      revision: doc.revision,
      snapshot,
      reason,
      createdBy: auth.userId,
    });
    const updated = await this.update(tx, auth, doc, { status: 'draft', revision: doc.revision + 1, approvedAt: null, currentStep: null });
    await this.hooks.get(doc.docType)?.onAmended?.(tx, auth, updated);
    await this.activity(tx, auth, doc.id, 'amended', `Amendment started (revision ${doc.revision + 1})`, { reason, previousRevision: doc.revision });
    await this.log(tx, auth, updated, 'document.amended', meta, { reason, revision: doc.revision + 1 });
    return updated;
  }

  async deleteDraft(tx: Transaction, auth: AuthContext, doc: DocumentRow, meta: RequestMeta) {
    if (doc.status !== 'draft' || doc.number) {
      throw new ConflictException('Only drafts that were never submitted can be deleted. Cancel it instead.');
    }
    await this.log(tx, auth, doc, 'document.deleted', meta, { title: doc.title });
    await tx.delete(documents).where(eq(documents.id, doc.id));
  }

  /** Approve / reject any document type by id (generic endpoint). */
  decideById(auth: AuthContext, id: string, decision: 'approved' | 'rejected', version: number, comment: string | undefined, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const found = await this.getForReader(tx, auth, id);
      const doc = await this.lock(tx, id, found.docType as DocType, version);
      const updated = await this.decide(tx, auth, doc, decision, comment, meta);
      return { id: updated.id, status: updated.status, version: updated.version };
    });
  }

  // ---- Read model ------------------------------------------------------------------

  async view(tx: Transaction, auth: AuthContext, doc: DocumentRow, perms: ModulePermissions): Promise<DocumentView> {
    const [scope] = await tx
      .select({ companyName: companies.name, branchCode: branches.code, branchName: branches.name })
      .from(companies)
      .leftJoin(branches, eq(branches.id, sql`${doc.branchId}::uuid`))
      .where(eq(companies.id, doc.companyId));
    const [creator] = doc.createdBy ? await tx.select({ name: users.fullName }).from(users).where(eq(users.id, doc.createdBy)) : [];
    const approvals = await this.approvals.latestRound(tx, doc.id);
    const step = await this.approvals.actionableStep(tx, auth, doc);
    const editable = EDITABLE.includes(doc.status);
    const def = isDocType(doc.docType) ? DOC_TYPES[doc.docType] : null;

    return {
      id: doc.id,
      docType: doc.docType,
      docTypeLabel: def?.label ?? doc.docType,
      number: doc.number,
      displayNumber: doc.number ? `${doc.number}${doc.revision ? ` (Rev ${doc.revision})` : ''}` : `Draft ${def?.code ?? ''}`.trim(),
      fiscalYear: doc.fiscalYear,
      docDate: doc.docDate,
      status: doc.status,
      revision: doc.revision,
      title: doc.title,
      amount: doc.amount,
      currency: doc.currency,
      company: { id: doc.companyId, name: scope?.companyName ?? '' },
      branch: doc.branchId && scope?.branchCode ? { id: doc.branchId, code: scope.branchCode, name: scope.branchName ?? '' } : null,
      submittedAt: doc.submittedAt,
      approvedAt: doc.approvedAt,
      cancelledAt: doc.cancelledAt,
      cancelReason: doc.cancelReason,
      createdAt: doc.createdAt,
      createdBy: creator?.name ?? null,
      updatedAt: doc.updatedAt,
      version: doc.version,
      customFields: doc.customFields ?? {},
      approvals,
      can: {
        edit: perms.manage && editable,
        delete: perms.manage && doc.status === 'draft' && !doc.number,
        submit: perms.manage && editable,
        approve: !!step,
        reject: !!step,
        cancel: perms.cancel && !!doc.number && ['pending_approval', 'approved', 'rejected'].includes(doc.status),
        amend: perms.cancel && doc.status === 'approved' && this.hooks.get(doc.docType)?.amendable !== false,
      },
    };
  }

  /** Loads a document of any type and checks the caller may read it. */
  async getForReader(tx: Transaction, auth: AuthContext, id: string): Promise<DocumentRow> {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, id));
    if (!doc || !isDocType(doc.docType)) throw new NotFoundException('Document not found');
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    auth.permissions = perms;
    if (!perms.has(DOC_TYPES[doc.docType].readPermission)) throw new ForbiddenException("You don't have access to this document");
    return doc;
  }

  // ---- Activity & comments -----------------------------------------------------------

  async activity(tx: Transaction, auth: AuthContext, documentId: string, kind: string, message: string, data?: Record<string, unknown>) {
    await tx.insert(documentActivity).values({ tenantId: auth.tenantId, documentId, kind, actorUserId: auth.userId, message, data });
  }

  listActivity(auth: AuthContext, documentId: string) {
    return this.database.run(auth, async (tx) => {
      await this.getForReader(tx, auth, documentId);
      return tx
        .select({
          id: documentActivity.id,
          kind: documentActivity.kind,
          message: documentActivity.message,
          data: documentActivity.data,
          createdAt: documentActivity.createdAt,
          actor: { id: documentActivity.actorUserId, name: users.fullName },
        })
        .from(documentActivity)
        .leftJoin(users, eq(users.id, documentActivity.actorUserId))
        .where(eq(documentActivity.documentId, documentId))
        .orderBy(desc(documentActivity.createdAt), desc(documentActivity.id));
    });
  }

  addComment(auth: AuthContext, documentId: string, message: string) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.getForReader(tx, auth, documentId);
      await this.activity(tx, auth, documentId, 'comment', message);
      const watchers = [...new Set([doc.createdBy, doc.submittedBy].filter((u): u is string => !!u && u !== auth.userId))];
      if (watchers.length && doc.number) {
        const data = await this.messageData(tx, auth, doc, { comment: message });
        await this.notifications.notify(tx, auth.tenantId, 'document.commented', watchers.map((userId) => ({ userId })), data);
      }
      return { ok: true };
    });
  }

  listRevisions(auth: AuthContext, documentId: string) {
    return this.database.run(auth, async (tx) => {
      await this.getForReader(tx, auth, documentId);
      return tx
        .select({
          revision: documentRevisions.revision,
          reason: documentRevisions.reason,
          createdAt: documentRevisions.createdAt,
          createdBy: users.fullName,
          snapshot: documentRevisions.snapshot,
        })
        .from(documentRevisions)
        .leftJoin(users, eq(users.id, documentRevisions.createdBy))
        .where(eq(documentRevisions.documentId, documentId))
        .orderBy(desc(documentRevisions.revision));
    });
  }

  /** Number / title search across the document types the caller can read. */
  search(auth: AuthContext, q: { q?: string; docType?: string; status?: string; limit: number }) {
    return this.database.run(auth, async (tx) => {
      const perms = await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId);
      const readable = Object.entries(DOC_TYPES)
        .filter(([, d]) => perms.has(d.readPermission))
        .map(([k]) => k);
      const types = q.docType ? readable.filter((t) => t === q.docType) : readable;
      if (!types.length) return [];
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({
          id: documents.id,
          docType: documents.docType,
          number: documents.number,
          title: documents.title,
          status: documents.status,
          docDate: documents.docDate,
          amount: documents.amount,
        })
        .from(documents)
        .where(
          and(
            inArray(documents.docType, types),
            q.status ? eq(documents.status, q.status as DocumentStatus) : undefined,
            term ? sql`(${ilike(documents.number, `%${term}%`)} or ${ilike(documents.title, `%${term}%`)})` : undefined,
          ),
        )
        .orderBy(desc(documents.createdAt))
        .limit(q.limit);
      return rows.map((r) => ({
        ...r,
        docTypeLabel: isDocType(r.docType) ? DOC_TYPES[r.docType].label : r.docType,
        path: isDocType(r.docType) ? `${DOC_TYPES[r.docType].path}/${r.id}` : null,
      }));
    });
  }

  // ---- helpers -----------------------------------------------------------------------

  private async emitWebhook(tx: Transaction, auth: AuthContext, doc: DocumentRow, event: WebhookEvent) {
    await this.webhooks.emit(tx, auth.tenantId, event, {
      id: doc.id,
      docType: doc.docType,
      number: doc.number,
      status: doc.status,
      revision: doc.revision,
      title: doc.title,
      amount: doc.amount,
      currency: doc.currency,
      docDate: doc.docDate,
    });
  }

  /** Notifies everyone who can act on the document's current pending level (never the submitter). */
  private async notifyPendingApprovers(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [step] = await tx
      .select()
      .from(documentApprovals)
      .where(and(eq(documentApprovals.documentId, doc.id), eq(documentApprovals.status, 'pending')))
      .orderBy(desc(documentApprovals.round))
      .limit(1);
    if (!step) return;
    const userIds = step.approverUserId
      ? [step.approverUserId]
      : step.approverRoleId
        ? await this.notifications.usersWithRole(tx, step.approverRoleId)
        : [];
    const recipients: Recipient[] = userIds.filter((u) => u !== doc.submittedBy).map((userId) => ({ userId }));
    if (!recipients.length) return;
    const data = await this.messageData(tx, auth, doc, { stepName: step.name });
    await this.notifications.notify(tx, auth.tenantId, 'document.approval_requested', recipients, data);
  }

  private async messageData(tx: Transaction, auth: AuthContext, doc: DocumentRow, extra: { stepName?: string; comment?: string }) {
    const [actor] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, auth.userId));
    const def = isDocType(doc.docType) ? DOC_TYPES[doc.docType] : null;
    return {
      docTypeLabel: def?.label ?? doc.docType,
      number: doc.number ?? 'Draft',
      title: doc.title ?? '',
      amount: doc.amount ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: doc.currency }).format(Number(doc.amount)) : '',
      actorName: actor?.name ?? 'Someone',
      link: def ? `${def.path}/${doc.id}` : '/',
      ...(extra.stepName ? { stepName: extra.stepName } : {}),
      ...(extra.comment ? { comment: extra.comment } : {}),
    };
  }

  /** Defaults to the oldest company and its head-office (or first) branch. */
  private async resolveScope(tx: Transaction, companyId?: string, branchId?: string | null) {
    let company = companyId;
    if (!company) {
      const [first] = await tx.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
      if (!first) throw new BadRequestException('Create a company first');
      company = first.id;
    } else {
      const [exists] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, company));
      if (!exists) throw new BadRequestException('Unknown company');
    }
    let branch = branchId ?? null;
    if (branch) {
      const [b] = await tx.select({ companyId: branches.companyId }).from(branches).where(eq(branches.id, branch));
      if (!b || b.companyId !== company) throw new BadRequestException('Branch does not belong to the company');
    } else if (branchId === undefined) {
      const [b] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.companyId, company), eq(branches.isActive, true), isNull(branches.deletedAt)))
        .orderBy(sql`case when ${branches.code} = 'HO' then 0 else 1 end`, asc(branches.createdAt))
        .limit(1);
      branch = b?.id ?? null;
    }
    return { companyId: company, branchId: branch };
  }

  async log(tx: Transaction, auth: AuthContext, doc: DocumentRow, action: string, meta: RequestMeta, metadata?: Record<string, unknown>) {
    await this.audit.log(tx, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action,
      entityType: doc.docType,
      entityId: doc.id,
      metadata: { number: doc.number, status: doc.status, ...metadata },
      ...meta,
    });
  }
}

function label(status: DocumentStatus) {
  return status.replace('_', ' ');
}
