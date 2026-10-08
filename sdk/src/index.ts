/**
 * NextGen ERP public SDK.
 *
 * ```ts
 * const erp = new NextGenClient({ apiKey: process.env.NEXTGEN_API_KEY!, baseUrl: 'https://api.nextgen-erp.in/api/v1' });
 * for await (const item of erp.paginate(erp.items.list, { q: 'bearing' })) console.log(item.code);
 * const ok = verifyWebhook(rawBody, req.headers['x-nextgen-signature'], process.env.WEBHOOK_SECRET!);
 * ```
 *
 * Works in Node 18+ and browsers (uses the global fetch and Web Crypto). API keys carry scopes:
 * a call outside the key's scopes answers 403.
 */

export interface ClientOptions {
  apiKey: string;
  /** Up to and including /api/v1. */
  baseUrl: string;
  /** Retries for 429 and 5xx answers (default 2), honouring Retry-After. */
  retries?: number;
  fetch?: typeof fetch;
  /** Per-request timeout in milliseconds (default 30 s). */
  timeoutMs?: number;
}

/** RFC 9457 problem details, as every error from the API is shaped. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: { path: string; message: string }[];
  requestId?: string;
}

export class NextGenError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${status}`);
    this.name = 'NextGenError';
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListQuery {
  q?: string;
  limit?: number;
  cursor?: string;
  [k: string]: string | number | boolean | undefined;
}

export interface Item {
  id: string;
  code: string;
  name: string;
  type: string;
  hsnCode: string | null;
  gstRate: string | null;
  isActive: boolean;
  [k: string]: unknown;
}

export interface Party {
  id: string;
  code: string;
  name: string;
  isCustomer: boolean;
  isVendor: boolean;
  gstin: string | null;
  [k: string]: unknown;
}

export interface DocumentSummary {
  id: string;
  number: string | null;
  status: string;
  docDate: string;
  [k: string]: unknown;
}

export interface SalesOrderLine {
  itemId: string;
  qty: string | number;
  rate?: string | number | null;
  discountPct?: string | number | null;
  description?: string | null;
}

export interface CreateSalesOrder {
  customerId: string;
  customerPoNo?: string | null;
  customerPoDate?: string | null;
  docDate?: string;
  notes?: string | null;
  lines: SalesOrderLine[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NextGenClient {
  private readonly base: string;
  private readonly retries: number;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ClientOptions) {
    if (!options.apiKey?.startsWith('ngk_')) throw new Error('An API key starts with ngk_');
    this.base = options.baseUrl.replace(/\/$/, '');
    this.retries = options.retries ?? 2;
    this.doFetch = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Any endpoint the key's scopes allow. */
  async request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {}): Promise<T> {
    const url = new URL(`${this.base}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      const res = await this.doFetch(url, {
        method,
        headers: { 'x-api-key': this.options.apiKey, accept: 'application/json', ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < this.retries) {
        const after = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 250 * 2 ** attempt);
        continue;
      }
      const text = await res.text();
      const data = text ? JSON.parse(text) : undefined;
      if (!res.ok) throw new NextGenError(res.status, (data as Problem) ?? null);
      return data as T;
    }
  }

  /** Walks every page of a cursor-paginated list. */
  async *paginate<T>(list: (q: ListQuery) => Promise<Page<T>>, query: ListQuery = {}): AsyncGenerator<T> {
    let cursor: string | undefined;
    do {
      const page = await list({ ...query, cursor });
      yield* page.items;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  readonly items = {
    list: (q: ListQuery = {}) => this.request<Page<Item>>('GET', '/masters/items', { query: q }),
    get: (id: string) => this.request<Item>('GET', `/masters/items/${id}`),
  };

  readonly parties = {
    list: (q: ListQuery = {}) => this.request<Page<Party>>('GET', '/masters/parties', { query: q }),
    get: (id: string) => this.request<Party>('GET', `/masters/parties/${id}`),
  };

  readonly salesOrders = {
    list: (q: ListQuery = {}) => this.request<Page<DocumentSummary>>('GET', '/sales/orders', { query: q }),
    get: (id: string) => this.request<DocumentSummary & { lines: unknown[] }>('GET', `/sales/orders/${id}`),
    create: (input: CreateSalesOrder) => this.request<DocumentSummary & { version: number }>('POST', '/sales/orders', { body: input }),
    submit: (id: string, version: number) => this.request<DocumentSummary>('POST', `/sales/orders/${id}/submit`, { body: { version } }),
  };

  readonly salesInvoices = {
    list: (q: ListQuery = {}) => this.request<Page<DocumentSummary>>('GET', '/sales/invoices', { query: q }),
    get: (id: string) => this.request<DocumentSummary & { lines: unknown[] }>('GET', `/sales/invoices/${id}`),
  };

  readonly purchaseOrders = {
    list: (q: ListQuery = {}) => this.request<Page<DocumentSummary>>('GET', '/purchase/orders', { query: q }),
    get: (id: string) => this.request<DocumentSummary & { lines: unknown[] }>('GET', `/purchase/orders/${id}`),
  };
}

// ---- webhooks -----------------------------------------------------------------------------------

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Constant-time comparison of two hex strings. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Checks the X-NextGen-Signature header (`t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`) of a
 * webhook against the endpoint secret, refusing deliveries older than the tolerance (replays).
 */
export async function verifyWebhook(rawBody: string | Uint8Array, header: string | null | undefined, secret: string, toleranceSec = 300, now = Date.now()) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(now / 1000 - t) > toleranceSec) return false;
  const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
  return same(await hmacHex(secret, `${t}.${body}`), parts.v1);
}

/** The event envelope every webhook delivery carries. */
export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  event: string;
  createdAt: string;
  workspace: string;
  data: T;
}
