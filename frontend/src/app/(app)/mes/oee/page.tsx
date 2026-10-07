"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { duration, LOSS_LABEL, pct, type OeeRow } from "@/lib/mes";

interface Oee { from: string; to: string; by: string; total: OeeRow; rows: OeeRow[] }

const DAY = 86_400_000;
const startOfIstDay = (ms: number) => Date.parse(`${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+05:30`);
const RANGES: Record<string, { label: string; from: () => number; to: () => number }> = {
  today: { label: "Today", from: () => startOfIstDay(Date.now()), to: () => Date.now() },
  yesterday: { label: "Yesterday", from: () => startOfIstDay(Date.now()) - DAY, to: () => startOfIstDay(Date.now()) },
  week: { label: "Last 7 days", from: () => startOfIstDay(Date.now()) - 6 * DAY, to: () => Date.now() },
  month: { label: "Last 30 days", from: () => startOfIstDay(Date.now()) - 29 * DAY, to: () => Date.now() },
};
const LOSS_ORDER = ["breakdown", "setup", "unexplained", "other", "minor_stop", "speed", "defects", "startup"] as const;
const LOSS_COLOR: Record<string, string> = { breakdown: "bg-danger", setup: "bg-warning", unexplained: "bg-danger/50", other: "bg-warning/50", minor_stop: "bg-primary/60", speed: "bg-primary/30", defects: "bg-muted", startup: "bg-muted/50" };

/** OEE by machine, line, shift or day, with where the time went. */
export default function OeePage() {
  const [range, setRange] = useState("today");
  const [by, setBy] = useState("machine");
  const q = useQuery({
    queryKey: ["/mes/oee", range, by],
    queryFn: () => api<Oee>("/mes/oee", { query: { from: new Date(RANGES[range].from()).toISOString(), to: new Date(RANGES[range].to()).toISOString(), by } }),
    refetchInterval: 60000,
  });
  const total = q.data?.total;
  const lossTotal = total ? LOSS_ORDER.reduce((n, k) => n + total.losses[k], 0) : 0;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="OEE"
        description="Availability × performance × quality, from machine states and counted parts. Planned stops and shift breaks are not losses."
        actions={
          <span className="flex gap-2">
            <Select className="h-9 w-36" aria-label="Period" value={range} onChange={(e) => setRange(e.target.value)}>{Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
            <Select className="h-9 w-36" aria-label="Group by" value={by} onChange={(e) => setBy(e.target.value)}><option value="machine">By machine</option><option value="workCenter">By line</option><option value="shift">By shift</option><option value="day">By day</option></Select>
          </span>
        }
      />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {total && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[["OEE", total.oee], ["Availability", total.availability], ["Performance", total.performance], ["Quality", total.quality]].map(([l, v]) => (
            <Card key={l as string} className="p-4"><p className="text-sm text-muted">{l}</p><p className="text-3xl font-semibold tabular-nums">{pct(v as number | null)}</p></Card>
          ))}
        </div>
      )}
      {total && lossTotal > 0 && (
        <Card>
          <CardHeader title="Where the time went" description={`Planned production time ${duration(total.plannedSeconds)}; ${duration(total.idealSeconds)} of it was needed for the good and rejected parts made.`} />
          <div className="space-y-3 border-t border-border p-4">
            <div className="flex h-4 overflow-hidden rounded-full bg-surface-muted">
              {LOSS_ORDER.filter((k) => total.losses[k] > 0).map((k) => <div key={k} className={LOSS_COLOR[k]} style={{ width: `${(total.losses[k] / lossTotal) * 100}%` }} title={`${LOSS_LABEL[k]}: ${duration(total.losses[k])}`} />)}
            </div>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {LOSS_ORDER.map((k) => (
                <li key={k} className="flex items-center gap-2"><span className={`size-3 rounded-sm ${LOSS_COLOR[k]}`} aria-hidden /><span className="flex-1">{LOSS_LABEL[k]}</span><span className="tabular-nums">{duration(total.losses[k])}</span></li>
              ))}
            </ul>
          </div>
        </Card>
      )}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-2 font-medium">{by === "machine" ? "Machine" : by === "workCenter" ? "Line" : by === "shift" ? "Shift" : "Day"}</th><th className="px-4 py-2 text-right font-medium">OEE</th><th className="px-4 py-2 text-right font-medium">Avail.</th><th className="px-4 py-2 text-right font-medium">Perf.</th><th className="px-4 py-2 text-right font-medium">Quality</th><th className="px-4 py-2 text-right font-medium">Good / rej.</th><th className="px-4 py-2 text-right font-medium">Downtime</th><th className="px-4 py-2 text-right font-medium">Stops</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-4 py-2">{r.label}{r.noDataSeconds > r.windowSeconds / 2 && <span className="block text-xs text-muted">no data for {duration(r.noDataSeconds)}</span>}</td>
                  <td className={`px-4 py-2 text-right font-semibold tabular-nums ${r.targetOeePct && r.oee !== null && r.oee * 100 < r.targetOeePct ? "text-danger" : ""}`}>{pct(r.oee)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(r.availability)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(r.performance)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(r.quality)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Math.round(r.good)} / {Math.round(r.reject)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{duration(r.downtimeSeconds)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.stops}</td>
                </tr>
              ))}
              {!q.data.rows.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">No monitored machines in this period.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
