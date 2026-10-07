"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
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
import { inr } from "@/lib/payroll";

interface Task { id: string; employeeId: string; kind: string; title: string; owner: string; dueDate: string | null; status: string; remarks: string | null; recovery: string | null; code: string; fullName: string }
interface Checklist { id: string; kind: "onboarding" | "exit"; name: string; items: { title: string; owner: string; days: number }[]; isDefault: boolean }
type Tab = "onboarding" | "exit" | "checklists";

export default function LifecyclePage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("onboarding");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Onboarding & exit" description="Joining tasks raised when a candidate is hired, and clearance tasks raised when a separation is accepted." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "onboarding", label: "Onboarding tasks" }, { value: "exit", label: "Exit clearance" }, { value: "checklists", label: "Checklists" }]} />
      {tab !== "checklists" ? <Tasks kind={tab} manage={can("hr.exit.manage")} /> : <Checklists manage={can("hr.exit.manage")} />}
    </div>
  );
}

function Tasks({ kind, manage }: { kind: "onboarding" | "exit"; manage: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending");
  const [editing, setEditing] = useState<Task | null>(null);
  const q = useQuery({ queryKey: [HR, "tasks", kind, status], queryFn: () => api<Task[]>(`${HR}/tasks`, { query: { kind, status: status || undefined } }) });
  const today = todayIST();
  return (
    <>
      <Select className="h-9 w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">Pending</option><option value="done">Done</option><option value="">All</option></Select>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <Link className="w-40 font-medium hover:underline" href={`${HR}/employees/${t.employeeId}`}>{t.fullName}</Link>
                <span>{t.title}</span>
                <Badge>{t.owner}</Badge>
                {t.dueDate && <span className={`text-xs ${t.status === "pending" && t.dueDate < today ? "text-danger" : "text-muted"}`}>due {formatDate(t.dueDate)}</span>}
                {t.recovery && Number(t.recovery) > 0 && <Badge tone="danger">recover {inr(t.recovery)}</Badge>}
                {t.remarks && <span className="text-xs text-muted">{t.remarks}</span>}
                <span className="ml-auto">{t.status === "pending" ? manage && <Button size="sm" variant="secondary" onClick={() => setEditing(t)}><Check className="size-3.5" aria-hidden /> Close</Button> : <Badge tone="success">{t.status.replace("_", " ")}</Badge>}</span>
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-6 text-center text-muted">Nothing here.</li>}
          </ul>
        </Card>
      )}
      {editing && <CloseTask t={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: [HR, "tasks"] }); }} />}
    </>
  );
}

function CloseTask({ t, onClose, onDone }: { t: Task; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ status: "done", remarks: "", recovery: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${HR}/tasks/${t.id}`, { method: "PUT", body: { status: f.status, remarks: f.remarks || null, recovery: f.recovery ? Number(f.recovery) : null } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={t.title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Outcome">{(p) => <Select {...p} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="done">Done</option><option value="not_needed">Not needed</option></Select>}</Field>
        {t.kind === "exit" && <Field label="Recover from settlement (₹)" hint="E.g. an unreturned item">{(p) => <Input {...p} inputMode="decimal" value={f.recovery} onChange={(e) => setF({ ...f, recovery: e.target.value })} />}</Field>}
        <Field label="Remarks" className="sm:col-span-2">{(p) => <Input {...p} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function Checklists({ manage }: { manage: boolean }) {
  const q = useQuery({ queryKey: [HR, "checklists"], queryFn: () => api<Checklist[]>(`${HR}/checklists`) });
  const [editing, setEditing] = useState<Checklist | "new" | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  return (
    <>
      {manage && <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> New checklist</Button>}
      {q.data?.map((c) => (
        <Card key={c.id} className="px-5 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">{c.name} <Badge>{c.kind}</Badge>{c.isDefault && <Badge tone="primary">in use</Badge>}{manage && <Button className="ml-auto" size="sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Pencil className="size-3.5" aria-hidden /></Button>}</p>
          <ul className="mt-2 list-disc pl-5 text-muted">{c.items.map((i, n) => <li key={n}>{i.title} · {i.owner} · {c.kind === "onboarding" ? `day ${i.days}` : `${i.days} day(s) before the last day`}</li>)}</ul>
        </Card>
      ))}
      {q.data && !q.data.length && <p className="text-sm text-muted">No checklists yet.</p>}
      {editing && <ChecklistDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ChecklistDialog({ row, onClose }: { row: Checklist | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ kind: row?.kind ?? "onboarding", name: row?.name ?? "", isDefault: row?.isDefault ?? true });
  const [items, setItems] = useState(row?.items.map((i) => ({ ...i, days: String(i.days) })) ?? [{ title: "", owner: "HR", days: "0" }]);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(row ? `${HR}/checklists/${row.id}` : `${HR}/checklists`, { method: row ? "PUT" : "POST", body: { ...f, items: items.filter((i) => i.title.trim()).map((i) => ({ ...i, days: Number(i.days) || 0 })) } });
      await qc.invalidateQueries({ queryKey: [HR, "checklists"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const set = (i: number, k: "title" | "owner" | "days", v: string) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Dialog open onClose={onClose} title={row ? `Edit ${row.name}` : "New checklist"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="For">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "onboarding" | "exit" })}><option value="onboarding">Joining</option><option value="exit">Exit clearance</option></Select>}</Field>
        <div className="space-y-2 sm:col-span-2">
          {items.map((i, n) => (
            <div key={n} className="flex gap-2">
              <Input aria-label="Task" className="flex-1" placeholder="Task" value={i.title} onChange={(e) => set(n, "title", e.target.value)} />
              <Input aria-label="Owner" className="w-28" placeholder="Owner" value={i.owner} onChange={(e) => set(n, "owner", e.target.value)} />
              <Input aria-label="Days" className="w-20" type="number" value={i.days} onChange={(e) => set(n, "days", e.target.value)} />
              <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setItems(items.filter((_, j) => j !== n))}><Trash2 className="size-3.5" aria-hidden /></Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setItems([...items, { title: "", owner: "HR", days: "0" }])}><Plus className="size-4" aria-hidden /> Add task</Button>
          <p className="text-xs text-muted">Days: after joining for onboarding; before the last working day for exit.</p>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /> Use for new joiners / separations</label>
      </div>
    </Dialog>
  );
}
