import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const AI = '/ai';
const ALL = ['inventory', 'purchase', 'sales', 'finance', 'production', 'maintenance', 'quality', 'hr', 'compliance', 'support'];

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const put = (path: string, b: unknown) => a.client.request('PUT', path, b);
async function submit(path: string, doc: any) {
  return ok(await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version }));
}
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Runs SQL as the owner role (bypasses row security) to age test data. */
async function owner(q: string, params: unknown[]) {
  const url = process.env.DATABASE_OWNER_URL ?? readFileSync(join(__dirname, '..', '..', '..', 'database', '.env'), 'utf8').match(/^DATABASE_OWNER_URL=(.*)$/m)?.[1];
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(q, params);
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  a = await signupWorkspace('aib-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id])).MAIN;
  ctx.item = await ok(await a.client.post('/masters/items', { name: 'Ceiling fan', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '84145120', sellingRate: '2500' }), 201);
  const e = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: ctx.wh, lines: [{ itemId: ctx.item.id, qty: '50', rate: '1500' }] }), 201);
  await submit('/inventory/stock-entries', e);
  ctx.cust = await ok(await a.client.post('/masters/parties', { name: 'Sri Sai Electricals', isCustomer: true, gstin: '36AABCD1234E1Z9', email: 'accounts@srisai.in', addresses: [{ type: 'both', line1: 'Abids', city: 'Hyderabad', stateCode: '36', pincode: '500001', isDefault: true }] }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('business agents', () => {
  it('every agent runs cleanly on a workspace', async () => {
    const list = await ok(await a.client.get(`${AI}/agents`));
    expect(list.agents.map((x: any) => x.code).sort()).toEqual([...ALL].sort());
    for (const code of ALL) expect(await ok(await a.client.post(`${AI}/agents/${code}/run`)), code).toMatchObject({ status: 'ok' });
  });

  it('chases overdue payments and lapsing quotations with drafted emails', async () => {
    const inv = await ok(await a.client.post('/sales/invoices', { customerId: ctx.cust.id, warehouseId: ctx.wh, creditDays: 15, lines: [{ itemId: ctx.item.id, qty: '4', rate: '2500' }] }), 201);
    await submit('/sales/invoices', inv);
    await owner(`update sales_invoices set due_date = current_date - 25 where id = $1`, [inv.id]);
    const q = await ok(await a.client.post('/sales/quotations', { customerId: ctx.cust.id, validUntil: addDays(today(), 2), lines: [{ itemId: ctx.item.id, qty: '20' }] }), 201);
    await submit('/sales/quotations', q);
    await ok(await a.client.post(`${AI}/agents/sales/run`));
    const inbox = await ok(await a.client.get(`${AI}/inbox?agent=sales`));
    const overdue = inbox.find((r: any) => r.kind === 'payment_overdue');
    expect(overdue).toMatchObject({ title: 'Sri Sai Electricals owes ₹11,800 overdue', action: { type: 'email_party' } });
    expect(overdue.action.params.body).toContain('Total overdue: ₹11,800');
    expect(inbox.find((r: any) => r.kind === 'quote_followup')).toMatchObject({ action: { type: 'email_party' } });
    const sent = await ok(await a.client.post(`${AI}/inbox/${overdue.id}/decide`, { approve: true }));
    expect(sent.result).toEqual({ sentTo: 'accounts@srisai.in' });
  });

  it('drafts a first reply to an unanswered ticket and sends it on approval', async () => {
    const t = await ok(await a.client.post('/service/tickets', { partyId: ctx.cust.id, contactName: 'Ravi', contactEmail: 'ravi@srisai.in', channel: 'email', subject: 'Fan making noise', description: 'The new ceiling fan is making a grinding noise' }), 201);
    await owner(`update svc_tickets set created_at = now() - interval '2 hours' where id = $1`, [t.id]);
    await ok(await a.client.post(`${AI}/agents/support/run`));
    const [r] = (await ok(await a.client.get(`${AI}/inbox?agent=support`))).filter((x: any) => x.kind === 'ticket_first_reply');
    expect(r).toMatchObject({ severity: 'info', action: { type: 'reply_ticket' } });
    expect(r.action.params.body).toContain('Dear Ravi');
    const done = await ok(await a.client.post(`${AI}/inbox/${r.id}/decide`, { approve: true }));
    expect(done.result).toMatchObject({ mailed: true });
    expect((await ok(await a.client.get(`/service/tickets/${t.id}`))).firstResponseAt).toBeTruthy();
  });

  it('lists statutory due dates with the right permission', async () => {
    await ok(await put(`${AI}/agents/compliance`, { enabled: true, guardrails: { params: { aheadDays: 31 } } }));
    await ok(await a.client.post(`${AI}/agents/compliance/run`));
    const due = (await ok(await a.client.get(`${AI}/inbox?agent=compliance`))).filter((x: any) => x.kind === 'statutory_due');
    expect(due.length).toBeGreaterThanOrEqual(4);
    expect(due.map((d: any) => d.title).join(' ')).toMatch(/GSTR-3B/);
  });
});
