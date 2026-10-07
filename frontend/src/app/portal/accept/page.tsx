"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { ApiError } from "@/lib/api";
import { portalApi, setPortalToken } from "@/lib/portal";

interface Preview { name: string; email: string; kind: string; party: string; company: string; workspace: string }

export default function AcceptPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Accept />
    </Suspense>
  );
}

function Accept() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["portal-invite", token], queryFn: () => portalApi<Preview>("/portal/auth/invite", { query: { token } }), enabled: token.length >= 40, retry: false });
  const [pw, setPw] = useState({ a: "", b: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (token.length < 40) return <Alert>This link is incomplete. Open it again from the email.</Alert>;
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const s = await portalApi<{ token: string }>("/portal/auth/accept", { body: { token, password: pw.a } });
      setPortalToken(s.token);
      try {
        localStorage.setItem("ngp_workspace", q.data!.workspace);
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
      <h1 className="text-2xl font-semibold">Welcome, {q.data!.name}</h1>
      <p className="mt-1 text-sm text-muted">{q.data!.company} has given you a {q.data!.kind} portal login for {q.data!.party}. Choose a password to continue.</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Workspace code</dt>
        <dd className="font-mono">{q.data!.workspace}</dd>
        <dt className="text-muted">Email</dt>
        <dd>{q.data!.email}</dd>
      </dl>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        <Field label="Password" hint="At least 10 characters">{(p) => <Input {...p} type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} />}</Field>
        <Field label="Repeat the password" error={pw.b && pw.a !== pw.b ? "The passwords do not match" : undefined}>{(p) => <Input {...p} type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} />}</Field>
        <Button type="submit" className="w-full" size="lg" loading={busy} disabled={pw.a.length < 10 || pw.a !== pw.b}>Set password and sign in</Button>
      </form>
    </Card>
  );
}
