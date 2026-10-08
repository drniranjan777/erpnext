"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
import { formatDate } from "@/lib/documents";
import { DMS, WEEKDAYS, type Beat, type Distributor, type Retailer } from "@/lib/dms";
import { inr } from "@/lib/payroll";

interface Member { userId: string; fullName: string }
type Tab = "distributors" | "beats" | "retailers";

export default function DmsNetworkPage() {
  const { can } = useAuth();
  const manage = can("dms.network.manage");
  const [tab, setTab] = useState<Tab>("distributors");
  const members = useQuery({ queryKey: ["iam", "users"], queryFn: () => api<Member[]>("/iam/users"), retry: false, enabled: manage });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Distribution" description="Distributors, the beats your field team works, and the retailers on them." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "distributors", label: "Distributors" }, { value: "beats", label: "Beats" }, { value: "retailers", label: "Retailers" }]} />
      {tab === "distributors" && <Distributors manage={manage} members={members.data ?? []} />}
      {tab === "beats" && <Beats manage={manage} members={members.data ?? []} />}
      {tab === "retailers" && <Retailers manage={manage} />}
    </div>
  );
}

function useAct(key: unknown[]) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  async function act(path: string, body: unknown) {
    setError(null);
    try {
      await api(path, { body });
      await qc.invalidateQueries({ queryKey: key });
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      return false;
    }
  }
  return { error, act };
}

function Distributors({ manage, members }: { manage: boolean; members: Member[] }) {
  const q = useQuery({ queryKey: [DMS, "distributors"], queryFn: () => api<Distributor[]>(`${DMS}/distributors`) });
  const customers = useQuery({ queryKey: ["/masters/parties", "customers"], queryFn: () => api<{ items: { id: string; name: string }[] }>(`/masters/parties`, { query: { role: "customer", limit: 200 } }), enabled: manage });
  const { error, act } = useAct([DMS]);
  const [f, setF] = useState({ partyId: "", salespersonId: "" });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <Card>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Distributor</th><th className="px-4 py-2 font-medium">Salesperson</th><th className="px-4 py-2 text-right font-medium">Retailers</th><th className="px-4 py-2 text-right font-medium">Secondary this month</th></tr></thead>
        <tbody className="divide-y divide-border">
          {q.data!.map((d) => (
            <tr key={d.id}>
              <td className="px-4 py-2"><Link className="font-medium hover:underline" href={`${DMS}/distributors/${d.id}`}>{d.name}</Link><span className="block text-xs text-muted">{d.code}{d.gstin && ` · ${d.gstin}`}{d.territory && ` · ${d.territory}`}</span>{!d.isActive && <Badge>inactive</Badge>}</td>
              <td className="px-4 py-2">{d.salesperson ?? "–"}</td>
              <td className="px-4 py-2 text-right tabular-nums">{d.retailers}</td>
              <td className="px-4 py-2 text-right tabular-nums">{inr(d.secondaryMtd)}</td>
            </tr>
          ))}
          {!q.data!.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted">No distributors yet. Any customer can be made a distributor.</td></tr>}
        </tbody>
      </table></div>
      {manage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Customer">{(p) => <Select {...p} className="w-64" value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })}><option value="">Choose…</option>{customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Salesperson">{(p) => <Select {...p} value={f.salespersonId} onChange={(e) => setF({ ...f, salespersonId: e.target.value })}><option value="">—</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}</Select>}</Field>
          <Button size="sm" disabled={!f.partyId} onClick={async () => (await act(`${DMS}/distributors`, { partyId: f.partyId, salespersonId: f.salespersonId || null })) && setF({ partyId: "", salespersonId: "" })}><Plus className="size-4" aria-hidden /> Add distributor</Button>
        </div>
      )}
    </Card>
  );
}

