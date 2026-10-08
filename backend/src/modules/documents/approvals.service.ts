import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  approvalRules,
  approvalRuleSteps,
  branches,
  companies,
  DOC_TYPES,
  documentApprovals,
  documents,
  isDocType,
  membershipRoles,
  roles,
  type Transaction,
  users,
} from '@nextgen/database';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../billing/entitlements.service';
import type { ApprovalRuleInput } from './documents.schemas';

type DocumentRow = typeof documents.$inferSelect;

export interface ApprovalStepView {
  stepNo: number;
  name: string;
  status: 'waiting' | 'pending' | 'approved' | 'rejected' | 'skipped';
  approver: { roleId: string | null; roleName: string | null; userId: string | null; userName: string | null };
  actedBy: string | null;
  actedAt: Date | null;
  comment: string | null;
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  // ---- Workflow engine (inside document transactions) ---------------------------

  /** Finds the first active rule matching the document (type, scope, amount slab, condition). */
  async matchRule(tx: Transaction, doc: DocumentRow, facts: ApprovalFacts = {}) {
    const candidates = await tx
      .select()
      .from(approvalRules)
      .where(
        and(
          eq(approvalRules.docType, doc.docType),
          eq(approvalRules.isActive, true),
          or(isNull(approvalRules.companyId), eq(approvalRules.companyId, doc.companyId)),
          doc.branchId ? or(isNull(approvalRules.branchId), eq(approvalRules.branchId, doc.branchId)) : isNull(approvalRules.branchId),
        ),
      )
      .orderBy(asc(approvalRules.priority), asc(approvalRules.createdAt));
    const amount = Decimal.from(doc.amount ?? '0');
    return candidates.find(
      (r) =>
        (r.minAmount === null || amount.cmp(Decimal.from(r.minAmount)) >= 0) &&
        (r.maxAmount === null || amount.cmp(Decimal.from(r.maxAmount)) <= 0) &&
        conditionHolds(r.condition, r.conditionValue, facts),
    );
  }

  /**
   * Snapshots the matching rule's steps onto the document for a new round.
   * Returns false when no approval is required.
   */
  async start(tx: Transaction, auth: AuthContext, doc: DocumentRow, facts: ApprovalFacts = {}): Promise<{ required: boolean; round: number; ruleName?: string }> {
    const [last] = await tx
      .select({ round: sql<number>`coalesce(max(${documentApprovals.round}), 0)` })
      .from(documentApprovals)
      .where(eq(documentApprovals.documentId, doc.id));
    const round = Number(last?.round ?? 0) + 1;

    const rule = await this.matchRule(tx, doc, facts);
    if (!rule) return { required: false, round };
    const steps = await tx.select().from(approvalRuleSteps).where(eq(approvalRuleSteps.ruleId, rule.id)).orderBy(asc(approvalRuleSteps.stepNo));
    if (!steps.length) return { required: false, round };

    await tx.insert(documentApprovals).values(
      steps.map((s, i) => ({
        tenantId: auth.tenantId,
        documentId: doc.id,
        round,
        stepNo: s.stepNo,
        name: s.name,
        approverRoleId: s.approverRoleId,
        approverUserId: s.approverUserId,
        status: i === 0 ? ('pending' as const) : ('waiting' as const),
      })),
    );
    return { required: true, round, ruleName: rule.name };
  }

  /** The caller's pending step on this document, or null. Enforces segregation of duties. */
  async actionableStep(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    if (doc.status !== 'pending_approval') return null;
    const [step] = await tx
      .select()
      .from(documentApprovals)
      .where(and(eq(documentApprovals.documentId, doc.id), eq(documentApprovals.status, 'pending')))
      .orderBy(desc(documentApprovals.round))
      .limit(1);
    if (!step) return null;
    if (doc.submittedBy === auth.userId) return null;
    if (step.approverUserId) return step.approverUserId === auth.userId ? step : null;
    if (!step.approverRoleId) return null;
    const [held] = await tx
      .select({ roleId: membershipRoles.roleId })
      .from(membershipRoles)
      .where(and(eq(membershipRoles.membershipId, auth.membershipId), eq(membershipRoles.roleId, step.approverRoleId)));
    return held ? step : null;
  }

