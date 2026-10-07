import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { aiModelChanges, aiSettings, aiUsage } from '@nextgen/database';
import { desc, sql } from 'drizzle-orm';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { AI_FEATURES, BLOCK_MESSAGE, costInr, decide, featureOn, monthStartIST, PiiMasker, PLAN_AI_BUDGET_INR, type AiFeature, type BlockReason, type ModelFeature, type PolicyState } from './policy';

/** Raised when policy stops a model call; callers fall back to their rule-based path or show `message`. */
export class AiBlockedError extends Error {
  constructor(readonly reason: BlockReason) {
    super(BLOCK_MESSAGE[reason]);
  }
}

export interface ModelRequest {
  system?: string;
  messages: unknown[];
  tools?: readonly unknown[];
  tool_choice?: unknown;
  max_tokens: number;
}

export interface ModelResponse {
  stop_reason: string;
  content: (
    | { type: 'text'; text: string }
    | {
        type: 'tool_use';
        id: string;
        name: string;
        input: Record<string, unknown>;
      }
    | { type: string; [k: string]: unknown }
  )[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface Policy {
  killed: boolean;
  features: Record<string, boolean>;
  consent: boolean;
  maskPii: boolean;
  budgetInr: number;
  models: Record<string, string>;
}

const TTL_MS = 30_000;

/**
 * The only way out to the AI model. Every call is checked against the workspace's AI policy
 * (kill switch, feature switches, consent, monthly budget), has personal data masked, uses the
 * model chosen for the feature, and is metered in `ai_usage` — including calls that were blocked.
 */
@Injectable()
export class AiGateway {
  private readonly logger = new Logger('AiGateway');
  private readonly apiKey: string;
  readonly defaultModel: string;
  private readonly cache = new Map<string, { value: Policy; expires: number }>();

  constructor(
    private readonly database: DatabaseService,
    private readonly entitlements: EntitlementsService,
    config: ConfigService<Env, true>,
  ) {
    this.apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.defaultModel = config.get('AI_MODEL', { infer: true });
  }

  /** A model key is set on this server. */
  get configured() {
    return !!this.apiKey;
  }

  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }

  async policy(tenantId: string): Promise<Policy> {
    const hit = this.cache.get(tenantId);
    if (hit && hit.expires > Date.now()) return hit.value;
    const e = await this.entitlements.get(tenantId);
    const value = await this.database.run({ tenantId }, async (tx) => {
      const [s] = await tx.select().from(aiSettings);
      const changes = await tx
        .select({
          feature: aiModelChanges.feature,
          model: aiModelChanges.model,
        })
        .from(aiModelChanges)
        .orderBy(desc(aiModelChanges.createdAt));
      const models: Record<string, string> = {};
      for (const c of changes) models[c.feature] ??= c.model;
      const planBudget = PLAN_AI_BUDGET_INR[e.planCode] ?? 0;
      return {
        killed: s?.killed ?? false,
        features: s?.features ?? {},
        consent: !!s?.externalConsentAt,
        maskPii: s?.maskPii ?? true,
        budgetInr: s?.monthlyBudgetInr != null ? Math.min(Number(s.monthlyBudgetInr), planBudget) : planBudget,
        models,
      };
    });
    this.cache.set(tenantId, { value, expires: Date.now() + TTL_MS });
    return value;
  }

  modelFor(p: Policy, feature: ModelFeature) {
    return p.models[feature] ?? this.defaultModel;
  }

  /** 403 when a workspace has switched the feature off. */
  async assertEnabled(tenantId: string, feature: AiFeature) {
    const p = await this.policy(tenantId);
    if (!featureOn(p, feature)) throw new ForbiddenException(`${AI_FEATURES[feature].name} is switched off for this workspace (AI → Governance).`);
  }

  async spent(tenantId: string): Promise<number> {
    const [r] = await this.database.run({ tenantId }, (tx) =>
      tx
        .select({ v: sql<string>`coalesce(sum(${aiUsage.costInr}), 0)` })
        .from(aiUsage)
        .where(sql`${aiUsage.createdAt} >= ${monthStartIST().toISOString()}`),
    );
    return Number(r.v);
  }

  /** The policy state the decision is made on (also shown on the governance page). */
  async state(tenantId: string): Promise<PolicyState & { policy: Policy }> {
    const policy = await this.policy(tenantId);
    return {
      configured: this.configured,
      killed: policy.killed,
      features: policy.features,
      consent: policy.consent,
      budgetInr: policy.budgetInr,
      spentInr: await this.spent(tenantId),
      policy,
    };
  }

  /** Why a model call for `feature` would be blocked now, or null when it may go out. */
  async blocked(tenantId: string, feature: ModelFeature): Promise<BlockReason | null> {
    if (!this.configured) return 'not_configured';
    return decide(await this.state(tenantId), feature);
  }

  /** Sends one request to the model. Throws AiBlockedError when policy stops it, Error when the call fails. */
  async call(auth: { tenantId: string; userId: string | null }, feature: ModelFeature, req: ModelRequest, timeoutMs = 60_000): Promise<ModelResponse> {
    const s = await this.state(auth.tenantId);
    const reason = decide(s, feature);
    const model = this.modelFor(s.policy, feature);
    if (reason) {
      await this.record(auth, { feature, model, status: 'blocked', reason });
      throw new AiBlockedError(reason);
    }
    const masker = new PiiMasker();
    const payload = s.policy.maskPii ? masker.mask(req) : req;
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, ...payload }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      await this.record(auth, {
        feature,
        model,
        status: 'error',
        reason: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network',
        latencyMs: Date.now() - started,
        piiMasked: masker.count,
      });
      throw e;
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      await this.record(auth, {
        feature,
        model,
        status: 'error',
        reason: `http_${res.status}`,
        latencyMs: Date.now() - started,
        piiMasked: masker.count,
      });
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const body = (await res.json()) as ModelResponse;
    const inputTokens = body.usage?.input_tokens ?? 0;
    const outputTokens = body.usage?.output_tokens ?? 0;
    await this.record(auth, {
      feature,
      model,
      status: 'ok',
      inputTokens,
      outputTokens,
      costInr: costInr(model, inputTokens, outputTokens),
      latencyMs: Date.now() - started,
      piiMasked: masker.count,
    });
    return masker.count ? { ...body, content: masker.unmask(body.content) } : body;
  }

  private async record(
    auth: { tenantId: string; userId: string | null },
    u: {
      feature: string;
      model: string;
      status: string;
      reason?: string;
      inputTokens?: number;
      outputTokens?: number;
      costInr?: number;
      latencyMs?: number;
      piiMasked?: number;
    },
  ) {
    try {
      await this.database.run({ tenantId: auth.tenantId, userId: auth.userId as string }, (tx) =>
        tx.insert(aiUsage).values({
          tenantId: auth.tenantId,
          userId: auth.userId,
          feature: u.feature,
          model: u.model,
          status: u.status,
          reason: u.reason ?? null,
          inputTokens: u.inputTokens ?? 0,
          outputTokens: u.outputTokens ?? 0,
          costInr: String(u.costInr ?? 0),
          latencyMs: u.latencyMs ?? null,
          piiMasked: u.piiMasked ?? 0,
        }),
      );
    } catch (e) {
      this.logger.warn(`Could not record AI usage: ${e instanceof Error ? e.message : e}`);
    }
  }
}
