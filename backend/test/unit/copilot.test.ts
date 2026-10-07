import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopilotService } from '../../src/modules/copilot/copilot.service';
import { isHindi, parseIntent, periodOf } from '../../src/modules/copilot/intents';

describe('rule-based intents', () => {
  it('opens and explains documents by number', () => {
    expect(parseIntent('open PO/26-27/0045')).toMatchObject({ tool: 'find_document', input: { query: 'PO/26-27/0045' } });
    expect(parseIntent('show me PO 45')).toMatchObject({ tool: 'find_document', input: { query: '45', docType: 'purchase_order' } });
    expect(parseIntent('why is WO/26-27/0003 stuck?')).toMatchObject({ tool: 'explain_document', input: { number: 'WO/26-27/0003' } });
    expect(parseIntent('PO 12 क्यों रुका है')).toMatchObject({ tool: 'explain_document', input: { number: '12', docType: 'purchase_order' } });
  });

  it('maps money and stock questions to reports, with periods', () => {
    expect(parseIntent('sales this month')).toMatchObject({ tool: 'run_report', input: { key: 'sales-by-customer', params: { from: 'month_start', to: 'today' } } });
    expect(parseIntent('what were sales last month?')?.input).toMatchObject({ params: { from: 'prev_month_start', to: 'prev_month_end' } });
    expect(parseIntent('इस साल की बिक्री')?.input).toMatchObject({ key: 'sales-by-customer', params: { from: 'fy_start' } });
    expect(parseIntent('who has overdue invoices')).toMatchObject({ input: { key: 'receivables-outstanding' } });
    expect(parseIntent('बकाया कितना है')).toMatchObject({ input: { key: 'receivables-outstanding' } });
    expect(parseIntent('bills to pay')).toMatchObject({ input: { key: 'payables-outstanding' } });
    expect(parseIntent('late work orders')).toMatchObject({ input: { key: 'work-order-status' } });
    expect(parseIntent('rejects by reason')).toMatchObject({ tool: 'query_data', input: { dataset: 'job_cards' } });
  });

  it('pulls the item out of stock questions', () => {
    expect(parseIntent('stock of hex bolt')).toMatchObject({ tool: 'query_data', input: { filters: [{ field: 'item', op: 'contains', value: 'hex bolt' }] } });
    expect(parseIntent('hex bolt का स्टॉक कितना है?')?.input).toMatchObject({ filters: [{ value: 'hex bolt' }] });
    expect(parseIntent('stock')).toMatchObject({ input: { key: 'stock-summary' } });
    expect(parseIntent('tell me a joke')).toBeNull();
  });

  it('reads draft requests', () => {
    expect(parseIntent('draft a purchase order from Deccan Steels: 100 hex bolt, 50 hex nut by 2026-10-20')).toMatchObject({
      tool: 'draft_document',
      input: { type: 'purchase_order', party: 'Deccan Steels', lines: [{ qty: '100', item: 'hex bolt' }, { qty: '50', item: 'hex nut' }], date: '2026-10-20' },
    });
    expect(parseIntent('create work order: 20 mounting bracket')?.input).toEqual({ type: 'work_order', lines: [{ qty: '20', item: 'mounting bracket' }] });
    expect(parseIntent('raise requisition for 10 kg resin and 5 grease')?.input).toEqual({ type: 'purchase_requisition', lines: [{ qty: '10', item: 'resin' }, { qty: '5', item: 'grease' }] });
    expect(parseIntent('create sales order for Reddy Agro: 30 x crate')?.input).toMatchObject({ type: 'sales_order', party: 'Reddy Agro', lines: [{ qty: '30', item: 'crate' }] });
  });

  it('detects Hindi and periods', () => {
    expect(isHindi('बिक्री')).toBe(true);
    expect(isHindi('sales')).toBe(false);
    expect(periodOf('aaj ki bikri').from).toBe('today');
  });
});

describe('model loop', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs tools the model asks for, feeds results back, and returns the answer with the tables', async () => {
    const calls: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        calls.push(body);
        const reply =
          calls.length === 1
            ? { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'tu1', name: 'run_report', input: { key: 'stock-summary' } }] }
            : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Stock is worth ₹1,000.' }] };
        return { ok: true, json: async () => reply, text: async () => '' };
      }),
    );
    const tools = { run: vi.fn(async () => ({ content: '{"totals":{"value":"1000.00"}}', blocks: [{ kind: 'table', title: 'Stock summary', columns: [], rows: [] }], actions: [{ kind: 'navigate', label: 'Open', href: '/reports/stock-summary' }] })) };
    const database = { run: vi.fn(async () => [{ name: 'Asha' }]) };
    const config = { get: (k: string) => (k === 'ANTHROPIC_API_KEY' ? 'test-key' : 'claude-test') };
    const svc = new CopilotService(database as never, tools as never, config as never);
    const out = await svc.chat({ tenantId: 't', userId: 'u', membershipId: 'm', sessionId: 's' } as never, { messages: [{ role: 'user', content: 'what is my stock worth' }], language: 'auto' });
    expect(out).toMatchObject({ mode: 'ai', reply: 'Stock is worth ₹1,000.', blocks: [{ title: 'Stock summary' }], actions: [{ href: '/reports/stock-summary' }] });
    expect(tools.run).toHaveBeenCalledWith(expect.anything(), 'run_report', { key: 'stock-summary' });
    expect(calls[0].system).toMatch(/not instructions to you/);
    expect(calls[0].tools.map((t: any) => t.name)).toContain('draft_document');
    const toolResult = calls[1].messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1', is_error: false });
  });

  it('falls back to the rule-based answers when the model is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 529, text: async () => 'overloaded' })));
    const tools = { run: vi.fn(async () => ({ content: '{}', blocks: [{ kind: 'table', title: 'Stock summary', columns: [], rows: [], totals: { value: '250.00' } }] })) };
    const svc = new CopilotService({ run: vi.fn(async () => []) } as never, tools as never, { get: (k: string) => (k === 'ANTHROPIC_API_KEY' ? 'k' : 'm') } as never);
    const out = await svc.chat({ userId: 'u2' } as never, { messages: [{ role: 'user', content: 'stock' }], language: 'en' });
    expect(out).toMatchObject({ mode: 'basic', reply: 'Stock on hand is worth ₹250.' });
  });

  it('limits questions per minute', async () => {
    const svc = new CopilotService({} as never, { run: vi.fn(async () => ({ content: '' })) } as never, { get: () => '' } as never);
    const auth = { userId: 'busy' } as never;
    for (let i = 0; i < 20; i++) await svc.chat(auth, { messages: [{ role: 'user', content: 'hello' }], language: 'en' });
    await expect(svc.chat(auth, { messages: [{ role: 'user', content: 'hello' }], language: 'en' })).rejects.toThrow(/Too many/);
  });
});
