import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
async function submit(path: string, doc: any) {
  return ok(await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version }));
}

beforeAll(async () => {
  a = await signupWorkspace('voice-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id])).MAIN;
  const mk = async (name: string, patch: Record<string, unknown> = {}) => ok(await a.client.post('/masters/items', { name, type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '84145120', ...patch }), 201);
  ctx.fan = await mk('Ceiling fan', { type: 'finished_good' });
  ctx.motor = await mk('Fan motor');
  ctx.resin = await mk('HDPE resin', { baseUomId: uom.KG });
  const line = await ok(await a.client.post('/manufacturing/work-centers', { code: 'L2', name: 'Line 2', kind: 'line', labourRate: '150' }), 201);
  await submit('/manufacturing/boms', await ok(await a.client.post('/manufacturing/boms', { itemId: ctx.fan.id, lines: [{ itemId: ctx.motor.id, qty: '1' }], operations: [{ seq: 10, name: 'Assemble', workCenterId: line.id, runMinutes: '2' }] }), 201));
  await ok(await a.client.post('/manufacturing/work-orders', { itemId: ctx.fan.id, qty: '100', sourceWarehouseId: ctx.wh, targetWarehouseId: ctx.wh }), 201);
  const e = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: ctx.wh, lines: [{ itemId: ctx.resin.id, qty: '420', rate: '110' }] }), 201);
  await submit('/inventory/stock-entries', e);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('voice commands', () => {
  it('turns the Hinglish line command into a production order to confirm, then creates it', async () => {
    const r = await ok(await a.client.post('/voice/interpret', { text: 'Line 2 par 5,000 units ka production order banao', lang: 'hi-IN' }));
    expect(r).toMatchObject({ kind: 'confirm', command: 'work_order', params: { itemId: ctx.fan.id, qty: '5000' } });
    expect(r.reply).toContain('Line 2');
    expect(r.notes[0]).toContain(ctx.fan.code);
    const done = await ok(await a.client.post('/voice/execute', { logId: r.logId, command: 'work_order', params: r.params }));
    const wo = await ok(await a.client.get(`/manufacturing/work-orders/${done.id}`));
    expect(wo).toMatchObject({ status: 'draft', qty: '5000.0000' });
    expect((await a.client.post('/voice/execute', { logId: r.logId, command: 'work_order', params: r.params })).status).toBe(400);
  });

  it('answers stock questions in Hindi and English', async () => {
    const hi = await ok(await a.client.post('/voice/interpret', { text: 'HDPE resin ka stock kitna hai', lang: 'hi-IN' }));
    expect(hi).toMatchObject({ kind: 'answer', command: 'stock' });
    expect(hi.reply).toBe('HDPE resin का स्टॉक 420 KG है।');
    const en = await ok(await a.client.post('/voice/interpret', { text: 'how much stock of resin', lang: 'en-IN' }));
    expect(en.reply).toBe('HDPE resin: 420 KG in stock.');
  });

  it('raises a requisition, asks back when unsure, and falls back to the copilot', async () => {
    const r = await ok(await a.client.post('/voice/interpret', { text: '50 kg resin mangwao', lang: 'hi-IN' }));
    expect(r).toMatchObject({ kind: 'confirm', command: 'requisition' });
    const pr = await ok(await a.client.post('/voice/execute', { logId: r.logId, command: 'requisition', params: { ...r.params, lines: [{ ...r.params.lines[0], quantity: '60' }] } }));
    expect((await ok(await a.client.get(`/purchase/requisitions/${pr.id}`))).lines[0]).toMatchObject({ quantity: '60.0000' });
    expect(await ok(await a.client.post('/voice/interpret', { text: '50 kg unobtainium mangwao', lang: 'en-IN' }))).toMatchObject({ kind: 'clarify' });
    const fb = await ok(await a.client.post('/voice/interpret', { text: 'show my pending approvals', lang: 'en-IN' }));
    expect(fb).toMatchObject({ kind: 'answer', command: null });
    const s = await ok(await a.client.get('/voice/stats'));
    expect(s.evalSet.accuracyPct).toBeGreaterThanOrEqual(90);
    // One executed as heard, one corrected on the confirm screen.
    expect(s.fieldAccuracyPct).toBe(50);
    expect(s.languages).toHaveLength(8);
  });
});
