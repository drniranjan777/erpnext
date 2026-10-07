"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { inr } from "@/lib/payroll";
import { SVC, when } from "@/lib/service";

interface Lookup { serialNo: string; warranty: { customer: string; itemCode: string; itemName: string; startDate: string; endDate: string; status: string; inWarranty: boolean } | null; contract: { number: string; kind: string; toDate: string } | null; tickets: { id: string; number: string; subject: string; status: string; createdAt: string }[]; visits: { id: string; number: string; kind: string; status: string; scheduledAt: string }[]; rmas: { id: string; number: string; status: string; reason: string }[] }
interface Contract { id: string; number: string; kind: string; fromDate: string; toDate: string; value: string; visitsPerYear: number; serials: string[]; status: string; customer: string; expired: boolean; visitsDone: number; visitsPlanned: number }
type Tab = "lookup" | "contracts";
const KIND: Record<string, string> = { amc_labour: "AMC (labour)", amc_comprehensive: "AMC (comprehensive)", warranty_extension: "Extended warranty" };

export default function InstalledBasePage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <InstalledBase />
    </Suspense>
  );
}

function InstalledBase() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>("lookup");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Installed base" description="Every machine by serial number: warranty, service contract and its service history." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "lookup", label: "Machines" }, { value: "contracts", label: "Service contracts" }]} />
      {tab === "lookup" ? <LookupView initial={sp.get("serial") ?? ""} /> : <Contracts />}
    </div>
  );
}

