"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { ACC, type BookSettings, type CostCenter } from "@/lib/accounting";
import { useAuth } from "@/lib/auth";
import { todayIST } from "@/lib/documents";

export default function AccountingSettingsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const s = useQuery({ queryKey: [ACC, "settings"], queryFn: () => api<BookSettings>(`${ACC}/settings`) });
  const [lock, setLock] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const manage = can("accounting.settings.manage");
  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ tone: "success", text: await fn() });
      qc.invalidateQueries({ queryKey: [ACC] });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Books" description="When the books start, which periods are closed, and cost centres." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {s.isLoading && <LoadingBlock />}
      {s.error && <ErrorBlock error={s.error} />}
      {s.data && (
        <Card>
          <CardHeader title="Period lock" description={`Books from ${s.data.booksFrom}. Nothing can be posted on or before the lock date, by documents or journals.`} />
          <div className="flex flex-wrap items-end gap-4 px-5 pb-5">
            <Field label="Locked up to">{(f) => <Input {...f} type="date" max={todayIST()} disabled={!manage} value={lock ?? s.data!.lockedUntil ?? ""} onChange={(e) => setLock(e.target.value)} />}</Field>
            {manage && (
              <>
                <Button loading={busy} disabled={lock === null} onClick={() => run(async () => { await api(`${ACC}/settings/${s.data!.companyId}`, { method: "PUT", body: { lockedUntil: lock || null } }); setLock(null); return lock ? `Locked up to ${lock}.` : "Unlocked."; })}>Save</Button>
                {s.data.lockedUntil && <Button variant="ghost" loading={busy} onClick={() => run(async () => { await api(`${ACC}/settings/${s.data!.companyId}`, { method: "PUT", body: { lockedUntil: null } }); return "Unlocked."; })}>Unlock</Button>}
              </>
            )}
          </div>
          <div className="border-t border-border px-5 py-4 text-sm">
            <p>
              {s.data.unposted ? <strong>{s.data.unposted} approved document(s)</strong> : "No documents"} from {s.data.booksFrom} are not in the ledger yet
              {s.data.initialisedAt && <span className="text-muted"> · last brought in {formatDateTime(s.data.initialisedAt)}</span>}.
            </p>
            {manage && s.data.unposted > 0 && (
              <Button className="mt-3" variant="secondary" loading={busy} onClick={() => run(async () => { const r = await api<{ posted: number }>(`${ACC}/settings/${s.data!.companyId}/initialise`, { method: "POST" }); return `${r.posted} document(s) posted to the ledger.`; })}>
                Post them now
              </Button>
            )}
          </div>
        </Card>
      )}
      <CostCenters />
    </div>
  );
}

function CostCenters() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [ACC, "cost-centers"], queryFn: () => api<CostCenter[]>(`${ACC}/cost-centers`) });
  const [f, setF] = useState({ code: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setError(null);
    try {
      await api(`${ACC}/cost-centers`, { body: f });
      setF({ code: "", name: "" });
      qc.invalidateQueries({ queryKey: [ACC, "cost-centers"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <CardHeader title="Cost centres" description="Tag journal lines with a plant, department or project." />
      <ul className="divide-y divide-border border-t border-border text-sm">
        {(q.data ?? []).map((c) => (
          <li key={c.id} className="flex gap-3 px-5 py-2"><span className="w-24 font-mono">{c.code}</span>{c.name}</li>
        ))}
        {q.data && !q.data.length && <li className="px-5 py-3 text-muted">None yet</li>}
      </ul>
      {can("accounting.accounts.manage") && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border px-5 py-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Code">{(p) => <Input {...p} className="w-32 uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />}</Field>
          <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Button variant="secondary" disabled={!f.code || f.name.length < 2} onClick={add}>Add</Button>
        </div>
      )}
    </Card>
  );
}
