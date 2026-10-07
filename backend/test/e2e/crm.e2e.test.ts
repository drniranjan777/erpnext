import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, API_URL, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let rep: Awaited<ReturnType<typeof addMember>>;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const C = '/crm';

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

beforeAll(async () => {
  a = await signupWorkspace('crm-a');
  emails.push(a.email);
  const role = await ok(await a.client.post('/iam/roles', { name: 'Sales rep', permissions: ['crm.leads.read', 'crm.leads.manage', 'crm.opportunities.read', 'crm.opportunities.manage'] }), 201);
  rep = await addMember(a.client, 'crm-rep', [role.id]);
  emails.push(rep.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.box = await ok(await a.client.post('/masters/items', { name: '5-ply corrugated box', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '48191010', sellingRate: '42' }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('leads', () => {
  it('assigns by territory, scores and flags duplicates', async () => {
    ctx.south = await ok(await a.client.post(`${C}/territories`, { code: 'south', name: 'South', stateCodes: ['36', '29'], ownerId: rep.userId }), 201);
    expect((await a.client.post(`${C}/territories`, { code: 'TS2', name: 'Clash', stateCodes: ['36'] })).status).toBe(409);
    ctx.lead = await ok(
      await a.client.post(`${C}/leads`, { name: 'Kiran Rao', company: 'Deccan Foods', email: 'purchase@deccanfoods.in', phone: '+91 98765 43210', city: 'Hyderabad', stateCode: '36', source: 'referral', requirement: '5000 printed 5-ply boxes a month for spice packs', estimatedValue: 1200000 }),
      201,
    );
    expect(ctx.lead).toMatchObject({ number: 'LD00001', ownerId: rep.userId, territoryId: ctx.south.id, score: 90 });
    const dup = await ok(await a.client.post(`${C}/leads`, { name: 'Kiran', phone: '9876543210', source: 'whatsapp' }), 201);
    expect(dup.duplicateOfId).toBe(ctx.lead.id);
    expect(dup.ownerId).toBeNull();
    const assigned = await ok(await a.client.post(`${C}/leads/assign`, { leadIds: [dup.id], ownerId: rep.userId }));
    expect(assigned.assigned).toBe(1);
  });

  it('imports an IndiaMART export once', async () => {
    const csv = 'SENDER_NAME,SENDER_MOBILE,SENDER_EMAIL,SENDER_COMPANY,SENDER_CITY,SENDER_STATE,QUERY_PRODUCT_NAME,QUERY_MESSAGE,UNIQUE_QUERY_ID\nRamesh,9811122233,ramesh@gmail.com,Ramesh Traders,Bengaluru,Karnataka,Corrugated Box,Need 1000 boxes,IM-1001\nSita,9822233344,,,,Gujarat,Carton,,IM-1002\n,,,,,,,,\n';
    const send = async () => {
      const form = new FormData();
      form.append('file', new Blob([csv], { type: 'text/csv' }), 'indiamart.csv');
      const res = await fetch(`${API_URL}${C}/leads/import?source=indiamart`, { method: 'POST', headers: { authorization: `Bearer ${a.client.accessToken}` }, body: form });
      expect(res.status).toBe(200);
      return res.json();
    };
    expect(await send()).toMatchObject({ created: 2, alreadyImported: 0 });
    expect(await send()).toMatchObject({ created: 0, alreadyImported: 2 });
    const list = await ok(await a.client.get(`${C}/leads?source=indiamart`));
    const ramesh = list.items.find((l: any) => l.name === 'Ramesh');
    // Karnataka is in the South territory.
    expect(ramesh).toMatchObject({ stateCode: '29', ownerId: rep.userId, territory: 'South' });
  });

  it('takes enquiries from a public web form', async () => {
    const form = await ok(await a.client.post(`${C}/forms`, { name: 'Website contact', ownerId: rep.userId }), 201);
    expect(form.key.startsWith(`${a.tenantId}.`)).toBe(true);
    const post = (body: unknown, key = form.key) => fetch(`${API_URL}/public/crm/forms/${key}/leads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r = await post({ name: 'Anita Shah', email: 'anita@shahpharma.com', state: 'Gujarat', message: 'Please quote for pharma cartons' });
    expect(r.status).toBe(200);
    expect((await r.json()).reference).toMatch(/^LD\d+$/);
    expect((await post({ name: 'Bot', email: 'x@y.com', website: 'spam' })).status).toBe(400);
    expect((await post({ name: 'No contact' })).status).toBe(400);
    expect((await post({ name: 'Wrong', email: 'w@x.com' }, `${a.tenantId}.${'x'.repeat(24)}`)).status).toBe(404);
    // Any website may post to the public route; the private API keeps its origin list.
    const pre = (path: string) => fetch(`${API_URL}${path}`, { method: 'OPTIONS', headers: { origin: 'https://example.org', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    expect((await pre(`/public/crm/forms/${form.key}/leads`)).headers.get('access-control-allow-origin')).toBe('*');
    expect((await pre(`${C}/leads`)).headers.get('access-control-allow-origin')).toBeNull();
    const list = await ok(await rep.client.get(`${C}/leads?source=web`));
    expect(list.items[0]).toMatchObject({ name: 'Anita Shah', ownerId: rep.userId });
  });

  it('moves a lead on with activities and converts it', async () => {
    const due = new Date(Date.now() - 3_600_000).toISOString();
    const task = await ok(await rep.client.post(`${C}/activities`, { kind: 'call', subject: 'First call', dueAt: due, leadId: ctx.lead.id }), 201);
    const agenda = await ok(await rep.client.get(`${C}/activities/agenda`));
    expect(agenda.find((x: any) => x.id === task.id)).toMatchObject({ overdue: true, leadName: 'Kiran Rao' });
    await ok(await rep.client.post(`${C}/activities/${task.id}/done`, { outcome: 'Wants samples' }));
    let lead = await ok(await rep.client.get(`${C}/leads/${ctx.lead.id}`));
    expect(lead.status).toBe('contacted');
    expect(lead.score).toBe(95);
    expect(lead.activities).toHaveLength(1);
    await ok(await rep.client.post(`${C}/leads/${ctx.lead.id}/status`, { status: 'qualified' }));
    // A rep may not create customers: conversion needs the masters permission too.
    expect((await rep.client.post(`${C}/leads/${ctx.lead.id}/convert`, {})).status).toBe(403);
    const conv = await ok(
      await a.client.post(`${C}/leads/${ctx.lead.id}/convert`, { party: { name: 'Deccan Foods Pvt Ltd', gstin: '36AABCD1234E1Z9', address: { line1: 'Plot 12, IDA Uppal', city: 'Hyderabad', stateCode: '36', pincode: '500039' } }, opportunity: { title: 'Spice pack boxes', amount: 1200000, closeDate: addDays(today(), 20) } }),
    );
    expect(conv.partyId).toBeTruthy();
    ctx.opp = conv.opportunityId;
    lead = await ok(await a.client.get(`${C}/leads/${ctx.lead.id}`));
    expect(lead).toMatchObject({ status: 'converted', partyName: 'Deccan Foods Pvt Ltd' });
    expect((await a.client.post(`${C}/leads/${ctx.lead.id}/convert`, {})).status).toBe(409);
    expect((await ok(await a.client.get(`/masters/parties/${conv.partyId}`))).contacts[0]).toMatchObject({ name: 'Kiran Rao' });
  });
});

describe('pipeline', () => {
  it('quotes from the opportunity and moves it to proposal', async () => {
    const r = await ok(await a.client.post(`${C}/opportunities/${ctx.opp}/quote`, { lines: [{ itemId: ctx.box.id, qty: 5000, rate: 40 }] }));
    expect(r.amount).toBe('200000.00');
    const o = await ok(await a.client.get(`${C}/opportunities/${ctx.opp}`));
    expect(o).toMatchObject({ stage: 'Proposal', quotationId: r.quotationId, amount: '200000.00' });
    expect(o.quotationNumber).toBeNull();
    const q = await ok(await a.client.get(`/sales/quotations/${r.quotationId}`));
    expect(q.customerEnquiryRef).toBe(o.number);
  });

  it('forecasts the weighted pipeline and needs a reason to lose', async () => {
    const stages = await ok(await a.client.get(`${C}/stages`));
    const fc = await ok(await a.client.get(`${C}/forecast`));
    const total = fc.byMonth.reduce((s: number, m: any) => s + m.weighted, 0);
    expect(total).toBe(100000);
    const lost = stages.find((s: any) => s.kind === 'lost');
    expect((await a.client.post(`${C}/opportunities/${ctx.opp}/move`, { stageId: lost.id })).status).toBe(400);
    const won = stages.find((s: any) => s.kind === 'won');
    expect((await rep.client.post(`${C}/targets`, { userId: rep.userId, month: today().slice(0, 7), amount: 500000 })).status).toBe(403);
    await ok(await a.client.post(`${C}/targets`, { userId: rep.userId, month: today().slice(0, 7), amount: 500000 }));
    expect(await ok(await rep.client.post(`${C}/opportunities/${ctx.opp}/move`, { stageId: won.id }))).toMatchObject({ status: 'won' });
    const t = await ok(await a.client.get(`${C}/targets`));
    expect(t.find((x: any) => x.userId === rep.userId)).toMatchObject({ target: 500000, won: 200000 });
    const s = await ok(await a.client.get(`${C}/summary`));
    expect(s).toMatchObject({ openOpportunities: 0 });
    expect(s.bySource.find((x: any) => x.source === 'referral')).toMatchObject({ leads: 1, converted: 1 });
  });
});
