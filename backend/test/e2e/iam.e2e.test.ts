import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, cleanupTenants, RUN_ID, signupWorkspace, strongPassword } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let b: Workspace;
const invitee = { email: `e2e-invitee-${RUN_ID}@test.local`, password: strongPassword(), client: new Client() };
let storeKeeperRoleId: string;
let inviteToken: string;
let inviteeMembershipId: string;

beforeAll(async () => {
  a = await signupWorkspace('a');
  b = await signupWorkspace('b');
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId, b?.tenantId].filter(Boolean), [a?.email, b?.email, invitee.email].filter(Boolean));
});

describe('roles', () => {
  it('provisions the system roles', async () => {
    const res = await a.client.get('/iam/roles');
    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.name).sort()).toEqual(['Administrator', 'Auditor', 'Owner', 'Viewer']);
  });

  it('creates a custom role', async () => {
    const res = await a.client.post('/iam/roles', {
      name: 'Store Keeper',
      description: 'Reads org setup',
      permissions: ['org.companies.read', 'org.branches.read'],
    });
    expect(res.status).toBe(201);
    expect(res.body.permissions).toEqual(['org.branches.read', 'org.companies.read']);
    storeKeeperRoleId = res.body.id;
  });

  it('rejects duplicate names (case-insensitive) and unknown permissions', async () => {
    expect((await a.client.post('/iam/roles', { name: 'store keeper', permissions: [] })).status).toBe(409);
    expect((await a.client.post('/iam/roles', { name: 'Hacker', permissions: ['iam.god.mode'] })).status).toBe(400);
  });

  it('keeps system roles read-only', async () => {
    const roles = (await a.client.get('/iam/roles')).body;
    const viewer = roles.find((r: any) => r.name === 'Viewer');
    expect((await a.client.patch(`/iam/roles/${viewer.id}`, { permissions: ['iam.users.manage'] })).status).toBe(403);
    expect((await a.client.delete(`/iam/roles/${viewer.id}`)).status).toBe(403);
  });
});

