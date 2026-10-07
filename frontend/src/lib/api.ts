/**
 * Browser API client for the NestJS backend (proxied at /api/v1).
 *
 * - Access token lives in memory only (never localStorage).
 * - On 401 it silently refreshes once via the httpOnly refresh cookie, then retries.
 * - Concurrent refreshes are de-duplicated (the backend treats refresh-token
 *   reuse as theft and revokes the session).
 */

const BASE = "/api/v1";

export interface ProblemDetails {
  title: string;
  status: number;
  detail?: string;
  errors?: { path: string; message: string; code?: string }[];
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
  ) {
    super(problem.detail ?? problem.title);
  }

  /** Field errors keyed by path, for forms. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]));
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function setSessionLostHandler(handler: (() => void) | null) {
  onSessionLost = handler;
}

/** Exchanges the refresh cookie for a new access token. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "same-origin" });
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      queueMicrotask(() => (refreshInFlight = null));
    }
  })();
  return refreshInFlight;
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Internal: skip the refresh-and-retry step. */
  noRetry?: boolean;
}

/** Multipart upload of a single file (field "file"), with the same refresh-and-retry as api(). Extra fields go before the file so the server sees them with it. */
export async function apiUpload<T>(path: string, file: File, fields: Record<string, string> = {}, retried = false): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", file, file.name);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    body: form,
    credentials: "same-origin",
  });
  if (res.status === 401 && !retried) {
    if (await refreshSession()) return apiUpload<T>(path, file, fields, true);
    onSessionLost?.();
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (payload as ProblemDetails) ?? { title: res.statusText, status: res.status });
  return payload as T;
}

/** Downloads an authenticated file and hands it to the browser as a save. */
export async function apiDownload(path: string, fileName: string, retried = false, body?: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 401 && !retried) {
    if (await refreshSession()) return apiDownload(path, fileName, true, body);
    onSessionLost?.();
  }
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as ProblemDetails | null;
    throw new ApiError(res.status, problem ?? { title: res.statusText, status: res.status });
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
    signal: opts.signal,
  });

  if (res.status === 401 && !opts.noRetry && !path.startsWith("/auth/")) {
    if (await refreshSession()) return api<T>(path, { ...opts, noRetry: true });
    onSessionLost?.();
  }

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("json");
  const payload = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const problem: ProblemDetails =
      isJson && payload && typeof payload === "object"
        ? (payload as ProblemDetails)
        : { title: res.statusText || "Request failed", status: res.status };
    throw new ApiError(res.status, problem);
  }
  return payload as T;
}
