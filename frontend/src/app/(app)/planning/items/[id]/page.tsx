"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Pegs } from "@/components/planning/pegs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { PLAN, SOURCE_LABEL, refHref, refLabel, type PlannedOrder, type Ref } from "@/lib/planning";

interface Params { source: string; lotSizing: string; lotQty: string | null; periodDays: number | null; orderCost: string | null; holdingPct: string | null; excluded: boolean }
interface TimelineRow { date: string; kind: "on_hand" | "demand" | "receipt" | "planned"; qty: number; ref: Ref | null; balance: number }
interface ItemPlan {
  item: { id: string; code: string; name: string; leadTimeDays: number | null; safetyStock: string | null; minOrderQty: string | null };
  parameters: Params;
  run: { id: string; startedAt: string; horizonDays: number } | null;
  plan: { level: number; onHand: string; safetyStock: string; demand: string; receipts: string; planned: string; endBalance: string; firstShortage: string | null; timeline: TimelineRow[] } | null;
}

const LOT: Record<string, string> = { l4l: "Lot for lot", fixed: "Fixed lot", eoq: "Economic order quantity", min_max: "Min / max", period: "Period order quantity" };
const KIND = { on_hand: "On hand", demand: "Demand", receipt: "Receipt", planned: "Planned order" } as const;