describe('invitations', () => {
  it('invites a new user and returns a shareable link', async () => {
    const res = await a.client.post('/iam/invitations', { email: invitee.email, fullName: 'Ravi Store', roleIds: [storeKeeperRoleId] });
    expect(res.status).toBe(201);
    expect(res.body.inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);
    inviteToken = res.body.inviteUrl.split('/invite/')[1];
  });

  it('blocks a second pending invite for the same email', async () => {
    const res = await a.client.post('/iam/invitations', { email: invitee.email, roleIds: [storeKeeperRoleId] });
    expect(res.status).toBe(409);
  });

  it('previews the invitation publicly', async () => {
    const res = await new Client().get(`/auth/invitations/${inviteToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: invitee.email, existingAccount: false, workspace: { slug: a.slug } });
  });

  it('enforces the password policy for new accounts', async () => {
    const res = await new Client().post(`/auth/invitations/${inviteToken}/accept`, { fullName: 'Ravi Store', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('accepts the invitation and signs the user in', async () => {
    const res = await invitee.client.post(`/auth/invitations/${inviteToken}/accept`, { fullName: 'Ravi Store', password: invitee.password });
    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe(a.tenantId);
    expect(invitee.client.refreshCookie).toBeTruthy();
    const me = await invitee.client.get('/auth/me');
    expect(me.body.permissions).toEqual(['org.branches.read', 'org.companies.read']);
  });

  it('cannot be used twice', async () => {
    const res = await new Client().post(`/auth/invitations/${inviteToken}/accept`, { password: invitee.password });
    expect(res.status).toBe(410);
  });
});

describe('permissions are enforced for the invited user', () => {
  it('allows what the role grants', async () => {
    expect((await invitee.client.get('/org/companies')).status).toBe(200);
  });

  it('denies everything else', async () => {
    expect((await invitee.client.get('/iam/users')).status).toBe(403);
    expect((await invitee.client.post('/org/companies', { name: 'Sneaky Ltd' })).status).toBe(403);
    expect((await invitee.client.post('/iam/roles', { name: 'Escalate', permissions: ['iam.roles.manage'] })).status).toBe(403);
  });
});

describe('user management', () => {
  it('lists members with roles', async () => {
    const res = await a.client.get('/iam/users');
    expect(res.status).toBe(200);
    const member = res.body.find((m: any) => m.email === invitee.email);
    expect(member.roles.map((r: any) => r.name)).toEqual(['Store Keeper']);
    inviteeMembershipId = member.membershipId;
    const owner = res.body.find((m: any) => m.email === a.email);
    expect(owner.isOwner).toBe(true);
  });

  it("doesn't let you edit your own access", async () => {
    const me = (await a.client.get('/iam/users')).body.find((m: any) => m.email === a.email);
    expect((await a.client.patch(`/iam/users/${me.membershipId}`, { status: 'disabled' })).status).toBe(403);
  });

  it('changes roles and takes effect immediately', async () => {
    const viewer = (await a.client.get('/iam/roles')).body.find((r: any) => r.name === 'Viewer');
    const res = await a.client.patch(`/iam/users/${inviteeMembershipId}`, { roleIds: [viewer.id] });
    expect(res.status).toBe(200);
    expect(res.body.roles.map((r: any) => r.name)).toEqual(['Viewer']);
    expect((await invitee.client.get('/iam/users')).status).toBe(200); // Viewer can read users
  });

  it('refuses to delete a role that is in use', async () => {
    const res = await a.client.patch(`/iam/users/${inviteeMembershipId}`, { roleIds: [storeKeeperRoleId] });
    expect(res.status).toBe(200);
    expect((await a.client.delete(`/iam/roles/${storeKeeperRoleId}`)).status).toBe(409);
  });

  it('disabling a user revokes their sessions and access', async () => {
    expect((await a.client.patch(`/iam/users/${inviteeMembershipId}`, { status: 'disabled' })).status).toBe(200);
    // Session check in AuthGuard: their existing access token stops working at once.
    expect((await invitee.client.get('/org/companies')).status).toBe(401);
    expect((await invitee.client.post('/auth/refresh')).status).toBe(401);
  });
});

describe('tenant isolation over HTTP', () => {
  it("workspace B can't see or touch workspace A's users", async () => {
    const list = await b.client.get('/iam/users');
    expect(list.body.map((m: any) => m.email)).toEqual([b.email]);
    expect((await b.client.patch(`/iam/users/${inviteeMembershipId}`, { status: 'active' })).status).toBe(404);
    expect((await b.client.patch(`/iam/roles/${storeKeeperRoleId}`, { name: 'Pwned' })).status).toBe(404);
  });
});

describe('audit trail', () => {
  it('records IAM actions with keyset pagination', async () => {
    const page1 = await a.client.get('/platform/audit-logs?limit=3');
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(3);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await a.client.get(`/platform/audit-logs?limit=3&cursor=${page1.body.nextCursor}`);
    const ids1 = page1.body.items.map((i: any) => i.id);
    expect(page2.body.items.every((i: any) => !ids1.includes(i.id))).toBe(true);

    const all = await a.client.get('/platform/audit-logs?entityType=membership&limit=50');
    const actions = all.body.items.map((i: any) => i.action);
    expect(actions).toContain('iam.invitation.accepted');
    expect(actions).toContain('iam.member.updated');
  });
});

describe('account security', () => {
  it('rejects a wrong current password with 400', async () => {
    const res = await a.client.post('/account/password', { currentPassword: 'wrong-password-1', newPassword: strongPassword() });
    expect(res.status).toBe(400);
  });

  it('changes the password and signs out other sessions', async () => {
    const second = new Client();
    await second.post('/auth/login', { email: a.email, password: a.password });
    const sessions = await a.client.get('/account/sessions');
    expect(sessions.body.filter((s: any) => s.current)).toHaveLength(1);

    const newPassword = strongPassword();
    const res = await a.client.post('/account/password', { currentPassword: a.password, newPassword });
    expect(res.status).toBe(200);
    expect(res.body.otherSessionsRevoked).toBeGreaterThanOrEqual(1);
    expect((await second.post('/auth/refresh')).status).toBe(401);

    expect((await new Client().post('/auth/login', { email: a.email, password: a.password })).status).toBe(401);
    expect((await new Client().post('/auth/login', { email: a.email, password: newPassword })).status).toBe(200);
    a.password = newPassword;
  });
});
