"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatMoney, todayIST } from "@/lib/documents";
import { MT } from "@/lib/maintenance";

interface Rel { asset: { id: string; code: string; name: string; criticality: string }; failures: number; downtimeHours: number; mttrHours: number | null; mtbfHours: number | null; availabilityPct: number | null; breakdownCost: string; plannedCost: string }
interface Oee { machine: { id: string; code: string; name: string }; plannedMinutes: number; downtimeMinutes: number; bookedMinutes: number; good: number; rejected: number; availabilityPct: number | null; performancePct: number | null; qualityPct: number | null; oeePct: number | null; losses: { breakdownMinutes: number; speedMinutes: number; qualityMinutes: number; idleMinutes: number } }
const p = (v: number | null) => (v === null ? "–" : `${v}%`);
const tone = (v: number | null) => (v === null ? "neutral" : v >= 85 ? "success" : v >= 60 ? "warning" : "danger");

export default function ReliabilityPage() {
  const to0 = todayIST();
  const [range, setRange] = useState({ from: new Date(Date.parse(`${to0}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10), to: to0 });
  const rel = useQuery({ queryKey: [MT, "reliability", range], queryFn: () => api<Rel[]>(`${MT}/reliability`, { query: range }) });
  const oee = useQuery({ queryKey: [MT, "oee", range], queryFn: () => api<Oee[]>(`${MT}/oee`, { query: range }) });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Reliability and OEE" description="MTTR and MTBF from breakdown orders, maintenance cost per asset, and OEE per machine from job cards and downtime (availability × performance × quality) with its losses." />
      <Card className="flex flex-wrap gap-4 p-4">
        <Field label="From">{(f) => <Input {...f} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />}</Field>
        <Field label="To">{(f) => <Input {...f} type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />}</Field>
      </Card>
      {(rel.isLoading || oee.isLoading) && <LoadingBlock />}
      {rel.error && <ErrorBlock error={rel.error} />}
      {oee.data && (
        <Card>
          <CardHeader title="OEE by machine" description="World class is around 85%." />
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Machine</th><th className="px-4 py-2 text-right font-medium">Availability</th><th className="px-4 py-2 text-right font-medium">Performance</th><th className="px-4 py-2 text-right font-medium">Quality</th><th className="px-4 py-2 text-right font-medium">OEE</th><th className="px-4 py-2 font-medium">Losses (h)</th></tr></thead>
              <tbody className="divide-y divide-border">
                {oee.data.map((m) => (
                  <tr key={m.machine.id}>
                    <td className="px-4 py-2"><span className="font-mono text-xs">{m.machine.code}</span> {m.machine.name}<span className="block text-xs text-muted">{m.good} good · {m.rejected} rejected</span></td>
                    <td className="px-4 py-2 text-right tabular-nums">{p(m.availabilityPct)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p(m.performancePct)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p(m.qualityPct)}</td>
                    <td className="px-4 py-2 text-right"><Badge tone={tone(m.oeePct)}>{p(m.oeePct)}</Badge></td>
                    <td className="px-4 py-2 text-xs text-muted">breakdown {Math.round(m.losses.breakdownMinutes / 6) / 10} · speed {Math.round(m.losses.speedMinutes / 6) / 10} · quality {Math.round(m.losses.qualityMinutes / 6) / 10} · idle {Math.round(m.losses.idleMinutes / 6) / 10}</td>
                  </tr>
                ))}
                {!oee.data.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No machines.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {rel.data && (
        <Card>
          <CardHeader title="Reliability by asset" />
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Asset</th><th className="px-4 py-2 text-right font-medium">Failures</th><th className="px-4 py-2 text-right font-medium">Downtime</th><th className="px-4 py-2 text-right font-medium">MTTR</th><th className="px-4 py-2 text-right font-medium">MTBF</th><th className="px-4 py-2 text-right font-medium">Availability</th><th className="px-4 py-2 text-right font-medium">Cost (breakdown · planned)</th></tr></thead>
              <tbody className="divide-y divide-border">
                {rel.data.map((r) => (
                  <tr key={r.asset.id}>
                    <td className="px-4 py-2"><span className="font-mono text-xs">{r.asset.code}</span> {r.asset.name} <Badge tone={r.asset.criticality === "A" ? "danger" : "neutral"}>{r.asset.criticality}</Badge></td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.failures}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.downtimeHours} h</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.mttrHours === null ? "–" : `${r.mttrHours} h`}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.mtbfHours === null ? "–" : `${r.mtbfHours} h`}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p(r.availabilityPct)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.breakdownCost)} · {formatMoney(r.plannedCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
