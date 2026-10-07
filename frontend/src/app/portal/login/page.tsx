"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api";
import { portalApi, setPortalToken } from "@/lib/portal";

export default function PortalLoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [f, setF] = useState(() => {
    let workspace = "";
    try {
      workspace = localStorage.getItem("ngp_workspace") ?? "";
    } catch {}
    return { workspace, email: "", password: "" };
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const s = await portalApi<{ token: string }>("/portal/auth/login", { body: f });
      setPortalToken(s.token);
      try {
        localStorage.setItem("ngp_workspace", f.workspace);
      } catch {}
      qc.removeQueries({ queryKey: ["portal"] });
      router.replace("/portal");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Please try again.");
      setBusy(false);
    }
  }
  return (
    <Card className="p-6">
      <h1 className="text-2xl font-semibold">Customer portal</h1>
      <p className="mt-1 text-sm text-muted">Orders, invoices, statement and service requests. Use the workspace code from your invitation email.</p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        <Field label="Workspace code">{(p) => <Input {...p} autoCapitalize="none" value={f.workspace} onChange={(e) => setF({ ...f, workspace: e.target.value })} />}</Field>
        <Field label="Email">{(p) => <Input {...p} type="email" autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Password">{(p) => <Input {...p} type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
        <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!f.workspace || !f.email || !f.password}>Sign in</Button>
      </form>
      <p className="mt-4 text-xs text-muted">Forgot your password? Ask your contact at the company to send a new link.</p>
    </Card>
  );
}