function LookupView({ initial }: { initial: string }) {
  const { can } = useAuth();
  const [serial, setSerial] = useState(initial);
  const [query, setQuery] = useState(initial);
  const [registering, setRegistering] = useState(false);
  const q = useQuery({ queryKey: [SVC, "serial", query], queryFn: () => api<Lookup>(`${SVC}/serials/${encodeURIComponent(query)}`), enabled: !!query });
  const r = q.data;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Input className="h-10 w-64" placeholder="Serial number" aria-label="Serial number" value={serial} onChange={(e) => setSerial(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setQuery(serial.trim())} />
        <Button onClick={() => setQuery(serial.trim())}><Search className="size-4" aria-hidden /> Look up</Button>
        {can("service.contracts.manage") && <Button variant="secondary" onClick={() => setRegistering(true)}><Plus className="size-4" aria-hidden /> Register warranty</Button>}
      </div>
      {q.isLoading && query && <LoadingBlock />}
      {r && (
        <>
          <Card>
            <CardHeader title={r.warranty ? `${r.warranty.itemCode} ${r.warranty.itemName}: ${r.serialNo}` : r.serialNo} description={r.warranty?.customer} />
            <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3 text-sm">
              {r.warranty ? <Badge tone={r.warranty.inWarranty ? "success" : "neutral"}>{r.warranty.status === "void" ? "warranty void (replaced)" : r.warranty.inWarranty ? `in warranty to ${formatDate(r.warranty.endDate)}` : `warranty ended ${formatDate(r.warranty.endDate)}`}</Badge> : <Badge tone="warning">no warranty registered</Badge>}
              {r.contract && <Badge tone="primary">{r.contract.number} {KIND[r.contract.kind]} to {formatDate(r.contract.toDate)}</Badge>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Service history" />
            <ul className="divide-y divide-border border-t border-border text-sm">
              {r.tickets.map((t) => <li key={t.id} className="px-5 py-2"><Link className="text-primary hover:underline" href={`${SVC}/tickets/${t.id}`}>{t.number}</Link> {t.subject} <Badge>{t.status}</Badge> <span className="text-xs text-muted">{when(t.createdAt)}</span></li>)}
              {r.visits.map((v) => <li key={v.id} className="px-5 py-2">{v.number} {v.kind} visit <Badge>{v.status}</Badge> <span className="text-xs text-muted">{when(v.scheduledAt)}</span></li>)}
              {r.rmas.map((m) => <li key={m.id} className="px-5 py-2">{m.number} return: {m.reason} <Badge>{m.status}</Badge></li>)}
              {!r.tickets.length && !r.visits.length && !r.rmas.length && <li className="px-5 py-4 text-muted">No service history.</li>}
            </ul>
          </Card>
        </>
      )}
      {registering && <WarrantyDialog onClose={() => setRegistering(false)} />}
    </>
  );
}

function WarrantyDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const customers = useQuery({ queryKey: ["/masters/parties", "customers"], queryFn: () => api<{ items: { id: string; name: string }[] }>(`/masters/parties`, { query: { role: "customer", limit: 200 } }) });
  const items = useQuery({ queryKey: ["/masters/items", "all"], queryFn: () => api<{ items: { id: string; code: string; name: string }[] }>(`/masters/items`, { query: { limit: 200 } }) });
  const [f, setF] = useState({ partyId: "", itemId: "", serialNo: "", saleDate: todayIST(), months: "12" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${SVC}/warranties`, { body: { ...f, months: Number(f.months) || undefined } });
      await qc.invalidateQueries({ queryKey: [SVC] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Register a warranty" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.partyId || !f.itemId || !f.serialNo}>Register</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer">{(p) => <Select {...p} value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })}><option value="">Choose…</option>{customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Item">{(p) => <Select {...p} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">Choose…</option>{items.data?.items.map((i) => <option key={i.id} value={i.id}>{i.code} {i.name}</option>)}</Select>}</Field>
        <Field label="Serial no.">{(p) => <Input {...p} value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} />}</Field>
        <Field label="Sold on">{(p) => <Input {...p} type="date" value={f.saleDate} onChange={(e) => setF({ ...f, saleDate: e.target.value })} />}</Field>
        <Field label="Months">{(p) => <Input {...p} type="number" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} />}</Field>
      </div>
      <p className="mt-2 text-xs text-muted">Installing the machine through a service visit restarts the warranty from the installation date.</p>
    </Dialog>
  );
}

function Contracts() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [SVC, "contracts"], queryFn: () => api<Contract[]>(`${SVC}/contracts`) });
  const customers = useQuery({ queryKey: ["/masters/parties", "customers"], queryFn: () => api<{ items: { id: string; name: string }[] }>(`/masters/parties`, { query: { role: "customer", limit: 200 } }) });
  const members = useQuery({ queryKey: ["iam", "users"], queryFn: () => api<{ userId: string; fullName: string }[]>("/iam/users"), retry: false });
  const [f, setF] = useState({ partyId: "", kind: "amc_comprehensive", fromDate: todayIST(), toDate: "", value: "", visitsPerYear: "4", serials: "", technicianId: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${SVC}/contracts`, { body: { ...f, value: Number(f.value) || 0, visitsPerYear: Number(f.visitsPerYear) || 0, serials: f.serials.split(/[,\s]+/).filter(Boolean), technicianId: f.technicianId || null } });
      setF({ ...f, value: "", serials: "" });
      qc.invalidateQueries({ queryKey: [SVC] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <ul className="divide-y divide-border text-sm">
        {q.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
            <span className="font-mono text-xs text-muted">{c.number}</span>
            <span className="font-medium">{c.customer}</span>
            <Badge>{KIND[c.kind]}</Badge>
            <span className="text-xs text-muted">{formatDate(c.fromDate)} – {formatDate(c.toDate)} · {inr(c.value)} · {c.serials.length ? c.serials.join(", ") : "all machines"}</span>
            <span className="ml-auto text-xs">{c.visitsDone} done, {c.visitsPlanned} planned</span>
            {c.status === "cancelled" ? <Badge tone="danger">cancelled</Badge> : c.expired && <Badge>expired</Badge>}
          </li>
        ))}
        {q.data && !q.data.length && <li className="px-5 py-4 text-muted">No service contracts.</li>}
      </ul>
      {can("service.contracts.manage") && (
        <div className="grid gap-2 border-t border-border p-4 sm:grid-cols-4">
          {error && <div className="sm:col-span-4"><Alert>{error}</Alert></div>}
          <Field label="Customer">{(p) => <Select {...p} value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })}><option value="">Choose…</option>{customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="From">{(p) => <Input {...p} type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} />}</Field>
          <Field label="To">{(p) => <Input {...p} type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} />}</Field>
          <Field label="Value (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}</Field>
          <Field label="Visits a year">{(p) => <Input {...p} type="number" value={f.visitsPerYear} onChange={(e) => setF({ ...f, visitsPerYear: e.target.value })} />}</Field>
          <Field label="Technician">{(p) => <Select {...p} value={f.technicianId} onChange={(e) => setF({ ...f, technicianId: e.target.value })}><option value="">—</option>{members.data?.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}</Select>}</Field>
          <Field label="Serials covered" hint="Blank = all the customer's machines">{(p) => <Input {...p} value={f.serials} onChange={(e) => setF({ ...f, serials: e.target.value })} />}</Field>
          <div><Button size="sm" disabled={!f.partyId || !f.toDate} onClick={save}><Plus className="size-4" aria-hidden /> Add contract</Button></div>
        </div>
      )}
    </Card>
  );
}