  /** Records a decision. Returns the document's new status. */
  async decide(
    tx: Transaction,
    auth: AuthContext,
    doc: DocumentRow,
    decision: 'approved' | 'rejected',
    comment: string | undefined,
  ): Promise<{ status: 'pending_approval' | 'approved' | 'rejected'; step: { stepNo: number; name: string }; nextStep: number | null }> {
    if (doc.status !== 'pending_approval') throw new ConflictException('This document is not awaiting approval');
    const step = await this.actionableStep(tx, auth, doc);
    if (!step) {
      throw new ForbiddenException(
        doc.submittedBy === auth.userId
          ? 'You submitted this document, so someone else must approve it'
          : 'You are not an approver for the current level',
      );
    }
    const now = new Date();
    await tx
      .update(documentApprovals)
      .set({ status: decision, actedBy: auth.userId, actedAt: now, comment: comment ?? null })
      .where(eq(documentApprovals.id, step.id));

    if (decision === 'rejected') {
      await tx
        .update(documentApprovals)
        .set({ status: 'skipped' })
        .where(and(eq(documentApprovals.documentId, doc.id), eq(documentApprovals.round, step.round), eq(documentApprovals.status, 'waiting')));
      return { status: 'rejected', step, nextStep: null };
    }

    const [next] = await tx
      .select()
      .from(documentApprovals)
      .where(and(eq(documentApprovals.documentId, doc.id), eq(documentApprovals.round, step.round), eq(documentApprovals.status, 'waiting')))
      .orderBy(asc(documentApprovals.stepNo))
      .limit(1);
    if (next) {
      await tx.update(documentApprovals).set({ status: 'pending' }).where(eq(documentApprovals.id, next.id));
      return { status: 'pending_approval', step, nextStep: next.stepNo };
    }
    return { status: 'approved', step, nextStep: null };
  }

  /** Marks open steps as skipped (cancel / amend). */
  async closeOpen(tx: Transaction, documentId: string) {
    await tx
      .update(documentApprovals)
      .set({ status: 'skipped' })
      .where(and(eq(documentApprovals.documentId, documentId), inArray(documentApprovals.status, ['pending', 'waiting'])));
  }

