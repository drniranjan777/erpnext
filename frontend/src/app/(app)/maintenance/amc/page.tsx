"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";
import { MT, type Asset } from "@/lib/maintenance";

interface Amc { id: string; title: string; vendor: string; startDate: string; endDate: string; value: string; visitsPerYear: number | null; responseHours: number | null; coverage: string | null; state: "active" | "expiring" | "expired"; preventiveVisits: number; breakdownVisits: number; slaMissed: number; assets: { code: string; name: string }[] }
interface Visit { id: string; kind: string; calledAt: string | null; attendedAt: string; engineer: string | null; notes: string | null; withinSla: boolean | null; responseHours: string | null }
const STATE = { active: "success", expiring: "warning", expired: "danger" } as const;

export default function AmcPage() {
  const { can } = useAuth();
  const manage = can("maintenance.orders.manage");
  const q = useQuery({ queryKey: [MT, "amc"], queryFn: () => api<Amc[]>(`${MT}/amc`) });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="AMC contracts" description="Annual maintenance contracts: what they cover, promised visits and breakdown response time. Each visit is logged; breakdown visits are checked against the response time." actions={manage && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> New contract</Button>} />
      {adding && <AmcForm onClose={() => setAdding(false)} />}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      <div className="space-y-4">
        {q.data?.map((c) => (
          <Card key={c.id}>
            <CardHeader
              title={`${c.title} · ${c.vendor}`}
              description={`${formatDate(c.startDate)} – ${formatDate(c.endDate)} · ${formatMoney(c.value)}${c.visitsPerYear ? ` · ${c.preventiveVisits} of ${c.visitsPerYear} visits` : ""}${c.responseHours ? ` · ${c.responseHours} h response` : ""}`}
              action={<span className="flex items-center gap-2">{c.slaMissed > 0 && <Badge tone="danger">{c.slaMissed} SLA missed</Badge>}<Badge tone={STATE[c.state]}>{c.state}</Badge><Button size="sm" variant="ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Hide" : "Visits"}</Button></span>}
            />
            {c.assets.length > 0 && <p className="border-t border-border px-5 py-2 text-xs text-muted">Covers {c.assets.map((a) => `${a.code} ${a.name}`).join(", ")}</p>}
            {open === c.id && <Visits contract={c} manage={manage} />}
          </Card>
        ))}
        {q.data && !q.data.length && <p className="text-center text-sm text-muted">No contracts.</p>}
      </div>
    </div>
  );
}

function Visits({ contract, manage }: { contract: Amc; manage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [MT, "amc", contract.id, "visits"], queryFn: () => api<Visit[]>(`${MT}/amc/${contract.id}/visits`) });
  const now = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16);
  const [f, setF] = useState(() => ({ kind: "preventive", calledAt: "", attendedAt: now(), engineer: "", notes: "" }));
  const [error, setError] = useState<string | null>(null);
  const iso = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : null);
  async function add() {
    setError(null);
    try {
      await api(`${MT}/amc/${contract.id}/visits`, { body: { kind: f.kind, calledAt: iso(f.calledAt), attendedAt: iso(f.attendedAt), engineer: f.engineer || null, notes: f.notes || null } });
      qc.invalidateQueries({ queryKey: [MT, "amc"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <div className="border-t border-border">
      <ul className="divide-y divide-border text-sm">
        {q.data?.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
            <Badge>{v.kind}</Badge>
            <span>{formatDateTime(v.attendedAt)}{v.engineer && ` · ${v.engineer}`}</span>
            {v.responseHours && <span className="text-muted">responded in {v.responseHours} h</span>}
            {v.withinSla !== null && <Badge tone={v.withinSla ? "success" : "danger"}>{v.withinSla ? "Within SLA" : "SLA missed"}</Badge>}
            {v.notes && <span className="text-xs text-muted">{v.notes}</span>}
          </li>
        ))}
        {q.data && !q.data.length && <li className="px-5 py-2 text-muted">No visits yet.</li>}
      </ul>
      {manage && (
        <div className="grid gap-2 border-t border-border p-4 sm:grid-cols-6">
          {error && <div className="sm:col-span-6"><Alert>{error}</Alert></div>}
          <Field label="Visit">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="preventive">Preventive</option><option value="breakdown">Breakdown call</option></Select>}</Field>
          {f.kind === "breakdown" && <Field label="Called at">{(p) => <Input {...p} type="datetime-local" value={f.calledAt} onChange={(e) => setF({ ...f, calledAt: e.target.value })} />}</Field>}
          <Field label="Attended at">{(p) => <Input {...p} type="datetime-local" value={f.attendedAt} onChange={(e) => setF({ ...f, attendedAt: e.target.value })} />}</Field>
          <Field label="Engineer">{(p) => <Input {...p} value={f.engineer} onChange={(e) => setF({ ...f, engineer: e.target.value })} />}</Field>
          <Field label="Notes" className="sm:col-span-2">{(p) => <Input {...p} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
          <div className="flex items-end"><Button size="sm" onClick={add}>Log visit</Button></div>
        </div>
      )}
    </div>
  );
}

function AmcForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const assets = useQuery({ queryKey: [MT, "assets"], queryFn: () => api<Asset[]>(`${MT}/assets`) });
  const [vendor, setVendor] = useState<PickedParty | null>(null);
  const [f, setF] = useState({ title: "", startDate: todayIST(), endDate: "", value: "", visitsPerYear: "4", responseHours: "8", coverage: "" });
  const [covered, setCovered] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${MT}/amc`, { body: { ...f, vendorId: vendor?.id, assetIds: [...covered], visitsPerYear: f.visitsPerYear ? Number(f.visitsPerYear) : null, responseHours: f.responseHours ? Number(f.responseHours) : null, coverage: f.coverage || null } });
      qc.invalidateQueries({ queryKey: [MT, "amc"] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <CardHeader title="New AMC" />
      <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-4">
        {error && <div className="sm:col-span-4"><Alert>{error}</Alert></div>}
        <Field label="Contractor" className="sm:col-span-2">{(p) => <PartyPicker id={p.id} role="vendor" value={vendor} onChange={setVendor} />}</Field>
        <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="From">{(p) => <Input {...p} type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />}</Field>
        <Field label="To">{(p) => <Input {...p} type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />}</Field>
        <Field label="Value (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}</Field>
        <Field label="Visits a year">{(p) => <Input {...p} inputMode="numeric" value={f.visitsPerYear} onChange={(e) => setF({ ...f, visitsPerYear: e.target.value })} />}</Field>
        <Field label="Response (hours)">{(p) => <Input {...p} inputMode="numeric" value={f.responseHours} onChange={(e) => setF({ ...f, responseHours: e.target.value })} />}</Field>
        <Field label="Coverage" className="sm:col-span-3">{(p) => <Input {...p} placeholder="Parts and labour, excluding consumables" value={f.coverage} onChange={(e) => setF({ ...f, coverage: e.target.value })} />}</Field>
        <div className="space-y-1 sm:col-span-4">
          <p className="text-sm font-medium">Assets covered</p>
          <div className="grid gap-1 sm:grid-cols-3">{assets.data?.map((a) => <Checkbox key={a.id} label={`${a.code} ${a.name}`} checked={covered.has(a.id)} onChange={(e) => setCovered((s) => { const n = new Set(s); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n; })} />)}</div>
        </div>
        <div className="flex justify-end gap-2 sm:col-span-4"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!vendor || !f.title.trim() || !f.endDate}>Save</Button></div>
      </div>
    </Card>
  );
}
