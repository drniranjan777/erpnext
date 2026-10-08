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
import { DataTable } from "@/components/ui/data-table";

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
            <DataTable
              rows={oee.data}
              rowKey={(m) => String(m.machine.id)}
              exportName="maintenance-reliability"
              storageKey="maintenance-reliability-0"
              empty={<p className="px-4 py-6 text-center text-sm text-muted">No machines.</p>}
              columns={[
                { key: "machine", label: "Machine", locked: true, className: "whitespace-normal", render: (m) => <><span className="font-mono text-xs">{m.machine.code}</span> {m.machine.name}<span className="block text-xs text-muted">{m.good} good · {m.rejected} rejected</span></> },
                { key: "availability", label: "Availability", align: "right", render: (m) => <>{p(m.availabilityPct)}</> },
                { key: "performance", label: "Performance", align: "right", render: (m) => <>{p(m.performancePct)}</> },
                { key: "quality", label: "Quality", align: "right", render: (m) => <>{p(m.qualityPct)}</> },
                { key: "oee", label: "OEE", align: "right", render: (m) => <><Badge tone={tone(m.oeePct)}>{p(m.oeePct)}</Badge></> },
                { key: "losses-h", label: "Losses (h)", className: "text-xs text-muted whitespace-normal", render: (m) => <>breakdown {Math.round(m.losses.breakdownMinutes / 6) / 10} · speed {Math.round(m.losses.speedMinutes / 6) / 10} · quality {Math.round(m.losses.qualityMinutes / 6) / 10} · idle {Math.round(m.losses.idleMinutes / 6) / 10}</> },
              ]}
            />
          </div>
        </Card>
      )}
      {rel.data && (
        <Card>
          <CardHeader title="Reliability by asset" />
          <div className="overflow-x-auto border-t border-border">
            <DataTable
              rows={rel.data}
              rowKey={(r) => String(r.asset.id)}
              exportName="maintenance-reliability"
              storageKey="maintenance-reliability-1"
              columns={[
                { key: "asset", label: "Asset", locked: true, className: "whitespace-normal", render: (r) => <><span className="font-mono text-xs">{r.asset.code}</span> {r.asset.name} <Badge tone={r.asset.criticality === "A" ? "danger" : "neutral"}>{r.asset.criticality}</Badge></> },
                { key: "failures", label: "Failures", align: "right", render: (r) => <>{r.failures}</> },
                { key: "downtime", label: "Downtime", align: "right", render: (r) => <>{r.downtimeHours} h</> },
                { key: "mttr", label: "MTTR", align: "right", render: (r) => <>{r.mttrHours === null ? "–" : `${r.mttrHours} h`}</> },
                { key: "mtbf", label: "MTBF", align: "right", render: (r) => <>{r.mtbfHours === null ? "–" : `${r.mtbfHours} h`}</> },
                { key: "availability", label: "Availability", align: "right", render: (r) => <>{p(r.availabilityPct)}</> },
                { key: "cost-breakdown-planned", label: "Cost (breakdown · planned)", align: "right", render: (r) => <>{formatMoney(r.breakdownCost)} · {formatMoney(r.plannedCost)}</> },
              ]}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
