import { deflateSync } from 'node:zlib';
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

beforeAll(async () => {
  a = await signupWorkspace('plm-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  const mk = (name: string, type: string) => a.client.post('/masters/items', { name, type, baseUomId: uom.NOS, gstRate: 18, hsnCode: '84314990' });
  ctx.pump = await ok(await mk('Pump assembly PA-50', 'finished_good'), 201);
  ctx.casing = await ok(await mk('Pump casing', 'raw_material'), 201);
  ctx.impeller = await ok(await mk('Impeller', 'raw_material'), 201);
  ctx.box = await ok(await mk('Export carton', 'packing_material'), 201);
  ctx.vendor = await ok(await a.client.post('/masters/parties', { name: 'Coimbatore Castings', isVendor: true, gstin: '36AABCS1234E1ZU', addresses: [{ type: 'both', line1: 'Peenya', city: 'Hyderabad', stateCode: '36', pincode: '500058', isDefault: true }] }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('PLM', () => {
  it('releases an item through the gates with an engineering BOM and CAD', async () => {
    await ok(await a.client.post('/plm/items/move', { itemId: ctx.pump.id, to: 'design' }));
    await ok(await a.client.post('/plm/items/move', { itemId: ctx.pump.id, to: 'prototype' }));
    const gate = await a.client.post('/plm/items/move', { itemId: ctx.pump.id, to: 'released', password: a.password });
    expect(gate.status).toBe(409);
    expect(gate.body.detail).toContain('Release the engineering BOM first');
    let e = await ok(await a.client.post('/plm/eboms', { itemId: ctx.pump.id, revision: 'A', lines: [{ findNo: 10, itemId: ctx.casing.id, qty: 1 }, { findNo: 20, itemId: ctx.impeller.id, qty: 1, refDes: 'IMP-1' }] }));
    e = await ok(await a.client.post(`/plm/eboms/${e.id}/release`, { password: a.password }));
    expect(e.status).toBe('released');
    expect((await a.client.post('/plm/eboms', { itemId: ctx.pump.id, revision: 'A', lines: [{ findNo: 10, itemId: ctx.casing.id, qty: 2 }] })).status).toBe(409);
    // A manufacturing BOM drafted from it, then changed in manufacturing: the comparison shows the difference.
    e = await ok(await a.client.post(`/plm/eboms/${e.id}/mbom`, {}));
    const bom = await ok(await a.client.get(`/manufacturing/boms/${e.mbomId}`));
    const wc = await ok(await a.client.post('/manufacturing/work-centers', { code: 'ASSY', name: 'Assembly' }), 201);
    const upd = await ok(await a.client.request('PUT', `/manufacturing/boms/${bom.id}`, { version: bom.version, itemId: ctx.pump.id, quantity: '1', lines: [{ itemId: ctx.casing.id, qty: '1' }, { itemId: ctx.impeller.id, qty: '1' }, { itemId: ctx.box.id, qty: '1' }], operations: [{ seq: 10, name: 'Assemble', workCenterId: wc.id, runMinutes: '20' }] }));
    await ok(await a.client.post(`/manufacturing/boms/${bom.id}/submit`, { version: upd.version }));
    e = await ok(await a.client.get(`/plm/eboms/${e.id}`));
    expect(e.comparison).toMatchObject({ matches: true, onlyManufacturing: [{ itemId: ctx.box.id, qty: 1 }] });
    // CAD: created checked out, version checked in (STEP metadata read), released under signature.
    let cad = await ok(await a.client.post('/plm/cad', { number: 'PA-50-ASM', title: 'Pump assembly model', itemId: ctx.pump.id }), 201);
    expect((await a.client.post(`/plm/cad/${cad.id}/release`, { password: a.password })).status).toBe(409);
    const step = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Pump PA-50'),'2;1');\nFILE_NAME('pa50.step','2026-10-01T10:00:00',('Design team'),(''),'','','');\nFILE_SCHEMA(('AP242'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;";
    cad = await ok(await a.client.upload(`/plm/cad/${cad.id}/check-in?note=First%20issue`, 'pa50.step', step));
    expect(cad).toMatchObject({ format: 'step', checkedOutBy: null, metadata: { description: 'Pump PA-50', schema: 'AP242' } });
    expect((await a.client.upload(`/plm/cad/${cad.id}/check-in`, 'pa50.step', step)).status).toBe(409);
    cad = await ok(await a.client.post(`/plm/cad/${cad.id}/release`, { password: a.password }));
    expect(cad.status).toBe('released');
    const got = await a.client.download(`/plm/cad/versions/${cad.versions[0].id}/download`);
    expect(new TextDecoder().decode(got.bytes)).toBe(step);
    await ok(await a.client.post('/plm/items/move', { itemId: ctx.pump.id, to: 'released', password: a.password }));
    // Checking out a released file starts revision B.
    cad = await ok(await a.client.post(`/plm/cad/${cad.id}/check-out`, {}));
    expect(cad).toMatchObject({ revision: 'B', status: 'in_work' });
  });

  it('keeps phased-out items off purchase orders', async () => {
    await ok(await a.client.post('/plm/items/move', { itemId: ctx.casing.id, to: 'design' }));
    await ok(await a.client.post('/plm/items/move', { itemId: ctx.casing.id, to: 'prototype' }));
    const blocked = await a.client.post('/plm/items/move', { itemId: ctx.casing.id, to: 'released', password: a.password });
    expect(blocked.status).toBe(409);
    expect(blocked.body.detail).toBe('Release a CAD file or drawing for the item first');
    expect((await ok(await a.client.get('/plm/items'))).find((s: any) => s.itemId === ctx.casing.id).stage).toBe('prototype');
    await ok(await a.client.post('/plm/items/move', { itemId: ctx.box.id, to: 'design' }));
    await ok(await a.client.post('/plm/items/move', { itemId: ctx.box.id, to: 'prototype' }));
    const art = await ok(await a.client.post('/plm/cad', { number: 'CTN-ART-1', title: 'Carton artwork', itemId: ctx.box.id }), 201);
    await ok(await a.client.upload(`/plm/cad/${art.id}/check-in`, 'carton.pdf', '%PDF-1.4\n%%EOF', 'application/pdf'));
    await ok(await a.client.post(`/plm/cad/${art.id}/release`, { password: a.password }));
    await ok(await a.client.post('/plm/items/move', { itemId: ctx.box.id, to: 'released', password: a.password }));
    await ok(await a.client.post('/plm/items/move', { itemId: ctx.box.id, to: 'phase_out' }));
    const po = await ok(await a.client.post('/purchase/orders', { vendorId: ctx.vendor.id, lines: [{ itemId: ctx.box.id, qty: '100', rate: '45' }] }), 201);
    const sub = await a.client.post(`/purchase/orders/${po.id}/submit`, { version: po.version });
    expect(sub.status).toBe(400);
    expect(sub.body.detail).toContain('is phase-out');
  });
});

describe('document management', () => {
  it('versions, searches, signs and disposes of files', async () => {
    const folder = await ok(await a.client.post('/doc-store/folders', { name: 'Quality SOPs', retentionYears: 0 }), 201);
    expect((await a.client.post('/doc-store/folders', { name: 'Quality SOPs' })).status).toBe(409);
    let f = await ok(await a.client.post('/doc-store/files', { folderId: folder.id, title: 'Press maintenance SOP', docNo: 'SOP-MNT-014', tags: ['maintenance', 'press'] }), 201);
    const content = 'BT /F1 12 Tf (Lock out the hydraulic accumulator before opening the guard) Tj ET';
    const body = deflateSync(Buffer.from(content));
    const pdf = Buffer.concat([Buffer.from(`%PDF-1.4\n4 0 obj\n<< /Length ${body.length} /Filter /FlateDecode >>\nstream\n`), body, Buffer.from('\nendstream\nendobj\n%%EOF')]);
    f = await ok(await a.client.upload(`/doc-store/files/${f.id}/versions?note=Issue%201`, 'sop-014.pdf', new Uint8Array(pdf), 'application/pdf'));
    expect(f).toMatchObject({ currentVersion: 1, hasText: true });
    expect(f.versions[0].textExtracted).toBe(true);
    const hits = await ok(await a.client.get('/doc-store/files?q=hydraulic%20accumulator'));
    expect(hits.map((h: any) => h.id)).toEqual([f.id]);
    expect(hits[0].snippet).toContain('«hydraulic»');
    expect(await ok(await a.client.get('/doc-store/files?q=forklift'))).toEqual([]);
    expect((await ok(await a.client.get('/doc-store/files?tag=press'))).length).toBe(1);
    // Signing: Aadhaar eSign is not set up here; the sandbox signer works and verifies.
    const v1 = f.versions[0];
    expect((await a.client.post(`/doc-store/versions/${v1.id}/sign`, { provider: 'aadhaar_esign', password: a.password })).status).toBe(409);
    f = await ok(await a.client.post(`/doc-store/versions/${v1.id}/sign`, { password: a.password, reason: 'Approved for use' }));
    expect(f.versions[0].signatures).toHaveLength(1);
    expect(await ok(await a.client.get(`/doc-store/versions/${v1.id}/verify`))).toEqual([expect.objectContaining({ hashMatches: true, valid: true, provider: 'sandbox' })]);
    // A second version replaces the searchable text; only the current version can be signed.
    f = await ok(await a.client.upload(`/doc-store/files/${f.id}/versions`, 'sop-014.txt', 'Revised: isolate the pump motor first', 'text/plain'));
    expect(f.currentVersion).toBe(2);
    expect((await a.client.post(`/doc-store/versions/${v1.id}/sign`, { password: a.password })).status).toBe(409);
    expect((await ok(await a.client.get('/doc-store/files?q=accumulator'))).length).toBe(0);
    expect((await ok(await a.client.get('/doc-store/files?q=isolate'))).length).toBe(1);
    // Retention of 0 years: disposable today, unless on legal hold.
    await ok(await a.client.post(`/doc-store/files/${f.id}/hold`, { legalHold: true }));
    expect((await a.client.post(`/doc-store/files/${f.id}/dispose`, {})).status).toBe(409);
    await ok(await a.client.post(`/doc-store/files/${f.id}/hold`, { legalHold: false }));
    expect((await ok(await a.client.get('/doc-store/disposal-due'))).map((d: any) => d.id)).toEqual([f.id]);
    f = await ok(await a.client.post(`/doc-store/files/${f.id}/dispose`, {}));
    expect(f.status).toBe('disposed');
    expect((await a.client.download(`/doc-store/versions/${v1.id}/download`)).status).toBe(409);
  });
});
