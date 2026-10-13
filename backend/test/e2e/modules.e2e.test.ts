import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let pharma: Workspace;
let other: Workspace;
const emails: string[] = [];

beforeAll(async () => {
  pharma = await signupWorkspace('mod-ph', { industry: 'pharma', allModules: false });
  other = await signupWorkspace('mod-ot', { industry: 'other', allModules: false });
  emails.push(pharma.email, other.email);
});

afterAll(async () => {
  await cleanupTenants([pharma?.tenantId, other?.tenantId].filter(Boolean), emails);
});

describe('modules by industry', () => {
  it('switches on the modules that suit the industry', async () => {
    const me = (await pharma.client.get('/auth/me')).body;
    expect(me.modules).toEqual(expect.arrayContaining(['manufacturing', 'process', 'pharma', 'quality', 'hse', 'wms', 'hr']));
    expect(me.modules).not.toEqual(expect.arrayContaining(['textile']));
    for (const k of ['textile', 'food', 'automotive', 'pos', 'distribution']) expect(me.modules).not.toContain(k);
  });

  it('gives every module to an industry it has no preset for', async () => {
    const list = (await other.client.get('/workspace/modules')).body;
    expect(list.modules.every((m: any) => m.enabled && m.byDefault)).toBe(true);
    expect((await other.client.get('/textile/orders')).status).toBe(200);
  });

  it('serves its own modules and the core, and blocks the rest', async () => {
    expect((await pharma.client.get('/gmp/line-clearances')).status).toBe(200);
    expect((await pharma.client.get('/process/formulas')).status).toBe(200);
    expect((await pharma.client.get('/sales/orders')).status).toBe(200);
    expect((await pharma.client.get('/masters/items')).status).toBe(200);
    for (const p of ['/textile/orders', '/food/haccp', '/auto/apqp', '/pos/terminals', '/compliance/certificates']) {
      const r = await pharma.client.get(p);
      expect(r.status, p).toBe(403);
    }
    expect(JSON.stringify((await pharma.client.get('/textile/orders')).body)).toContain('switched off');
  });

  it('lets an administrator switch modules on and off', async () => {
    const list = (await pharma.client.get('/workspace/modules')).body;
    expect(list.industry).toBe('pharma');
    const want = Object.fromEntries(list.modules.map((m: any) => [m.key, m.enabled]));
    const r = await pharma.client.request('PUT', '/workspace/modules', { modules: { ...want, textile: true, hse: false } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.modules.find((m: any) => m.key === 'textile')).toMatchObject({ enabled: true, byDefault: false });
    expect((await pharma.client.get('/textile/orders')).status).toBe(200);
    expect((await pharma.client.get('/hse/sds')).status).toBe(403);
    expect((await pharma.client.get('/auth/me')).body.modules).toContain('textile');
  });

  it('follows the industry when it changes, keeping nothing stale', async () => {
    const preview = (await pharma.client.get('/workspace/modules?industry=food')).body;
    const want = Object.fromEntries(preview.modules.map((m: any) => [m.key, m.enabled]));
    const r = await pharma.client.request('PUT', '/workspace/modules', { industry: 'food', modules: want });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.industry).toBe('food');
    expect((await pharma.client.get('/food/haccp')).status).toBe(200);
    expect((await pharma.client.get('/gmp/line-clearances')).status).toBe(403);
  });

  it('only lets administrators change modules', async () => {
    const roles = (await other.client.get('/iam/roles')).body;
    const viewer = roles.find((x: any) => /view|read/i.test(x.name)) ?? roles.find((x: any) => !/owner|admin/i.test(x.name));
    const member = await addMember(other.client, 'mod-v', [viewer.id]);
    emails.push(member.email);
    expect((await member.client.request('PUT', '/workspace/modules', { modules: { crm: false } })).status).toBe(403);
    expect((await member.client.get('/workspace/modules')).status).toBe(200);
  });

  it('rejects unknown modules', async () => {
    expect((await other.client.request('PUT', '/workspace/modules', { modules: { nope: true } })).status).toBe(400);
  });
});
