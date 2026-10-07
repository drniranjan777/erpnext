"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2, X } from "lucide-react";
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
import { HR } from "@/lib/hr";
import { inr, monthLabel } from "@/lib/payroll";

interface Claim { id: string; kind: string; spentOn: string; amount: string; description: string; status: "pending" | "approved" | "rejected"; approvedAmount: string | null; payMonth: string | null; decisionNote: string | null; employeeId: string; code: string; fullName: string; isOwn: boolean; isManager: boolean }
const TONE = { pending: "warning", approved: "success", rejected: "danger" } as const;

export default function ClaimsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState<Claim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: [HR, "claims", status], queryFn: () => api<Claim[]>(`${HR}/claims`, { query: { status: status || undefined } }) });
  async function withdraw(id: string) {
    setError(null);
    try {
      await api(`${HR}/claims/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: [HR, "claims"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Expense claims" description="Claims approved by the reporting manager or HR are paid with the next open payroll as a reimbursement." actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> New claim</Button>} />
      <Select className="h-9 w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></Select>
      {error && <Alert>{error}</Alert>}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <span className="w-24">{formatDate(c.spentOn)}</span>
                <span className="font-medium">{c.isOwn ? "Me" : c.fullName}</span>
                <Badge>{c.kind}</Badge>
                <span className="text-muted">{c.description}</span>
                <span className="tabular-nums">{inr(c.amount)}</span>
                <Badge tone={TONE[c.status]}>{c.status}{c.status === "approved" && c.approvedAmount !== c.amount ? ` ${inr(c.approvedAmount)}` : ""}</Badge>
                {c.payMonth && <span className="text-xs text-muted">paid with {monthLabel(c.payMonth)} salary</span>}
                {c.decisionNote && <span className="text-xs text-muted">“{c.decisionNote}”</span>}
                <span className="ml-auto flex gap-1">
                  {c.status === "pending" && !c.isOwn && (c.isManager || can("hr.claims.manage")) && <Button size="sm" variant="secondary" onClick={() => setDeciding(c)}>Decide</Button>}
                  {c.status === "pending" && c.isOwn && <Button size="sm" variant="ghost" aria-label="Withdraw" onClick={() => withdraw(c.id)}><Trash2 className="size-3.5" aria-hidden /></Button>}
                </span>
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-6 text-center text-muted">No claims.</li>}
          </ul>
        </Card>
      )}
      {adding && <NewClaim onClose={() => setAdding(false)} />}
      {deciding && <Decide c={deciding} onClose={() => setDeciding(null)} />}
    </div>
  );
}

function NewClaim({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ kind: "travel", spentOn: todayIST(), amount: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${HR}/claims`, { body: { ...f, amount: Number(f.amount) } });
      await qc.invalidateQueries({ queryKey: [HR, "claims"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New expense claim" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!Number(f.amount) || f.description.trim().length < 3}>Submit</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="For">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="travel">Travel</option><option value="conveyance">Local conveyance</option><option value="food">Food</option><option value="medical">Medical</option><option value="phone">Phone</option><option value="other">Other</option></Select>}</Field>
        <Field label="Spent on">{(p) => <Input {...p} type="date" max={todayIST()} value={f.spentOn} onChange={(e) => setF({ ...f, spentOn: e.target.value })} />}</Field>
        <Field label="Amount (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        <Field label="What for" className="sm:col-span-2">{(p) => <Input {...p} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function Decide({ c, onClose }: { c: Claim; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(String(Number(c.amount)));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function decide(approve: boolean) {
    setError(null);
    try {
      await api(`${HR}/claims/${c.id}/decide`, { body: { approve, approvedAmount: approve ? Number(amount) : undefined, note: note || undefined } });
      await qc.invalidateQueries({ queryKey: [HR, "claims"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`${c.fullName}: ${c.kind} ${inr(c.amount)}`} footer={<><Button variant="ghost" onClick={() => decide(false)}><X className="size-4" aria-hidden /> Reject</Button><Button onClick={() => decide(true)}><Check className="size-4" aria-hidden /> Approve</Button></>}>
      {error && <Alert>{error}</Alert>}
      <p className="mb-3 text-sm text-muted">{c.description} · {formatDate(c.spentOn)}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Approve (₹)">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Note">{(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
