"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { NoWmsWarehouse, WarehouseSelect } from "@/components/wms/warehouse-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { useWarehouseParam, WMS } from "@/lib/wms";

interface Pickable { id: string; number: string; docDate: string; customer: string; expectedDate: string | null; lines: number; openBaseQty: number }
interface Wave { id: string; number: string; mode: string; status: string; createdAt: string; orders: number; picks: number; openPicks: number; shortages: unknown[] }
const TONE = { open: "primary", picked: "warning", delivered: "success", cancelled: "neutral" } as const;

export default function WavesPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Waves />
    </Suspense>
  );
}

function Waves() {
  const { can } = useAuth();
  const router = useRouter();
  const { wh, loading, current } = useWarehouseParam();
  const [chosen, setChosen] = useState<string[]>([]);
  const [mode, setMode] = useState("order");
  const [error, setError] = useState<string | null>(null);
  const pickable = useQuery({ queryKey: [WMS, "pickable", wh], queryFn: () => api<Pickable[]>(`${WMS}/warehouses/${wh}/pickable`), enabled: !!wh });
  const waves = useQuery({ queryKey: [WMS, "waves", wh], queryFn: () => api<Wave[]>(`${WMS}/warehouses/${wh}/waves`), enabled: !!wh });
  if (loading) return <LoadingBlock />;
  if (!wh || !current) return <NoWmsWarehouse />;
  async function create() {
    setError(null);
    try {
      const w = await api<{ id: string }>(`${WMS}/waves`, { body: { warehouseId: wh, orderIds: chosen, mode } });
      router.push(`${WMS}/waves/${w.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`Picking · ${current.code}`} description="Group open sales orders into a wave: picks come first-expiry-first-out from storage bins, honour each item's minimum shelf life, and run in walking order." actions={<WarehouseSelect />} />
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader
          title="Orders to pick"
          action={can("wms.tasks.execute") && (
            <span className="flex items-center gap-2">
              <Select className="h-9 w-48" aria-label="Picking mode" value={mode} onChange={(e) => setMode(e.target.value)}><option value="order">Order by order</option><option value="batch">Batch (all orders in one walk)</option><option value="zone">By zone</option></Select>
              <Button disabled={!chosen.length} onClick={create}>Make a wave{chosen.length ? ` of ${chosen.length}` : ""}</Button>
            </span>
          )}
        />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {pickable.data?.map((o) => (
            <li key={o.id} className="flex items-center gap-3 px-5 py-2">
              <input type="checkbox" aria-label={`Pick ${o.number}`} checked={chosen.includes(o.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))} />
              <Link className="font-mono text-xs text-primary hover:underline" href={`/sales/orders/${o.id}`}>{o.number}</Link>
              <span className="font-medium">{o.customer}</span>
              <span className="text-xs text-muted">{o.lines} line(s) · {formatQty(o.openBaseQty)} units{o.expectedDate && ` · due ${formatDate(o.expectedDate)}`}</span>
            </li>
          ))}
          {pickable.data && !pickable.data.length && <li className="px-5 py-4 text-center text-muted">No approved orders waiting to be picked here.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Waves" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {waves.data?.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <Link className="font-mono text-primary hover:underline" href={`${WMS}/waves/${w.id}`}>{w.number}</Link>
              <span>{w.orders} order(s) · {w.picks} pick(s){w.openPicks ? `, ${w.openPicks} open` : ""} · {w.mode}</span>
              {w.shortages.length > 0 && <Badge tone="warning">{w.shortages.length} short</Badge>}
              <Badge tone={TONE[w.status as keyof typeof TONE]} className="ml-auto">{w.status}</Badge>
            </li>
          ))}
          {waves.data && !waves.data.length && <li className="px-5 py-4 text-center text-muted">No waves yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
