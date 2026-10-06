import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;
type Member = Awaited<ReturnType<typeof addMember>>;

let a: Workspace;
let b: Workspace;
let viewer: Member;
const emails: string[] = [];
const PR = '/purchase/requisitions';
const line = { description: 'Hydraulic oil 68', uom: 'LTR', quantity: '50', estimatedRate: '185' };

beforeAll(async () => {
  a = await signupWorkspace('cust-a');
  b = await signupWorkspace('cust-b');
  const roles = (await a.client.get('/iam/roles')).body;
  viewer = await addMember(a.client, 'cust-viewer', [roles.find((r: any) => r.name === 'Viewer').id]);
  emails.push(a.email, b.email, viewer.email);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId, b?.tenantId].filter(Boolean), emails);
});

describe('custom fields', () => {
  let costCentre: any;
  let machine: any;
  let pr: any;

  it('admins define fields; keys are derived from labels', async () => {
    const r1 = await a.client.post('/platform/custom-fields', {
      entity: 'purchase_requisition',
      label: 'Cost centre',
      type: 'select',
      options: ['Moulding', 'Assembly', 'Tool room'],
      required: true,
    });
    expect(r1.status).toBe(201);
    costCentre = r1.body;
    expect(costCentre.key).toBe('cost_centre');
    const r2 = await a.client.post('/platform/custom-fields', { entity: 'purchase_requisition', label: 'Machine no.', type: 'text' });
    machine = r2.body;
    expect(machine.key).toBe('machine_no');
    expect((await a.client.post('/platform/custom-fields', { entity: 'purchase_requisition', label: 'cost centre', type: 'text' })).status).toBe(409);
    expect((await a.client.post('/platform/custom-fields', { entity: 'purchase_requisition', label: 'Grade', type: 'select', options: [] })).status).toBe(400);
  });

  it('non-admins can read definitions (forms need them) but not change them', async () => {
    expect((await viewer.client.get('/platform/custom-fields?entity=purchase_requisition&activeOnly=true')).body).toHaveLength(2);
    expect((await viewer.client.post('/platform/custom-fields', { entity: 'purchase_requisition', label: 'X', type: 'text' })).status).toBe(403);
  });

  it('validates required fields and select options on documents', async () => {
    const missing = await a.client.post(PR, { lines: [line] });
    expect(missing.status).toBe(400);
    expect(missing.body.errors[0].path).toBe('customFields.cost_centre');
    const bad = await a.client.post(PR, { lines: [line], customFields: { cost_centre: 'Canteen' } });
    expect(bad.status).toBe(400);
  });

  it('stores values and drops unknown keys', async () => {
    const res = await a.client.post(PR, { purpose: 'Custom fields', lines: [line], customFields: { cost_centre: 'Moulding', machine_no: 'IMM-07', hacker: 'x' } });
    expect(res.status).toBe(201);
    pr = res.body;
    expect(pr.customFields).toEqual({ cost_centre: 'Moulding', machine_no: 'IMM-07' });
  });

  it('keeps values of deactivated fields when the document is edited', async () => {
    await a.client.patch(`/platform/custom-fields/${machine.id}`, { version: machine.version, isActive: false });
    const res = await a.client.request('PUT', `${PR}/${pr.id}`, { version: pr.version, lines: [line], customFields: { cost_centre: 'Assembly' } });
    expect(res.status).toBe(200);
    expect(res.body.customFields).toEqual({ cost_centre: 'Assembly', machine_no: 'IMM-07' });
    pr = res.body;
  });

  it("other workspaces don't see the definitions", async () => {
    expect((await b.client.get('/platform/custom-fields')).body).toHaveLength(0);
  });
});

