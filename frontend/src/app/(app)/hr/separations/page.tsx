"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Check, LogOut, Undo2 } from "lucide-react";
import Link from "next/link";
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
import { HR } from "@/lib/hr";
import { inr } from "@/lib/payroll";
import { SEP_TONE, type SettlementLine } from "@/lib/talent";
import { askConfirm } from "@/components/ui/ask";
import { DataTable } from "@/components/ui/data-table";

interface Sep { id: string; kind: string; noticeDate: string; lastWorkingDay: string; reason: string; status: keyof typeof SEP_TONE; noticeShortfallDays: number; waiveShortfall: boolean; journalId: string | null; employeeId: string; code: string; fullName: string; department: string | null; pendingTasks: number }
interface Settlement { serviceDays?: number; earnings: SettlementLine[]; deductions: SettlementLine[]; net: string; checks: string[]; note?: string | null }

export default function SeparationsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const hr = can("hr.exit.read");
  const [status, setStatus] = useState("");
  const [dlg, setDlg] = useState<{ kind: "new" } | { kind: "accept"; s: Sep } | { kind: "ff"; s: Sep } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: [HR, "separations", status], queryFn: () => api<Sep[]>(`${HR}/separations`, { query: { status: status || undefined } }), enabled: hr });
  const mine = useQuery({ queryKey: [HR, "separations", "mine"], queryFn: () => api<Sep[]>(`${HR}/separations/mine`), retry: false, enabled: can("hr.self.use") });
  const refresh = () => qc.invalidateQueries({ queryKey: [HR] });
  async function withdraw(id: string) {
    if (!await askConfirm("Withdraw this separation?")) return;
    setError(null);
    try {
      await api(`${HR}/separations/${id}/withdraw`, { body: {} });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const open = mine.data?.find((s) => s.status === "requested" || s.status === "accepted");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Separations" description="Resignations and other exits: notice, clearance and the full and final settlement." actions={(can("hr.exit.manage") || (can("hr.self.use") && mine.data && !open)) && <Button onClick={() => setDlg({ kind: "new" })}><LogOut className="size-4" aria-hidden /> {can("hr.exit.manage") ? "Record separation" : "Resign"}</Button>} />
      {error && <Alert>{error}</Alert>}
      {open && !hr && (
        <Card className="px-5 py-4 text-sm">
          <p>Your resignation of {formatDate(open.noticeDate)}, last working day {formatDate(open.lastWorkingDay)}: <Badge tone={SEP_TONE[open.status]}>{open.status}</Badge></p>
          {open.status === "requested" && <Button className="mt-2" size="sm" variant="ghost" onClick={() => withdraw(open.id)}><Undo2 className="size-3.5" aria-hidden /> Withdraw</Button>}
        </Card>
      )}
      {hr && (
        <>
          <Select className="h-9 w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="requested">Requested</option><option value="accepted">Serving notice</option><option value="settled">Settled</option><option value="withdrawn">Withdrawn</option></Select>
          {q.isLoading && <LoadingBlock />}
          {q.error && <ErrorBlock error={q.error} />}
          {q.data && (
            <Card>
              <DataTable
                rows={q.data}
                rowKey={(s) => String(s.id)}
                exportName="hr-separations"
                storageKey="hr-separations-0"
                empty={<p className="px-4 py-6 text-center text-sm text-muted">No separations.</p>}
                columns={[
                  { key: "employee", label: "Employee", locked: true, className: "whitespace-normal", render: (s) => <><Link className="font-medium hover:underline" href={`${HR}/employees/${s.employeeId}`}>{s.fullName}</Link><span className="block text-xs text-muted">{s.reason}</span></> },
                  { key: "kind", label: "Kind", className: "capitalize whitespace-normal", render: (s) => <>{s.kind}</> },
                  { key: "notice-last-day", label: "Notice · last day", className: "whitespace-normal", render: (s) => <>{formatDate(s.noticeDate)} · {formatDate(s.lastWorkingDay)}</> },
                  { key: "short-notice", label: "Short notice", className: "whitespace-normal", render: (s) => <>{s.noticeShortfallDays ? `${s.noticeShortfallDays} days${s.waiveShortfall ? " (waived)" : ""}` : "–"}</> },
                  { key: "status", label: "Status", className: "whitespace-normal", render: (s) => <><Badge tone={SEP_TONE[s.status]}>{s.status === "accepted" ? "serving notice" : s.status}</Badge>{s.pendingTasks > 0 && <span className="ml-1 text-xs text-warning">{s.pendingTasks} clearance pending</span>}</> },
                  { key: "col5", label: "", align: "right", noSort: true, render: (s) => <><span className="inline-flex gap-1">
                                          {s.status === "requested" && can("hr.exit.manage") && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "accept", s })}><Check className="size-3.5" aria-hidden /> Accept</Button>}
                                          {(s.status === "accepted" || s.status === "settled") && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "ff", s })}><Calculator className="size-3.5" aria-hidden /> F&F</Button>}
                                          {["requested", "accepted"].includes(s.status) && can("hr.exit.manage") && <Button size="sm" variant="ghost" aria-label="Withdraw" onClick={() => withdraw(s.id)}><Undo2 className="size-3.5" aria-hidden /></Button>}
                                        </span></> },
                ]}
              />
            </Card>
          )}
        </>
      )}
      {dlg?.kind === "new" && <NewDialog hr={can("hr.exit.manage")} onClose={() => setDlg(null)} onDone={() => { setDlg(null); refresh(); }} />}
      {dlg?.kind === "accept" && <AcceptDialog s={dlg.s} onClose={() => setDlg(null)} onDone={() => { setDlg(null); refresh(); }} />}
      {dlg?.kind === "ff" && <SettlementDialog s={dlg.s} canSettle={can("hr.exit.settle")} onClose={() => setDlg(null)} onDone={refresh} />}
    </div>
  );
}

