"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime, timeAgo } from "@/components/ui/page";
import { api } from "@/lib/api";
import { fmtValue } from "@/lib/iot";

interface Logger { id: string; code: string; name: string; unit: string | null; purpose: string; warehouseName: string | null; vehicleNo: string | null; lastValue: number | null; lastAt: string | null; range: { low: number | null; high: number | null }; status: "ok" | "out_of_range" | "no_data"; last24h: { min: number | null; max: number | null; mktC: number | null; minutesOutside: number; excursions: number } }
interface Report { logger: { code: string; name: string; unit: string | null }; range: { low: number | null; high: number | null }; readings: number; min: number | null; max: number | null; avg: number | null; mktC: number | null; minutesOutside: number; excursions: { start: string; end: string; minutes: number; direction: string; worst: number }[] }

const STATUS = { ok: ["success", "in range"], out_of_range: ["danger", "out of range"], no_data: ["neutral", "no data for 15 min"] } as const;

/** Cold chain: temperature and humidity loggers in stores and vehicles, with excursion reports. */
export default function ColdChainPage() {
  const loggers = useQuery({ queryKey: ["/plant/cold-chain"], queryFn: () => api<Logger[]>("/plant/cold-chain"), refetchInterval: 30000 });
  const [pick, setPick] = useState<string>("");
  const [days, setDays] = useState("1");
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  const report = useQuery({
    queryKey: ["/plant/cold-chain/report", pick, days, low, high],
    queryFn: () => api<Report>("/plant/cold-chain/report", { query: { signalId: pick, from: new Date(Date.now() - Number(days) * 86_400_000).toISOString(), ...(low !== "" ? { low } : {}), ...(high !== "" ? { high } : {}) } }),
    enabled: !!pick,
  });
  const r = report.data;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Cold chain" description="Loggers are signals measuring temperature or humidity, linked to a store or a vehicle. The acceptable range is the logger's 'outside' alarm limit. Trips show the readings of the loggers in their vehicle." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {loggers.data?.map((l) => (
          <button key={l.id} type="button" onClick={() => setPick(l.id)} className={`rounded-xl border p-4 text-left hover:bg-surface-muted ${pick === l.id ? "border-primary" : "border-border"}`}>
            <div className="flex items-center gap-2">
              <span className="font-medium">{l.name}</span>
              <Badge tone={STATUS[l.status][0]} className="ml-auto">{STATUS[l.status][1]}</Badge>
            </div>
            <p className="text-xs text-muted">{l.warehouseName ?? `Vehicle ${l.vehicleNo}`} · {l.range.low !== null || l.range.high !== null ? `range ${l.range.low ?? "–"} to ${l.range.high ?? "–"}` : "no range set"}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{fmtValue(l.lastValue, l.unit)}</p>
            <p className="text-xs text-muted">{l.lastAt ? timeAgo(l.lastAt) : "never"} · 24 h: {l.last24h.min ?? "–"} to {l.last24h.max ?? "–"}{l.last24h.mktC !== null ? `, MKT ${l.last24h.mktC} °C` : ""}{l.last24h.excursions ? `, ${l.last24h.excursions} excursion(s) (${l.last24h.minutesOutside} min)` : ""}</p>
          </button>
        ))}
        {loggers.data && !loggers.data.length && <p className="text-muted">No loggers yet. Add a temperature or humidity signal and link it to a store or vehicle.</p>}
      </div>
      {pick && (
        <Card>
          <CardHeader
            title={r ? `Report: ${r.logger.name}` : "Report"}
            action={
              <span className="flex flex-wrap gap-2">
                <Select className="h-9 w-32" aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)}><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option></Select>
                <Input className="h-9 w-24" type="number" step="any" aria-label="Low limit" placeholder="Low" value={low} onChange={(e) => setLow(e.target.value)} />
                <Input className="h-9 w-24" type="number" step="any" aria-label="High limit" placeholder="High" value={high} onChange={(e) => setHigh(e.target.value)} />
              </span>
            }
          />
          {r && (
            <div className="space-y-3 border-t border-border p-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-5">
                <div><p className="text-xs text-muted">Readings</p><p className="font-semibold">{r.readings}</p></div>
                <div><p className="text-xs text-muted">Min / avg / max</p><p className="font-semibold">{r.min ?? "–"} / {r.avg ?? "–"} / {r.max ?? "–"} {r.logger.unit ?? ""}</p></div>
                <div><p className="text-xs text-muted">Mean kinetic temperature</p><p className="font-semibold">{r.mktC !== null ? `${r.mktC} °C` : "–"}</p></div>
                <div><p className="text-xs text-muted">Range</p><p className="font-semibold">{r.range.low ?? "–"} to {r.range.high ?? "–"}</p></div>
                <div><p className="text-xs text-muted">Time outside</p><p className={`font-semibold ${r.minutesOutside ? "text-danger" : ""}`}>{r.minutesOutside} min</p></div>
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {r.excursions.map((e) => <li key={e.start} className="flex gap-3 px-3 py-1.5"><Badge tone="danger">{e.direction}</Badge><span>{formatDateTime(e.start)} for {e.minutes} min</span><span className="ml-auto">worst {fmtValue(e.worst, r.logger.unit)}</span></li>)}
                {!r.excursions.length && <li className="px-3 py-3 text-center text-muted">No excursions in this period.</li>}
              </ul>
              <Link className="text-primary hover:underline" href={`/iot/signals/${pick}`}>Chart and alarm limits</Link>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
