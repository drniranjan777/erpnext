"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, refreshSession, setAccessToken, setSessionLostHandler } from "./api";

export interface Me {
  user: { id: string; email: string; fullName: string; mobile: string | null; locale: string; mfaEnabled: boolean };
  tenant: { id: string; slug: string; name: string; status: string; industry: string | null; trialEndsAt: string | null };
  permissions: string[];
  /** Optional modules switched on for the workspace (by industry, adjusted in Settings). */
  modules: string[];
  plan: {
    code: string;
    name: string;
    state: "trialing" | "active" | "past_due" | "cancelled" | "expired" | "suspended";
    readOnly: boolean;
    trialEndsAt: string | null;
    periodEnd: string | null;
    features: string[];
  };
  isPlatformAdmin: boolean;
}

/** Result of the password step: signed in, pick a workspace, or enter a 2FA code. */
export type LoginStep = { kind: "done" } | { kind: "tenants"; tenants: TenantOption[] } | { kind: "mfa"; mfaToken: string };

export interface TenantOption {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface SessionResponse {
  accessToken: string;
  expiresIn: number;
}

type LoginResponse = SessionResponse | { requiresTenantSelection: true; tenants: TenantOption[] } | { mfaRequired: true; mfaToken: string };

export interface SignupPayload {
  workspaceName: string;
  slug: string;
  industry?: string;
  companyName: string;
  gstin?: string;
  fullName: string;
  email: string;
  mobile?: string;
  password: string;
}

type Status = "loading" | "authenticated" | "anonymous";

interface AuthState {
  status: Status;
  me: Me | null;
  login(email: string, password: string, tenantSlug?: string): Promise<LoginStep>;
  verifyMfa(mfaToken: string, code: string): Promise<void>;
  signup(payload: SignupPayload): Promise<void>;
  /** Accepts an invitation and starts a session in that workspace. */
  acceptInvitation(token: string, body: { fullName?: string; password: string; mfaCode?: string }): Promise<void>;
  logout(): Promise<void>;
  /** Re-fetches /auth/me (after profile or permission changes). */
  refreshMe(): Promise<void>;
  can(permission: string): boolean;
  /** Whether an optional module is switched on; `null`/`undefined` (core screens) is always true. */
  hasModule(module: string | null | undefined): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);

  const loadMe = useCallback(async () => {
    const data = await api<Me>("/auth/me");
    setMe(data);
    setStatus("authenticated");
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    setMe(null);
    setStatus("anonymous");
    queryClient.clear();
  }, [queryClient]);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    setSessionLostHandler(clear);
    let cancelled = false;
    (async () => {
      const ok = await refreshSession();
      if (cancelled) return;
      if (!ok) return setStatus("anonymous");
      try {
        await loadMe();
      } catch {
        if (!cancelled) clear();
      }
    })();
    return () => {
      cancelled = true;
      setSessionLostHandler(null);
    };
  }, [clear, loadMe]);

  const login = useCallback<AuthState["login"]>(
    async (email, password, tenantSlug) => {
      const res = await api<LoginResponse>("/auth/login", { body: { email, password, tenantSlug } });
      if ("requiresTenantSelection" in res) return { kind: "tenants", tenants: res.tenants };
      if ("mfaRequired" in res) return { kind: "mfa", mfaToken: res.mfaToken };
      setAccessToken(res.accessToken);
      await loadMe();
      return { kind: "done" };
    },
    [loadMe],
  );

  const verifyMfa = useCallback<AuthState["verifyMfa"]>(
    async (mfaToken, code) => {
      const res = await api<SessionResponse>("/auth/mfa/verify", { body: { mfaToken, code } });
      setAccessToken(res.accessToken);
      await loadMe();
    },
    [loadMe],
  );

  const signup = useCallback<AuthState["signup"]>(
    async (payload) => {
      const res = await api<SessionResponse>("/auth/signup", { body: payload });
      setAccessToken(res.accessToken);
      await loadMe();
    },
    [loadMe],
  );

  const acceptInvitation = useCallback<AuthState["acceptInvitation"]>(
    async (token, body) => {
      const res = await api<SessionResponse>(`/auth/invitations/${encodeURIComponent(token)}/accept`, { body });
      queryClient.clear();
      setAccessToken(res.accessToken);
      await loadMe();
    },
    [loadMe, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api<void>("/auth/logout", { method: "POST" });
    } finally {
      clear();
    }
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      login,
      verifyMfa,
      signup,
      acceptInvitation,
      logout,
      refreshMe: loadMe,
      can: (permission) => me?.permissions.includes(permission) ?? false,
      hasModule: (module) => !module || (me?.modules?.includes(module) ?? true),
    }),
    [status, me, login, verifyMfa, signup, acceptInvitation, logout, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
