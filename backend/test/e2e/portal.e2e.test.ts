import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, Client, signupWorkspace, strongPassword } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const A = '/portal-admin';

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

/** Accepts an invite link and returns a client carrying the portal token. */
async function join(inviteUrl: string, password: string) {
  const token = decodeURIComponent(new URL(inviteUrl).searchParams.get('token')!);
  const c = new Client();
  const preview = await ok(await c.get(`/portal/auth/invite?token=${encodeURIComponent(token)}`));
  const s = await ok(await c.post('/portal/auth/accept', { token, password }));
  expect(s.token).toMatch(/^ngp_/);
  c.accessToken = s.token;
  return { client: c, preview, token };
}

beforeAll(async () => {
  a = await signupWorkspace('portal-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id])).MAIN;
  ctx.item = await ok(await a.client.post('/masters/items', { name: 'Corrugated box 5-ply', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '48191010', sellingRate: '42' }), 201);
  const entry = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: ctx.wh, lines: [{ itemId: ctx.item.id, qty: '500', rate: '30' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${entry.id}/submit`, { version: entry.version }));
  const addr = [{ type: 'both', line1: 'Plot 4, IDA Uppal', city: 'Hyderabad', stateCode: '36', pincode: '500039', isDefault: true }];
  ctx.cust = await ok(await a.client.post('/masters/parties', { name: 'Deccan Foods', isCustomer: true, gstin: '36AABCD1234E1Z9', email: 'accounts@deccanfoods.in', addresses: addr }), 201);
  ctx.other = await ok(await a.client.post('/masters/parties', { name: 'Sri Sai Traders', isCustomer: true, gstRegistrationType: 'unregistered', addresses: addr }), 201);
  ctx.vendor = await ok(await a.client.post('/masters/parties', { name: 'Kraft Paper Mills', isVendor: true, gstRegistrationType: 'unregistered', addresses: addr }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('portal logins', () => {
  it('invites a customer contact, who sets a password and signs in with the workspace code', async () => {
    expect((await a.client.post(`${A}/users`, { partyId: ctx.vendor.id, name: 'Vendor', email: 'v@kraft.in' })).status).toBe(400);
    expect((await a.client.post(`${A}/users`, { partyId: ctx.cust.id, kind: 'dealer', name: 'Kiran', email: 'kiran@deccanfoods.in' })).status).toBe(400);
    const inv = await ok(await a.client.post(`${A}/users`, { partyId: ctx.cust.id, name: 'Kiran Rao', email: 'kiran@deccanfoods.in' }), 201);
    expect((await a.client.post(`${A}/users`, { partyId: ctx.other.id, name: 'Someone', email: 'KIRAN@deccanfoods.in' })).status).toBe(409);
    ctx.password = strongPassword();
    const j = await join(inv.inviteUrl, ctx.password);
    expect(j.preview).toMatchObject({ party: 'Deccan Foods', kind: 'customer', workspace: a.slug });
    // The link works once.
    expect((await new Client().post('/portal/auth/accept', { token: j.token, password: strongPassword() })).status).toBe(404);
    ctx.kiran = j.client;
    ctx.kiranId = inv.id;

    const anon = new Client();
    expect((await anon.post('/portal/auth/login', { workspace: a.slug, email: 'kiran@deccanfoods.in', password: 'wrong-password-1' })).status).toBe(401);
    expect((await anon.post('/portal/auth/login', { workspace: 'no-such-workspace', email: 'kiran@deccanfoods.in', password: ctx.password })).status).toBe(401);
    const s = await ok(await anon.post('/portal/auth/login', { workspace: a.slug, email: 'Kiran@DeccanFoods.in', password: ctx.password }));
    expect(s.token).toMatch(/^ngp_/);
    expect((await a.client.get(`${A}/users`)).body[0]).toMatchObject({ party: 'Deccan Foods', status: 'active' });
  });

  it('keeps portal and staff tokens apart', async () => {
    expect((await new Client().get('/portal/me')).status).toBe(401);
    // A staff token is not a portal session, and a portal token cannot call staff routes.
    expect((await a.client.get('/portal/me')).status).toBe(401);
    expect((await ctx.kiran.get('/masters/parties')).status).toBe(401);
    expect(await ok(await ctx.kiran.get('/portal/me'))).toMatchObject({ name: 'Kiran Rao', kind: 'customer', party: { name: 'Deccan Foods' } });
  });
});

describe('customer portal', () => {
  it('places an order that staff accept into a draft sales order', async () => {
    const cat = await ok(await ctx.kiran.get('/portal/catalogue?q=box'));
    expect(cat[0]).toMatchObject({ id: ctx.item.id, sellingRate: '42.0000' });
    const o = await ok(await ctx.kiran.post('/portal/requests', { customerPoNo: 'DF/PO/88', lines: [{ itemId: ctx.item.id, qty: 200 }] }), 201);
    expect(o).toMatchObject({ number: 'POR000001', status: 'submitted' });
    const list = await ok(await a.client.get(`${A}/orders?status=submitted`));
    expect(list[0]).toMatchObject({ number: 'POR000001', customer: 'Deccan Foods', placedBy: 'Kiran Rao' });
    expect(list[0].lines[0]).toMatchObject({ code: ctx.item.code, qty: '200' });
    expect((await a.client.post(`${A}/orders/${o.id}/decide`, { accept: false })).status).toBe(400);
    const d = await ok(await a.client.post(`${A}/orders/${o.id}/decide`, { accept: true, warehouseId: ctx.wh }));
    const so = await ok(await a.client.get(`/sales/orders/${d.salesOrderId}`));
    expect(so).toMatchObject({ status: 'draft', customerPoNo: 'DF/PO/88' });
    expect(so.lines[0]).toMatchObject({ qty: '200.0000', rate: '42.0000' });
    expect((await ok(await ctx.kiran.get('/portal/requests')))[0]).toMatchObject({ status: 'accepted', salesOrderId: d.salesOrderId });
    expect((await ctx.kiran.post(`/portal/requests/${o.id}/withdraw`)).status).toBe(409);
  });

  it('shows invoices and the statement for its own party only', async () => {
    const created = await ok(await a.client.post('/sales/invoices', { customerId: ctx.cust.id, warehouseId: ctx.wh, lines: [{ itemId: ctx.item.id, qty: '10', rate: '50' }] }), 201);
    await ok(await a.client.post(`/sales/invoices/${created.id}/submit`, { version: created.version }));
    const otherInv = await ok(await a.client.post('/sales/invoices', { customerId: ctx.other.id, warehouseId: ctx.wh, lines: [{ itemId: ctx.item.id, qty: '1', rate: '50' }] }), 201);
    await ok(await a.client.post(`/sales/invoices/${otherInv.id}/submit`, { version: otherInv.version }));

    const invs = await ok(await ctx.kiran.get('/portal/invoices'));
    expect(invs).toHaveLength(1);
    expect(invs[0]).toMatchObject({ id: created.id, grandTotal: '590.00', outstanding: '590.00', state: 'open' });
    expect((await ok(await ctx.kiran.get(`/portal/invoices/${created.id}`))).lines[0]).toMatchObject({ hsnCode: '48191010', taxableValue: '500.00' });
    expect((await ctx.kiran.get(`/portal/invoices/${otherInv.id}`)).status).toBe(404);
    const me = await ok(await ctx.kiran.get('/portal/me'));
    expect(me).toMatchObject({ outstanding: '590.00', requests: 0 });
    const st = await ok(await ctx.kiran.get('/portal/statement'));
    expect(st.party.name).toBe('Deccan Foods');
    expect(st.openBills.map((b: any) => b.id)).toContain(created.id);
    expect(st.ledger.entries[0]).not.toHaveProperty('narration');
    expect(await ok(await ctx.kiran.get('/portal/payments'))).toEqual([]);
  });

  it('raises a ticket, sees replies but not internal notes, and writes back', async () => {
    await ok(await a.client.post('/service/articles', { title: 'Boxes crushing in stacking', body: '1. Check the stacking height.\n2. Store away from damp floors.', tags: ['box', 'stacking'], isPublic: true }), 201);
    await ok(await a.client.post('/service/articles', { title: 'Internal: board grammage chart', body: 'For staff only, not for customers.', tags: ['box'] }), 201);
    const t = await ok(await ctx.kiran.post('/portal/tickets', { subject: 'Boxes crushing when stacked', description: 'Last lot of boxes is crushing in stacking, please help' }), 201);
    const staffView = await ok(await a.client.get(`/service/tickets/${t.id}`));
    expect(staffView).toMatchObject({ partyId: ctx.cust.id, channel: 'portal', contactEmail: 'kiran@deccanfoods.in', contactName: 'Kiran Rao' });

    const assist = await ok(await a.client.get(`/service/tickets/${t.id}/assist`));
    expect(assist.mode).toBe('basic');
    expect(assist.reply).toContain(t.number);
    expect(assist.reply).toContain('Dear Kiran Rao');

    await ok(await a.client.post(`/service/tickets/${t.id}/reply`, { body: 'Please share photos of the stack.', toCustomer: true }));
    await ok(await a.client.post(`/service/tickets/${t.id}/reply`, { body: 'Probably a damp warehouse.', toCustomer: false }));
    await ok(await a.client.post(`/service/tickets/${t.id}/status`, { status: 'waiting_customer' }));
    const mine = await ok(await ctx.kiran.get(`/portal/tickets/${t.id}`));
    expect(mine.messages.map((m: any) => m.body)).toEqual(['Please share photos of the stack.']);
    await ok(await ctx.kiran.post(`/portal/tickets/${t.id}/messages`, { body: 'Photos sent on WhatsApp.' }));
    const after = await ok(await a.client.get(`/service/tickets/${t.id}`));
    expect(after.status).toBe('open');
    expect(after.events.at(-1)).toMatchObject({ kind: 'customer', body: 'Photos sent on WhatsApp.' });
    expect((await ctx.kiran.post(`/portal/tickets/${t.id}/rating`, { rating: 5 })).status).toBe(409);

    const kb = await ok(await ctx.kiran.get('/portal/articles?q=box'));
    expect(kb.map((x: any) => x.title)).toEqual(['Boxes crushing in stacking']);
    ctx.ticket = t;
  });
});

describe('dealer portal and isolation', () => {
  it('shows schemes, claims and stock to a dealer', async () => {
    await ok(await a.client.post('/dms/distributors', { partyId: ctx.other.id }), 201);
    const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
    await ok(await a.client.post('/dms/schemes', { code: 'BOX10', name: '10 % off on 100 boxes', kind: 'qty_slab', level: 'secondary', itemIds: [ctx.item.id], slabs: [{ min: 100, discountPct: 10 }], fromDate: `${today.slice(0, 8)}01`, toDate: monthEnd }), 201);
    const inv = await ok(await a.client.post(`${A}/users`, { partyId: ctx.other.id, kind: 'dealer', name: 'Ramesh', email: 'ramesh@srisai.in' }), 201);
    const dealer = (await join(inv.inviteUrl, strongPassword())).client;
    expect((await ok(await dealer.get('/portal/me'))).dealer).toMatchObject({ activeSchemes: 1, pendingClaims: 0 });
    expect((await ok(await dealer.get('/portal/schemes')))[0]).toMatchObject({ code: 'BOX10', items: [ctx.item.code] });
    const c = await ok(await dealer.post('/portal/claims', { kind: 'damage', fromDate: `${today.slice(0, 8)}01`, toDate: today, claimedAmount: 1200, notes: 'Wet cartons in transit' }), 201);
    expect(c.status).toBe('submitted');
    expect((await ok(await dealer.get('/portal/me'))).dealer.pendingClaims).toBe(1);
    expect(await ok(await dealer.get('/portal/claims'))).toHaveLength(1);
    expect(await ok(await dealer.get('/portal/stock'))).toBeTruthy();
    // The customer contact is not a dealer.
    expect((await ctx.kiran.get('/portal/schemes')).status).toBe(404);
    // Nor can the dealer see the other party's ticket or invoice.
    expect((await dealer.get(`/portal/tickets/${ctx.ticket.id}`)).status).toBe(404);
    expect(await ok(await dealer.get('/portal/invoices'))).toHaveLength(1);
    ctx.dealer = dealer;
  });

  it('ends sessions when a login is disabled', async () => {
    await ok(await a.client.post(`${A}/users/${ctx.kiranId}/disable`));
    expect((await ctx.kiran.get('/portal/me')).status).toBe(401);
    expect((await new Client().post('/portal/auth/login', { workspace: a.slug, email: 'kiran@deccanfoods.in', password: ctx.password })).status).toBe(401);
    const re = await ok(await a.client.post(`${A}/users/${ctx.kiranId}/reissue`));
    expect(re.inviteUrl).toContain('/portal/accept?token=');
    expect((await ok(await new Client().post('/portal/auth/login', { workspace: a.slug, email: 'kiran@deccanfoods.in', password: ctx.password }))).token).toMatch(/^ngp_/);
  });
});

describe('sales assistance', () => {
  it('explains a lead score and suggests the next action', async () => {
    const lead = await ok(await a.client.post('/crm/leads', { name: 'Anil', phone: '9876512345', source: 'indiamart', requirement: 'boxes' }), 201);
    const l = await ok(await a.client.get(`/crm/leads/${lead.id}`));
    expect(l.insight.grade).toBe('C');
    expect(l.insight.missing).toContain('+15 with a business email');
    expect(l.insight.nextAction).toMatchObject({ action: 'call', urgency: 'now' });
  });
});
