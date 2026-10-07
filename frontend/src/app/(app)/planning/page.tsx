"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, LockOpen, Play, Wand2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";
import { Pegs } from "@/components/planning/pegs";
import { EXCEPTION_LABEL, PLAN, SOURCE_LABEL, refHref, type MrpException, type MrpRun, type PlannedOrder } from "@/lib/planning";

type Tab = "orders" | "exceptions";

export default function PlanningPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can("planning.mrp.manage");
  const runs = useQuery({ queryKey: [PLAN, "runs"], queryFn: () => api<MrpRun[]>(`${PLAN}/mrp/runs`) });
  const [tab, setTab] = useState<Tab>("orders");
  const [horizon, setHorizon] = useState("120");
  const [useForecast, setUseForecast] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = runs.data?.find((r) => r.status === "done");

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api(`${PLAN}/mrp/runs`, { body: { horizonDays: Number(horizon) || 120, useForecast } });
      await qc.invalidateQueries({ queryKey: [PLAN] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="MRP planning"
        description="Net requirements for every item, level by level: open orders and forecast against stock, purchase orders, requisitions and work orders. Planned orders are offset by lead time and sized by each item's lot rule."
      />
      {manage && (
        <Card className="flex flex-wrap items-end gap-4 p-5">
          <Field label="Horizon (days)">{(p) => <Input {...p} className="w-28" inputMode="numeric" value={horizon} onChange={(e) => setHorizon(e.target.value.replace(/\D/g, ""))} />}</Field>
          <Checkbox label="Include the demand forecast" checked={useForecast} onChange={(e) => setUseForecast(e.target.checked)} />
          <div className="ml-auto flex items-center gap-3">
            {last && <span className="text-xs text-muted">Last run {formatDateTime(last.startedAt)} · {(last.stats.ms / 1000).toFixed(1)} s</span>}
            <Button onClick={run} loading={busy}><Play className="size-4" aria-hidden /> Run MRP</Button>
          </div>
        </Card>
      )}
      {error && <Alert>{error}</Alert>}
      {runs.isLoading && <LoadingBlock />}
      {runs.error && <ErrorBlock error={runs.error} />}
      {runs.data && !last && <EmptyState title="MRP has not been run yet" description={manage ? "Set each item's lead time, safety stock and lot size, then run MRP." : "Ask a planner to run MRP."} />}
      {last && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Items planned" value={last.stats.plannedItems} sub={`of ${last.stats.items}`} />
            <Stat label="Planned orders" value={last.stats.plannedOrders} sub={`${last.stats.buy} buy · ${last.stats.make} make`} />
            <Stat label="Exceptions" value={last.stats.exceptions} sub={`${(last.stats.ex_expedite ?? 0) + (last.stats.ex_past_due ?? 0)} urgent`} />
            <Stat label="Horizon" value={last.horizonDays} sub={last.useForecast ? "days, with forecast" : "days, orders only"} />
          </div>
          <div role="tablist" className="flex gap-1 border-b border-border">
            {(["orders", "exceptions"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? "border-primary text-primary" : "border-transparent text-muted hover:text-foreground"}`}>
                {t === "orders" ? "Planned orders" : "Exception messages"}
              </button>
            ))}
          </div>
          {tab === "orders" ? <PlannedOrders manage={manage} /> : <Exceptions />}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{(value ?? 0).toLocaleString("en-IN")}</p>
      <p className="text-xs text-muted">{sub}</p>
    </Card>
  );
}

function PlannedOrders({ manage }: { manage: boolean }) {
  const qc = useQueryClient();
  const whs = useWarehouses();
  const [filter, setFilter] = useState({ source: "", status: "planned,firmed", q: "" });
  const list = useQuery({ queryKey: [PLAN, "planned", filter], queryFn: () => api<{ total: number; items: PlannedOrder[] }>(`${PLAN}/planned-orders`, { query: { source: filter.source || undefined, status: filter.status, q: filter.q || undefined, limit: 200 } }) });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [wh, setWh] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; node: React.ReactNode } | null>(null);
  const rows = list.data?.items ?? [];
  const open = rows.filter((r) => r.status !== "converted");
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function act(kind: "firm" | "unfirm" | "convert") {
    setBusy(true);
    setMsg(null);
    try {
      const ids = [...sel];
      if (kind === "convert") {
        const r = await api<{ requisition: { id: string; number: string } | null; workOrders: { id: string; number: string; item: string }[]; errors: { code: string; message: string }[] }>(`${PLAN}/planned-orders/convert`, { body: { ids, warehouseId: wh || null } });
        setMsg({
          tone: r.errors.length ? "danger" : "success",
          node: (
            <>
              {r.requisition && <>Requisition <Link className="underline" href={`/purchase/requisitions/${r.requisition.id}`}>{r.requisition.number}</Link> drafted. </>}
              {r.workOrders.length > 0 && <>{r.workOrders.length} work order{r.workOrders.length === 1 ? "" : "s"} drafted: {r.workOrders.map((w) => <Link key={w.id} className="mr-2 underline" href={`/manufacturing/work-orders/${w.id}`}>{w.item}</Link>)}</>}
              {r.errors.map((e, i) => <span key={i} className="block">{e.code}: {e.message}</span>)}
            </>
          ),
        });
      } else {
        const r = await api<{ updated: number }>(`${PLAN}/planned-orders/firm`, { body: { ids, firm: kind === "firm" } });
        setMsg({ tone: "success", node: `${r.updated} order${r.updated === 1 ? "" : "s"} ${kind === "firm" ? "firmed: the next run keeps them" : "back to planned"}.` });
      }
      setSel(new Set());
      await qc.invalidateQueries({ queryKey: [PLAN] });
    } catch (e) {
      setMsg({ tone: "danger", node: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Search">{(p) => <Input {...p} className="h-9 w-48" placeholder="Item code or name" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />}</Field>
        <Field label="Source">{(p) => <Select {...p} className="h-9" value={filter.source} onChange={(e) => setFilter({ ...filter, source: e.target.value })}><option value="">All</option><option value="buy">Buy</option><option value="make">Make</option><option value="batch">Batch</option></Select>}</Field>
        <Field label="Status">{(p) => <Select {...p} className="h-9" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}><option value="planned,firmed">Open</option><option value="planned">Planned</option><option value="firmed">Firmed</option><option value="converted">Converted</option></Select>}</Field>
        {manage && sel.size > 0 && (
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <Field label="Make into">{(p) => <Select {...p} className="h-9" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">First store</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</Select>}</Field>
            <Button size="sm" variant="secondary" onClick={() => act("firm")} disabled={busy}><Lock className="size-4" aria-hidden /> Firm</Button>
            <Button size="sm" variant="secondary" onClick={() => act("unfirm")} disabled={busy}><LockOpen className="size-4" aria-hidden /> Unfirm</Button>
            <Button size="sm" onClick={() => act("convert")} loading={busy}><Wand2 className="size-4" aria-hidden /> Convert {sel.size}</Button>
          </div>
        )}
      </div>
      {msg && <div className="px-4 pb-3"><Alert tone={msg.tone}>{msg.node}</Alert></div>}
      {list.isLoading && <LoadingBlock />}
      {list.error && <ErrorBlock error={list.error} />}
      {list.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                {manage && <th className="w-10 px-4 py-2"><Checkbox aria-label="Select all" checked={open.length > 0 && open.every((r) => sel.has(r.id))} indeterminate={sel.size > 0 && !open.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(open.map((r) => r.id)) : new Set())} /></th>}
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 text-right font-medium">Quantity</th>
                <th className="px-4 py-2 font-medium">Release</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 font-medium">For</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className={sel.has(r.id) ? "bg-primary-soft/40" : undefined}>
                  {manage && <td className="px-4 py-2">{r.status !== "converted" && <Checkbox aria-label={`Select ${r.item.code}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} />}</td>}
                  <td className="px-4 py-2"><Link href={`/planning/items/${r.item.id}`} className="hover:underline"><span className="font-mono text-xs text-muted">{r.item.code}</span> {r.item.name}</Link>{r.level > 0 && <span className="ml-1 text-xs text-muted">· level {r.level}</span>}</td>
                  <td className="px-4 py-2"><Badge tone={r.source === "buy" ? "neutral" : "primary"}>{SOURCE_LABEL[r.source]}</Badge></td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQty(r.qty)} <span className="text-xs text-muted">{r.item.uom}</span></td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.releaseDate)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.dueDate)}</td>
                  <td className="px-4 py-2 text-xs"><Pegs pegs={r.pegs} /></td>
                  <td className="px-4 py-2">
                    {r.status === "converted" ? (r.converted && refHref(r.converted) ? <Link className="text-xs underline" href={refHref(r.converted)!}>{r.converted.number ?? "Draft"}</Link> : <Badge tone="success">Converted</Badge>) : <Badge tone={r.status === "firmed" ? "warning" : "neutral"}>{r.status === "firmed" ? "Firmed" : "Planned"}</Badge>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="px-4 py-6 text-center text-muted">Nothing to order: requirements are covered.</td></tr>}
            </tbody>
          </table>
          {list.data.total > rows.length && <p className="border-t border-border px-4 py-2 text-xs text-muted">Showing {rows.length} of {list.data.total}. Narrow the search to see the rest.</p>}
        </div>
      )}
    </Card>
  );
}

