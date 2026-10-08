"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { DMS, SCHEME_KIND, slabText, type Applied, type Retailer, type SchemeRow } from "@/lib/dms";
import { inr } from "@/lib/payroll";
import { askConfirm } from "@/components/ui/ask";

interface Sale { id: string; number: string; date: string; retailer: string; distributor: string; gross: string; discount: string; net: string; source: string; status: string; schemes: Applied[]; bookedBy: string | null }
type Tab = "sales" | "schemes";
const useItems = () => useQuery({ queryKey: ["/masters/items", "all"], queryFn: () => api<{ items: { id: string; code: string; name: string }[] }>(`/masters/items`, { query: { limit: 200 } }) });

export default function SecondarySalesPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("sales");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Secondary sales and schemes" description="Distributor-to-retailer sales, priced with the trade schemes running on the day." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "sales", label: "Secondary sales" }, { value: "schemes", label: "Schemes" }]} />
      {tab === "sales" ? <Sales manage={can("dms.network.manage")} /> : <Schemes manage={can("dms.schemes.manage")} />}
    </div>
  );
}

function Sales({ manage }: { manage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [DMS, "sales", "all"], queryFn: () => api<Sale[]>(`${DMS}/secondary-sales`) });
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  async function importFile(f: File) {
    setMsg(null);
    try {
      const r = await apiUpload<{ sales: number; errors: { row: number; error: string }[] }>(`${DMS}/secondary-sales/import`, f);
      setMsg({ tone: r.errors.length ? "danger" : "success", text: `${r.sales} sale(s) recorded${r.errors.length ? `; ${r.errors.map((e) => `row ${e.row}: ${e.error}`).join("; ")}` : ""}.` });
      qc.invalidateQueries({ queryKey: [DMS] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Import failed" });
    } finally {
      if (file.current) file.current.value = "";
    }
  }
  async function cancel(id: string) {
    setMsg(null);
    try {
      await api(`${DMS}/secondary-sales/${id}/cancel`, { body: {} });
      qc.invalidateQueries({ queryKey: [DMS] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <>
      {manage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Record sale</Button>
          <input ref={file} type="file" accept=".csv,.xlsx" className="hidden" aria-label="Sales file" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          <Button variant="secondary" onClick={() => file.current?.click()}><Upload className="size-4" aria-hidden /> Import distributor file</Button>
          <span className="text-xs text-muted">Columns: retailer_code, item_code, qty, rate (optional), date, invoice_no.</span>
        </div>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <span className="w-24">{formatDate(s.date)}</span>
                <span className="font-mono text-xs text-muted">{s.number}</span>
                <span className="font-medium">{s.retailer}</span>
                <span className="text-xs text-muted">{s.distributor}{s.bookedBy && ` · ${s.bookedBy}`}</span>
                <Badge>{s.source}</Badge>
                {s.schemes.map((a) => <Badge key={`${a.code}${a.itemId}`} tone="success">{a.code}{a.freeQty ? ` +${a.freeQty} free` : ` −${inr(a.discount)}`}</Badge>)}
                {s.status === "cancelled" && <Badge tone="danger">cancelled</Badge>}
                <span className="ml-auto tabular-nums">{inr(s.net)}</span>
                {manage && s.status === "recorded" && <Button size="sm" variant="ghost" aria-label="Cancel sale" onClick={async () => await askConfirm("Cancel this sale?") && cancel(s.id)}><Trash2 className="size-3.5" aria-hidden /></Button>}
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-6 text-center text-muted">No secondary sales yet.</li>}
          </ul>
        </Card>
      )}
      {adding && <SaleDialog onClose={() => setAdding(false)} />}
    </>
  );
}

function SaleDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const retailers = useQuery({ queryKey: [DMS, "retailers", ""], queryFn: () => api<Retailer[]>(`${DMS}/retailers`) });
  const items = useItems();
  const [retailerId, setRetailerId] = useState("");
  const [date, setDate] = useState(todayIST());
  const [lines, setLines] = useState([{ itemId: "", qty: "" }]);
  const [priced, setPriced] = useState<{ gross: number; discount: number; net: number; applied: Applied[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = () => ({ date, lines: lines.filter((l) => l.itemId && Number(l.qty)).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) });
  async function preview() {
    setError(null);
    try {
      setPriced(await api(`${DMS}/price`, { body: body() }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  async function save() {
    setError(null);
    try {
      await api(`${DMS}/secondary-sales`, { body: { retailerId, ...body() } });
      await qc.invalidateQueries({ queryKey: [DMS] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Record a secondary sale" footer={<><Button variant="secondary" onClick={preview}>Apply schemes</Button><Button onClick={save} disabled={!retailerId || !body().lines.length}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Retailer">{(p) => <Select {...p} value={retailerId} onChange={(e) => setRetailerId(e.target.value)}><option value="">Choose…</option>{retailers.data?.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.distributor})</option>)}</Select>}</Field>
        <Field label="Date">{(p) => <Input {...p} type="date" max={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <div className="space-y-2 sm:col-span-2">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Select aria-label="Item" className="flex-1" value={l.itemId} onChange={(e) => { setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x))); setPriced(null); }}><option value="">Item…</option>{items.data?.items.map((it) => <option key={it.id} value={it.id}>{it.code} {it.name}</option>)}</Select>
              <Input aria-label="Quantity" className="w-24" inputMode="decimal" value={l.qty} onChange={(e) => { setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x))); setPriced(null); }} />
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { itemId: "", qty: "" }])}><Plus className="size-4" aria-hidden /> Line</Button>
        </div>
      </div>
      {priced && (
        <div className="mt-3 rounded border border-border p-3 text-sm">
          {priced.applied.map((a) => <p key={`${a.code}${a.itemId}`} className="flex justify-between"><span>{a.code}: {a.basis}</span><span className="tabular-nums">{a.freeQty ? `${a.freeQty} free` : `− ${inr(a.discount)}`}</span></p>)}
          <p className="mt-1 flex justify-between font-medium"><span>Gross {inr(priced.gross)}</span><span>Net {inr(priced.net)}</span></p>
        </div>
      )}
    </Dialog>
  );
}

