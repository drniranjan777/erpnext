"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { inr } from "@/lib/payroll";

interface Est { id: string; number: string; kind: string; title: string; qty: string; unitCost: string; unitPrice: string; marginPct: string; status: string; quotationId: string | null; createdAt: string; party: string | null }
interface Result { lines: { label: string; basis: string; amount: number }[]; unitCost: number; unitPrice: number; total: number; facts: Record<string, string | number> }
interface Template { id: string; name: string; terms: string; validityDays: number; isDefault: boolean }
type Kind = "box" | "fabrication" | "furniture";
const KIND: Record<string, string> = { box: "Corrugated box", fabrication: "Fabrication", furniture: "Furniture", configured: "Configured product" };
type Tab = "estimates" | "templates";

export default function EstimatesPage() {
  const { can } = useAuth();
  const manage = can("cpq.estimates.manage");
  const [tab, setTab] = useState<Tab>("estimates");
  const [creating, setCreating] = useState<Kind | null>(null);
  const [quoting, setQuoting] = useState<Est | null>(null);
  const q = useQuery({ queryKey: ["/cpq", "estimates"], queryFn: () => api<Est[]>("/cpq/estimates") });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Estimates"
        description="Cost made-to-order products from their specification, then quote the price in one step."
        actions={manage && <span className="flex gap-2">{(["box", "fabrication", "furniture"] as Kind[]).map((k) => <Button key={k} variant={k === "box" ? "primary" : "secondary"} onClick={() => setCreating(k)}><Calculator className="size-4" aria-hidden /> {KIND[k]}</Button>)}</span>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "estimates", label: "Estimates" }, { value: "templates", label: "Quote templates" }]} />
      {tab === "estimates" && (
        <Card>
          {q.isLoading && <LoadingBlock />}
          {q.error && <ErrorBlock error={q.error} />}
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Estimate</th><th className="px-4 py-2 font-medium">Customer</th><th className="px-4 py-2 text-right font-medium">Qty</th><th className="px-4 py-2 text-right font-medium">Cost</th><th className="px-4 py-2 text-right font-medium">Price</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data?.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2"><span className="font-medium">{e.title}</span><span className="block text-xs text-muted">{e.number} · {KIND[e.kind]} · {formatDate(e.createdAt.slice(0, 10))}</span></td>
                  <td className="px-4 py-2">{e.party ?? "–"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(e.qty)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(e.unitCost) ? inr(e.unitCost) : "–"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{inr(e.unitPrice)}<span className="block text-xs text-muted">{Number(e.marginPct) ? `${Number(e.marginPct)} % margin` : ""}</span></td>
                  <td className="px-4 py-2">{e.quotationId ? <Link href={`/sales/quotations/${e.quotationId}`}><Badge tone="success">quoted</Badge></Link> : manage ? <Button size="sm" variant="secondary" onClick={() => setQuoting(e)}><FileText className="size-3.5" aria-hidden /> Quote</Button> : <Badge>draft</Badge>}</td>
                </tr>
              ))}
              {q.data && !q.data.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No estimates yet.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
      {tab === "templates" && <Templates manage={manage} />}
      {creating && <EstimateDialog kind={creating} onClose={() => setCreating(null)} />}
      {quoting && <QuoteDialog e={quoting} onClose={() => setQuoting(null)} />}
    </div>
  );
}

const useCustomers = () => useQuery({ queryKey: ["/masters/parties", "customers"], queryFn: () => api<{ items: { id: string; code: string; name: string }[] }>(`/masters/parties`, { query: { role: "customer", limit: 200 } }) });

