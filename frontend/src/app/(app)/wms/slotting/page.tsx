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
import { useWarehouseParam, WMS, type Bin } from "@/lib/wms";

interface Slotting { movers: { itemId: string; code: string; name: string; picks: number; bin: string }[]; suggestions: { itemId: string; code: string; name: string; picks: number; from: string; to: string; gain: number }[] }

export default function SlottingPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <SlottingView />
    </Suspense>
  );
}

function SlottingView() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { wh, loading, current } = useWarehouseParam();
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const slot = useQuery({ queryKey: [WMS, "slotting", wh], queryFn: () => api<Slotting>(`${WMS}/warehouses/${wh}/slotting`), enabled: !!wh });
  const faces = useQuery({ queryKey: [WMS, "bins", wh, "faces"], queryFn: () => api<(Bin & { replenMin?: string | null; replenMax?: string | null })[]>(`${WMS}/warehouses/${wh}/bins`), enabled: !!wh });
  if (loading) return <LoadingBlock />;
  if (!wh || !current) return <NoWmsWarehouse />;
  async function replenish() {
    setMsg(null);
    try {
      const r = await api<{ created: { number: string; bin: string; qty: string; from: string }[]; short: { bin: string; short: string }[] }>(`${WMS}/warehouses/${wh}/replenish`, { body: {} });
      setMsg({ tone: "success", text: r.created.length ? `${r.created.length} replenishment task(s): ${r.created.map((t) => `${t.from} → ${t.bin}`).join(", ")}.${r.short.length ? ` Short for ${r.short.map((s) => s.bin).join(", ")}.` : ""}` : "Every pick face is above its minimum." });
      qc.invalidateQueries({ queryKey: [WMS] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Replenishment and slotting · ${current.code}`} description="Pick faces (a bin with a fixed item and a min / max) are topped up from reserve stock. Fast movers far from the dock are paired with nearer empty bins." actions={<><WarehouseSelect />{can("wms.tasks.execute") && <Button onClick={replenish}>Plan replenishment</Button>}</>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Pick faces" description="Set min and max on bins that have a fixed item." />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {faces.data?.filter((b) => b.fixedItemId).map((b) => <PickFace key={b.id} bin={b} manage={can("wms.setup.manage")} />)}
          {faces.data && !faces.data.some((b) => b.fixedItemId) && <li className="px-5 py-4 text-center text-muted">No bin has a fixed item yet.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Slotting suggestions" description="Top fifth of items by outbound moves in 90 days, sitting farther along the walk than an empty bin." />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {slot.data?.suggestions.map((s) => <li key={s.itemId} className="flex gap-3 px-5 py-2"><span className="font-mono text-xs">{s.code}</span><span>{s.name}</span><span className="text-xs text-muted">{s.picks} moves</span><span className="ml-auto font-mono text-xs">{s.from} → {s.to}</span></li>)}
          {slot.data && !slot.data.suggestions.length && <li className="px-5 py-4 text-center text-muted">Fast movers are already near the dock.</li>}
        </ul>
      </Card>
    </div>
  );
}

function PickFace({ bin, manage }: { bin: Bin & { replenMin?: string | null; replenMax?: string | null }; manage: boolean }) {
  const [f, setF] = useState({ min: bin.replenMin ? String(Number(bin.replenMin)) : "", max: bin.replenMax ? String(Number(bin.replenMax)) : "" });
  const [saved, setSaved] = useState<string | null>(null);
  async function save() {
    try {
      await api(`${WMS}/bins/${bin.id}/pick-face`, { method: "PUT", body: { replenMin: f.min ? Number(f.min) : null, replenMax: f.max ? Number(f.max) : null } });
      setSaved("saved");
    } catch (err) {
      setSaved(err instanceof ApiError ? err.message : "failed");
    }
  }
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-2">
      <span className="font-mono">{bin.code}</span>
      <span className="text-xs text-muted">{bin.fixedItem}</span>
      <span className="ml-auto flex items-center gap-2">
        <Input aria-label="Min" className="h-8 w-20" placeholder="min" disabled={!manage} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
        <Input aria-label="Max" className="h-8 w-20" placeholder="max" disabled={!manage} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
        {manage && <Button size="sm" variant="ghost" onClick={save}>Save</Button>}
        {saved && <span className="text-xs text-muted">{saved}</span>}
      </span>
    </li>
  );
}
