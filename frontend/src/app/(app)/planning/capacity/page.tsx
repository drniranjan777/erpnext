"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { PLAN } from "@/lib/planning";

interface Capacity {
  mode: "rough" | "detailed";
  buckets: { start: string; end: string }[];
  workCenters: { id: string; code: string; name: string; outside: boolean; capacity: number[]; orders: number[]; planned: number[]; utilisation: (number | null)[] }[];
}

const hours = (m: number) => (m >= 600 ? `${Math.round(m / 60)} h` : `${(m / 60).toFixed(1)} h`);
const label = (b: { start: string }, mode: string) => new Date(`${b.start}T00:00:00Z`).toLocaleDateString("en-IN", mode === "rough" ? { day: "numeric", month: "short", timeZone: "UTC" } : { weekday: "short", day: "numeric", timeZone: "UTC" });
const tone = (u: number | null) => (u === null ? "bg-surface-muted" : u > 100 ? "bg-danger" : u > 85 ? "bg-warning" : "bg-success");

export default function CapacityPage() {
  const [mode, setMode] = useState<"rough" | "detailed">("rough");
  const q = useQuery({ queryKey: [PLAN, "capacity", mode], queryFn: () => api<Capacity>(`${PLAN}/capacity`, { query: { mode } }) });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Capacity"
        description="Load against available hours per work centre. Rough-cut: open work orders spread over their planned window plus MRP planned orders, by week. Detailed: the finite schedule, by day."
        actions={
          <Select aria-label="View" value={mode} onChange={(e) => setMode(e.target.value as "rough" | "detailed")}>
            <option value="rough">Rough-cut (8 weeks)</option>
            <option value="detailed">Detailed (14 days)</option>
          </Select>
        }
      />
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-success" /> up to 85 %</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-warning" /> 85–100 %</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-danger" /> overloaded</span>
        {mode === "rough" && <span className="inline-flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-primary/40" /> of which MRP planned orders</span>}
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && !q.data.workCenters.length && <EmptyState title="No work centres" description="Set up work centres with their hours under Work centres & tools." />}
      {q.data && q.data.workCenters.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="sticky left-0 bg-surface-muted px-4 py-2 text-left font-medium">Work centre</th>
                {q.data.buckets.map((b) => <th key={b.start} className="px-2 py-2 text-center font-medium">{label(b, q.data!.mode)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.workCenters.map((w) => (
                <tr key={w.id}>
                  <td className="sticky left-0 bg-surface px-4 py-2"><span className="font-mono text-xs text-muted">{w.code}</span> {w.name}{w.outside && <span className="block text-xs text-muted">Outside: no limit</span>}</td>
                  {q.data!.buckets.map((b, i) => {
                    const load = w.orders[i] + w.planned[i];
                    const u = w.utilisation[i];
                    return (
                      <td key={b.start} className="px-2 py-2 text-center" title={`Load ${hours(load)} (${hours(w.planned[i])} planned) of ${hours(w.capacity[i])}`}>
                        {load > 0 || w.capacity[i] > 0 ? (
                          <div className="mx-auto w-16">
                            <div className="relative h-2 overflow-hidden rounded-full bg-surface-muted">
                              <div className={`absolute inset-y-0 left-0 ${tone(u)}`} style={{ width: `${Math.min(100, u ?? (load > 0 ? 100 : 0))}%` }} />
                              {w.planned[i] > 0 && w.capacity[i] > 0 && <div className="absolute inset-y-0 bg-primary/40" style={{ left: `${Math.min(100, (w.orders[i] / w.capacity[i]) * 100)}%`, width: `${Math.min(100, (w.planned[i] / w.capacity[i]) * 100)}%` }} />}
                            </div>
                            <span className={`text-xs tabular-nums ${u !== null && u > 100 ? "font-semibold text-danger" : "text-muted"}`}>{u === null ? (load ? hours(load) : "–") : `${u}%`}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">–</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