/** Text fields that turn into numbers (lists are comma separated). */
type FormValues = Record<string, string>;
const DEFAULTS: Record<Kind, FormValues> = {
  box: { length: "300", width: "200", height: "150", ply: "3", linerGsm: "150, 120", fluteGsm: "120", flutes: "B", paperRate: "40", conversionRate: "10", printColours: "1", printRatePerColour: "0.5", wastagePct: "5", marginPct: "20", qty: "1000" },
  fabrication: { material: "ms", plateLength: "1000", plateWidth: "500", thickness: "5", plates: "1", sectionKg: "4", rate: "70", scrapPct: "10", weldMinutes: "30", cutMinutes: "15", shopRate: "600", finishPerKg: "15", overheadPct: "10", marginPct: "25", qty: "1" },
  furniture: { width: "900", height: "1800", depth: "450", shelves: "3", doors: "2", boardRate: "1200", backRate: "400", finishRate: "600", edgeRate: "30", hardware: "1500", labourHours: "6", labourRate: "250", wastagePct: "10", marginPct: "30", qty: "1" },
};
const LABELS: Record<string, string> = {
  length: "Length (mm)", width: "Width (mm)", height: "Height (mm)", ply: "Ply", linerGsm: "Liner GSM (outer first)", fluteGsm: "Flute GSM", flutes: "Flute types (A, B, C, E, F)", paperRate: "Paper ₹/kg", conversionRate: "Conversion ₹/kg", printColours: "Print colours", printRatePerColour: "₹ per colour per box",
  material: "Material", plateLength: "Plate length (mm)", plateWidth: "Plate width (mm)", thickness: "Thickness (mm)", plates: "Plates per unit", sectionKg: "Sections (kg per unit)", rate: "Material ₹/kg", scrapPct: "Scrap %", weldMinutes: "Welding (min)", cutMinutes: "Cutting & bending (min)", shopRate: "Shop rate ₹/hour", finishPerKg: "Painting ₹/kg", overheadPct: "Overheads %",
  depth: "Depth (mm)", shelves: "Shelves", doors: "Doors", boardRate: "Board ₹/m²", backRate: "Back panel ₹/m²", finishRate: "Laminate / finish ₹/m²", edgeRate: "Edge band ₹/m", hardware: "Hardware ₹", labourHours: "Labour hours", labourRate: "Labour ₹/hour",
  wastagePct: "Wastage %", marginPct: "Margin % (on price)", qty: "Quantity",
};
const nums = (s: string) => s.split(/[,\s]+/).filter(Boolean).map(Number);

function toInputs(kind: Kind, f: FormValues) {
  const n = (k: string) => Number(f[k]) || 0;
  if (kind === "box") return { length: n("length"), width: n("width"), height: n("height"), ply: n("ply"), linerGsm: nums(f.linerGsm), fluteGsm: nums(f.fluteGsm), flutes: f.flutes.split(/[,\s]+/).filter(Boolean).map((x) => x.toUpperCase()), paperRate: n("paperRate"), conversionRate: n("conversionRate"), printColours: n("printColours"), printRatePerColour: n("printRatePerColour"), wastagePct: n("wastagePct"), marginPct: n("marginPct"), qty: n("qty") };
  if (kind === "furniture") return Object.fromEntries(Object.keys(DEFAULTS.furniture).map((k) => [k, n(k)]));
  const parts = [{ name: "Plate", material: f.material, length: n("plateLength"), width: n("plateWidth"), thickness: n("thickness"), count: Math.max(1, n("plates")) }];
  if (n("sectionKg")) parts.push({ name: "Sections", material: f.material, weightKg: n("sectionKg"), count: 1 } as never);
  return {
    parts,
    rates: { [f.material]: n("rate") },
    scrapPct: n("scrapPct"),
    processes: [{ name: "Cutting and bending", minutes: n("cutMinutes"), ratePerHour: n("shopRate") }, { name: "Welding", minutes: n("weldMinutes"), ratePerHour: n("shopRate") }].filter((p) => p.minutes > 0),
    finishPerKg: n("finishPerKg"),
    overheadPct: n("overheadPct"),
    marginPct: n("marginPct"),
    qty: n("qty"),
  };
}

function EstimateDialog({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const qc = useQueryClient();
  const customers = useCustomers();
  const [f, setF] = useState<FormValues>(DEFAULTS[kind]);
  const [title, setTitle] = useState("");
  const [partyId, setPartyId] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function calc() {
    setError(null);
    try {
      setResult(await api<Result>(`/cpq/calculate/${kind}`, { body: toInputs(kind, f) }));
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  async function save() {
    setError(null);
    try {
      await api("/cpq/estimates", { body: { kind, title, partyId: partyId || null, inputs: toInputs(kind, f) } });
      await qc.invalidateQueries({ queryKey: ["/cpq"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`${KIND[kind]} estimate`} footer={<><Button variant="secondary" onClick={calc}>Calculate</Button><Button onClick={save} disabled={title.trim().length < 2 || !result}>Save estimate</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Customer">{(p) => <Select {...p} value={partyId} onChange={(e) => setPartyId(e.target.value)}><option value="">—</option>{customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {Object.keys(f).map((k) =>
          k === "material" ? (
            <Field key={k} label={LABELS[k]}>{(p) => <Select {...p} value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value }); setResult(null); }}><option value="ms">Mild steel</option><option value="ss">Stainless steel</option><option value="al">Aluminium</option><option value="gi">GI</option></Select>}</Field>
          ) : (
            <Field key={k} label={LABELS[k] ?? k}>{(p) => <Input {...p} value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value }); setResult(null); }} />}</Field>
          ),
        )}
      </div>
      {result && (
        <Card className="mt-4">
          <CardHeader title={`${inr(result.unitPrice)} a unit · ${inr(result.total)} in all`} description={Object.entries(result.facts).map(([k, v]) => `${k} ${v}`).join(" · ")} />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {result.lines.map((l) => <li key={l.label} className="flex justify-between px-4 py-1.5"><span>{l.label} <span className="text-xs text-muted">{l.basis}</span></span><span className="tabular-nums">{inr(l.amount)}</span></li>)}
            <li className="flex justify-between px-4 py-1.5 font-medium"><span>Unit cost</span><span className="tabular-nums">{inr(result.unitCost)}</span></li>
          </ul>
        </Card>
      )}
    </Dialog>
  );
}

