/**
 * SaaS plan catalog (default pricing, ex-GST). Single source of truth for the
 * backend (limits, feature gates, billing) and the pricing page.
 */

export const FEATURES = {
  multi_level_approvals: 'Multi-level approval workflows',
  custom_fields: 'Custom fields',
  print_designer: 'Custom print formats',
  api_access: 'API keys',
  webhooks: 'Webhooks',
  whatsapp: 'WhatsApp notifications',
  priority_support: 'Priority support',
} as const;

export type Feature = keyof typeof FEATURES;
const ALL_FEATURES = Object.keys(FEATURES) as Feature[];

export interface PlanLimits {
  users: number;
  companies: number;
  storageMb: number;
  apiKeys: number;
  webhooks: number;
}

export interface PlanDefinition {
  name: string;
  tagline: string;
  /** INR per month / per year, exclusive of 18% GST. 0 = not purchasable. */
  priceMonthly: number;
  priceYearly: number;
  limits: PlanLimits;
  features: Feature[];
  purchasable: boolean;
}

export const PLANS = {
  trial: {
    name: 'Free trial',
    tagline: 'Everything, for 30 days',
    priceMonthly: 0,
    priceYearly: 0,
    limits: { users: 10, companies: 2, storageMb: 2_048, apiKeys: 2, webhooks: 2 },
    features: ALL_FEATURES,
    purchasable: false,
  },
  starter: {
    name: 'Starter',
    tagline: 'For small workshops getting organised',
    priceMonthly: 1_999,
    priceYearly: 19_990,
    limits: { users: 5, companies: 1, storageMb: 5_120, apiKeys: 0, webhooks: 0 },
    features: [],
    purchasable: true,
  },
  growth: {
    name: 'Growth',
    tagline: 'For growing manufacturers with teams and approvals',
    priceMonthly: 4_999,
    priceYearly: 49_990,
    limits: { users: 25, companies: 3, storageMb: 25_600, apiKeys: 5, webhooks: 5 },
    features: ['multi_level_approvals', 'custom_fields', 'print_designer', 'api_access', 'webhooks', 'whatsapp'],
    purchasable: true,
  },
  enterprise: {
    name: 'Enterprise',
    tagline: 'For multi-plant groups that need everything',
    priceMonthly: 14_999,
    priceYearly: 149_990,
    limits: { users: 200, companies: 20, storageMb: 204_800, apiKeys: 50, webhooks: 50 },
    features: ALL_FEATURES,
    purchasable: true,
  },
} as const satisfies Record<string, PlanDefinition>;

export type PlanCode = keyof typeof PLANS;
export const PLAN_CODES = Object.keys(PLANS) as PlanCode[];
export const GST_RATE_PERCENT = 18;

export function isPlanCode(v: string): v is PlanCode {
  return v in PLANS;
}