  /** Steps of the latest round, with approver names. */
  async latestRound(tx: Transaction, documentId: string): Promise<ApprovalStepView[]> {
    const rows = await tx
      .select({
        round: documentApprovals.round,
        stepNo: documentApprovals.stepNo,
        name: documentApprovals.name,
        status: documentApprovals.status,
        roleId: documentApprovals.approverRoleId,
        roleName: roles.name,
        userId: documentApprovals.approverUserId,
        actedBy: documentApprovals.actedBy,
        actedAt: documentApprovals.actedAt,
        comment: documentApprovals.comment,
      })
      .from(documentApprovals)
      .leftJoin(roles, eq(roles.id, documentApprovals.approverRoleId))
      .where(eq(documentApprovals.documentId, documentId))
      .orderBy(desc(documentApprovals.round), asc(documentApprovals.stepNo));
    if (!rows.length) return [];
    const round = rows[0].round;
    const latest = rows.filter((r) => r.round === round);
    const userIds = [...new Set(latest.flatMap((r) => [r.userId, r.actedBy]).filter(Boolean) as string[])];
    const names = userIds.length
      ? new Map((await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.name]))
      : new Map<string, string>();
    return latest.map((r) => ({
      stepNo: r.stepNo,
      name: r.name,
      status: r.status,
      approver: { roleId: r.roleId, roleName: r.roleName, userId: r.userId, userName: r.userId ? (names.get(r.userId) ?? null) : null },
      actedBy: r.actedBy ? (names.get(r.actedBy) ?? 'Former user') : null,
      actedAt: r.actedAt,
      comment: r.comment,
    }));
  }

  /** Documents waiting for the caller's decision. */
  inbox(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const myRoles = (
        await tx.select({ roleId: membershipRoles.roleId }).from(membershipRoles).where(eq(membershipRoles.membershipId, auth.membershipId))
      ).map((r) => r.roleId);
      const rows = await tx
        .select({
          documentId: documents.id,
          version: documents.version,
          docType: documents.docType,
          number: documents.number,
          title: documents.title,
          amount: documents.amount,
          currency: documents.currency,
          docDate: documents.docDate,
          submittedAt: documents.submittedAt,
          submittedBy: users.fullName,
          stepNo: documentApprovals.stepNo,
          stepName: documentApprovals.name,
        })
        .from(documentApprovals)
        .innerJoin(documents, eq(documents.id, documentApprovals.documentId))
        .leftJoin(users, eq(users.id, documents.submittedBy))
        .where(
          and(
            eq(documentApprovals.status, 'pending'),
            eq(documents.status, 'pending_approval'),
            ne(documents.submittedBy, auth.userId),
            or(
              eq(documentApprovals.approverUserId, auth.userId),
              myRoles.length ? inArray(documentApprovals.approverRoleId, myRoles) : sql`false`,
            ),
          ),
        )
        .orderBy(asc(documents.submittedAt));
      return rows.map((r) => ({
        ...r,
        docTypeLabel: isDocType(r.docType) ? DOC_TYPES[r.docType].label : r.docType,
        path: isDocType(r.docType) ? `${DOC_TYPES[r.docType].path}/${r.documentId}` : null,
      }));
    });
  }

  // ---- Rule administration ------------------------------------------------------

  listRules(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rules = await tx
        .select({ rule: approvalRules, companyName: companies.name, branchName: branches.name })
        .from(approvalRules)
        .leftJoin(companies, eq(companies.id, approvalRules.companyId))
        .leftJoin(branches, eq(branches.id, approvalRules.branchId))
        .orderBy(asc(approvalRules.docType), asc(approvalRules.priority), asc(approvalRules.name));
      const ids = rules.map((r) => r.rule.id);
      const steps = ids.length
        ? await tx
            .select({ step: approvalRuleSteps, roleName: roles.name, userName: users.fullName })
            .from(approvalRuleSteps)
            .leftJoin(roles, eq(roles.id, approvalRuleSteps.approverRoleId))
            .leftJoin(users, eq(users.id, approvalRuleSteps.approverUserId))
            .where(inArray(approvalRuleSteps.ruleId, ids))
            .orderBy(asc(approvalRuleSteps.stepNo))
        : [];
      return rules.map(({ rule, companyName, branchName }) => ({
        ...rule,
        docTypeLabel: isDocType(rule.docType) ? DOC_TYPES[rule.docType].label : rule.docType,
        companyName,
        branchName,
        steps: steps
          .filter((s) => s.step.ruleId === rule.id)
          .map((s) => ({
            stepNo: s.step.stepNo,
            name: s.step.name,
            approverRoleId: s.step.approverRoleId,
            approverUserId: s.step.approverUserId,
            approverLabel: s.roleName ? `Any ${s.roleName}` : (s.userName ?? 'Unknown'),
          })),
      }));
    });
  }

  async saveRule(auth: AuthContext, id: string | null, input: ApprovalRuleInput, meta: RequestMeta) {
    if (input.steps.length > 1) await this.entitlements.assertFeature(auth.tenantId, 'multi_level_approvals');
    return this.database.run(auth, async (tx) => {
      const { steps, ...rule } = input;
      const values = {
        ...rule,
        companyId: rule.companyId ?? null,
        branchId: rule.branchId ?? null,
        minAmount: rule.minAmount ?? null,
        maxAmount: rule.maxAmount ?? null,
        condition: rule.condition ?? null,
        conditionValue: rule.condition && rule.condition !== 'credit_exceeded' ? (rule.conditionValue ?? null) : null,
      };
      let ruleId = id;
      if (id) {
        const [existing] = await tx.select({ id: approvalRules.id, version: approvalRules.version }).from(approvalRules).where(eq(approvalRules.id, id));
        if (!existing) throw new NotFoundException('Approval rule not found');
        await tx
          .update(approvalRules)
          .set({ ...values, updatedBy: auth.userId, version: existing.version + 1 })
          .where(eq(approvalRules.id, id));
        await tx.delete(approvalRuleSteps).where(eq(approvalRuleSteps.ruleId, id));
      } else {
        const [row] = await tx
          .insert(approvalRules)
          .values({ ...values, tenantId: auth.tenantId, createdBy: auth.userId, updatedBy: auth.userId })
          .returning({ id: approvalRules.id });
        ruleId = row.id;
      }
      await tx.insert(approvalRuleSteps).values(
        steps.map((s, i) => ({
          tenantId: auth.tenantId,
          ruleId: ruleId!,
          stepNo: i + 1,
          name: s.name,
          approverRoleId: s.approverRoleId ?? null,
          approverUserId: s.approverUserId ?? null,
        })),
      );
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: id ? 'platform.approval_rule.updated' : 'platform.approval_rule.created',
        entityType: 'approval_rule',
        entityId: ruleId,
        metadata: { ...values, steps },
        ...meta,
      });
      return { id: ruleId };
    });
  }

  async deleteRule(auth: AuthContext, id: string, meta: RequestMeta) {
    await this.database.run(auth, async (tx) => {
      const [row] = await tx.delete(approvalRules).where(eq(approvalRules.id, id)).returning({ name: approvalRules.name });
      if (!row) throw new NotFoundException('Approval rule not found');
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'platform.approval_rule.deleted',
        entityType: 'approval_rule',
        entityId: id,
        metadata: { name: row.name },
        ...meta,
      });
    });
  }
}


/** Facts a module supplies at submission for rule conditions. */
export interface ApprovalFacts {
  /** Largest discount below list price on any line, %. */
  maxDiscountPct?: string | null;
  /** Gross margin of the document, %. */
  marginPct?: string | null;
  /** Customer credit limit exceeded or overdue invoices outstanding. */
  creditExceeded?: boolean;
}

/** A rule without a condition always applies; one with a condition applies only when the fact is present and met. */
function conditionHolds(condition: string | null, value: string | null, facts: ApprovalFacts) {
  if (!condition) return true;
  switch (condition) {
    case 'discount_above':
      return facts.maxDiscountPct !== undefined && facts.maxDiscountPct !== null && Decimal.from(facts.maxDiscountPct).cmp(Decimal.from(value ?? '0')) > 0;
    case 'margin_below':
      return facts.marginPct !== undefined && facts.marginPct !== null && Decimal.from(facts.marginPct).cmp(Decimal.from(value ?? '0')) < 0;
    case 'credit_exceeded':
      return facts.creditExceeded === true;
    default:
      return false;
  }
}
