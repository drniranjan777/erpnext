"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { NoWmsWarehouse, WarehouseSelect } from "@/components/wms/warehouse-select";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatQty, todayIST } from "@/lib/documents";
import { useWarehouseParam, WMS } from "@/lib/wms";
import { DataTable } from "@/components/ui/data-table";

interface Productivity { people: { userId: string; name: string; picks: number; putaways: number; units: string; shortPicks: number; activeMinutes: number; picksPerHour: number | null }[]; totals: { picks: number; shortPicks: number; putaways: number }; accuracy: { counts: number; lines: number; avgPct: string | null } }
interface Level { binId: string; bin: string; itemCode: string; currentMin: string | null; currentMax: string | null; avgDaily: number; peakDaily: number; suggestedMin: number | null; suggestedMax: number | null }

export default function InsightsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Insights />
    </Suspense>
  );
}

function Insights() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { wh, loading, current } = useWarehouseParam();
  const [range, setRange] = useState({ from: `${todayIST().slice(0, 7)}-01`, to: todayIST() });
  const [msg, setMsg] = useState<string | null>(null);
  const prod = useQuery({ queryKey: [WMS, "productivity", wh, range], queryFn: () => api<Productivity>(`${WMS}/warehouses/${wh}/productivity`, { query: range }), enabled: !!wh });
  const levels = useQuery({ queryKey: [WMS, "face-levels", wh], queryFn: () => api<Level[]>(`${WMS}/warehouses/${wh}/face-levels`), enabled: !!wh });
  if (loading) return <LoadingBlock />;
  if (!wh || !current) return <NoWmsWarehouse />;
  const changed = (levels.data ?? []).filter((l) => l.suggestedMin !== null && l.suggestedMax !== null && (Number(l.currentMin ?? -1) !== l.suggestedMin || Number(l.currentMax ?? -1) !== l.suggestedMax));
  async function apply() {
    try {
      const r = await api<{ updated: number }>(`${WMS}/face-levels`, { body: { levels: changed.map((l) => ({ binId: l.binId, min: l.suggestedMin, max: l.suggestedMax })) } });
      setMsg(`${r.updated} pick face(s) updated.`);
      qc.invalidateQueries({ queryKey: [WMS] });
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const p = prod.data;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Floor insights · ${current.code}`} description="Picking productivity and inventory accuracy (the targets: 25 % more picks per hour, 99.5 % accuracy after two counts), and pick-face levels from recent demand." actions={<WarehouseSelect />} />
      <div className="flex gap-2"><Input className="h-9 w-40" type="date" aria-label="From" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /><Input className="h-9 w-40" type="date" aria-label="To" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
      {p && (
        <div className="grid gap-4 sm:grid-cols-4">
          <Card className="px-4 py-3"><p className="text-xs uppercase text-muted">Picks</p><p className="text-2xl font-semibold">{p.totals.picks}</p></Card>
          <Card className="px-4 py-3"><p className="text-xs uppercase text-muted">Short picks</p><p className="text-2xl font-semibold">{p.totals.shortPicks}</p><p className="text-xs text-muted">{p.totals.picks ? `${Math.round((p.totals.shortPicks / p.totals.picks) * 1000) / 10} %` : "–"}</p></Card>
          <Card className="px-4 py-3"><p className="text-xs uppercase text-muted">Put-aways</p><p className="text-2xl font-semibold">{p.totals.putaways}</p></Card>
          <Card className="px-4 py-3"><p className="text-xs uppercase text-muted">Count accuracy</p><p className={`text-2xl font-semibold ${p.accuracy.avgPct && Number(p.accuracy.avgPct) >= 99.5 ? "text-success" : ""}`}>{p.accuracy.avgPct ? `${p.accuracy.avgPct} %` : "–"}</p><p className="text-xs text-muted">{p.accuracy.counts} count(s), {p.accuracy.lines} line(s)</p></Card>
        </div>
      )}
      <Card>
        <CardHeader title="By person" description="Active time counts gaps of up to 10 minutes between confirmations." />
        <DataTable
          rows={p?.people ?? []}
          rowKey={(x) => String(x.userId)}
          exportName="wms-insights"
          storageKey="wms-insights-0"
          empty={<p className="px-4 py-6 text-center text-sm text-muted">No floor work in this period.</p>}
          columns={[
            { key: "person", label: "Person", locked: true, className: "whitespace-normal", render: (x) => <>{x.name}</> },
            { key: "picks", label: "Picks", align: "right", render: (x) => <>{x.picks}{x.shortPicks ? ` (${x.shortPicks} short)` : ""}</> },
            { key: "put-aways", label: "Put-aways", align: "right", render: (x) => <>{x.putaways}</> },
            { key: "units", label: "Units", align: "right", render: (x) => <>{formatQty(x.units)}</> },
            { key: "active", label: "Active", align: "right", render: (x) => <>{x.activeMinutes} min</> },
            { key: "picks-hour", label: "Picks / hour", align: "right", render: (x) => <>{x.picksPerHour ?? "–"}</> },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Pick-face levels from demand" description="Min covers a day of demand plus half the gap to the busiest day; max adds three days of cover, within the bin's limit." action={can("wms.setup.manage") && changed.length > 0 && <Button size="sm" onClick={apply}>Apply {changed.length}</Button>} />
        {msg && <div className="px-5 pb-2"><Alert tone="success">{msg}</Alert></div>}
        <DataTable
          rows={levels.data ?? []}
          rowKey={(l) => String(l.binId)}
          exportName="wms-insights"
          storageKey="wms-insights-1"
          empty={<p className="px-4 py-6 text-center text-sm text-muted">No bin has a fixed item.</p>}
          columns={[
            { key: "face", label: "Face", locked: true, className: "font-mono whitespace-normal", render: (l) => <>{l.bin}</> },
            { key: "item", label: "Item", className: "whitespace-normal", render: (l) => <>{l.itemCode}</> },
            { key: "avg-peak-a-day", label: "Avg / peak a day", align: "right", render: (l) => <>{l.avgDaily} / {l.peakDaily}</> },
            { key: "now", label: "Now", align: "right", render: (l) => <>{l.currentMin ? `${Number(l.currentMin)}–${Number(l.currentMax)}` : "–"}</> },
            { key: "suggested", label: "Suggested", align: "right", render: (l) => <>{l.suggestedMin !== null ? `${l.suggestedMin}–${l.suggestedMax}` : "no demand"}</> },
          ]}
        />
      </Card>
    </div>
  );
}
