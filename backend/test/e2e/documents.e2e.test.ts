import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fiscalYearOf, todayIST } from '../../src/common/fiscal-year';
import { addMember, API_URL, Client, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;
type Member = Awaited<ReturnType<typeof addMember>>;

const FY = fiscalYearOf(todayIST()).label;
const PR = '/purchase/requisitions';

let a: Workspace;
let b: Workspace;
let manager: Member; // approves level 1 (role "Purchase Manager")
let admin: Member; // approves level 2 (role "Administrator")
const emails: string[] = [];

const lines = [
  { description: 'HDPE granules, natural', uom: 'KG', quantity: '3', estimatedRate: '33.335' }, // 100.005 → 100.01
  { description: 'Masterbatch, blue', uom: 'KG', quantity: 2.5, estimatedRate: '4.01' }, // 10.025 → 10.03
];

async function createPr(client: Client, purpose: string, extra: Record<string, unknown> = {}) {
  const res = await client.post(PR, { purpose, priority: 'high', lines, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

beforeAll(async () => {
  a = await signupWorkspace('docs-a');
  b = await signupWorkspace('docs-b');
  const pm = await a.client.post('/iam/roles', { name: 'Purchase Manager', permissions: ['purchase.requisitions.read'] });
  const roles = (await a.client.get('/iam/roles')).body;
  const administrator = roles.find((r: any) => r.name === 'Administrator');
  manager = await addMember(a.client, 'docs-manager', [pm.body.id]);
  admin = await addMember(a.client, 'docs-admin', [administrator.id]);
  emails.push(a.email, b.email, manager.email, admin.email);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId, b?.tenantId].filter(Boolean), emails);
});

describe('drafts', () => {
  let draft: any;

  it('creates a draft with exact decimal totals and no number yet', async () => {
    draft = await createPr(a.client, 'Raw material for October run');
    expect(draft).toMatchObject({ status: 'draft', number: null, amount: '110.04', revision: 0, priority: 'high' });
    expect(draft.lines.map((l: any) => l.estimatedAmount)).toEqual(['100.01', '10.03']);
    expect(draft.branch.code).toBe('HO');
    expect(draft.can).toMatchObject({ edit: true, delete: true, submit: true, approve: false });
  });

  it('rejects stale edits (optimistic locking)', async () => {
    const ok = await a.client.request('PUT', `${PR}/${draft.id}`, { version: draft.version, purpose: 'Updated', lines: [lines[0]] });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ amount: '100.01', title: 'Updated', version: draft.version + 1 });
    const stale = await a.client.request('PUT', `${PR}/${draft.id}`, { version: draft.version, lines });
    expect(stale.status).toBe(409);
    draft = ok.body;
  });

  it('validates lines', async () => {
    const res = await a.client.post(PR, { lines: [{ description: 'x', uom: '', quantity: '-1' }] });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: any) => e.path)).toEqual(expect.arrayContaining(['lines.0.uom', 'lines.0.quantity']));
  });

  it('deletes a never-submitted draft', async () => {
    expect((await a.client.delete(`${PR}/${draft.id}?version=${draft.version}`)).status).toBe(204);
    expect((await a.client.get(`${PR}/${draft.id}`)).status).toBe(404);
  });
});

describe('numbering and auto-approval', () => {
  it('auto-approves when no approval rule matches and assigns the first number', async () => {
    const pr = await createPr(a.client, 'Office stationery');
    const res = await a.client.post(`${PR}/${pr.id}/submit`, { version: pr.version });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'approved', number: `PR/HO/${FY}/0001` });
    expect(res.body.can.delete).toBe(false);
  });

  it('created a default series on first use', async () => {
    const series = await a.client.get('/platform/number-series');
    expect(series.body).toHaveLength(1);
    expect(series.body[0]).toMatchObject({ docType: 'purchase_requisition', name: 'Default', pattern: 'PR/{BRANCH}/{FY}/{SEQ}', isDefault: true });
    expect(series.body[0].nextNumber).toBe(`PR/HO/${FY}/0002`);
  });

  it('allocates gapless, unique numbers under concurrent submits', async () => {
    const drafts = await Promise.all([1, 2, 3, 4, 5].map((i) => createPr(a.client, `Parallel ${i}`)));
    const results = await Promise.all(drafts.map((d) => a.client.post(`${PR}/${d.id}/submit`, { version: d.version })));
    const numbers = results.map((r) => r.body.number).sort();
    expect(new Set(numbers).size).toBe(5);
    expect(numbers).toEqual([2, 3, 4, 5, 6].map((n) => `PR/HO/${FY}/${String(n).padStart(4, '0')}`));
  });

  it('rejects invalid series patterns', async () => {
    const company = (await a.client.get('/org/companies')).body[0];
    const res = await a.client.post('/platform/number-series', {
      docType: 'purchase_requisition',
      companyId: company.id,
      name: 'Broken',
      pattern: 'PR/{FY}/{NOPE}',
    });
    expect(res.status).toBe(400);
  });
});

