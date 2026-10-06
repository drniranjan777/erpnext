/**
 * Black-box HTTP helpers for e2e tests. Tests talk to a running API
 * (API_URL, default http://localhost:4000/api/v1) exactly like the frontend does.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { purgeTenants } from '@nextgen/database';
import { Pool } from 'pg';

export const API_URL = process.env.API_URL ?? 'http://localhost:4000/api/v1';
export const RUN_ID = randomBytes(3).toString('hex');

export const strongPassword = () => `Pw-${randomBytes(9).toString('base64url')}9a`;

export interface Response<T = any> {
  status: number;
  body: T;
  setCookie: string | null;
}

/** A browser-like client: keeps the access token + refresh cookie. */
export class Client {
  accessToken: string | null = null;
  refreshCookie: string | null = null;

  async request<T = any>(method: string, path: string, body?: unknown): Promise<Response<T>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    if (this.refreshCookie && path.startsWith('/auth')) headers.cookie = this.refreshCookie;
    const res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie?.startsWith('ngerp_rt=')) this.refreshCookie = setCookie.split(';')[0];
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (parsed?.accessToken) this.accessToken = parsed.accessToken;
    return { status: res.status, body: parsed as T, setCookie };
  }

  /** multipart/form-data upload of one file. */
  async upload<T = any>(path: string, fileName: string, content: string | Uint8Array, type = 'application/octet-stream'): Promise<Response<T>> {
    const form = new FormData();
    form.append('file', new Blob([content as BlobPart], { type }), fileName);
    const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}, body: form });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T, setCookie: null };
  }

  /** Raw GET for file downloads. */
  async download(path: string) {
    const res = await fetch(`${API_URL}${path}`, { headers: this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {} });
    return { status: res.status, type: res.headers.get('content-type') ?? '', disposition: res.headers.get('content-disposition') ?? '', bytes: new Uint8Array(await res.arrayBuffer()) };
  }

  get = <T = any>(path: string) => this.request<T>('GET', path);
  post = <T = any>(path: string, body?: unknown) => this.request<T>('POST', path, body ?? {});
  patch = <T = any>(path: string, body: unknown) => this.request<T>('PATCH', path, body);
  delete = <T = any>(path: string) => this.request<T>('DELETE', path);
}

/** Signs up a brand-new workspace and returns its owner client. */
export async function signupWorkspace(label: string) {
  const client = new Client();
  const password = strongPassword();
  const email = `e2e-${label}-${RUN_ID}@test.local`;
  const res = await client.post('/auth/signup', {
    workspaceName: `E2E ${label} ${RUN_ID}`,
    slug: `e2e-${label}-${RUN_ID}`,
    companyName: `E2E ${label} Pvt Ltd`,
    industry: 'engineering',
    fullName: `Owner ${label}`,
    email,
    password,
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { client, email, password, tenantId: res.body.tenant.id as string, slug: res.body.tenant.slug as string };
}

/** Invites + accepts a new member with the given roles; returns their signed-in client. */
export async function addMember(owner: Client, label: string, roleIds: string[]) {
  const email = `e2e-${label}-${RUN_ID}@test.local`;
  const inv = await owner.post('/iam/invitations', { email, fullName: `User ${label}`, roleIds });
  if (inv.status !== 201) throw new Error(`invite failed: ${inv.status} ${JSON.stringify(inv.body)}`);
  const token = inv.body.inviteUrl.split('/invite/')[1];
  const client = new Client();
  const acc = await client.post(`/auth/invitations/${token}/accept`, { fullName: `User ${label}`, password: strongPassword() });
  if (acc.status !== 200) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.body)}`);
  return { client, email, userId: acc.body.user.id as string };
}

/** Removes e2e workspaces created by this run (owner DB role; the app role can't delete tenants). */
export async function cleanupTenants(tenantIds: string[], emails: string[]) {
  if (!tenantIds.length) return;
  let ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!ownerUrl) {
    try {
      const envFile = readFileSync(join(__dirname, '..', '..', '..', 'database', '.env'), 'utf8');
      ownerUrl = envFile.match(/^DATABASE_OWNER_URL=(.*)$/m)?.[1];
    } catch {
      /* no local env file */
    }
  }
  if (!ownerUrl) return;
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await purgeTenants(pool, tenantIds, emails);
  } finally {
    await pool.end();
  }
}
