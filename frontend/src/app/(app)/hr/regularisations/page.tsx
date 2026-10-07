"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
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

interface Reg { id: string; date: string; inAt: string | null; outAt: string | null; reason: string; status: string; decisionNote: string | null; employeeId: string; code: string; fullName: string; isOwn: boolean; isManager: boolean }
const TONE = { pending: "warning", approved: "success", rejected: "danger" } as const;
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "–");

export default function RegularisationsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: [HR, "regularisations", status], queryFn: () => api<Reg[]>(`${HR}/attendance/regularisations`, { query: { status: status || undefined } }) });
  async function decide(id: string, approve: boolean) {
    setError(null);
    try {
      await api(`${HR}/attendance/regularisations/${id}/decide`, { body: { approve } });
      qc.invalidateQueries({ queryKey: [HR] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const mayDecide = (r: Reg) => r.status === "pending" && !r.isOwn && (r.isManager || can("hr.attendance.manage"));
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Regularisation" description="Correct a missed or wrong punch. The reporting manager or HR approves; the day is then recalculated." actions={<Button onClick={() => setAsking(true)}><Plus className="size-4" aria-hidden /> Request</Button>} />
      <Select className="h-9 w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></Select>
      {error && <Alert>{error}</Alert>}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <span className="w-28">{formatDate(r.date)}</span>
                <span className="font-medium">{r.fullName}</span>
                <span className="tabular-nums text-muted">in {time(r.inAt)} · out {time(r.outAt)}</span>
                <span className="text-muted">{r.reason}</span>
                <Badge tone={TONE[r.status as keyof typeof TONE]}>{r.status}</Badge>
                {mayDecide(r) && (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => decide(r.id, true)}><Check className="size-4" aria-hidden /> Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => decide(r.id, false)}><X className="size-4" aria-hidden /> Reject</Button>
                  </span>
                )}
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-6 text-center text-muted">Nothing here.</li>}
          </ul>
        </Card>
      )}
      {asking && <RequestDialog onClose={() => setAsking(false)} />}
    </div>
  );
}

function RequestDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const people = useQuery({ queryKey: [HR, "people"], queryFn: () => api<{ id: string; code: string; fullName: string }[]>(`${HR}/employees/search`), enabled: can("hr.employees.read") });
  const [f, setF] = useState({ employeeId: "", date: todayIST(), inTime: "", outTime: "", reason: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${HR}/attendance/regularisations`, { body: { employeeId: f.employeeId || undefined, date: f.date, inTime: f.inTime || null, outTime: f.outTime || null, reason: f.reason } });
      await qc.invalidateQueries({ queryKey: [HR, "regularisations"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Regularise a day" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={f.reason.trim().length < 3 || (!f.inTime && !f.outTime)}>Send</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {can("hr.attendance.manage") && <Field label="Employee" className="sm:col-span-2">{(p) => <Select {...p} value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Myself</option>{people.data?.map((m) => <option key={m.id} value={m.id}>{m.fullName} ({m.code})</option>)}</Select>}</Field>}
        <Field label="Date" className="sm:col-span-2">{(p) => <Input {...p} type="date" max={todayIST()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="In at">{(p) => <Input {...p} type="time" value={f.inTime} onChange={(e) => setF({ ...f, inTime: e.target.value })} />}</Field>
        <Field label="Out at">{(p) => <Input {...p} type="time" value={f.outTime} onChange={(e) => setF({ ...f, outTime: e.target.value })} />}</Field>
        <Field label="Reason" className="sm:col-span-2">{(p) => <Input {...p} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