describe('multi-level approval', () => {
  let ruleId: string;
  let pr: any;

  it('sets up a two-level rule', async () => {
    const roles = (await a.client.get('/iam/roles')).body;
    const res = await a.client.post('/platform/approval-rules', {
      docType: 'purchase_requisition',
      name: 'All requisitions',
      minAmount: '0',
      steps: [
        { name: 'Purchase manager', approverRoleId: roles.find((r: any) => r.name === 'Purchase Manager').id },
        { name: 'Admin sign-off', approverRoleId: roles.find((r: any) => r.name === 'Administrator').id },
      ],
    });
    expect(res.status).toBe(201);
    ruleId = res.body.id;
  });

  it('routes the submitted document to level 1', async () => {
    const draft = await createPr(a.client, 'Two-level approval test');
    const res = await a.client.post(`${PR}/${draft.id}/submit`, { version: draft.version });
    pr = res.body;
    expect(pr.status).toBe('pending_approval');
    expect(pr.approvals.map((s: any) => s.status)).toEqual(['pending', 'waiting']);
  });

  it('enforces segregation of duties and level order', async () => {
    expect((await a.client.post(`/documents/${pr.id}/approve`, { version: pr.version })).status).toBe(403); // submitter
    expect((await admin.client.post(`/documents/${pr.id}/approve`, { version: pr.version })).status).toBe(403); // wrong level
  });

  it('shows the document in the level-1 approver inbox only', async () => {
    const inbox = (await manager.client.get('/documents/approvals/inbox')).body;
    expect(inbox.map((d: any) => d.documentId)).toContain(pr.id);
    expect(inbox.find((d: any) => d.documentId === pr.id)).toMatchObject({ stepName: 'Purchase manager', path: `/purchase/requisitions/${pr.id}` });
    expect((await admin.client.get('/documents/approvals/inbox')).body.map((d: any) => d.documentId)).not.toContain(pr.id);
  });

  it('approves level by level', async () => {
    const l1 = await manager.client.post(`/documents/${pr.id}/approve`, { version: pr.version, comment: 'Rates look fine' });
    expect(l1.status).toBe(200);
    expect(l1.body.status).toBe('pending_approval');
    const l2 = await admin.client.post(`/documents/${pr.id}/approve`, { version: l1.body.version });
    expect(l2.body.status).toBe('approved');
    const view = (await a.client.get(`${PR}/${pr.id}`)).body;
    expect(view.approvals.map((s: any) => [s.status, s.actedBy])).toEqual([
      ['approved', 'User docs-manager'],
      ['approved', 'User docs-admin'],
    ]);
    pr = view;
  });

  it('rejects with a mandatory reason; resubmission keeps the number', async () => {
    const draft = await createPr(a.client, 'Will be rejected');
    const sub = (await a.client.post(`${PR}/${draft.id}/submit`, { version: draft.version })).body;
    expect((await manager.client.post(`/documents/${draft.id}/reject`, { version: sub.version })).status).toBe(400);
    const rej = await manager.client.post(`/documents/${draft.id}/reject`, { version: sub.version, comment: 'Quantity too high' });
    expect(rej.body.status).toBe('rejected');

    const current = (await a.client.get(`${PR}/${draft.id}`)).body;
    expect(current.can.edit).toBe(true);
    const edited = await a.client.request('PUT', `${PR}/${draft.id}`, { version: current.version, purpose: 'Reduced qty', lines: [lines[1]] });
    const resub = await a.client.post(`${PR}/${draft.id}/submit`, { version: edited.body.version });
    expect(resub.body).toMatchObject({ status: 'pending_approval', number: sub.number });
    expect(resub.body.approvals.map((s: any) => s.status)).toEqual(['pending', 'waiting']);

    const activity = (await a.client.get(`/documents/${draft.id}/activity`)).body.map((e: any) => e.kind);
    expect(activity).toEqual(expect.arrayContaining(['created', 'submitted', 'rejected', 'edited']));

    const cancelled = await a.client.post(`${PR}/${draft.id}/cancel`, { version: resub.body.version, reason: 'No longer needed' });
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: 'No longer needed' });
    expect((await manager.client.get('/documents/approvals/inbox')).body.map((d: any) => d.documentId)).not.toContain(draft.id);
  });

  it('amends an approved document into a new revision with a snapshot', async () => {
    const res = await a.client.post(`${PR}/${pr.id}/amend`, { version: pr.version, reason: 'Add freight line' });
    expect(res.body).toMatchObject({ status: 'draft', revision: 1, number: pr.number, displayNumber: `${pr.number} (Rev 1)` });
    const revs = (await a.client.get(`/documents/${pr.id}/revisions`)).body;
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ revision: 0, reason: 'Add freight line' });
    expect(revs[0].snapshot.lines).toHaveLength(2);
  });

  it('removes the rule; later documents auto-approve again', async () => {
    expect((await a.client.delete(`/platform/approval-rules/${ruleId}`)).status).toBe(204);
    const d = await createPr(a.client, 'After rule removed');
    expect((await a.client.post(`${PR}/${d.id}/submit`, { version: d.version })).body.status).toBe('approved');
  });
});