function NewDialog({ hr, onClose, onDone }: { hr: boolean; onClose: () => void; onDone: () => void }) {
  const people = useQuery({ queryKey: [HR, "people"], queryFn: () => api<{ id: string; code: string; fullName: string }[]>(`${HR}/employees/search`), enabled: hr });
  const [f, setF] = useState({ employeeId: "", kind: "resignation", noticeDate: todayIST(), lastWorkingDay: "", reason: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${HR}/separations`, { body: { ...f, employeeId: f.employeeId || undefined } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={hr ? "Record a separation" : "Resign"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.lastWorkingDay || f.reason.trim().length < 3}>Submit</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {hr && <Field label="Employee" className="sm:col-span-2">{(p) => <Select {...p} value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Myself</option>{people.data?.map((m) => <option key={m.id} value={m.id}>{m.fullName} ({m.code})</option>)}</Select>}</Field>}
        {hr && <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="resignation">Resignation</option><option value="termination">Termination</option><option value="retirement">Retirement</option><option value="death">Death</option><option value="absconding">Absconding</option></Select>}</Field>}
        {hr && <Field label="Notice given on">{(p) => <Input {...p} type="date" value={f.noticeDate} onChange={(e) => setF({ ...f, noticeDate: e.target.value })} />}</Field>}
        <Field label="Last working day">{(p) => <Input {...p} type="date" value={f.lastWorkingDay} onChange={(e) => setF({ ...f, lastWorkingDay: e.target.value })} />}</Field>
        <Field label="Reason" className="sm:col-span-2">{(p) => <Input {...p} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function AcceptDialog({ s, onClose, onDone }: { s: Sep; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ lastWorkingDay: s.lastWorkingDay, waiveShortfall: false });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${HR}/separations/${s.id}/accept`, { body: f });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Accept: ${s.fullName}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Accept</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        <Field label="Last working day" hint={`Notice given ${formatDate(s.noticeDate)}`}>{(p) => <Input {...p} type="date" value={f.lastWorkingDay} onChange={(e) => setF({ ...f, lastWorkingDay: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.waiveShortfall} onChange={(e) => setF({ ...f, waiveShortfall: e.target.checked })} /> Waive recovery for notice not served</label>
        <p className="text-xs text-muted">Puts the employee on notice and raises the exit clearance checklist.</p>
      </div>
    </Dialog>
  );
}

function SettlementDialog({ s, canSettle, onClose, onDone }: { s: Sep; canSettle: boolean; onClose: () => void; onDone: () => void }) {
  const q = useQuery({ queryKey: [HR, "separations", s.id, "ff"], queryFn: () => api<Settlement>(`${HR}/separations/${s.id}/settlement`) });
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  async function settle() {
    if (!await askConfirm("Post the full and final settlement? The employee is marked as left.")) return;
    setError(null);
    try {
      await api(`${HR}/separations/${s.id}/settle`, { body: {} });
      setPosted(true);
      onDone();
      q.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const d = q.data;
  const settled = s.status === "settled" || posted;
  const block = (title: string, ls: SettlementLine[]) => (
    <Card>
      <CardHeader title={title} />
      <ul className="divide-y divide-border border-t border-border text-sm">
        {ls.map((l) => <li key={l.code} className="flex justify-between px-4 py-1.5"><span>{l.name}{l.basis && <span className="block text-xs text-muted">{l.basis}</span>}</span><span className="tabular-nums">{inr(l.amount)}</span></li>)}
        {!ls.length && <li className="px-4 py-2 text-muted">None</li>}
      </ul>
    </Card>
  );
  return (
    <Dialog open onClose={onClose} title={`Full and final: ${s.fullName}`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{!settled && canSettle && <Button disabled={!d || d.checks.length > 0} onClick={settle}>Post settlement</Button>}</>}>
      {q.isLoading && <LoadingBlock />}
      {error && <Alert>{error}</Alert>}
      {settled && <Alert tone="success">Settled and posted to the books.</Alert>}
      {d && (
        <div className="space-y-3">
          {!settled && d.checks.length > 0 && <Alert tone="warning">{d.checks.join(" · ")}</Alert>}
          {d.note && <p className="text-xs text-muted">{d.note}.</p>}
          <div className="grid gap-3 sm:grid-cols-2">{block("Payable", d.earnings)}{block("Recoverable", d.deductions)}</div>
          <p className="text-right text-base font-semibold">{Number(d.net) >= 0 ? `Net payable ${inr(d.net)}` : `Net recoverable from the employee ${inr(-Number(d.net))}`}</p>
        </div>
      )}
    </Dialog>
  );
}
