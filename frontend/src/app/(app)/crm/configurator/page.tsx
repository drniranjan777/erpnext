"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { inr } from "@/lib/payroll";

interface Group { id: string; code: string; name: string; required: boolean; multi: boolean; sequence: number; options: { code: string; label: string; priceDelta: number; excludes?: string[]; requires?: string[] }[] }
interface Options { item: { id: string; code: string; name: string; sellingRate: string | null }; groups: Group[] }

/** Configure an item from its option groups (price deltas, excludes / requires rules) and quote it. */
export default function ConfiguratorPage() {
  const { can } = useAuth();
  const manage = can("cpq.estimates.manage");
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["/masters/items", "all"], queryFn: () => api<{ items: { id: string; code: string; name: string }[] }>(`/masters/items`, { query: { limit: 200 } }) });
  const customers = useQuery({ queryKey: ["/masters/parties", "customers"], queryFn: () => api<{ items: { id: string; name: string }[] }>(`/masters/parties`, { query: { role: "customer", limit: 200 } }) });
  const [itemId, setItemId] = useState("");
  const opts = useQuery({ queryKey: ["/cpq", "options", itemId], queryFn: () => api<Options>(`/cpq/items/${itemId}/options`), enabled: !!itemId });
  const [chosen, setChosen] = useState<string[]>([]);
  const [qty, setQty] = useState("1");
  const [partyId, setPartyId] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: React.ReactNode } | null>(null);
  const price = useQuery({ queryKey: ["/cpq", "configure", itemId, chosen, qty], queryFn: () => api<{ ok: boolean; errors: string[]; unitPrice: number; total: number; description: string }>("/cpq/configure", { body: { itemId, chosen, qty: Number(qty) || 1 } }), enabled: !!itemId && !!opts.data?.groups.length });
  const toggle = (g: Group, code: string) => {
    const full = `${g.code}.${code}`;
    setChosen((c) => (c.includes(full) ? c.filter((x) => x !== full) : g.multi ? [...c, full] : [...c.filter((x) => !x.startsWith(`${g.code}.`)), full]));
  };
  async function quote() {
    setMsg(null);
    try {
      const r = await api<{ quotationId: string }>("/cpq/configure/quote", { body: { itemId, chosen, qty: Number(qty) || 1, partyId } });
      setMsg({ tone: "success", text: <>Draft quotation created. <Link className="underline" href={`/sales/quotations/${r.quotationId}`}>Open it</Link></> });
      qc.invalidateQueries({ queryKey: ["/cpq"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Configurator" description="Build a product from its options; the rules stop combinations that cannot be made, and the price follows the choices." />
      <Select className="h-10 w-80" aria-label="Item" value={itemId} onChange={(e) => { setItemId(e.target.value); setChosen([]); setMsg(null); }}><option value="">Choose a product…</option>{items.data?.items.map((i) => <option key={i.id} value={i.id}>{i.code} {i.name}</option>)}</Select>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {opts.data && (
        <>
          {opts.data.groups.map((g) => (
            <Card key={g.id}>
              <CardHeader title={`${g.name}${g.required ? " *" : ""}`} description={g.multi ? "Choose any" : "Choose one"} action={manage && <Button size="sm" variant="ghost" aria-label={`Remove ${g.name}`} onClick={async () => { await api(`/cpq/option-groups/${g.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["/cpq", "options"] }); }}><Trash2 className="size-3.5" aria-hidden /></Button>} />
              <div className="flex flex-wrap gap-2 border-t border-border p-4">
                {g.options.map((o) => {
                  const on = chosen.includes(`${g.code}.${o.code}`);
                  return <Button key={o.code} size="sm" variant={on ? "primary" : "secondary"} onClick={() => toggle(g, o.code)}>{o.label}{o.priceDelta ? ` (${o.priceDelta > 0 ? "+" : ""}${inr(o.priceDelta)})` : ""}</Button>;
                })}
              </div>
            </Card>
          ))}
          {!opts.data.groups.length && <p className="text-sm text-muted">This product has no options yet.</p>}
          {price.data && (
            <Card className="space-y-3 px-5 py-4">
              {price.data.errors.length > 0 && <Alert tone="warning">{price.data.errors.join(" · ")}</Alert>}
              <p className="text-lg font-semibold">{inr(price.data.unitPrice)} a unit · {inr(price.data.total)} for {qty}</p>
              <p className="text-sm text-muted">Base {inr(opts.data.item.sellingRate)} · {price.data.description || "no options chosen"}</p>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Quantity">{(p) => <Input {...p} className="w-24" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />}</Field>
                <Field label="Customer">{(p) => <Select {...p} className="w-64" value={partyId} onChange={(e) => setPartyId(e.target.value)}><option value="">Choose…</option>{customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
                {can("sales.quotations.manage") && <Button disabled={!price.data.ok || !partyId} onClick={quote}><FileText className="size-4" aria-hidden /> Quote</Button>}
              </div>
            </Card>
          )}
          {manage && <GroupEditor itemId={itemId} />}
        </>
      )}
    </div>
  );
}

function GroupEditor({ itemId }: { itemId: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: "", name: "", required: false, multi: false, sequence: "1", options: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    // One option per line: CODE | Label | price delta | excludes (comma) | requires (comma)
    const options = f.options
      .split("\n")
      .map((l) => l.split("|").map((x) => x.trim()))
      .filter((p) => p[0])
      .map(([code, label, delta, excludes, requires]) => ({ code, label: label || code, priceDelta: Number(delta) || 0, excludes: excludes ? excludes.split(",").map((x) => x.trim()).filter(Boolean) : undefined, requires: requires ? requires.split(",").map((x) => x.trim()).filter(Boolean) : undefined }));
    try {
      await api(`/cpq/items/${itemId}/options`, { body: { ...f, sequence: Number(f.sequence) || 1, options } });
      setF({ code: "", name: "", required: false, multi: false, sequence: "1", options: "" });
      qc.invalidateQueries({ queryKey: ["/cpq", "options"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <CardHeader title="Add or replace an option group" description="One option per line: CODE | Label | price delta | excludes (GROUP.CODE, …) | requires (GROUP.CODE, …)" />
      <div className="grid gap-2 border-t border-border p-4 sm:grid-cols-4">
        {error && <div className="sm:col-span-4"><Alert>{error}</Alert></div>}
        <Field label="Group code">{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Order">{(p) => <Input {...p} type="number" value={f.sequence} onChange={(e) => setF({ ...f, sequence: e.target.value })} />}</Field>
        <div className="flex items-end gap-3 pb-2 text-sm"><label className="flex items-center gap-1"><input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} /> Required</label><label className="flex items-center gap-1"><input type="checkbox" checked={f.multi} onChange={(e) => setF({ ...f, multi: e.target.checked })} /> Several</label></div>
        <Field label="Options" className="sm:col-span-4">{(p) => <textarea {...p} rows={4} className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} />}</Field>
        <div><Button size="sm" disabled={!f.code || f.name.trim().length < 2 || !f.options.trim()} onClick={save}><Plus className="size-4" aria-hidden /> Save group</Button></div>
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted"><Badge>Example</Badge> 2HP | 2 HP motor | 4500 | | PNL.STAR</p>
    </Card>
  );
}
