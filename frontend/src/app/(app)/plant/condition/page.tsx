"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtValue } from "@/lib/iot";
import { askConfirm, askText } from "@/components/ui/ask";
import { DataTable } from "@/components/ui/data-table";

interface Model { signalId: string; code: string; name: string; purpose: string; unit: string | null; machineCode: string | null; lastValue: number | null; id: string | null; enabled: boolean; minSamples: number | null; zThreshold: number | null; consecutive: number | null; driftThreshold: number | null; createMaintenance: boolean | null; n: number | null; mean: number | null; std: number | null; lastScore: number | null; learned: boolean | null; openAnomalies: number }
interface Anomaly { id: string; kind: string; raisedAt: string; value: number; score: number; baselineMean: number; baselineStd: number; clearedAt: string | null; maintenanceOrderId: string | null; feedback: string | null; feedbackNote: string | null; feedbackBy: string | null; signalId: string; signalCode: string; unit: string | null; machineCode: string | null; machineName: string | null }
interface Anomalies { rows: Anomaly[]; summary: { total: number; confirmed: number; falseAlarms: number; withMaintenance: number; precisionPct: number | null } }

const DEFAULTS = { enabled: true, minSamples: 200, zThreshold: 4, consecutive: 3, driftThreshold: 2.5, createMaintenance: true };

/** Condition monitoring: each signal learns its normal behaviour; spikes and drift raise maintenance requests. */
export default function ConditionPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("iot.devices.manage");
  const [status, setStatus] = useState<"open" | "all">("open");
  const [error, setError] = useState<string | null>(null);
  const models = useQuery({ queryKey: ["/plant/condition/models"], queryFn: () => api<Model[]>("/plant/condition/models"), refetchInterval: 30000 });
  const anomalies = useQuery({ queryKey: ["/plant/condition/anomalies", status], queryFn: () => api<Anomalies>("/plant/condition/anomalies", { query: { status } }), refetchInterval: 30000 });
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["/plant/condition"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const cfg = (m: Model) => ({ enabled: m.enabled, minSamples: m.minSamples ?? DEFAULTS.minSamples, zThreshold: m.zThreshold ?? DEFAULTS.zThreshold, consecutive: m.consecutive ?? DEFAULTS.consecutive, driftThreshold: m.driftThreshold ?? DEFAULTS.driftThreshold, createMaintenance: m.createMaintenance ?? DEFAULTS.createMaintenance });
  const s = anomalies.data?.summary;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Condition monitoring" description="Each monitored signal learns its normal level and spread from its first readings. A reading far outside it several times in a row (a spike), or a steady move away from it (drift), raises a maintenance request on the machine's asset. Mark each one as confirmed or a false alarm so the hit rate is known." />
      {error && <Alert>{error}</Alert>}
      {s && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Card className="p-4"><p className="text-sm text-muted">Anomalies (90 days)</p><p className="text-2xl font-semibold">{s.total}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted">Confirmed</p><p className="text-2xl font-semibold">{s.confirmed}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted">False alarms</p><p className="text-2xl font-semibold">{s.falseAlarms}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted">Hit rate</p><p className="text-2xl font-semibold">{s.precisionPct === null ? "–" : `${s.precisionPct} %`}</p></Card>
        </div>
      )}
      <Card>
        <CardHeader title="Anomalies" action={<Select className="h-9 w-44" aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value as "open" | "all")}><option value="open">Needing attention</option><option value="all">All</option></Select>} />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {anomalies.data?.rows.map((a) => (
            <li key={a.id} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={a.kind === "spike" ? "danger" : "warning"}>{a.kind}</Badge>
                {a.clearedAt ? <Badge tone="success">back to normal</Badge> : <Badge tone="danger">active</Badge>}
                <span className="font-medium">{a.machineCode ? `${a.machineCode} ${a.machineName}` : a.signalCode}</span>
                <span className="ml-auto text-xs text-muted">{formatDateTime(a.raisedAt)}</span>
              </div>
              <p>{a.signalCode} at {fmtValue(a.value, a.unit)}; normal {fmtValue(a.baselineMean, a.unit)} ± {a.baselineStd} ({Math.abs(a.score)} standard deviations).{a.maintenanceOrderId && <> <Link className="text-primary hover:underline" href={`/maintenance/orders/${a.maintenanceOrderId}`}>Maintenance request</Link>.</>}</p>
              {a.feedback ? (
                <p className="text-xs text-muted">{a.feedback === "confirmed" ? "Confirmed" : "False alarm"} by {a.feedbackBy ?? "–"}{a.feedbackNote ? `: ${a.feedbackNote}` : ""}</p>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={async () => { const note = await askText("What was found? (optional)"); if (note !== null) run(() => api(`/plant/condition/anomalies/${a.id}/feedback`, { body: { feedback: "confirmed", note: note || null } })); }}>Confirmed</Button>
                  <Button size="sm" variant="ghost" onClick={() => run(() => api(`/plant/condition/anomalies/${a.id}/feedback`, { body: { feedback: "false_alarm" } }))}>False alarm</Button>
                </div>
              )}
            </li>
          ))}
          {anomalies.data && !anomalies.data.rows.length && <li className="px-4 py-8 text-center text-muted">Nothing needs attention.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Monitored signals" description="Vibration, temperature, current, pressure and speed signals. The baseline is fixed once learned: relearn it after maintenance or a change in the process." />
        <DataTable
          rows={models.data ?? []}
          rowKey={(m) => String(m.signalId)}
          exportName="plant-condition"
          storageKey="plant-condition-0"
          empty={<p className="px-4 py-6 text-center text-sm text-muted">No measured signals yet.</p>}
          columns={[
            { key: "signal", label: "Signal", locked: true, className: "whitespace-normal", render: (m) => <><Link className="font-mono text-xs text-primary hover:underline" href={`/iot/signals/${m.signalId}`}>{m.code}</Link><p>{m.name}{m.machineCode ? ` · ${m.machineCode}` : ""}</p></> },
            { key: "normal", label: "Normal", className: "text-xs whitespace-normal", render: (m) => <>{!m.enabled ? "Not monitored" : !m.learned ? `Learning: ${m.n ?? 0} of ${m.minSamples} readings` : `${fmtValue(m.mean, m.unit)} ± ${Math.round((m.std ?? 0) * 1000) / 1000}`}</> },
            { key: "now", label: "Now", align: "right", render: (m) => <>{fmtValue(m.lastValue, m.unit)}{m.learned && m.lastScore !== null && <span className="block text-xs text-muted">{m.lastScore} σ</span>}{m.openAnomalies > 0 && <Badge tone="danger">anomaly</Badge>}</> },
            { key: "col3", label: "", align: "right", noSort: true, render: (m) => <>{manage && (
                              <span className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => run(() => api(`/plant/condition/models/${m.signalId}`, { method: "PUT", body: { ...cfg(m), enabled: !m.enabled } }))}>{m.enabled ? "Stop" : "Monitor"}</Button>
                                {m.enabled && m.id && <Button size="sm" variant="ghost" onClick={async () => await askConfirm("Forget the learned baseline and learn it again from the next readings?") && run(() => api(`/plant/condition/models/${m.signalId}/relearn`, { body: cfg(m) }))}>Relearn</Button>}
                              </span>
                            )}</> },
          ]}
        />
      </Card>
    </div>
  );
}
