import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const step = (p: any, key: string) => p.steps.find((s: any) => s.key === key);

beforeAll(async () => {
  a = await signupWorkspace('onb-a');
  emails.push(a.email);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('onboarding', () => {
  it('starts with an honest checklist', async () => {
    const p = await ok(await a.client.get('/onboarding/progress'));
    expect(p).toMatchObject({ industry: 'engineering', complete: false, done: 0 });
    expect(p.steps.map((s: any) => s.key)).toEqual(['company', 'template', 'items', 'parties', 'opening', 'books', 'bom', 'team', 'approvals', 'first']);
    expect(step(p, 'approvals').optional).toBe(true);
  });

  it('applies an industry template once, adding only what is missing', async () => {
    const templates = await ok(await a.client.get('/onboarding/templates'));
    expect(templates.map((t: any) => t.key)).toEqual(expect.arrayContaining(['engineering', 'plastic', 'pharma', 'food', 'other']));
    const first = await ok(await a.client.post('/onboarding/templates/apply', { industry: 'plastic' }));
    expect(first.added.warehouses.sort()).toEqual(['FG', 'REJ', 'SCRAP', 'SHOP']);
    expect(first.added.workCenters).toEqual(['IMM', 'BLOW', 'EXTR', 'PRINT', 'PACK']);
    expect(first.added.itemGroups).toEqual(['POLY', 'MB', 'REGR', 'INS']);
    const again = await ok(await a.client.post('/onboarding/templates/apply', { industry: 'plastic' }));
    expect(again.added).toEqual({ itemGroups: [], warehouses: [], workCenters: [] });
    const whs = (await a.client.get('/inventory/warehouses')).body;
    expect(whs.find((w: any) => w.code === 'REJ')).toMatchObject({ type: 'rejected', isNettable: false });
    const p = await ok(await a.client.get('/onboarding/progress'));
    expect(p.industry).toBe('plastic');
    expect(step(p, 'template').done).toBe(true);
    expect((await a.client.post('/onboarding/templates/apply', { industry: 'nope' })).status).toBe(400);
  });

  it('ticks steps from real data', async () => {
    const company = (await a.client.get('/org/companies')).body[0];
    await ok(await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: '36AABCS1234E1ZU', address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } }));
    const p = await ok(await a.client.get('/onboarding/progress'));
    expect(step(p, 'company').done).toBe(true);
    expect(p.done).toBe(2);
  });

  it('needs setup permissions to apply a template', async () => {
    const roles = (await a.client.get('/iam/roles')).body;
    const viewer = await addMember(a.client, 'onb-viewer', [roles.find((r: any) => r.name === 'Viewer').id]);
    emails.push(viewer.email);
    expect((await viewer.client.post('/onboarding/templates/apply', { industry: 'engineering' })).status).toBe(403);
    expect((await viewer.client.get('/onboarding/progress')).status).toBe(200);
  });

  it('times every response', async () => {
    const r = await fetch('http://localhost:4000/api/v1/onboarding/templates', { headers: { authorization: `Bearer ${a.client.accessToken}` } });
    expect(r.headers.get('x-response-time')).toMatch(/^\d+ms$/);
  });
});
