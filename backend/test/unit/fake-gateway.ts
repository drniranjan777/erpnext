import { vi } from 'vitest';
import { AiGateway } from '../../src/modules/ai-gov/ai-gateway.service';

/** An AiGateway with an allowing policy (consent given, budget left) and no database. */
export function fakeGateway(apiKey: string, policy: { consent?: boolean; maskPii?: boolean; spentInr?: number; features?: Record<string, boolean> } = {}) {
  const database = { run: vi.fn(async (_auth: unknown, fn: (tx: unknown) => unknown) => fn({ insert: () => ({ values: async (v: unknown) => recorded.push(v) }) })) };
  const recorded: unknown[] = [];
  const g = new AiGateway(database as never, {} as never, { get: (k: string) => (k === 'ANTHROPIC_API_KEY' ? apiKey : 'claude-sonnet-test') } as never);
  const p = { killed: false, features: policy.features ?? {}, consent: policy.consent ?? true, maskPii: policy.maskPii ?? true, budgetInr: 500, models: {} };
  vi.spyOn(g, 'policy').mockResolvedValue(p);
  vi.spyOn(g, 'spent').mockResolvedValue(policy.spentInr ?? 0);
  return Object.assign(g, { recorded });
}