function Schemes({ manage }: { manage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [DMS, "schemes"], queryFn: () => api<SchemeRow[]>(`${DMS}/schemes`) });
  const items = useItems();
  const name = (id: string) => items.data?.items.find((i) => i.id === id)?.code ?? "?";
  const [f, setF] = useState({ code: "", name: "", kind: "qty_slab", level: "secondary", itemId: "", fromDate: todayIST(), toDate: todayIST(), slabs: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    // One slab per line: minimum, then the benefit (% / ₹ a unit / free qty).
    const slabs = f.slabs.split("\n").map((l) => l.split(/[,\s]+/).filter(Boolean).map(Number)).filter((p) => p.length >= 2).map(([min, v, w]) => (f.kind === "free_goods" ? { min, freeQty: v } : f.kind === "value_slab" ? { min, discountPct: v } : w === 1 ? { min, perUnit: v } : { min, discountPct: v }));
    try {
      await api(`${DMS}/schemes`, { body: { code: f.code, name: f.name, kind: f.kind, level: f.level, itemIds: f.itemId ? [f.itemId] : [], slabs, fromDate: f.fromDate, toDate: f.toDate } });
      setF({ ...f, code: "", name: "", slabs: "" });
      qc.invalidateQueries({ queryKey: [DMS, "schemes"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <ul className="divide-y divide-border text-sm">
        {q.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 px-5 py-2">
            <span className="w-24 font-mono text-xs text-muted">{s.code}</span>
            <span className="font-medium">{s.name}</span>
            <Badge>{SCHEME_KIND[s.kind]}</Badge>
            <Badge tone={s.level === "primary" ? "primary" : "neutral"}>{s.level}</Badge>
            <span className="text-xs text-muted">{s.slabs.map((x) => slabText(s.kind, x)).join("; ")} · {s.itemIds.length ? s.itemIds.map(name).join(", ") : "all items"} · {formatDate(s.fromDate)} – {formatDate(s.toDate)}</span>
          </li>
        ))}
        {q.data && !q.data.length && <li className="px-5 py-4 text-muted">No schemes yet.</li>}
      </ul>
      {manage && (
        <div className="grid gap-2 border-t border-border p-4 sm:grid-cols-4">
          {error && <div className="sm:col-span-4"><Alert>{error}</Alert></div>}
          <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
          <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(SCHEME_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Level">{(p) => <Select {...p} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="secondary">Secondary (to retailers)</option><option value="primary">Primary (to distributors)</option></Select>}</Field>
          <Field label="Item">{(p) => <Select {...p} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">All items</option>{items.data?.items.map((i) => <option key={i.id} value={i.id}>{i.code} {i.name}</option>)}</Select>}</Field>
          <Field label="From">{(p) => <Input {...p} type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} />}</Field>
          <Field label="To">{(p) => <Input {...p} type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} />}</Field>
          <div />
          <Field label="Slabs" className="sm:col-span-3" hint={f.kind === "free_goods" ? "One per line: buy qty, free qty (e.g. 12, 1)" : f.kind === "value_slab" ? "One per line: order value ₹, discount % (e.g. 10000, 2)" : "One per line: min qty, discount % — or min qty, ₹ a unit, 1 (e.g. 10, 5, 1)"}>{(p) => <textarea {...p} rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" value={f.slabs} onChange={(e) => setF({ ...f, slabs: e.target.value })} />}</Field>
          <div className="flex items-end"><Button size="sm" disabled={!f.code || f.name.trim().length < 2 || !f.slabs.trim()} onClick={save}><Plus className="size-4" aria-hidden /> Add scheme</Button></div>
        </div>
      )}
    </Card>
  );
}
