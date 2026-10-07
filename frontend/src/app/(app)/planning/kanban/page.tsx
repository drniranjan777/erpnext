"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Plus, Printer, ScanLine } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatQty } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";
import { PLAN, refHref } from "@/lib/planning";

interface CardRow { id: string; cardNo: number; status: "full" | "empty"; signalledAt: string | null; doc: { id: string; number: string | null; docType: string; status: string } | null }
interface Loop { id: string; kind: "production" | "purchase" | "transfer"; item: { id: string; code: string; name: string; uom: string }; warehouse: { id: string; code: string }; sourceWarehouse: { id: string; code: string } | null; containerQty: string; leadTimeDays: number; notes: string | null; isActive: boolean; cards: CardRow[]; full: number }
const KIND = { production: "Make", purchase: "Buy", transfer: "Move" } as const;
const DOC_PATH: Record<string, string> = { stock_entry: "/inventory/stock-entries" };
const docHref = (d: CardRow["doc"]) => (d ? (refHref({ docType: d.docType, id: d.id }) ?? (DOC_PATH[d.docType] ? `${DOC_PATH[d.docType]}/${d.id}` : null)) : null);

export default function KanbanPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can("planning.mrp.manage");
  const q = useQuery({ queryKey: [PLAN, "kanban"], queryFn: () => api<Loop[]>(`${PLAN}/kanban`) });
  const [editing, setEditing] = useState<Loop | "new" | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; node: React.ReactNode } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<{ card: { cardNo: number; status: string }; doc?: { id: string; displayNumber: string; docType: string } }>) {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fn();
      const href = r.doc ? docHref({ id: r.doc.id, number: r.doc.displayNumber, docType: r.doc.docType, status: "draft" }) : null;
      setMsg({ tone: "success", node: r.doc ? <>Card {r.card.cardNo} signalled: {href ? <Link className="underline" href={href}>{r.doc.displayNumber}</Link> : r.doc.displayNumber} drafted.</> : <>Card {r.card.cardNo} is back in the rack.</> });
      await qc.invalidateQueries({ queryKey: [PLAN, "kanban"] });
    } catch (e) {
      setMsg({ tone: "danger", node: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Kanban"
        description="Fixed containers that pull replenishment. When a container is emptied, signal its card: a draft work order, requisition or transfer is raised. When the full container comes back, receive the card."
        actions={manage && <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> New loop</Button>}
      />
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Scan a card">
          {(p) => (
            <Input
              {...p}
              className="w-72 font-mono"
              placeholder="KB:…"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.trim()) {
                  const c = code.trim();
                  setCode("");
                  act("scan", () => api(`${PLAN}/kanban/scan`, { body: { code: c } }));
                }
              }}
            />
          )}
        </Field>
        <p className="flex items-center gap-1 pb-2 text-xs text-muted"><ScanLine className="size-4" aria-hidden /> A full card is signalled; an empty one is received.</p>
      </Card>
      {msg && <Alert tone={msg.tone}>{msg.node}</Alert>}
      {editing && <LoopForm loop={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: [PLAN, "kanban"] }); }} />}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && !q.data.length && <EmptyState title="No kanban loops" description="Set up a loop for each item you replenish by container: line-side parts, packaging, fast-moving consumables." />}
      <div className="grid gap-4 lg:grid-cols-2">
        {q.data?.map((l) => (
          <Card key={l.id} className={l.isActive ? "" : "opacity-60"}>
            <CardHeader
              title={`${l.item.code} ${l.item.name}`}
              description={`${KIND[l.kind]} ${formatQty(l.containerQty)} ${l.item.uom} per container · ${l.sourceWarehouse ? `${l.sourceWarehouse.code} → ` : ""}${l.warehouse.code} · ${l.leadTimeDays} day${l.leadTimeDays === 1 ? "" : "s"} lead time`}
              action={
                <span className="flex gap-1">
                  <Link href={`/print/kanban/${l.id}`} target="_blank" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-surface-muted"><Printer className="size-4" aria-hidden /> Cards</Link>
                  {manage && <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>Edit</Button>}
                </span>
              }
            />
            <div className="flex flex-wrap gap-2 border-t border-border p-4">
              {l.cards.map((c) => {
                const href = docHref(c.doc);
                return (
                  <div key={c.id} className={`w-28 rounded-lg border p-2 text-xs ${c.status === "full" ? "border-success bg-success-soft" : "border-warning bg-warning-soft"}`}>
                    <div className="flex items-center justify-between font-medium"><span>Card {c.cardNo}</span><Badge tone={c.status === "full" ? "success" : "warning"}>{c.status === "full" ? "Full" : "Out"}</Badge></div>
                    {c.status === "empty" && (
                      <p className="mt-1 text-muted">
                        {timeAgo(c.signalledAt)}
                        {c.doc && <> · {href ? <Link className="underline" href={href}>{c.doc.number ?? "Draft"}</Link> : c.doc.number}</>}
                      </p>
                    )}
                    <Button size="sm" variant="ghost" className="mt-1 h-7 w-full text-xs" loading={busy === c.id} disabled={!l.isActive && c.status === "full"} onClick={() => act(c.id, () => api(`${PLAN}/kanban/cards/${c.id}/${c.status === "full" ? "signal" : "receive"}`, { method: "POST" }))}>
                      {c.status === "full" ? "Signal empty" : "Receive"}
                    </Button>
                  </div>
                );
              })}
            </div>
            <p className="border-t border-border px-4 py-2 text-xs text-muted">{l.full} of {l.cards.length} containers full{l.notes ? ` · ${l.notes}` : ""}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function LoopForm({ loop, onClose, onSaved }: { loop: Loop | null; onClose: () => void; onSaved: () => void }) {
  const whs = useWarehouses();
  const [item, setItem] = useState<{ id: string; label: string } | null>(loop ? { id: loop.item.id, label: `${loop.item.code} ${loop.item.name}` } : null);
  const [f, setF] = useState({ kind: loop?.kind ?? "production", warehouseId: loop?.warehouse.id ?? "", sourceWarehouseId: loop?.sourceWarehouse?.id ?? "", containerQty: loop ? String(Number(loop.containerQty)) : "", cards: String(loop?.cards.length ?? 2), leadTimeDays: String(loop?.leadTimeDays ?? 1), notes: loop?.notes ?? "", isActive: loop?.isActive ?? true });
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (!item) return setError("Choose the item");
    setBusy(true);
    setError(null);
    try {
      const body = { itemId: item.id, kind: f.kind, warehouseId: f.warehouseId, sourceWarehouseId: f.kind === "transfer" ? f.sourceWarehouseId || null : null, containerQty: f.containerQty, cards: Number(f.cards), leadTimeDays: Number(f.leadTimeDays) || 0, notes: f.notes || null, isActive: f.isActive };
      await api(loop ? `${PLAN}/kanban/${loop.id}` : `${PLAN}/kanban`, { method: loop ? "PUT" : "POST", body });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  async function suggest() {
    if (!loop) return;
    const r = await api<{ dailyUsage: number; cards: number | null }>(`${PLAN}/kanban/${loop.id}/suggest`);
    setHint(r.cards ? `Average use ${r.dailyUsage} ${loop.item.uom} a day over 90 days: about ${r.cards} cards cover the lead time with 20 % safety.` : "No use recorded at this point of use in the last 90 days.");
    if (r.cards) setF((x) => ({ ...x, cards: String(r.cards) }));
  }
  return (
    <Card>
      <CardHeader title={loop ? `Edit loop: ${loop.item.code}` : "New kanban loop"} />
      <div className="space-y-4 border-t border-border p-5">
        {error && <Alert>{error}</Alert>}
        {hint && <Alert tone="success">{hint}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Item" required className="sm:col-span-2">{() => (item ? <div className="flex items-center gap-2 text-sm">{item.label}{!loop && <Button size="sm" variant="ghost" onClick={() => setItem(null)}>Change</Button>}</div> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} stockOnly />)}</Field>
          <Field label="Replenished by">{(p) => <Select {...p} value={f.kind} onChange={set("kind")}><option value="production">Making (work order)</option><option value="purchase">Buying (requisition)</option><option value="transfer">Moving from a store</option></Select>}</Field>
          <Field label="Point of use" required>{(p) => <Select {...p} value={f.warehouseId} onChange={set("warehouseId")}><option value="">Choose…</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</Select>}</Field>
          {f.kind === "transfer" && <Field label="From store" required>{(p) => <Select {...p} value={f.sourceWarehouseId} onChange={set("sourceWarehouseId")}><option value="">Choose…</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</Select>}</Field>}
          <Field label="Quantity per container" required>{(p) => <Input {...p} inputMode="decimal" value={f.containerQty} onChange={set("containerQty")} />}</Field>
          <Field label="Cards" required>{(p) => <span className="flex gap-2"><Input {...p} inputMode="numeric" className="w-20" value={f.cards} onChange={set("cards")} />{loop && <Button size="sm" variant="ghost" onClick={suggest}><Lightbulb className="size-4" aria-hidden /> Suggest</Button>}</span>}</Field>
          <Field label="Lead time (days)">{(p) => <Input {...p} inputMode="numeric" value={f.leadTimeDays} onChange={set("leadTimeDays")} />}</Field>
          <Field label="Notes" className="sm:col-span-2">{(p) => <Input {...p} value={f.notes} onChange={set("notes")} />}</Field>
          {loop && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy}>Save</Button>
        </div>
      </div>
    </Card>
  );
}
