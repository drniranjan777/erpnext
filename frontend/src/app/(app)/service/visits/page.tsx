"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { SignaturePad } from "@/components/service/signature-pad";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SVC, when } from "@/lib/service";

interface Visit { id: string; number: string; kind: string; status: string; scheduledAt: string; completedAt: string | null; serialNo: string | null; customer: string; technician: string | null; ticketNumber: string | null; ticketId: string | null; contractNumber: string | null; itemName: string | null; chargeable: boolean }
const TONE = { scheduled: "primary", in_progress: "warning", done: "success", cancelled: "neutral" } as const;

export default function VisitsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState({ mine: true, status: "scheduled" });
  const [completing, setCompleting] = useState<Visit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: [SVC, "visits", f], queryFn: () => api<Visit[]>(`${SVC}/visits`, { query: { mine: f.mine ? "true" : undefined, status: f.status || undefined } }) });
  async function start(id: string) {
    setError(null);
    try {
      await api(`${SVC}/visits/${id}/start`, { body: {} });
      qc.invalidateQueries({ queryKey: [SVC, "visits"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const field = can("service.field.manage");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Service visits" description="Installation, preventive (contract) and breakdown visits. Finish one with the work done, spares used and the customer's signature." />
      <div className="flex flex-wrap items-center gap-3">
        <Select className="h-9 w-40" aria-label="Whose" value={f.mine ? "mine" : "all"} onChange={(e) => setF({ ...f, mine: e.target.value === "mine" })}><option value="mine">My visits</option><option value="all">Everyone&apos;s</option></Select>
        <Select className="h-9 w-40" aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="">All</option></Select>
      </div>
      {error && <Alert>{error}</Alert>}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="w-40 text-xs">{when(v.scheduledAt)}</span>
                <span className="font-medium">{v.customer}</span>
                <Badge>{v.kind}</Badge>
                <span className="text-xs text-muted">{[v.itemName, v.serialNo, v.contractNumber, v.technician].filter(Boolean).join(" · ")}</span>
                {v.ticketId && <Link className="text-xs text-primary hover:underline" href={`${SVC}/tickets/${v.ticketId}`}>{v.ticketNumber}</Link>}
                <Badge tone={TONE[v.status as keyof typeof TONE]} className="ml-auto">{v.status.replace("_", " ")}</Badge>
                {v.status === "done" && v.chargeable && <Badge tone="warning">chargeable</Badge>}
                {field && v.status === "scheduled" && <Button size="sm" variant="secondary" onClick={() => start(v.id)}><Play className="size-3.5" aria-hidden /> Start</Button>}
                {field && ["scheduled", "in_progress"].includes(v.status) && <Button size="sm" onClick={() => setCompleting(v)}>Finish</Button>}
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-6 text-center text-muted">No visits.</li>}
          </ul>
        </Card>
      )}
      {completing && <CompleteDialog v={completing} onClose={() => setCompleting(null)} />}
    </div>
  );
}

function CompleteDialog({ v, onClose }: { v: Visit; onClose: () => void }) {
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["/masters/items", "all"], queryFn: () => api<{ items: { id: string; code: string; name: string }[] }>(`/masters/items`, { query: { limit: 200 } }) });
  const warehouses = useQuery({ queryKey: ["/inventory/warehouses"], queryFn: () => api<{ id: string; code: string; name: string }[]>("/inventory/warehouses") });
  const [f, setF] = useState({ workDone: "", signedBy: "", warehouseId: "", chargeable: "auto" });
  const [checks, setChecks] = useState<{ item: string; ok: boolean }[]>([]);
  const [spares, setSpares] = useState<{ itemId: string; qty: string }[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onSign = useCallback((d: string | null) => setSignature(d), []);
  async function save() {
    setError(null);
    try {
      const used = spares.filter((s) => s.itemId && Number(s.qty));
      await api(`${SVC}/visits/${v.id}/complete`, { body: { workDone: f.workDone, signedBy: f.signedBy, signature, checklist: checks.filter((c) => c.item.trim()), spares: used.map((s) => ({ itemId: s.itemId, qty: Number(s.qty) })), warehouseId: used.length ? f.warehouseId : undefined, chargeable: f.chargeable === "auto" ? undefined : f.chargeable === "yes" } });
      await qc.invalidateQueries({ queryKey: [SVC] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Finish ${v.number}: ${v.customer}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={f.workDone.trim().length < 3 || f.signedBy.trim().length < 2}>Finish visit</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        <Field label="Work done">{(p) => <textarea {...p} rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" value={f.workDone} onChange={(e) => setF({ ...f, workDone: e.target.value })} />}</Field>
        <div className="space-y-1">
          <p className="text-sm font-medium">Checklist</p>
          {checks.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label="Check" className="flex-1" value={c.item} onChange={(e) => setChecks(checks.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={c.ok} onChange={(e) => setChecks(checks.map((x, j) => (j === i ? { ...x, ok: e.target.checked } : x)))} /> OK</label>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setChecks([...checks, { item: "", ok: true }])}><Plus className="size-4" aria-hidden /> Check</Button>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Spares used</p>
          {spares.map((s, i) => (
            <div key={i} className="flex gap-2">
              <Select aria-label="Spare" className="flex-1" value={s.itemId} onChange={(e) => setSpares(spares.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}><option value="">Item…</option>{items.data?.items.map((it) => <option key={it.id} value={it.id}>{it.code} {it.name}</option>)}</Select>
              <Input aria-label="Quantity" className="w-20" inputMode="decimal" value={s.qty} onChange={(e) => setSpares(spares.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setSpares(spares.filter((_, j) => j !== i))}><Trash2 className="size-3.5" aria-hidden /></Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSpares([...spares, { itemId: "", qty: "1" }])}><Plus className="size-4" aria-hidden /> Spare</Button>
          {spares.length > 0 && <Field label="Issued from">{(p) => <Select {...p} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">Warehouse…</option>{warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field>}
        </div>
        <Field label="Charge the customer?" hint="Automatic: free under warranty or a comprehensive contract">{(p) => <Select {...p} value={f.chargeable} onChange={(e) => setF({ ...f, chargeable: e.target.value })}><option value="auto">Automatic</option><option value="yes">Chargeable</option><option value="no">Free</option></Select>}</Field>
        <Field label="Signed by (customer)">{(p) => <Input {...p} value={f.signedBy} onChange={(e) => setF({ ...f, signedBy: e.target.value })} />}</Field>
        <SignaturePad onChange={onSign} />
      </div>
    </Dialog>
  );
}
