import { Injectable } from '@nestjs/common';
import { aiEvalRuns, aiModelChanges, aiSettings, users } from '@nextgen/database';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { AiGateway } from './ai-gateway.service';
import { EVAL_SUITES, type EvalSuite } from './evals';
import { AI_FEATURE_CODES, AI_FEATURES, MODEL_FEATURES, monthStartIST, PLAN_AI_BUDGET_INR, priceOf, USD_INR } from './policy';
import { many } from '../../common/sql';

export const policySchema = z.object({
  features: z.partialRecord(z.enum(AI_FEATURE_CODES as [string, ...string[]]), z.boolean()).optional(),
  maskPii: z.boolean().optional(),
  monthlyBudgetInr: z.number().min(0).max(10_000_000).nullable().optional(),
  /** true records consent (by the caller, now); false withdraws it. */
  externalConsent: z.boolean().optional(),
});
export const modelSchema = z.object({
  feature: z.enum(MODEL_FEATURES as [string, ...string[]]),
  model: z
    .string()
    .trim()
    .regex(/^claude-[a-z0-9.-]{2,60}$/, 'Use a Claude model id, e.g. claude-sonnet-5-5'),
  note: z.string().trim().max(300).optional(),
});

/** AI governance: the workspace policy, model registry, usage and cost, and evaluation runs. */
@Injectable()
export class AiGovService {
  constructor(
    private readonly database: DatabaseService,
    private readonly gateway: AiGateway,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  async get(auth: AuthContext) {
    const s = await this.gateway.state(auth.tenantId);
    const e = await this.entitlements.get(auth.tenantId);
    const row = await this.database.run(auth, async (tx) => {
      const [r] = await tx
        .select({
          consentAt: aiSettings.externalConsentAt,
          consentBy: users.fullName,
          maskPii: aiSettings.maskPii,
          budget: aiSettings.monthlyBudgetInr,
        })
        .from(aiSettings)
        .leftJoin(users, eq(users.id, aiSettings.externalConsentBy));
      return r;
    });
    return {
      configured: s.configured,
      killed: s.killed,
      consent: row?.consentAt ? { at: row.consentAt, by: row.consentBy } : null,
      maskPii: row?.maskPii ?? true,
      monthlyBudgetInr: row?.budget != null ? Number(row.budget) : null,
      planBudgetInr: PLAN_AI_BUDGET_INR[e.planCode] ?? 0,
      planName: e.planName,
      budgetInr: s.budgetInr,
      spentInr: Math.round(s.spentInr * 100) / 100,
      features: AI_FEATURE_CODES.map((code) => ({
        code,
        ...AI_FEATURES[code],
        enabled: s.features[code] !== false,
        modelId: AI_FEATURES[code].model ? this.gateway.modelFor(s.policy, code as (typeof MODEL_FEATURES)[number]) : null,
      })),
      defaultModel: this.gateway.defaultModel,
      usdInr: USD_INR,
    };
  }

  async save(auth: AuthContext, input: z.infer<typeof policySchema>) {
    await this.database.run(auth, async (tx) => {
      const [cur] = await tx.select().from(aiSettings);
      const values: Partial<typeof aiSettings.$inferInsert> = {
        updatedBy: auth.userId,
        updatedAt: new Date(),
      };
      if (input.features) values.features = { ...(cur?.features ?? {}), ...(input.features as Record<string, boolean>) };
      if (input.maskPii !== undefined) values.maskPii = input.maskPii;
      if (input.monthlyBudgetInr !== undefined) values.monthlyBudgetInr = input.monthlyBudgetInr === null ? null : String(input.monthlyBudgetInr);
      if (input.externalConsent !== undefined) {
        values.externalConsentAt = input.externalConsent ? (cur?.externalConsentAt ?? new Date()) : null;
        values.externalConsentBy = input.externalConsent ? (cur?.externalConsentBy ?? auth.userId) : null;
      }
      await tx
        .insert(aiSettings)
        .values({ tenantId: auth.tenantId, ...values })
        .onConflictDoUpdate({ target: aiSettings.tenantId, set: values });
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'ai.policy_changed',
        entityType: 'ai_settings',
        entityId: cur?.id ?? null,
        metadata: input,
      });
    });
    this.gateway.invalidate(auth.tenantId);
    return this.get(auth);
  }

  // ---- models ----------------------------------------------------------------------------------

  models(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      tx
        .select({
          id: aiModelChanges.id,
          feature: aiModelChanges.feature,
          model: aiModelChanges.model,
          note: aiModelChanges.note,
          changedBy: users.fullName,
          createdAt: aiModelChanges.createdAt,
        })
        .from(aiModelChanges)
        .leftJoin(users, eq(users.id, aiModelChanges.changedBy))
        .orderBy(desc(aiModelChanges.createdAt))
        .limit(100),
    );
  }

  async setModel(auth: AuthContext, input: z.infer<typeof modelSchema>) {
    const row = await this.database.run(auth, async (tx) => {
      const [r] = await tx
        .insert(aiModelChanges)
        .values({
          tenantId: auth.tenantId,
          feature: input.feature,
          model: input.model,
          note: input.note ?? null,
          changedBy: auth.userId,
        })
        .returning();
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'ai.model_changed',
        entityType: 'ai_model_changes',
        entityId: r.id,
        metadata: { feature: input.feature, model: input.model },
      });
      return r;
    });
    this.gateway.invalidate(auth.tenantId);
    return { ...row, price: priceOf(input.model) };
  }

  // ---- usage -----------------------------------------------------------------------------------

  usage(auth: AuthContext, days: number) {
    return this.database.run(auth, async (tx) => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const byFeature = await many<{
        feature: string;
        calls: number;
        blocked: number;
        errors: number;
        inputTokens: number;
        outputTokens: number;
        costInr: number;
        avgLatencyMs: number | null;
        piiMasked: number;
      }>(
        tx,
        sql`select feature, count(*) filter (where status = 'ok')::int as calls, count(*) filter (where status = 'blocked')::int as blocked,
              count(*) filter (where status = 'error')::int as errors, coalesce(sum(input_tokens), 0)::int as "inputTokens",
              coalesce(sum(output_tokens), 0)::int as "outputTokens", coalesce(sum(cost_inr), 0)::float8 as "costInr",
              round(avg(latency_ms) filter (where status = 'ok'))::int as "avgLatencyMs", coalesce(sum(pii_masked), 0)::int as "piiMasked"
            from ai_usage where created_at >= ${since} group by feature order by 7 desc`,
      );
      const byDay = await many<{ day: string; calls: number; costInr: number }>(
        tx,
        sql`select to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day, count(*) filter (where status = 'ok')::int as calls,
              coalesce(sum(cost_inr), 0)::float8 as "costInr" from ai_usage where created_at >= ${since} group by 1 order by 1`,
      );
      const blockedWhy = await many<{ reason: string; n: number }>(tx, sql`select reason, count(*)::int as n from ai_usage where status <> 'ok' and created_at >= ${since} group by 1 order by 2 desc`);
      const byUser = await many<{
        name: string | null;
        calls: number;
        costInr: number;
      }>(
        tx,
        sql`select u.full_name as name, count(*)::int as calls, coalesce(sum(a.cost_inr), 0)::float8 as "costInr"
            from ai_usage a left join users u on u.id = a.user_id where a.status = 'ok' and a.created_at >= ${since} group by 1 order by 3 desc limit 10`,
      );
      const [month] = await many<{ costInr: number }>(tx, sql`select coalesce(sum(cost_inr), 0)::float8 as "costInr" from ai_usage where created_at >= ${monthStartIST().toISOString()}`);
      return {
        days,
        byFeature,
        byDay,
        byUser,
        notSent: blockedWhy,
        monthCostInr: Math.round(month.costInr * 100) / 100,
      };
    });
  }

  // ---- evaluations -----------------------------------------------------------------------------

  async runEval(auth: AuthContext, suite: EvalSuite) {
    const r = EVAL_SUITES[suite].run();
    return this.database.run(auth, async (tx) => {
      const [prev] = await tx.select({ scorePct: aiEvalRuns.scorePct }).from(aiEvalRuns).where(eq(aiEvalRuns.suite, suite)).orderBy(desc(aiEvalRuns.createdAt)).limit(1);
      const [row] = await tx
        .insert(aiEvalRuns)
        .values({
          tenantId: auth.tenantId,
          suite,
          cases: r.cases,
          passed: r.passed,
          scorePct: String(r.scorePct),
          details: r.details,
          runBy: auth.userId,
        })
        .returning();
      return {
        ...row,
        scorePct: r.scorePct,
        previousPct: prev ? Number(prev.scorePct) : null,
      };
    });
  }

  evals(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          id: aiEvalRuns.id,
          suite: aiEvalRuns.suite,
          cases: aiEvalRuns.cases,
          passed: aiEvalRuns.passed,
          scorePct: aiEvalRuns.scorePct,
          details: aiEvalRuns.details,
          runBy: users.fullName,
          createdAt: aiEvalRuns.createdAt,
        })
        .from(aiEvalRuns)
        .leftJoin(users, eq(users.id, aiEvalRuns.runBy))
        .orderBy(desc(aiEvalRuns.createdAt))
        .limit(60);
      return {
        suites: (Object.keys(EVAL_SUITES) as EvalSuite[]).map((code) => ({
          code,
          name: EVAL_SUITES[code].name,
        })),
        runs: rows.map((r) => ({ ...r, scorePct: Number(r.scorePct) })),
      };
    });
  }
}
