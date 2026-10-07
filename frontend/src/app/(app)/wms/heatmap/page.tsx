"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Suspense, useState } from "react";
import { NoWmsWarehouse, WarehouseSelect } from "@/components/wms/warehouse-select";
import { Card } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useWarehouseParam, WMS } from "@/lib/wms";

interface Cell { id: string; code: string; zone: string; condition: string; aisle: string | null; rack: string | null; shelf: string | null; gridX: number | null; gridY: number | null; isBlocked: boolean; weightKg: number; volumeM3: number; qty: number; fill: number | null; moves30: number; items: number }

export default function HeatmapPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Heatmap />
    </Suspense>
  );
}

/** Colour of a cell from 0 (cool) to 1 (hot). */
function heat(v: number) {
  const t = Math.max(0, Math.min(1, v));
  return `hsl(${Math.round(210 - 210 * t)} 80% ${Math.round(92 - 40 * t)}%)`;
}

function Heatmap() {
  const { wh, loading, current } = useWarehouseParam();
  const [mode, setMode] = useState<"fill" | "moves">("fill");
  const q = useQuery({ queryKey: [WMS, "heatmap", wh], queryFn: () => api<Cell[]>(`${WMS}/warehouses/${wh}/heatmap`), enabled: !!wh });
  if (loading) return <LoadingBlock />;
  if (!wh || !current) return <NoWmsWarehouse />;
  const cells = q.data ?? [];
  const maxMoves = Math.max(1, ...cells.map((c) => c.moves30));
  // One block per zone + aisle; racks run down, shelves across.
  const groups = new Map<string, Cell[]>();
  for (const c of cells) {
    const k = `${c.zone} · aisle ${c.aisle ?? "–"}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const value = (c: Cell) => (mode === "fill" ? (c.fill ?? (c.items ? 0.5 : 0)) : c.moves30 / maxMoves);
  const full = cells.filter((c) => (c.fill ?? 0) >= 0.9).length;
  const empty = cells.filter((c) => !c.items).length;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`Heat map · ${current.code}`} description="How full each storage bin is (by weight, volume or quantity limit), or how busy it was in the last 30 days." actions={<WarehouseSelect />} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {(["fill", "moves"] as const).map((m) => <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-lg px-3 py-1.5 ${mode === m ? "bg-primary/10 font-medium text-primary" : "text-muted"}`}>{m === "fill" ? "How full" : "How busy"}</button>)}
        <span className="text-muted">{cells.length} bins · {empty} empty · {full} at 90 % or more</span>
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      <div className="grid gap-4 md:grid-cols-2">
        {[...groups.entries()].map(([k, list]) => {
          const racks = [...new Set(list.map((c) => c.rack ?? c.code))];
          const shelves = [...new Set(list.map((c) => c.shelf ?? "1"))].sort();
          return (
            <Card key={k} className="p-4">
              <p className="mb-2 text-sm font-medium">{k}</p>
              <div className="grid gap-1" style={{ gridTemplateColumns: `auto repeat(${shelves.length}, minmax(0, 1fr))` }}>
                {racks.map((r) => (
                  <div key={r} className="contents">
                    <span className="pr-2 text-right font-mono text-xs text-muted">{r}</span>
                    {shelves.map((s) => {
                      const c = list.find((x) => (x.rack ?? x.code) === r && (x.shelf ?? "1") === s);
                      if (!c) return <span key={s} />;
                      const tip = `${c.code}: ${c.items} item(s), ${c.fill === null ? "no limit set" : `${Math.round(c.fill * 100)} % full`}, ${c.moves30} moves in 30 days${c.isBlocked ? ", blocked" : ""}`;
                      return (
                        <Link key={s} href={`${WMS}/scan?wh=${wh}&bin=${encodeURIComponent(c.code)}`} title={tip} aria-label={tip} className={`flex h-8 items-center justify-center rounded text-[10px] font-mono ${c.isBlocked ? "ring-2 ring-danger" : ""}`} style={{ background: c.items || mode === "moves" ? heat(value(c)) : "var(--color-surface-muted)" }}>
                          {s}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
        {q.data && !cells.length && <p className="text-sm text-muted">No storage bins yet.</p>}
      </div>
    </div>
  );
}
