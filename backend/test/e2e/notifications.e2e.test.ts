import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, Client, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;
type Member = Awaited<ReturnType<typeof addMember>>;

let a: Workspace;
let approver: Member;
const emails: string[] = [];
const PR = '/purchase/requisitions';

/** Polls until `check` passes (the job worker runs asynchronously). */
async function eventually<T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (check(v)) return v;
    if (Date.now() - start > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function submitPr(purpose: string) {
  const d = (await a.client.post(PR, { purpose, lines: [{ description: 'Cutting oil', uom: 'LTR', quantity: '20', estimatedRate: '210' }] })).body;
  return (await a.client.post(`${PR}/${d.id}/submit`, { version: d.version })).body;
}

beforeAll(async () => {
  a = await signupWorkspace('notif');
  const role = await a.client.post('/iam/roles', { name: 'Stores Head', permissions: ['purchase.requisitions.read'] });
  approver = await addMember(a.client, 'notif-approver', [role.body.id]);
  emails.push(a.email, approver.email);
  await a.client.post('/platform/approval-rules', {
    docType: 'purchase_requisition',
    name: 'Everything',
    steps: [{ name: 'Stores head', approverRoleId: role.body.id }],
  });
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('invitation email', () => {
  it('queues and sends the invitation email through the job worker', async () => {
    const log = await eventually(
      () => a.client.get('/platform/message-log?limit=50'),
      (r) => r.body.items.some((d: any) => d.recipient === approver.email && d.event === 'iam.invitation' && d.status === 'sent'),
    );
    const invite = log.body.items.find((d: any) => d.recipient === approver.email && d.event === 'iam.invitation');
    expect(invite).toMatchObject({ channel: 'email', status: 'sent', provider: 'file' });
    expect(invite.subject).toContain('invited you to');
  });
});

describe('approval notifications', () => {
  let pr: any;

  it('notifies the approver in-app and by email when a document is submitted', async () => {
    pr = await submitPr('Notify approver');
    expect(pr.status).toBe('pending_approval');

    const unread = await approver.client.get('/notifications/unread-count');
    expect(unread.body.unread).toBeGreaterThanOrEqual(1);
    const list = (await approver.client.get('/notifications?unread=true')).body.items;
    const n = list.find((x: any) => x.event === 'document.approval_requested' && x.link === `/purchase/requisitions/${pr.id}`);
    expect(n.title).toBe(`Approval needed: ${pr.number}`);
    expect(n.body).toContain('₹4,200.00');

    const log = await eventually(
      () => a.client.get('/platform/message-log?limit=50'),
      (r) => r.body.items.some((d: any) => d.recipient === approver.email && d.event === 'document.approval_requested' && d.status === 'sent'),
    );
    expect(log.body.items.some((d: any) => d.recipient === approver.email && d.event === 'document.approval_requested' && d.status === 'sent')).toBe(true);
  });

  it('does not notify the submitter about their own submission', async () => {
    const mine = (await a.client.get('/notifications')).body.items;
    expect(mine.some((x: any) => x.event === 'document.approval_requested')).toBe(false);
  });

  it('tells the submitter when the document is rejected', async () => {
    await approver.client.post(`/documents/${pr.id}/reject`, { version: pr.version, comment: 'Wrong grade of oil' });
    const mine = (await a.client.get('/notifications?unread=true')).body.items;
    const n = mine.find((x: any) => x.event === 'document.rejected');
    expect(n.body).toContain('Wrong grade of oil');
  });

  it('marks notifications as read', async () => {
    const list = (await approver.client.get('/notifications?unread=true')).body.items;
    expect((await approver.client.post(`/notifications/${list[0].id}/read`)).status).toBe(200);
    await approver.client.post('/notifications/read-all');
    expect((await approver.client.get('/notifications/unread-count')).body.unread).toBe(0);
  });
});

describe('preferences', () => {
  it('lets a user turn off a channel and respects it', async () => {
    const res = await approver.client.request('PUT', '/account/notification-preferences', {
      changes: [
        { event: 'document.approval_requested', channel: 'in_app', enabled: false },
        { event: 'document.approval_requested', channel: 'email', enabled: false },
      ],
    });
    expect(res.status).toBe(200);
    const prefs = (await approver.client.get('/account/notification-preferences')).body;
    const ev = prefs.find((p: any) => p.event === 'document.approval_requested');
    expect(ev.channels.find((c: any) => c.channel === 'in_app').enabled).toBe(false);

    await submitPr('Quiet please');
    expect((await approver.client.get('/notifications/unread-count')).body.unread).toBe(0);
  });

  it('refuses to turn off mandatory security alerts', async () => {
    const res = await approver.client.request('PUT', '/account/notification-preferences', {
      changes: [{ event: 'account.password_changed', channel: 'email', enabled: false }],
    });
    expect(res.status).toBe(400);
  });

  it('only admins can read the message log', async () => {
    expect((await approver.client.get('/platform/message-log')).status).toBe(403);
  });
});

describe('instant session revocation', () => {
  it('a signed-out session stops working immediately, not at token expiry', async () => {
    const other = new Client();
    await other.post('/auth/login', { email: a.email, password: a.password });
    expect((await other.get('/auth/me')).status).toBe(200);
    const sessions = (await a.client.get('/account/sessions')).body;
    const target = sessions.find((s: any) => !s.current);
    expect((await a.client.delete(`/account/sessions/${target.id}`)).status).toBe(204);
    expect((await other.get('/auth/me')).status).toBe(401);
  });

  it('a disabled member is locked out of every endpoint at once', async () => {
    const users = (await a.client.get('/iam/users')).body;
    const m = users.find((u: any) => u.email === approver.email);
    expect((await approver.client.get('/auth/me')).status).toBe(200);
    await a.client.patch(`/iam/users/${m.membershipId}`, { status: 'disabled' });
    expect((await approver.client.get('/auth/me')).status).toBe(401);
    expect((await approver.client.get('/notifications')).status).toBe(401);
  });
});
