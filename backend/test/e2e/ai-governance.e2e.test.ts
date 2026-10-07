import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let clerk: Awaited<ReturnType<typeof addMember>>;
const emails: string[] = [];
const GOV = '/ai/governance';

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

/** Runs SQL as the owner role (bypasses row security) to add metered calls. */
async function owner(q: string, params: unknown[]) {
  const url = process.env.DATABASE_OWNER_URL ?? readFileSync(join(__dirname, '..', '..', '..', 'database', '.env'), 'utf8').match(/^DATABASE_OWNER_URL=(.*)$/m)?.[1];
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    return (await pool.query(q, params)).rows;
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  a = await signupWorkspace('aigov-a');
  emails.push(a.email);
  const role = await ok(await a.client.post('/iam/roles', { name: 'Voice only', permissions: ['ai.inbox.use'] }), 201);
  clerk = await addMember(a.client, 'aigov-clerk', [role.id]);
  emails.push(clerk.email);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('AI policy', () => {
  it('starts with every feature on, no consent, PII masking and the plan budget', async () => {
    const g = await ok(await a.client.get(GOV));
    expect(g).toMatchObject({ consent: null, maskPii: true, monthlyBudgetInr: null, planBudgetInr: 500, budgetInr: 500, spentInr: 0, killed: false });
    expect(g.features.map((f: any) => f.code)).toEqual(['copilot', 'document_ai', 'bill_capture', 'ticket_reply', 'voice', 'insights']);
    expect(g.features.every((f: any) => f.enabled)).toBe(true);
    expect(g.features.find((f: any) => f.code === 'voice').modelId).toBeNull();
    expect((await clerk.client.get(GOV)).status).toBe(403);
  });

  it('records consent, caps the budget at the plan and switches features off', async () => {
    const g = await ok(await a.client.post(GOV, { externalConsent: true, monthlyBudgetInr: 1_000_000, maskPii: false, features: { voice: false, insights: false } }));
    expect(g.consent).toMatchObject({ by: expect.any(String) });
    expect(g).toMatchObject({ maskPii: false, monthlyBudgetInr: 1_000_000, budgetInr: 500 });
    expect(g.features.filter((f: any) => !f.enabled).map((f: any) => f.code)).toEqual(['voice', 'insights']);
    const lower = await ok(await a.client.post(GOV, { monthlyBudgetInr: 200, maskPii: true }));
    expect(lower).toMatchObject({ budgetInr: 200, maskPii: true, consent: { at: g.consent.at } });
  });

  it('refuses switched-off features and allows them again', async () => {
    const v = await a.client.post('/voice/interpret', { text: 'line 2 par 500 units ka production order banao' });
    expect(v.status).toBe(403);
    expect(v.body.detail).toMatch(/Voice commands is switched off/);
    expect((await a.client.post('/insights/why', { question: 'why did margin drop this month?' })).status).toBe(403);
    await ok(await a.client.post(GOV, { features: { voice: true, insights: true, copilot: false } }));
    expect((await a.client.post('/voice/interpret', { text: 'line 2 par 500 units ka production order banao' })).status).toBe(200);
    expect((await a.client.post('/copilot/chat', { messages: [{ role: 'user', content: 'stock' }] })).status).toBe(403);
    const back = await ok(await a.client.post(GOV, { features: { copilot: true }, externalConsent: false }));
    expect(back.consent).toBeNull();
    expect((await a.client.post('/copilot/chat', { messages: [{ role: 'user', content: 'stock' }] })).status).toBe(200);
  });
});

describe('model registry', () => {
  it('keeps the history of model choices per feature', async () => {
    await ok(await a.client.post(`${GOV}/models`, { feature: 'copilot', model: 'claude-sonnet-5-5', note: 'default' }), 201);
    const m = await ok(await a.client.post(`${GOV}/models`, { feature: 'copilot', model: 'claude-haiku-4-5-20251001', note: 'cheaper for Q&A' }), 201);
    expect(m.price).toMatchObject({ input: 1, output: 5 });
    expect((await a.client.post(`${GOV}/models`, { feature: 'voice', model: 'claude-haiku-4-5-20251001' })).status).toBe(400);
    expect((await a.client.post(`${GOV}/models`, { feature: 'copilot', model: 'gpt-4o' })).status).toBe(400);
    const history = await ok(await a.client.get(`${GOV}/models`));
    expect(history.map((h: any) => h.model)).toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-5-5']);
    const g = await ok(await a.client.get(GOV));
    expect(g.features.find((f: any) => f.code === 'copilot').modelId).toBe('claude-haiku-4-5-20251001');
  });
});

describe('usage and budget', () => {
  it('sums metered calls by feature and counts this month against the budget', async () => {
    await owner(
      `insert into ai_usage (tenant_id, feature, model, status, input_tokens, output_tokens, cost_inr, latency_ms, reason, pii_masked) values
        ($1, 'copilot', 'claude-sonnet-5-5', 'ok', 10000, 1000, 3.96, 1200, null, 2),
        ($1, 'copilot', 'claude-sonnet-5-5', 'ok', 5000, 500, 1.98, 800, null, 0),
        ($1, 'document_ai', 'claude-sonnet-5-5', 'ok', 200000, 2000, 195.36, 9000, null, 0),
        ($1, 'copilot', 'claude-sonnet-5-5', 'blocked', 0, 0, 0, null, 'no_consent', 0)`,
      [a.tenantId],
    );
    const u = await ok(await a.client.get(`${GOV}/usage?days=30`));
    expect(u.monthCostInr).toBe(201.3);
    expect(u.byFeature[0]).toMatchObject({ feature: 'document_ai', calls: 1, costInr: 195.36 });
    expect(u.byFeature[1]).toMatchObject({ feature: 'copilot', calls: 2, blocked: 1, inputTokens: 15000, avgLatencyMs: 1000, piiMasked: 2 });
    expect(u.notSent).toEqual([{ reason: 'no_consent', n: 1 }]);
    const g = await ok(await a.client.get(GOV));
    expect(g).toMatchObject({ spentInr: 201.3, budgetInr: 200 });
  });
});

describe('evaluations', () => {
  it('runs the evaluation sets and keeps the history', async () => {
    const v = await ok(await a.client.post(`${GOV}/evals/voice`), 201);
    expect(v.scorePct).toBeGreaterThanOrEqual(90);
    expect(v.previousPct).toBeNull();
    const t1 = await ok(await a.client.post(`${GOV}/evals/triage`), 201);
    expect(t1).toMatchObject({ cases: 12, passed: 12, scorePct: 100 });
    const t2 = await ok(await a.client.post(`${GOV}/evals/triage`), 201);
    expect(t2.previousPct).toBe(100);
    expect((await a.client.post(`${GOV}/evals/unknown`)).status).toBe(400);
    const e = await ok(await a.client.get(`${GOV}/evals`));
    expect(e.suites.map((s: any) => s.code)).toEqual(['voice', 'triage', 'documents']);
    expect(e.runs.map((r: any) => r.suite)).toEqual(['triage', 'triage', 'voice']);
  });
});