describe('permissions & isolation', () => {
  it('approvers with read-only access cannot create or cancel', async () => {
    expect((await manager.client.post(PR, { lines })).status).toBe(403);
    const list = await manager.client.get(PR);
    expect(list.status).toBe(200);
    const any = list.body.items.find((i: any) => i.status === 'approved');
    expect((await manager.client.post(`${PR}/${any.id}/cancel`, { version: 1, reason: 'nope' })).status).toBe(403);
  });

  it("workspace B can't read workspace A's documents", async () => {
    const list = (await a.client.get(PR)).body.items;
    expect((await b.client.get(`${PR}/${list[0].id}`)).status).toBe(404);
    expect((await b.client.get(`/documents/${list[0].id}/activity`)).status).toBe(404);
    expect((await b.client.get(PR)).body.items).toHaveLength(0);
  });

  it('paginates with a cursor', async () => {
    const p1 = (await a.client.get(`${PR}?limit=3`)).body;
    expect(p1.items).toHaveLength(3);
    const p2 = (await a.client.get(`${PR}?limit=3&cursor=${p1.nextCursor}`)).body;
    expect(p2.items.every((i: any) => !p1.items.some((j: any) => j.id === i.id))).toBe(true);
  });
});

describe('attachments', () => {
  let docId: string;
  let attachmentId: string;

  async function upload(client: Client, id: string, name: string, type: string, content: string | Uint8Array) {
    const form = new FormData();
    form.append('file', new Blob([content], { type }), name);
    const res = await fetch(`${API_URL}/documents/${id}/attachments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${client.accessToken}` },
      body: form,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  it('uploads, lists and downloads a file', async () => {
    docId = (await a.client.get(PR)).body.items[0].id;
    const up = await upload(a.client, docId, 'कोटेशन quote.txt', 'text/plain', 'Vendor quote: ₹ 1,250 per kg');
    expect(up.status).toBe(201);
    attachmentId = up.body.id;
    const list = (await manager.client.get(`/documents/${docId}/attachments`)).body;
    expect(list.map((f: any) => f.fileName)).toContain('कोटेशन quote.txt');

    const dl = await fetch(`${API_URL}/documents/attachments/${attachmentId}/download`, {
      headers: { authorization: `Bearer ${manager.client.accessToken}` },
    });
    expect(dl.status).toBe(200);
    expect(await dl.text()).toBe('Vendor quote: ₹ 1,250 per kg');
  });

  it('refuses executable / unknown file types', async () => {
    expect((await upload(a.client, docId, 'setup.exe', 'application/x-msdownload', 'MZ')).status).toBe(415);
  });

  it('only the uploader can remove a file, and other workspaces see nothing', async () => {
    expect((await manager.client.delete(`/documents/attachments/${attachmentId}`)).status).toBe(403);
    expect((await b.client.get(`/documents/attachments/${attachmentId}/download`)).status).toBe(404);
    expect((await a.client.delete(`/documents/attachments/${attachmentId}`)).status).toBe(204);
    expect((await a.client.get(`/documents/${docId}/attachments`)).body).toHaveLength(0);
  });
});
