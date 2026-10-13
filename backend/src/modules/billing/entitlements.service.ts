import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  apiKeys,
  attachments,
  companies,
  enabledModules,
  FEATURES,
  invitations,
  isPlanCode,
  memberships,
  PLANS,
  subscriptions,
  tenants,
  webhookEndpoints,
  type Feature,
  type ModuleKey,
  type PlanCode,
  type PlanLimits,
  type Transaction,
} from '@nextgen/database';
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';

export type BillingState = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'suspended';

export interface Entitlements {
  planCode: PlanCode;
  planName: string;
  state: BillingState;
  /** Writes are blocked (trial over / subscription ended / suspended); billing still works. */
  readOnly: boolean;
  trialEndsAt: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  features: Feature[];
  limits: PlanLimits;
  /** Optional ERP modules switched on: the industry's defaults adjusted by the workspace. */
  modules: ModuleKey[];
}

export type LimitedResource = keyof PlanLimits;

const RESOURCE_LABEL: Record<LimitedResource, string> = {
  users: 'users',
  companies: 'companies',
  storageMb: 'MB of file storage',
  apiKeys: 'API keys',
  webhooks: 'webhooks',
};

/** 402 Payment Required with a message the UI can show next to an "Upgrade" button. */
export class PlanRequiredException extends HttpException {
  constructor(message: string) {
    super({ message, errors: [{ path: 'plan', message, code: 'plan_required' }] }, HttpStatus.PAYMENT_REQUIRED);
  }
}

const TTL_MS = 30_000;

/**
 * What a tenant may do right now: plan features, limits and whether the
 * workspace is read-only. Platform admins can override features per tenant
 * (tenants.settings.featureOverrides).
 */
@Injectable()
export class EntitlementsService {
  private readonly cache = new Map<string, { value: Entitlements; expires: number }>();

  constructor(private readonly database: DatabaseService) {}

  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }

  async get(tenantId: string): Promise<Entitlements> {
    const hit = this.cache.get(tenantId);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await this.database.run({ tenantId }, (tx) => this.compute(tx, tenantId));
    this.cache.set(tenantId, { value, expires: Date.now() + TTL_MS });
    return value;
  }

  async compute(tx: Transaction, tenantId: string): Promise<Entitlements> {
    const [t] = await tx
      .select({ status: tenants.status, planCode: tenants.planCode, trialEndsAt: tenants.trialEndsAt, settings: tenants.settings, industry: tenants.industry })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const [s] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
    const planCode: PlanCode = t && isPlanCode(t.planCode) ? t.planCode : 'trial';
    const plan = PLANS[planCode];
    const now = Date.now();

    let state: BillingState = (s?.status as BillingState | undefined) ?? 'trialing';
    if (t?.status === 'suspended' || t?.status === 'archived') state = 'suspended';
    else if (state === 'trialing' && t?.trialEndsAt && t.trialEndsAt.getTime() < now) state = 'expired';
    else if (state === 'cancelled' && s?.currentPeriodEnd && s.currentPeriodEnd.getTime() < now) state = 'expired';

    const overrides = ((t?.settings as { featureOverrides?: Record<string, boolean> } | undefined)?.featureOverrides ?? {}) as Record<string, boolean>;
    const features = (Object.keys(FEATURES) as Feature[]).filter((f) => (f in overrides ? overrides[f] : (plan.features as readonly Feature[]).includes(f)));

    return {
      planCode,
      planName: plan.name,
      state,
      readOnly: state === 'expired' || state === 'suspended',
      trialEndsAt: t?.trialEndsAt ?? null,
      periodEnd: s?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: s?.cancelAtPeriodEnd ?? false,
      features,
      limits: plan.limits,
      modules: enabledModules(t?.industry, (t?.settings as { modules?: Record<string, boolean> } | undefined)?.modules),
    };
  }

  async assertFeature(tenantId: string, feature: Feature) {
    const e = await this.get(tenantId);
    if (!e.features.includes(feature)) {
      throw new PlanRequiredException(`${FEATURES[feature]} ${feature === 'api_access' || feature === 'webhooks' ? 'are' : 'is'} not included in your ${e.planName} plan. Upgrade to use it.`);
    }
  }

  /** Throws when adding `adding` more of a resource would exceed the plan limit. */
  async assertLimit(tx: Transaction, tenantId: string, resource: LimitedResource, adding = 1) {
    const e = await this.get(tenantId);
    const limit = e.limits[resource];
    const used = await this.usageOf(tx, resource);
    if (used + adding > limit) {
      throw new PlanRequiredException(
        limit === 0
          ? `Your ${e.planName} plan doesn't include ${RESOURCE_LABEL[resource]}. Upgrade to add them.`
          : `Your ${e.planName} plan allows ${limit} ${RESOURCE_LABEL[resource]} (you have ${used}). Upgrade for more.`,
      );
    }
  }

  async usage(tx: Transaction): Promise<Record<LimitedResource, number>> {
    const resources: LimitedResource[] = ['users', 'companies', 'storageMb', 'apiKeys', 'webhooks'];
    const values = await Promise.all(resources.map((r) => this.usageOf(tx, r)));
    return Object.fromEntries(resources.map((r, i) => [r, values[i]])) as Record<LimitedResource, number>;
  }

  /** Current usage (RLS scopes every count to the caller's tenant). */
  private async usageOf(tx: Transaction, resource: LimitedResource): Promise<number> {
    switch (resource) {
      case 'users': {
        const [m] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.status, 'active'));
        const [i] = await tx
          .select({ n: count() })
          .from(invitations)
          .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())));
        return Number(m.n) + Number(i.n);
      }
      case 'companies': {
        const [r] = await tx.select({ n: count() }).from(companies).where(isNull(companies.deletedAt));
        return Number(r.n);
      }
      case 'storageMb': {
        const [r] = await tx
          .select({ bytes: sql<string>`coalesce(sum(${attachments.sizeBytes}), 0)` })
          .from(attachments)
          .where(isNull(attachments.deletedAt));
        return Math.ceil(Number(r.bytes) / 1_048_576);
      }
      case 'apiKeys': {
        const [r] = await tx.select({ n: count() }).from(apiKeys).where(isNull(apiKeys.revokedAt));
        return Number(r.n);
      }
      case 'webhooks': {
        const [r] = await tx.select({ n: count() }).from(webhookEndpoints).where(eq(webhookEndpoints.isActive, true));
        return Number(r.n);
      }
    }
  }
}