function Exceptions() {
  const [kind, setKind] = useState("");
  const q = useQuery({ queryKey: [PLAN, "exceptions", kind], queryFn: () => api<{ counts: Record<string, number>; total: number; items: MrpException[] }>(`${PLAN}/mrp/exceptions`, { query: { kind: kind || undefined, limit: 200 } }) });
  return (
    <Card>
      <CardHeader title="Exception messages" description="What the plan needs a planner to act on, most urgent first." />
      <div className="flex flex-wrap gap-2 border-t border-border p-4">
        <button onClick={() => setKind("")} className={`rounded-full px-3 py-1 text-xs ${kind === "" ? "bg-primary text-primary-foreground" : "bg-surface-muted text-muted"}`}>All</button>
        {Object.entries(q.data?.counts ?? {}).map(([k, n]) => (
          <button key={k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-xs ${kind === k ? "bg-primary text-primary-foreground" : "bg-surface-muted text-muted"}`}>{EXCEPTION_LABEL[k]?.label ?? k} · {n}</button>
        ))}
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <ul className="divide-y divide-border border-t border-border text-sm">
          {q.data.items.map((e) => {
            const href = refHref(e.ref);
            const meta = EXCEPTION_LABEL[e.kind] ?? { label: e.kind, tone: "neutral" as const };
            return (
              <li key={e.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <Badge tone={meta.tone}>{meta.label}</Badge>
                <div className="min-w-0 flex-1">
                  <Link href={`/planning/items/${e.item.id}`} className="font-medium hover:underline"><span className="font-mono text-xs text-muted">{e.item.code}</span> {e.item.name}</Link>
                  <p className="text-muted">{e.message}</p>
                </div>
                {href && <Link href={href} className="text-xs underline">{e.ref?.number ?? "Open"}</Link>}
              </li>
            );
          })}
          {!q.data.items.length && <li className="px-5 py-6 text-center text-muted">No exceptions.</li>}
        </ul>
      )}
    </Card>
  );
}