describe('print formats', () => {
  let prId: string;
  let formatId: string;

  it('renders the built-in format with company, lines and custom fields', async () => {
    const draft = (await a.client.post(PR, { purpose: 'Print me', lines: [line], customFields: { cost_centre: 'Tool room' } })).body;
    const submitted = (await a.client.post(`${PR}/${draft.id}/submit`, { version: draft.version })).body;
    prId = submitted.id;
    const res = await viewer.client.get(`/documents/${prId}/print`);
    expect(res.status).toBe(200);
    expect(res.body.html).toContain(submitted.number);
    expect(res.body.html).toContain('Hydraulic oil 68');
    expect(res.body.html).toContain('₹9,250.00');
    expect(res.body.html).toContain('Tool room');
    expect(res.body.formats[0]).toMatchObject({ id: null, isDefault: true });
  });

  it('escapes document data (no HTML injection through field values)', async () => {
    const d = (await a.client.post(PR, { purpose: '<img src=x onerror=alert(1)>', lines: [line], customFields: { cost_centre: 'Moulding' } })).body;
    const html = (await a.client.get(`/documents/${d.id}/print`)).body.html as string;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src&#x3D;x');
  });

  it('rejects broken templates with a helpful error', async () => {
    const res = await a.client.post('/platform/print-formats', { docType: 'purchase_requisition', name: 'Broken', template: '<div>{{#if doc}}unclosed</div>' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('template');
  });

  it('previews against sample data, then saves a custom default format', async () => {
    const preview = await a.client.post('/platform/print-formats/preview', {
      docType: 'purchase_requisition',
      template: '<h1>{{company.name}}</h1><p class="n">{{doc.displayNumber}}</p>',
      css: '.n { color: red }',
    });
    expect(preview.body.html).toContain('Sample Industries Pvt Ltd');
    const created = await a.client.post('/platform/print-formats', {
      docType: 'purchase_requisition',
      name: 'Compact',
      template: '<h1>{{company.name}}</h1><p class="n">REQ {{doc.displayNumber}} · {{money doc.amount}}</p>',
      css: '.n { font-weight: bold }',
      isDefault: true,
    });
    expect(created.status).toBe(201);
    formatId = created.body.id;
    const html = (await a.client.get(`/documents/${prId}/print`)).body.html as string;
    expect(html).toContain('REQ PR/HO/');
    expect(html).toContain('₹9,250.00');
    expect(html).toContain('.n { font-weight: bold }');
  });

  it('can still print with the built-in format and other formats explicitly', async () => {
    const res = await a.client.get(`/documents/${prId}/print?formatId=${formatId}`);
    expect(res.body.formatId).toBe(formatId);
    expect(res.body.formats.map((f: any) => f.name)).toEqual(['Standard (built-in)', 'Compact']);
  });

  it('only customisation admins manage formats; other tenants cannot print our documents', async () => {
    expect((await viewer.client.get('/platform/print-formats')).status).toBe(403);
    expect((await b.client.get(`/documents/${prId}/print`)).status).toBe(404);
  });
});

describe('saved views', () => {
  it('keeps personal views private and shares shared ones', async () => {
    const mine = await viewer.client.post('/saved-views', { entity: 'purchase_requisitions', name: 'My urgent', filters: { status: 'pending_approval', priority: 'urgent' } });
    expect(mine.status).toBe(201);
    const shared = await a.client.post('/saved-views', { entity: 'purchase_requisitions', name: 'Team pending', filters: { status: 'pending_approval' }, isShared: true });
    const ownerViews = (await a.client.get('/saved-views?entity=purchase_requisitions')).body.map((v: any) => v.name);
    expect(ownerViews).toEqual(['Team pending']);
    const viewerViews = (await viewer.client.get('/saved-views?entity=purchase_requisitions')).body;
    expect(viewerViews.map((v: any) => v.name)).toEqual(['My urgent', 'Team pending']);
    expect(viewerViews.find((v: any) => v.name === 'Team pending').mine).toBe(false);
    expect((await viewer.client.delete(`/saved-views/${shared.body.id}`)).status).toBe(403);
    expect((await viewer.client.delete(`/saved-views/${mine.body.id}`)).status).toBe(204);
  });
});