function Beats({ manage, members }: { manage: boolean; members: Member[] }) {
  const q = useQuery({ queryKey: [DMS, "beats"], queryFn: () => api<Beat[]>(`${DMS}/beats`) });
  const dists = useQuery({ queryKey: [DMS, "distributors"], queryFn: () => api<Distributor[]>(`${DMS}/distributors`) });
  const { error, act } = useAct([DMS]);
  const [f, setF] = useState({ code: "", name: "", distributorId: "", salespersonId: "", weekday: "" });
  return (
    <Card>
      <ul className="divide-y divide-border text-sm">
        {q.data?.map((b) => <li key={b.id} className="flex flex-wrap gap-3 px-5 py-2"><span className="w-20 font-mono text-xs text-muted">{b.code}</span><span className="font-medium">{b.name}</span><span className="text-xs text-muted">{[b.distributor, b.salesperson, b.weekday !== null ? WEEKDAYS[b.weekday] : "any day"].filter(Boolean).join(" · ")}</span><span className="ml-auto text-xs">{b.retailers} outlets</span></li>)}
        {q.data && !q.data.length && <li className="px-5 py-4 text-muted">No beats yet.</li>}
      </ul>
      {manage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Code">{(p) => <Input {...p} className="w-24" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
          <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Distributor">{(p) => <Select {...p} value={f.distributorId} onChange={(e) => setF({ ...f, distributorId: e.target.value })}><option value="">—</option>{dists.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
          <Field label="Salesperson">{(p) => <Select {...p} value={f.salespersonId} onChange={(e) => setF({ ...f, salespersonId: e.target.value })}><option value="">—</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}</Select>}</Field>
          <Field label="Day">{(p) => <Select {...p} value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}><option value="">Any</option>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>}</Field>
          <Button size="sm" disabled={!f.code || f.name.trim().length < 2} onClick={async () => (await act(`${DMS}/beats`, { code: f.code, name: f.name, distributorId: f.distributorId || null, salespersonId: f.salespersonId || null, weekday: f.weekday === "" ? null : Number(f.weekday) })) && setF({ code: "", name: "", distributorId: "", salespersonId: "", weekday: "" })}><Plus className="size-4" aria-hidden /> Add beat</Button>
        </div>
      )}
    </Card>
  );
}

function Retailers({ manage }: { manage: boolean }) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: [DMS, "retailers", search], queryFn: () => api<Retailer[]>(`${DMS}/retailers`, { query: { q: search || undefined } }) });
  return (
    <>
      <div className="flex gap-3"><Input className="h-9 w-64" placeholder="Name, code or phone" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />{manage && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Retailer</Button>}</div>
      <Card>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Retailer</th><th className="px-4 py-2 font-medium">Distributor · beat</th><th className="px-4 py-2 font-medium">Class</th><th className="px-4 py-2 text-right font-medium">Points</th><th className="px-4 py-2 font-medium">Last visit</th></tr></thead>
          <tbody className="divide-y divide-border">
            {q.data?.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2"><span className="font-medium">{r.name}</span><span className="block text-xs text-muted">{r.code}{r.city && ` · ${r.city}`}{r.phone && ` · ${r.phone}`}{!r.latitude && " · no location yet"}</span></td>
                <td className="px-4 py-2">{r.distributor}<span className="block text-xs text-muted">{r.beat ?? "no beat"}</span></td>
                <td className="px-4 py-2"><Badge>{r.outletClass}</Badge></td>
                <td className="px-4 py-2 text-right tabular-nums">{r.points}</td>
                <td className="px-4 py-2 text-xs">{r.lastVisit ? formatDate(r.lastVisit.slice(0, 10)) : "never"}</td>
              </tr>
            ))}
            {q.data && !q.data.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No retailers.</td></tr>}
          </tbody>
        </table></div>
      </Card>
      {adding && <RetailerDialog onClose={() => setAdding(false)} />}
    </>
  );
}

function RetailerDialog({ onClose }: { onClose: () => void }) {
  const dists = useQuery({ queryKey: [DMS, "distributors"], queryFn: () => api<Distributor[]>(`${DMS}/distributors`) });
  const beats = useQuery({ queryKey: [DMS, "beats"], queryFn: () => api<Beat[]>(`${DMS}/beats`) });
  const { error, act } = useAct([DMS]);
  const [f, setF] = useState({ code: "", name: "", ownerName: "", phone: "", distributorId: "", beatId: "", city: "", outletClass: "C" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (await act(`${DMS}/retailers`, { ...f, ownerName: f.ownerName || null, phone: f.phone || null, beatId: f.beatId || null, city: f.city || null })) onClose();
  }
  return (
    <Dialog open onClose={onClose} title="New retailer" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.code || !f.name || !f.distributorId}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={set("code")} />}</Field>
        <Field label="Shop name">{(p) => <Input {...p} value={f.name} onChange={set("name")} />}</Field>
        <Field label="Owner">{(p) => <Input {...p} value={f.ownerName} onChange={set("ownerName")} />}</Field>
        <Field label="Phone">{(p) => <Input {...p} value={f.phone} onChange={set("phone")} />}</Field>
        <Field label="Distributor">{(p) => <Select {...p} value={f.distributorId} onChange={set("distributorId")}><option value="">Choose…</option>{dists.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <Field label="Beat">{(p) => <Select {...p} value={f.beatId} onChange={set("beatId")}><option value="">—</option>{beats.data?.filter((b) => !b.distributorId || b.distributorId === f.distributorId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
        <Field label="City">{(p) => <Input {...p} value={f.city} onChange={set("city")} />}</Field>
        <Field label="Outlet class">{(p) => <Select {...p} value={f.outletClass} onChange={set("outletClass")}><option value="A">A</option><option value="B">B</option><option value="C">C</option></Select>}</Field>
      </div>
      <p className="mt-2 text-xs text-muted">The outlet&apos;s location is taken from the first field visit.</p>
    </Dialog>
  );
}
