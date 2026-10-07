import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let tech: Awaited<ReturnType<typeof addMember>>;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const S = '/service';

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

/** Moves a ticket's targets into the past (the owner role bypasses row security). */
async function backdate(ticketId: string) {
  const url = process.env.DATABASE_OWNER_URL ?? readFileSync(join(__dirname, '..', '..', '..', 'database', '.env'), 'utf8').match(/^DATABASE_OWNER_URL=(.*)$/m)?.[1];
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(`update svc_tickets set response_due_at = now() - interval '2 hours', resolution_due_at = now() - interval '1 minute' where id = $1`, [ticketId]);
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  a = await signupWorkspace('svc-a');
  emails.push(a.email);
  const role = await ok(await a.client.post('/iam/roles', { name: 'Technician', permissions: ['service.tickets.read', 'service.field.manage'] }), 201);
  tech = await addMember(a.client, 'svc-tech', [role.id]);
  emails.push(tech.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id])).MAIN;
  ctx.chiller = await ok(await a.client.post('/masters/items', { name: 'Water chiller 5 TR', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '84186990' }), 201);
  ctx.spare = await ok(await a.client.post('/masters/items', { name: 'Compressor relay', type: 'consumable', baseUomId: uom.NOS, gstRate: 18, hsnCode: '85364900' }), 201);
  const entry = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: ctx.wh, lines: [{ itemId: ctx.spare.id, qty: '20', rate: '450' }] }), 201);
  await ok(await a.client.post(`/inventory/stock-entries/${entry.id}/submit`, { version: entry.version }));
  ctx.cust = await ok(await a.client.post('/masters/parties', { name: 'Deccan Pharma', isCustomer: true, gstin: '36AABCD1234E1Z9', email: 'maint@deccanpharma.in', addresses: [{ type: 'both', line1: 'Plot 9, IDA Bollaram', city: 'Hyderabad', stateCode: '36', pincode: '502325', isDefault: true }], contacts: [{ name: 'Suresh', phone: '9876501234', isPrimary: true }] }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('tickets and SLA', () => {
  it('matches the customer, triages, finds the warranty and sets targets', async () => {
    await ok(await a.client.post(`${S}/warranties`, { partyId: ctx.cust.id, itemId: ctx.chiller.id, serialNo: 'CH-1001', saleDate: addDays(today(), -100), months: 12 }), 201);
    expect((await a.client.post(`${S}/warranties`, { partyId: ctx.cust.id, itemId: ctx.chiller.id, serialNo: 'ch-1001' })).status).toBe(409);
    const t = await ok(await a.client.post(`${S}/tickets`, { contactName: 'Suresh', contactPhone: '+91 98765 01234', channel: 'phone', subject: 'Chiller not working', description: 'Production line stopped since 6 am', serialNo: 'CH-1001' }), 201);
    expect(t).toMatchObject({ number: 'TKT000001', partyId: ctx.cust.id, category: 'breakdown', priority: 'urgent', itemId: ctx.chiller.id });
    expect(t.warrantyId).toBeTruthy();
    // Urgent: respond in 1 hour, resolve in 4 (round the clock by default).
    expect(Date.parse(t.resolutionDueAt) - Date.parse(t.createdAt)).toBe(4 * 3_600_000);
    ctx.ticket = t;
  });

  it('escalates missed targets and notes the history', async () => {
    await ok(await a.client.post(`${S}/tickets/${ctx.ticket.id}/assign`, { userId: tech.userId }));
    await backdate(ctx.ticket.id);
    expect(await ok(await a.client.post(`${S}/sla/check`))).toMatchObject({ escalated: 1 });
    const t = await ok(await a.client.get(`${S}/tickets/${ctx.ticket.id}`));
    expect(t).toMatchObject({ escalationLevel: 2, response: 'breached', resolutionSla: 'breached' });
    expect(t.events.map((e: any) => e.kind)).toEqual(['status', 'assign', 'escalation']);
    expect((await ok(await a.client.get(`${S}/tickets?breached=true`))).map((x: any) => x.id)).toContain(ctx.ticket.id);
    // Escalating again does nothing more.
    expect((await ok(await a.client.post(`${S}/sla/check`))).escalated).toBe(0);
  });

  it('replies to the customer, suggests articles and resolves', async () => {
    await ok(await a.client.post(`${S}/articles`, { title: 'Chiller not cooling or not working', body: 'Check the compressor relay and the condenser fan before calling for a visit.', tags: ['chiller', 'compressor'] }), 201);
    const r = await ok(await a.client.post(`${S}/tickets/${ctx.ticket.id}/reply`, { body: 'Our engineer will reach you by noon.' }));
    expect(r.mailed).toBe(true);
    const t = await ok(await a.client.get(`${S}/tickets/${ctx.ticket.id}`));
    expect(t.status).toBe('in_progress');
    expect(t.firstResponseAt).toBeTruthy();
    expect(t.suggestions[0].title).toBe('Chiller not cooling or not working');
    expect((await a.client.post(`${S}/tickets/${ctx.ticket.id}/status`, { status: 'closed' })).status).toBe(400);
  });
});

describe('contracts, visits and RMA', () => {
  it('plans contract visits and covers the customer', async () => {
    const c = await ok(await a.client.post(`${S}/contracts`, { partyId: ctx.cust.id, kind: 'amc_comprehensive', fromDate: today(), toDate: addDays(today(), 364), value: 60000, visitsPerYear: 4, technicianId: tech.userId }), 201);
    expect(c).toMatchObject({ number: 'AMC00001', visitsPlanned: 4 });
    const t = await ok(await a.client.post(`${S}/tickets`, { partyId: ctx.cust.id, subject: 'Noise from the cooling tower pump', serialNo: 'PUMP-77' }), 201);
    expect(t.contractId).toBe(c.id);
    const visits = await ok(await tech.client.get(`${S}/visits?mine=true&status=scheduled`));
    expect(visits.filter((v: any) => v.contractNumber === 'AMC00001')).toHaveLength(4);
  });

  it('completes a breakdown visit: spares from stock, signature, ticket resolved', async () => {
    const v = await ok(await a.client.post(`${S}/visits`, { kind: 'breakdown', ticketId: ctx.ticket.id, technicianId: tech.userId, scheduledAt: new Date().toISOString() }), 201);
    expect(v).toMatchObject({ partyId: ctx.cust.id, serialNo: 'CH-1001' });
    await ok(await tech.client.post(`${S}/visits/${v.id}/start`));
    expect((await tech.client.post(`${S}/visits/${v.id}/complete`, { workDone: 'Replaced relay', spares: [{ itemId: ctx.spare.id, qty: 1 }], signedBy: 'Suresh' })).status).toBe(400);
    const done = await ok(await tech.client.post(`${S}/visits/${v.id}/complete`, { workDone: 'Replaced the compressor relay; chiller back to 7 °C', checklist: [{ item: 'Gas pressure', ok: true }], spares: [{ itemId: ctx.spare.id, qty: 1 }], warehouseId: ctx.wh, signedBy: 'Suresh', signature: 'data:image/png;base64,iVBORw0KGgo=' }));
    expect(done).toMatchObject({ status: 'done', chargeable: false });
    const entry = await ok(await a.client.get(`/inventory/stock-entries/${done.stockEntryId}`));
    expect(entry.status).toBe('approved');
    const t = await ok(await a.client.get(`${S}/tickets/${ctx.ticket.id}`));
    expect(t).toMatchObject({ status: 'resolved', resolution: 'Replaced the compressor relay; chiller back to 7 °C' });
    await ok(await a.client.post(`${S}/tickets/${ctx.ticket.id}/status`, { status: 'closed' }));
  });

  it('starts the warranty at installation', async () => {
    const v = await ok(await a.client.post(`${S}/visits`, { kind: 'installation', partyId: ctx.cust.id, itemId: ctx.chiller.id, serialNo: 'CH-2002', scheduledAt: new Date().toISOString() }), 201);
    const done = await ok(await tech.client.post(`${S}/visits/${v.id}/complete`, { workDone: 'Installed and commissioned', signedBy: 'Suresh' }));
    expect(done.warrantyId).toBeTruthy();
    const look = await ok(await a.client.get(`${S}/serials/CH-2002`));
    expect(look.warranty).toMatchObject({ startDate: today(), inWarranty: true });
    expect(look.visits).toHaveLength(1);
  });

  it('runs an RMA through repair or replacement', async () => {
    const r = await ok(await a.client.post(`${S}/rmas`, { partyId: ctx.cust.id, itemId: ctx.chiller.id, serialNo: 'CH-1001', reason: 'Compressor seized' }), 201);
    expect(r).toMatchObject({ number: 'RMA00001', underWarranty: true, status: 'authorised' });
    expect((await a.client.post(`${S}/rmas`, { partyId: ctx.cust.id, itemId: ctx.chiller.id, serialNo: 'CH-1001', reason: 'Again' })).status).toBe(409);
    expect((await a.client.post(`${S}/rmas/${r.id}/step`, { step: 'return', dispatchRef: 'X' })).status).toBe(409);
    await ok(await a.client.post(`${S}/rmas/${r.id}/step`, { step: 'receive' }));
    expect((await a.client.post(`${S}/rmas/${r.id}/step`, { step: 'replaced' })).status).toBe(400);
    await ok(await a.client.post(`${S}/rmas/${r.id}/step`, { step: 'replaced', diagnosis: 'Compressor beyond repair', replacementSerial: 'CH-1001R' }));
    await ok(await a.client.post(`${S}/rmas/${r.id}/step`, { step: 'return', dispatchRef: 'DC-445' }));
    const old = await ok(await a.client.get(`${S}/serials/CH-1001`));
    expect(old.warranty.status).toBe('void');
    const repl = await ok(await a.client.get(`${S}/serials/CH-1001R`));
    expect(repl.warranty).toMatchObject({ inWarranty: true, endDate: old.warranty.endDate });
  });

  it('reports SLA performance', async () => {
    const r = await ok(await a.client.get(`${S}/report`));
    const urgent = r.byPriority.find((p: any) => p.priority === 'urgent');
    expect(urgent).toMatchObject({ tickets: 1, responseMet: 0, resolutionMet: 0, responsePct: 0 });
    expect(r.byCategory.find((c: any) => c.category === 'breakdown').tickets).toBeGreaterThanOrEqual(1);
  });
});
