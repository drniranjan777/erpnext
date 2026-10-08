"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Landmark, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { DMS, type Distributor, type SchemeRow } from "@/lib/dms";
import { inr } from "@/lib/payroll";
import { askConfirm, askText } from "@/components/ui/ask";

interface Claim { id: string; number: string; kind: string; fromDate: string; toDate: string; claimedAmount: string; computedAmount: string | null; approvedAmount: string | null; status: "submitted" | "approved" | "rejected" | "settled"; notes: string | null; decisionNote: string | null; journalId: string | null; distributor: string; schemeCode: string | null; schemeName: string | null }
const TONE = { submitted: "warning", approved: "primary", rejected: "danger", settled: "success" } as const;

export default function ClaimsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [raising, setRaising] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: [DMS, "claims", status], queryFn: () => api<Claim[]>(`${DMS}/claims`, { query: { status: status || undefined } }) });
  async function act(path: string, body: unknown, confirmText?: string) {
    if (confirmText && !await askConfirm(confirmText)) return;
    setError(null);
    try {
      await api(path, { body });
      qc.invalidateQueries({ queryKey: [DMS, "claims"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Distributor claims" description="Scheme claims are checked against the sales the scheme applied to; settled claims credit the distributor's account." actions={can("dms.claims.manage") && <Button onClick={() => setRaising(true)}><Plus className="size-4" aria-hidden /> Claim</Button>} />
      <Select className="h-9 w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="settled">Settled</option><option value="rejected">Rejected</option></Select>
      {error && <Alert>{error}</Alert>}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Claim</th><th className="px-4 py-2 font-medium">Period</th><th className="px-3 py-2 text-right font-medium">Claimed</th><th className="px-3 py-2 text-right font-medium">Per the system</th><th className="px-3 py-2 text-right font-medium">Approved</th><th className="px-4 py-2 font-medium">Status</th><th /></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2"><span className="font-medium">{c.distributor}</span><span className="block text-xs text-muted">{c.number} · {c.schemeCode ? `${c.schemeCode} ${c.schemeName}` : c.kind.replace("_", " ")}</span></td>
                  <td className="px-4 py-2 text-xs">{formatDate(c.fromDate)} – {formatDate(c.toDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(c.claimedAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.computedAmount === null ? "–" : <span className={Number(c.computedAmount) < Number(c.claimedAmount) ? "text-warning" : ""}>{inr(c.computedAmount)}</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(c.approvedAmount)}</td>
                  <td className="px-4 py-2"><Badge tone={TONE[c.status]}>{c.status}</Badge>{c.journalId && <Link className="ml-2 text-xs text-primary hover:underline" href={`/accounting/journals/${c.journalId}`}>journal</Link>}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-flex gap-1">
                      {c.status === "submitted" && can("dms.claims.manage") && (
                        <>
                          <Button size="sm" variant="secondary" onClick={async () => { const v = await askText("Amount to approve", c.computedAmount ?? c.claimedAmount); if (v) act(`${DMS}/claims/${c.id}/decide`, { approve: true, approvedAmount: Number(v) }); }}><Check className="size-3.5" aria-hidden /> Approve</Button>
                          <Button size="sm" variant="ghost" aria-label="Reject" onClick={async () => { const note = await askText("Why rejected?"); if (note) act(`${DMS}/claims/${c.id}/decide`, { approve: false, note }); }}><X className="size-3.5" aria-hidden /></Button>
                        </>
                      )}
                      {c.status === "approved" && can("dms.claims.settle") && <Button size="sm" onClick={() => act(`${DMS}/claims/${c.id}/settle`, {}, `Credit ${c.distributor} with ${inr(c.approvedAmount)}?`)}><Landmark className="size-3.5" aria-hidden /> Settle</Button>}
                    </span>
                  </td>
                </tr>
              ))}
              {!q.data.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No claims.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
      {raising && <RaiseDialog onClose={() => setRaising(false)} />}
    </div>
  );
}

function RaiseDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const dists = useQuery({ queryKey: [DMS, "distributors"], queryFn: () => api<Distributor[]>(`${DMS}/distributors`) });
  const schemes = useQuery({ queryKey: [DMS, "schemes"], queryFn: () => api<SchemeRow[]>(`${DMS}/schemes`) });
  const [f, setF] = useState({ distributorId: "", kind: "scheme", schemeId: "", fromDate: `${todayIST().slice(0, 7)}-01`, toDate: todayIST(), claimedAmount: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${DMS}/claims`, { body: { ...f, schemeId: f.kind === "scheme" ? f.schemeId : null, claimedAmount: Number(f.claimedAmount), notes: f.notes || null } });
      await qc.invalidateQueries({ queryKey: [DMS, "claims"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Distributor claim" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.distributorId || !Number(f.claimedAmount) || (f.kind === "scheme" && !f.schemeId)}>Submit</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Distributor">{(p) => <Select {...p} value={f.distributorId} onChange={(e) => setF({ ...f, distributorId: e.target.value })}><option value="">Choose…</option>{dists.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="scheme">Scheme</option><option value="damage">Damaged goods</option><option value="price_difference">Price difference</option><option value="other">Other</option></Select>}</Field>
        {f.kind === "scheme" && <Field label="Scheme" className="sm:col-span-2">{(p) => <Select {...p} value={f.schemeId} onChange={(e) => setF({ ...f, schemeId: e.target.value })}><option value="">Choose…</option>{schemes.data?.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name} ({s.level})</option>)}</Select>}</Field>}
        <Field label="From">{(p) => <Input {...p} type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} />}</Field>
        <Field label="To">{(p) => <Input {...p} type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} />}</Field>
        <Field label="Amount claimed (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.claimedAmount} onChange={(e) => setF({ ...f, claimedAmount: e.target.value })} />}</Field>
        <Field label="Notes">{(p) => <Input {...p} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