export default function ItemPlanPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const q = useQuery({ queryKey: [PLAN, "item", id], queryFn: () => api<ItemPlan>(`${PLAN}/items/${id}`) });
  const orders = useQuery({ queryKey: [PLAN, "planned", { itemId: id }], queryFn: () => api<{ items: PlannedOrder[] }>(`${PLAN}/planned-orders`, { query: { itemId: id, status: "planned,firmed,converted", limit: 100 } }) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  const p = d.plan;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`${d.item.code} ${d.item.name}`} description={d.run ? `MRP record from the run of ${formatDateTime(d.run.startedAt)} (${d.run.horizonDays}-day horizon).` : "MRP has not been run yet."} actions={<Link href="/planning" className="text-sm underline">Back to planning</Link>} />
      {p && (
        <div className="grid gap-3 sm:grid-cols-5">
          {[
            ["On hand", p.onHand],
            ["Safety stock", p.safetyStock],
            ["Demand", p.demand],
            ["Receipts", p.receipts],
            ["Planned", p.planned],
          ].map(([l, v]) => (
            <Card key={l} className="p-4"><p className="text-xs uppercase tracking-wide text-muted">{l}</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatQty(v)}</p></Card>
          ))}
        </div>
      )}
      {p?.firstShortage && <Alert tone="warning">Without the planned orders, stock runs out on {formatDate(p.firstShortage)}.</Alert>}
      {p && (
        <Card>
          <CardHeader title="Time-phased record" description={`Level ${p.level}. Receipts and demand by date, with the projected balance after each.`} />
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">What</th><th className="px-4 py-2 font-medium">Reference</th><th className="px-4 py-2 text-right font-medium">In</th><th className="px-4 py-2 text-right font-medium">Out</th><th className="px-4 py-2 text-right font-medium">Balance</th></tr></thead>
              <tbody className="divide-y divide-border">
                {p.timeline.map((r, i) => {
                  const href = refHref(r.ref);
                  const inQty = r.kind === "receipt" || r.kind === "planned";
                  return (
                    <tr key={i} className={r.kind === "planned" ? "bg-primary-soft/40" : undefined}>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-4 py-2">{KIND[r.kind]}</td>
                      <td className="px-4 py-2 text-xs">{r.ref && r.kind !== "planned" ? (href ? <Link className="underline" href={href}>{refLabel(r.ref)}</Link> : refLabel(r.ref)) : ""}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.kind !== "on_hand" && inQty ? formatQty(String(r.qty)) : ""}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.kind === "demand" ? formatQty(String(r.qty)) : ""}</td>
                      <td className={`px-4 py-2 text-right font-medium tabular-nums ${r.balance < Number(p.safetyStock) ? "text-danger" : ""}`}>{formatQty(String(r.balance))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {orders.data && orders.data.items.length > 0 && (
        <Card>
          <CardHeader title="Planned orders" description="Pegging: the demand each order covers." />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {orders.data.items.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <Badge tone={o.source === "buy" ? "neutral" : "primary"}>{SOURCE_LABEL[o.source]}</Badge>
                <span className="tabular-nums">{formatQty(o.qty)}</span>
                <span className="text-muted">release {formatDate(o.releaseDate)}, due {formatDate(o.dueDate)}</span>
                <span className="text-xs"><Pegs pegs={o.pegs} limit={6} /></span>
                <span className="ml-auto">{o.status === "converted" && o.converted && refHref(o.converted) ? <Link className="text-xs underline" href={refHref(o.converted)!}>{o.converted.number ?? "Draft"}</Link> : <Badge tone={o.status === "firmed" ? "warning" : o.status === "converted" ? "success" : "neutral"}>{o.status}</Badge>}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <ParametersCard d={d} editable={can("planning.mrp.manage")} />
    </div>
  );
}

function ParametersCard({ d, editable }: { d: ItemPlan; editable: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    source: d.parameters.source,
    lotSizing: d.parameters.lotSizing,
    lotQty: d.parameters.lotQty ? String(Number(d.parameters.lotQty)) : "",
    periodDays: d.parameters.periodDays ? String(d.parameters.periodDays) : "",
    orderCost: d.parameters.orderCost ? String(Number(d.parameters.orderCost)) : "",
    holdingPct: d.parameters.holdingPct ? String(Number(d.parameters.holdingPct)) : "",
    excluded: d.parameters.excluded,
    leadTimeDays: d.item.leadTimeDays === null ? "" : String(d.item.leadTimeDays),
    safetyStock: d.item.safetyStock ? String(Number(d.item.safetyStock)) : "",
    minOrderQty: d.item.minOrderQty ? String(Number(d.item.minOrderQty)) : "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`${PLAN}/items/${d.item.id}/parameters`, {
        method: "PUT",
        body: {
          source: f.source,
          lotSizing: f.lotSizing,
          lotQty: f.lotQty || null,
          periodDays: f.periodDays ? Number(f.periodDays) : null,
          orderCost: f.orderCost || null,
          holdingPct: f.holdingPct || null,
          excluded: f.excluded,
          leadTimeDays: f.leadTimeDays === "" ? null : Number(f.leadTimeDays),
          safetyStock: f.safetyStock || null,
          minOrderQty: f.minOrderQty || null,
        },
      });
      setMsg({ tone: "success", text: "Saved. The next MRP run uses these settings." });
      await qc.invalidateQueries({ queryKey: [PLAN, "item", d.item.id] });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Planning parameters" description="How MRP orders this item." />
      <fieldset disabled={!editable} className="grid gap-4 border-t border-border p-5 sm:grid-cols-3">
        <Field label="Make or buy">{(p) => <Select {...p} value={f.source} onChange={set("source")}><option value="auto">Automatic (make when there is a BOM or formula)</option><option value="make">Make</option><option value="buy">Buy</option></Select>}</Field>
        <Field label="Lead time (days)">{(p) => <Input {...p} inputMode="numeric" value={f.leadTimeDays} onChange={set("leadTimeDays")} />}</Field>
        <Field label="Safety stock">{(p) => <Input {...p} inputMode="decimal" value={f.safetyStock} onChange={set("safetyStock")} />}</Field>
        <Field label="Lot sizing">{(p) => <Select {...p} value={f.lotSizing} onChange={set("lotSizing")}>{Object.entries(LOT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        {(f.lotSizing === "fixed" || f.lotSizing === "min_max") && <Field label={f.lotSizing === "fixed" ? "Lot quantity" : "Maximum stock"} required>{(p) => <Input {...p} inputMode="decimal" value={f.lotQty} onChange={set("lotQty")} />}</Field>}
        {f.lotSizing === "period" && <Field label="Days each order covers" required>{(p) => <Input {...p} inputMode="numeric" value={f.periodDays} onChange={set("periodDays")} />}</Field>}
        {f.lotSizing === "eoq" && (
          <>
            <Field label="Cost per order (₹)" required>{(p) => <Input {...p} inputMode="decimal" value={f.orderCost} onChange={set("orderCost")} />}</Field>
            <Field label="Holding cost (% a year)">{(p) => <Input {...p} inputMode="decimal" placeholder="20" value={f.holdingPct} onChange={set("holdingPct")} />}</Field>
          </>
        )}
        <Field label="Minimum order quantity">{(p) => <Input {...p} inputMode="decimal" value={f.minOrderQty} onChange={set("minOrderQty")} />}</Field>
        <div className="flex items-end sm:col-span-3"><Checkbox label="Leave this item out of MRP" checked={f.excluded} onChange={(e) => setF({ ...f, excluded: e.target.checked })} /></div>
      </fieldset>
      {msg && <div className="px-5 pb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {editable && <div className="flex justify-end border-t border-border p-4"><Button onClick={save} loading={busy}>Save</Button></div>}
    </Card>
  );
}
