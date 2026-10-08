"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { DataTable } from "@/components/ui/data-table";

interface WorkCenter { id: string; code: string; name: string; units: number; hoursPerDay: string; daysPerWeek: number; efficiencyPct: string; kind: string }
interface Load { workCenterId: string; code: string; name: string; units: number; hoursPerDay: number; busyHours: number; loadPct: number | null }
interface Side { late: number; finishesAt: string | null; setupMinutes: number; load: Load[] }
interface Result { baseline: Side; scenario: Side; orders: { id: string; number: string; item: string; added: boolean; before: { end: string | null; late: boolean } | null; after: { end: string | null; late: boolean }; shiftHours: number | null }[] }
type WcChange = { workCenterId: string; units: string; hoursPerDay: string; daysPerWeek: string; efficiencyPct: string };

/** What-if: change capacity or add an order and see the effect on the plan before deciding. Nothing is saved. */
export default function SimulatePage() {
  const wcs = useQuery({ queryKey: ["/manufacturing/work-centers"], queryFn: () => api<WorkCenter[]>("/manufacturing/work-centers"), select: (all) => all.filter((w) => w.kind !== "subcontract") });
  const [changes, setChanges] = useState<WcChange[]>([]);
  const [orders, setOrders] = useState<{ itemId: string; label: string; qty: string; due: string; priority: string }[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = (v: string) => (v.trim() === "" ? undefined : Number(v));
  async function run() {
    setError(null);
    setBusy(true);
    try {
      setResult(
        await api<Result>("/twin/simulate", {
          body: {
            workCenters: changes.filter((c) => c.workCenterId).map((c) => ({ workCenterId: c.workCenterId, units: n(c.units), hoursPerDay: n(c.hoursPerDay), daysPerWeek: n(c.daysPerWeek), efficiencyPct: n(c.efficiencyPct) })),
            newOrders: orders.filter((o) => o.itemId && Number(o.qty) > 0).map((o) => ({ itemId: o.itemId, qty: Number(o.qty), due: o.due || undefined, priority: Number(o.priority) })),
          },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  const setC = (i: number, p: Partial<WcChange>) => setChanges(changes.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const delta = (a: number, b: number) => (b === a ? "" : b > a ? ` (+${b - a})` : ` (${b - a})`);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="What-if" description="Re-plans every open work order with the changes below, using the same finite scheduler as the production plan, and compares it with today's plan. Nothing is saved." />
      <Card>
        <CardHeader title="Capacity changes" description="Leave a field empty to keep it as it is. Fewer units = a machine down; more hours or days = overtime or an extra shift." />
        <div className="space-y-2 border-t border-border p-4 text-sm">
          {changes.map((c, i) => {
            const w = wcs.data?.find((x) => x.id === c.workCenterId);
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select className="h-9 w-56" aria-label="Work centre" value={c.workCenterId} onChange={(e) => setC(i, { workCenterId: e.target.value })}><option value="">Work centre…</option>{wcs.data?.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</Select>
                <Input className="h-9 w-24" type="number" min={1} aria-label="Machines" placeholder={w ? `${w.units} units` : "units"} value={c.units} onChange={(e) => setC(i, { units: e.target.value })} />
                <Input className="h-9 w-28" type="number" min={1} max={24} aria-label="Hours per day" placeholder={w ? `${Number(w.hoursPerDay)} h/day` : "h/day"} value={c.hoursPerDay} onChange={(e) => setC(i, { hoursPerDay: e.target.value })} />
                <Input className="h-9 w-28" type="number" min={1} max={7} aria-label="Days per week" placeholder={w ? `${w.daysPerWeek} days` : "days"} value={c.daysPerWeek} onChange={(e) => setC(i, { daysPerWeek: e.target.value })} />
                <Input className="h-9 w-28" type="number" min={10} max={200} aria-label="Efficiency %" placeholder={w ? `${Number(w.efficiencyPct)} %` : "%"} value={c.efficiencyPct} onChange={(e) => setC(i, { efficiencyPct: e.target.value })} />
                <Button size="sm" variant="ghost" onClick={() => setChanges(changes.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            );
          })}
          <Button size="sm" variant="secondary" onClick={() => setChanges([...changes, { workCenterId: "", units: "", hoursPerDay: "", daysPerWeek: "", efficiencyPct: "" }])}>Change a work centre</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Extra orders" description="An order you might take: made with the item's routing from its bill of materials." />
        <div className="space-y-2 border-t border-border p-4 text-sm">
          {orders.map((o, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-56">{o.label}</span>
              <Input className="h-9 w-28" type="number" min={1} aria-label="Quantity" placeholder="Qty" value={o.qty} onChange={(e) => setOrders(orders.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
              <Input className="h-9 w-40" type="date" aria-label="Due" value={o.due} onChange={(e) => setOrders(orders.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} />
              <Select className="h-9 w-32" aria-label="Priority" value={o.priority} onChange={(e) => setOrders(orders.map((x, j) => (j === i ? { ...x, priority: e.target.value } : x)))}>{[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>Priority {p}</option>)}</Select>
              <Button size="sm" variant="ghost" onClick={() => setOrders(orders.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <div className="max-w-sm"><ItemPicker placeholder="Add an order for…" onPick={(it) => setOrders([...orders, { itemId: it.id, label: `${it.code} · ${it.name}`, qty: "", due: "", priority: "3" }])} /></div>
        </div>
      </Card>
      {error && <Alert>{error}</Alert>}
      <Button loading={busy} onClick={run}>Simulate</Button>
      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4"><p className="text-sm text-muted">Late orders</p><p className="text-2xl font-semibold">{result.baseline.late} → {result.scenario.late}</p></Card>
            <Card className="p-4"><p className="text-sm text-muted">Everything finished by</p><p className="text-lg font-semibold">{formatDateTime(result.baseline.finishesAt)} → {formatDateTime(result.scenario.finishesAt)}</p></Card>
            <Card className="p-4"><p className="text-sm text-muted">Setup time</p><p className="text-2xl font-semibold">{result.baseline.setupMinutes} → {result.scenario.setupMinutes} min</p></Card>
          </div>
          <Card>
            <CardHeader title="Work centres" />
            <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Work centre</th><th className="px-4 py-2 font-medium">Capacity</th><th className="px-4 py-2 text-right font-medium">Busy hours</th><th className="px-4 py-2 text-right font-medium">Load</th></tr></thead>
              <tbody className="divide-y divide-border">
                {result.scenario.load.map((s) => {
                  const b = result.baseline.load.find((x) => x.workCenterId === s.workCenterId)!;
                  return (
                    <tr key={s.workCenterId}>
                      <td className="px-4 py-2">{s.code} · {s.name}</td>
                      <td className="px-4 py-2 text-xs">{s.units} unit(s){delta(b.units, s.units)} · {s.hoursPerDay} h/day{delta(b.hoursPerDay, s.hoursPerDay)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{b.busyHours} → {s.busyHours}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{b.loadPct ?? "–"} % → <strong className={(s.loadPct ?? 0) > 100 ? "text-danger" : ""}>{s.loadPct ?? "–"} %</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </Card>
          <Card>
            <CardHeader title="Orders" description="Biggest changes first." />
            <DataTable
              rows={result.orders}
              rowKey={(o) => String(o.id)}
              exportName="twin-simulate"
              storageKey="twin-simulate-1"
              columns={[
                { key: "order", label: "Order", locked: true, className: "whitespace-normal", render: (o) => <><span className="font-mono text-xs">{o.number}</span> {o.item}{o.added && <Badge tone="warning" className="ml-1">what-if</Badge>}</> },
                { key: "finishes-now", label: "Finishes now", className: "text-xs whitespace-normal", render: (o) => <>{o.before ? <>{formatDateTime(o.before.end)}{o.before.late && <Badge tone="danger" className="ml-1">late</Badge>}</> : "–"}</> },
                { key: "would-finish", label: "Would finish", className: "text-xs whitespace-normal", render: (o) => <>{formatDateTime(o.after.end)}{o.after.late && <Badge tone="danger" className="ml-1">late</Badge>}</> },
                { key: "change", label: "Change", align: "right", render: (o) => <><span className={`${(o.shiftHours ?? 0) > 0 ? "text-danger" : (o.shiftHours ?? 0) < 0 ? "text-success" : ""}`}>{o.shiftHours === null ? "–" : `${o.shiftHours > 0 ? "+" : ""}${o.shiftHours} h`}</span></> },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
