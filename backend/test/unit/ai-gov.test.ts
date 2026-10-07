import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiBlockedError } from '../../src/modules/ai-gov/ai-gateway.service';
import { evalDocuments, evalTriage, evalVoice } from '../../src/modules/ai-gov/evals';
import { costInr, decide, monthStartIST, PiiMasker, type PolicyState } from '../../src/modules/ai-gov/policy';
import { fakeGateway } from './fake-gateway';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const allow: PolicyState = { configured: true, killed: false, features: {}, consent: true, budgetInr: 500, spentInr: 0 };

describe('AI policy', () => {
  it('lets a call out only when every check passes', () => {
    expect(decide(allow, 'copilot')).toBeNull();
    expect(decide({ ...allow, configured: false }, 'copilot')).toBe('not_configured');
    expect(decide({ ...allow, killed: true }, 'copilot')).toBe('killed');
    expect(decide({ ...allow, features: { copilot: false } }, 'copilot')).toBe('off');
    expect(decide({ ...allow, features: { copilot: false } }, 'bill_capture')).toBeNull();
    expect(decide({ ...allow, consent: false }, 'ticket_reply')).toBe('no_consent');
    expect(decide({ ...allow, spentInr: 500 }, 'document_ai')).toBe('budget');
  });

  it('prices calls by model family in rupees', () => {
    // Sonnet: $3 in / $15 out per million tokens at ₹88.
    expect(costInr('claude-sonnet-5-5', 10_000, 1_000)).toBe(3.96);
    expect(costInr('claude-haiku-4-5-20251001', 1_000_000, 0)).toBe(88);
    expect(costInr('claude-opus-5-5', 0, 1_000)).toBe(2.2);
  });

  it('starts the month in India time', () => {
    expect(monthStartIST(new Date('2026-10-31T20:00:00Z')).toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(monthStartIST(new Date('2026-10-08T06:00:00Z')).toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });
});

describe('PII masking', () => {
  it('masks personal data, keeps GSTINs and restores the values in the reply', () => {
    const m = new PiiMasker();
    const out = m.maskText('Mail asha.rao@example.com or call +91 98480 12345. PAN ABCDE1234F, Aadhaar 2345 6789 0123, A/c No: 123456789012. GSTIN 36AABCS1234E1ZU.');
    expect(out).toBe('Mail [EMAIL_1] or call [PHONE_3]. PAN [PAN_4], Aadhaar [AADHAAR_2], A/c No: [ACCOUNT_5]. GSTIN 36AABCS1234E1ZU.');
    expect(m.count).toBe(5);
    expect(m.unmaskText('Write to [EMAIL_1] about [PAN_4].')).toBe('Write to asha.rao@example.com about ABCDE1234F.');
  });

  it('masks the strings of a request but not file data', () => {
    const m = new PiiMasker();
    const req = m.mask({ messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'ravi@x.in' } }, { type: 'text', text: 'ravi@x.in' }] }] });
    expect(req.messages[0].content).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'ravi@x.in' } }, { type: 'text', text: '[EMAIL_1]' }]);
  });
});

describe('AI gateway', () => {
  const auth = { tenantId: 't', userId: 'u' };

  it('masks the request, uses the feature model, unmasks the reply and meters the call', async () => {
    const sent: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Replied to [EMAIL_1].' }], usage: { input_tokens: 10_000, output_tokens: 1_000 } }) };
      }),
    );
    const g = fakeGateway('key');
    const res = await g.call(auth, 'ticket_reply', { max_tokens: 100, messages: [{ role: 'user', content: 'Customer: meena@example.com' }] });
    expect(sent[0]).toMatchObject({ model: 'claude-sonnet-test', messages: [{ content: 'Customer: [EMAIL_1]' }] });
    expect(res.content[0]).toEqual({ type: 'text', text: 'Replied to meena@example.com.' });
    expect(g.recorded).toEqual([expect.objectContaining({ feature: 'ticket_reply', status: 'ok', inputTokens: 10_000, outputTokens: 1_000, costInr: '3.96', piiMasked: 1 })]);
  });

  it('blocks without consent and records why', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const g = fakeGateway('key', { consent: false });
    await expect(g.call(auth, 'copilot', { max_tokens: 10, messages: [] })).rejects.toBeInstanceOf(AiBlockedError);
    expect(fetch).not.toHaveBeenCalled();
    expect(g.recorded).toEqual([expect.objectContaining({ status: 'blocked', reason: 'no_consent' })]);
  });

  it('records failed calls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' })));
    const g = fakeGateway('key', { maskPii: false });
    await expect(g.call(auth, 'document_ai', { max_tokens: 10, messages: [] })).rejects.toThrow(/HTTP 429/);
    expect(g.recorded).toEqual([expect.objectContaining({ status: 'error', reason: 'http_429' })]);
  });

  it('refuses a feature the workspace switched off', async () => {
    const g = fakeGateway('', { features: { voice: false } });
    await expect(g.assertEnabled('t', 'voice')).rejects.toThrow(/switched off/);
    await expect(g.assertEnabled('t', 'insights')).resolves.toBeUndefined();
  });
});

describe('evaluation sets', () => {
  it('score the rule-based features', () => {
    expect(evalVoice().scorePct).toBeGreaterThanOrEqual(90);
    expect(evalTriage()).toMatchObject({ cases: 12, passed: 12, scorePct: 100 });
    expect(evalDocuments()).toMatchObject({ cases: 5, passed: 5, scorePct: 100 });
  });
});