function QuoteDialog({ e, onClose }: { e: Est; onClose: () => void }) {
  const qc = useQueryClient();
  const customers = useCustomers();
  const items = useQuery({ queryKey: ["/masters/items", "all"], queryFn: () => api<{ items: { id: string; code: string; name: string }[] }>(`/masters/items`, { query: { limit: 200 } }) });
  const templates = useQuery({ queryKey: ["/cpq", "templates"], queryFn: () => api<Template[]>("/cpq/templates") });
  const [f, setF] = useState({ itemId: "", partyId: "", templateId: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`/cpq/estimates/${e.id}/quote`, { body: { itemId: f.itemId || undefined, partyId: f.partyId || undefined, templateId: f.templateId || undefined } });
      await qc.invalidateQueries({ queryKey: ["/cpq"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Quote ${e.number}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Create draft quotation</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        {!e.party && <Field label="Customer">{(p) => <Select {...p} value={f.partyId} onChange={(ev) => setF({ ...f, partyId: ev.target.value })}><option value="">Choose…</option>{customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>}
        <Field label="Quote under item" hint="Often a generic made-to-order item; the line description carries the specification">{(p) => <Select {...p} value={f.itemId} onChange={(ev) => setF({ ...f, itemId: ev.target.value })}><option value="">Choose…</option>{items.data?.items.map((it) => <option key={it.id} value={it.id}>{it.code} {it.name}</option>)}</Select>}</Field>
        <Field label="Template">{(p) => <Select {...p} value={f.templateId} onChange={(ev) => setF({ ...f, templateId: ev.target.value })}><option value="">Default</option>{templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
      </div>
    </Dialog>
  );
}

function Templates({ manage }: { manage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["/cpq", "templates"], queryFn: () => api<Template[]>("/cpq/templates") });
  const [f, setF] = useState({ name: "", terms: "", validityDays: "30", isDefault: false });
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setError(null);
    try {
      await api("/cpq/templates", { body: { ...f, validityDays: Number(f.validityDays) || 30 } });
      setF({ name: "", terms: "", validityDays: "30", isDefault: false });
      qc.invalidateQueries({ queryKey: ["/cpq", "templates"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <ul className="divide-y divide-border text-sm">
        {q.data?.map((t) => <li key={t.id} className="px-5 py-2"><p className="flex items-center gap-2 font-medium">{t.name} <span className="text-xs font-normal text-muted">valid {t.validityDays} days</span>{t.isDefault && <Badge tone="primary">default</Badge>}</p><p className="whitespace-pre-wrap text-xs text-muted">{t.terms}</p></li>)}
        {q.data && !q.data.length && <li className="px-5 py-4 text-muted">No templates yet.</li>}
      </ul>
      {manage && (
        <div className="grid gap-2 border-t border-border p-4 sm:grid-cols-4">
          {error && <div className="sm:col-span-4"><Alert>{error}</Alert></div>}
          <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Valid for (days)">{(p) => <Input {...p} type="number" value={f.validityDays} onChange={(e) => setF({ ...f, validityDays: e.target.value })} />}</Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /> Default</label>
          <div className="flex items-end"><Button size="sm" disabled={f.name.trim().length < 2 || f.terms.trim().length < 5} onClick={add}><Plus className="size-4" aria-hidden /> Add</Button></div>
          <Field label="Terms" className="sm:col-span-4">{(p) => <Input {...p} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} />}</Field>
        </div>
      )}
    </Card>
  );
}
