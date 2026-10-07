/**
 * AI governance rules, kept pure so they can be unit tested: which features exist, what a model
 * call costs, the plan budgets, PII masking, and whether a call may go out.
 */

export const AI_FEATURES = {
  copilot: {
    name: 'Copilot',
    model: true,
    description: 'Questions about the business, answered from the ERP data',
  },
  document_ai: {
    name: 'Document AI',
    model: true,
    description: 'Reading challans, e-way bills, CoAs, quotations and bank statements (scans need the model)',
  },
  bill_capture: {
    name: 'Bill capture',
    model: true,
    description: 'Reading scanned and PDF supplier bills',
  },
  ticket_reply: {
    name: 'Ticket replies',
    model: true,
    description: 'Drafting replies to service tickets',
  },
  voice: {
    name: 'Voice commands',
    model: false,
    description: 'Spoken commands in English, Hindi and Hinglish',
  },
  insights: {
    name: 'Predictions',
    model: false,
    description: 'Collections, price outlook and why-analysis',
  },
} as const;
export type AiFeature = keyof typeof AI_FEATURES;
export const AI_FEATURE_CODES = Object.keys(AI_FEATURES) as AiFeature[];
/** Features that call the external model. */
export type ModelFeature = 'copilot' | 'document_ai' | 'bill_capture' | 'ticket_reply';
export const MODEL_FEATURES = AI_FEATURE_CODES.filter((f) => AI_FEATURES[f].model) as ModelFeature[];

/** Monthly model spend included in each plan (₹). A workspace may set a lower cap. */
export const PLAN_AI_BUDGET_INR: Record<string, number> = {
  trial: 500,
  starter: 500,
  growth: 2_500,
  enterprise: 15_000,
};

/** List prices in US$ per million tokens, by model family. */
const PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /haiku/, input: 1, output: 5 },
  { match: /opus/, input: 5, output: 25 },
  { match: /sonnet|fable/, input: 3, output: 15 },
];
export const USD_INR = 88;

export function priceOf(model: string) {
  return PRICES.find((p) => p.match.test(model)) ?? PRICES[2];
}

/** Cost of a call in ₹, to 4 decimals. */
export function costInr(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model);
  return Math.round(((inputTokens * p.input + outputTokens * p.output) / 1_000_000) * USD_INR * 10_000) / 10_000;
}

export type BlockReason = 'not_configured' | 'killed' | 'off' | 'no_consent' | 'budget';
export const BLOCK_MESSAGE: Record<BlockReason, string> = {
  not_configured: 'AI is not set up on this server (no ANTHROPIC_API_KEY).',
  killed: 'AI is stopped for this workspace (kill switch).',
  off: 'This AI feature is switched off in AI governance.',
  no_consent: 'Sending data to the AI provider has not been allowed yet. An administrator can allow it under AI → Governance.',
  budget: "This month's AI budget is used up. An administrator can raise it under AI → Governance.",
};

export interface PolicyState {
  configured: boolean;
  killed: boolean;
  features: Record<string, boolean>;
  consent: boolean;
  budgetInr: number;
  spentInr: number;
}

/** Whether a feature may be used at all (model or not). */
export function featureOn(s: Pick<PolicyState, 'features'>, feature: AiFeature) {
  return s.features[feature] !== false;
}

/** Whether a model call for `feature` may go out now, and if not, why. */
export function decide(s: PolicyState, feature: ModelFeature): BlockReason | null {
  if (!s.configured) return 'not_configured';
  if (s.killed) return 'killed';
  if (!featureOn(s, feature)) return 'off';
  if (!s.consent) return 'no_consent';
  if (s.spentInr >= s.budgetInr) return 'budget';
  return null;
}

// ---- PII masking -------------------------------------------------------------------------------

/**
 * Personal data that never needs to reach the model. GSTINs are business identifiers and are kept
 * (documents are matched on them); a PAN inside a GSTIN is therefore not masked.
 */
const PII: { kind: string; re: RegExp }[] = [
  { kind: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'AADHAAR', re: /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/g },
  {
    kind: 'PHONE',
    re: /(?<![\dA-Za-z])(?:\+91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g,
  },
  { kind: 'PAN', re: /(?<![0-9A-Z])[A-Z]{5}\d{4}[A-Z](?![0-9A-Z])/g },
  {
    kind: 'ACCOUNT',
    re: /(?<=(?:a\/c|acct|account)(?: no\.?| number)?[:\s#.-]*)\d{9,18}(?!\d)/gi,
  },
];

export class PiiMasker {
  private readonly toToken = new Map<string, string>();
  private readonly toValue = new Map<string, string>();
  private n = 0;

  get count() {
    return this.toToken.size;
  }

  maskText(text: string): string {
    let out = text;
    for (const { kind, re } of PII) {
      out = out.replace(re, (v) => {
        let token = this.toToken.get(v);
        if (!token) {
          token = `[${kind}_${++this.n}]`;
          this.toToken.set(v, token);
          this.toValue.set(token, v);
        }
        return token;
      });
    }
    return out;
  }

  unmaskText(text: string): string {
    return this.toValue.size ? text.replace(/\[(?:EMAIL|AADHAAR|PHONE|PAN|ACCOUNT)_\d+\]/g, (t) => this.toValue.get(t) ?? t) : text;
  }

  /** Masks every string in a request, except base64 file data. */
  mask<T>(value: T): T {
    return walk(value, (s, key) => (key === 'data' || key === 'media_type' || key === 'type' || key === 'model' ? s : this.maskText(s))) as T;
  }

  unmask<T>(value: T): T {
    return walk(value, (s) => this.unmaskText(s)) as T;
  }
}

function walk(v: unknown, fn: (s: string, key: string | null) => string, key: string | null = null): unknown {
  if (typeof v === 'string') return fn(v, key);
  if (Array.isArray(v)) return v.map((x) => walk(x, fn, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, fn, k)]));
  return v;
}

/** First day of the current month in India, as a timestamp. */
export function monthStartIST(now = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3_600_000);
}
