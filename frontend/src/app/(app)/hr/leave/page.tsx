"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Undo2, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { HR, type LeaveBalance, type LeaveType } from "@/lib/hr";

interface Application { id: string; fromDate: string; toDate: string; fromHalf: boolean; toHalf: boolean; days: number; reason: string; status: string; decisionNote: string | null; typeCode: string; typeName: string; employeeId: string; code: string; fullName: string; isOwn: boolean; isManager: boolean }
const TONE = { pending: "warning", approved: "success", rejected: "danger", cancelled: "neutral" } as const;

export default function LeavePage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = useQuery({ queryKey: [HR, "leave", "balances", "me"], queryFn: () => api<LeaveBalance[]>(`${HR}/leave/balances`), retry: false });
  const q = useQuery({ queryKey: [HR, "leave", "applications", status], queryFn: () => api<Application[]>(`${HR}/leave/applications`, { query: { status: status || undefined } }) });
  const refresh = () => qc.invalidateQueries({ queryKey: [HR] });
  async function act(path: string, body: unknown = {}) {
    setError(null);
    try {
      await api(path, { body });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const hr = can("hr.leave.manage");
  const span = (a: Application) => `${formatDate(a.fromDate)}${a.fromHalf ? " (2nd half)" : ""}${a.toDate !== a.fromDate ? ` – ${formatDate(a.toDate)}` : ""}${a.toHalf ? " (1st half)" : ""}`;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Leave" description="Applications go to the reporting manager or HR. Approved leave is shown on the muster roll." actions={<Button onClick={() => setApplying(true)}><Plus className="size-4" aria-hidden /> Apply</Button>} />
      {mine.data && mine.data.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {mine.data.map((b) => (
            <Card key={b.leaveTypeId} className="px-4 py-3">
              <p className="text-xs text-muted">{b.typeName}</p>
              <p className="text-xl font-semibold tabular-nums">{b.balanceNow - b.pending}</p>
              <p className="text-xs text-muted">{b.pending ? `${b.pending} pending · ` : ""}{b.availed} taken this year</p>
            </Card>
          ))}
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title="Applications" action={<Select className="h-9 w-36" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option><option value="">All</option></Select>} />
        {q.isLoading && <LoadingBlock />}
        {q.error && <ErrorBlock error={q.error} />}
        <ul className="divide-y divide-border border-t border-border text-sm">
          {q.data?.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <span className="font-medium">{a.fullName}</span>
              <Badge>{a.typeCode}</Badge>
              <span>{span(a)}</span>
              <span className="text-muted">{a.days} day(s) · {a.reason}</span>
              <Badge tone={TONE[a.status as keyof typeof TONE]}>{a.status}</Badge>
              <span className="ml-auto flex gap-1">
                {a.status === "pending" && !a.isOwn && (a.isManager || hr) && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => act(`${HR}/leave/applications/${a.id}/decide`, { approve: true })}><Check className="size-4" aria-hidden /> Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => act(`${HR}/leave/applications/${a.id}/decide`, { approve: false })}><X className="size-4" aria-hidden /> Reject</Button>
                  </>
                )}
                {(a.status === "pending" || a.status === "approved") && (hr || (a.isOwn && (a.status === "pending" || a.fromDate > todayIST()))) && (
                  <Button size="sm" variant="ghost" onClick={() => act(`${HR}/leave/applications/${a.id}/cancel`)}><Undo2 className="size-4" aria-hidden /> Cancel</Button>
                )}
              </span>
            </li>
          ))}
          {q.data && !q.data.length && <li className="px-5 py-6 text-center text-muted">No applications.</li>}
        </ul>
      </Card>
      {applying && <ApplyDialog onClose={() => setApplying(false)} onDone={() => { setApplying(false); refresh(); }} />}
    </div>
  );
}

function ApplyDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { can } = useAuth();
  const types = useQuery({ queryKey: [HR, "leave", "types"], queryFn: () => api<LeaveType[]>(`${HR}/leave/types`) });
  const people = useQuery({ queryKey: [HR, "people"], queryFn: () => api<{ id: string; code: string; fullName: string }[]>(`${HR}/employees/search`), enabled: can("hr.leave.manage") && can("hr.employees.read") });
  const [f, setF] = useState({ employeeId: "", leaveTypeId: "", fromDate: todayIST(), toDate: todayIST(), fromHalf: false, toHalf: false, reason: "" });
  const [error, setError] = useState<string | null>(null);
  const type = types.data?.find((t) => t.id === f.leaveTypeId);
  async function save() {
    setError(null);
    try {
      await api(`${HR}/leave/applications`, { body: { ...f, employeeId: f.employeeId || undefined } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Apply for leave" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.leaveTypeId || f.reason.trim().length < 3}>Apply</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {can("hr.leave.manage") && <Field label="Employee" className="sm:col-span-2">{(p) => <Select {...p} value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Myself</option>{people.data?.map((m) => <option key={m.id} value={m.id}>{m.fullName} ({m.code})</option>)}</Select>}</Field>}
        <Field label="Leave type" className="sm:col-span-2">{(p) => <Select {...p} value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}><option value="">Choose…</option>{types.data?.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}{t.isPaid ? "" : " (unpaid)"}</option>)}</Select>}</Field>
        <Field label="From">{(p) => <Input {...p} type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} />}</Field>
        <Field label="To">{(p) => <Input {...p} type="date" min={f.fromDate} value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} />}</Field>
        {(!type || type.allowHalfDay) && (
          <>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.fromHalf} onChange={(e) => setF({ ...f, fromHalf: e.target.checked })} /> Start after lunch</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.toHalf} onChange={(e) => setF({ ...f, toHalf: e.target.checked })} /> End at lunch</label>
          </>
        )}
        <Field label="Reason" className="sm:col-span-2">{(p) => <Input {...p} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
        {type && <p className="text-xs text-muted sm:col-span-2">{type.countHolidays ? "Weekly offs and holidays inside the leave are counted." : "Weekly offs and holidays inside the leave are not counted."}</p>}
      </div>
    </Dialog>
  );
}
