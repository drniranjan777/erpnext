"use client";

/**
 * Client for the customer / dealer portal. Portal logins are separate from staff sessions: the
 * opaque portal token is kept for the browser tab (sessionStorage) and sent as a bearer token.
 */
import { useQuery } from "@tanstack/react-query";
import { ApiError, type ProblemDetails } from "./api";

const BASE = "/api/v1";
const KEY = "ngp_session";

export function portalToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setPortalToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the session lasts until the page is reloaded.
  }
}

type Query = Record<string, string | number | undefined | null>;

export async function portalApi<T>(path: string, opts: { method?: "GET" | "POST"; body?: unknown; query?: Query } = {}): Promise<T> {
  const qs = opts.query ? new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString() : "";
  const token = portalToken();
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.body === undefined ? {} : { "content-type": "application/json" }) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const payload = await res.json().catch(() => null);
  // An ended session drops the token; the portal shell then sends the user to sign in.
  if (res.status === 401 && !path.startsWith("/portal/auth/")) setPortalToken(null);
  if (!res.ok) throw new ApiError(res.status, (payload as ProblemDetails) ?? { title: res.statusText, status: res.status });
  return payload as T;
}

export interface PortalMe {
  name: string;
  kind: "customer" | "dealer";
  party: { name: string; code: string; gstin: string | null };
  company: string;
  outstanding: string;
  overdue: string;
  openOrders: number;
  requests: number;
  openTickets: number;
  dealer: { activeSchemes: number; pendingClaims: number } | null;
}

export function usePortalMe() {
  return useQuery({ queryKey: ["portal", "me"], queryFn: () => portalApi<PortalMe>("/portal/me"), retry: false });
}

export const TICKET_TONE: Record<string, "neutral" | "primary" | "success" | "warning" | "danger"> = { open: "primary", in_progress: "warning", waiting_customer: "warning", resolved: "success", closed: "neutral" };
export const TICKET_LABEL: Record<string, string> = { open: "Open", in_progress: "Being worked on", waiting_customer: "Waiting for you", resolved: "Resolved", closed: "Closed" };
