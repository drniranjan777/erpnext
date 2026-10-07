"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { SeriesChart } from "@/components/iot/series-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtValue, PURPOSES, SEVERITY_TONE, type AlarmRule, type Signal } from "@/lib/iot";

interface Series { signal: { code: string; name: string; unit: string | null; purpose: string }; bucketSeconds: number; points: { t: string; avg: number; min: number; max: number; last: number; n: number }[] }

const RANGES = { "1h": 3_600_000, "8h": 8 * 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 } as const;
const OPS = { above: "above", below: "below", outside: "outside the band", equals: "equal to" };

/** One signal: its history and its alarm limits. */
export default function SignalPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("iot.devices.manage");
  const [range, setRange] = useState<keyof typeof RANGES>("24h");
  const [rule, setRule] = useState({ name: "", op: "above", threshold: "", threshold2: "", delaySeconds: "60", severity: "warning", notify: true, createMaintenance: false });
  const [error, setError] = useState<string | null>(null);
  const series = useQuery({
    queryKey: ["/iot/signals", id, "series", range],
    queryFn: () => api<Series>(`/iot/signals/${id}/series`, { query: { from: new Date(Date.now() - RANGES[range]).toISOString(), points: 240 } }),
    refetchInterval: range === "1h" ? 10000 : 60000,
  });
  const signal = useQuery({ queryKey: ["/iot/signals"], queryFn: () => api<Signal[]>("/iot/signals"), select: (all) => all.find((s) => s.id === id) });
  const rules = useQuery({ queryKey: ["/iot/rules", id], queryFn: () => api<AlarmRule[]>("/iot/rules", { query: { signalId: id } }) });
  const s = signal.data;

  async function saveRule(body: Record<string, unknown>, ruleId?: string) {
    setError(null);
    try {
      await (ruleId ? api(`/iot/rules/${ruleId}`, { method: "PUT", body }) : api("/iot/rules", { body }));
      qc.invalidateQueries({ queryKey: ["/iot/rules", id] });
      if (!ruleId) setRule({ ...rule, name: "", threshold: "", threshold2: "" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const limits = (rules.data ?? []).filter((r) => r.isActive).flatMap((r) => [{ value: r.threshold, label: r.name }, ...(r.op === "outside" && r.threshold2 !== null ? [{ value: r.threshold2, label: `${r.name} (upper)` }] : [])]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={s ? `${s.name}` : "Signal"}
        description={s ? `${s.code} · ${PURPOSES[s.purpose] ?? s.purpose}${s.machineCode ? ` · ${s.machineCode} ${s.machineName}` : ""}` : undefined}
        actions={s && <span className="text-right"><span className="block text-2xl font-semibold tabular-nums">{fmtValue(s.lastValue, s.unit)}</span><span className="text-xs text-muted">{s.lastAt ? timeAgo(s.lastAt) : "no readings yet"}</span></span>}
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader
          title="History"
          description={series.data ? `Average per ${series.data.bucketSeconds >= 60 ? `${series.data.bucketSeconds / 60} min` : `${series.data.bucketSeconds} s`}, with the lowest and highest in each period shaded.` : undefined}
          action={<div className="flex gap-1">{(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => <Button key={r} size="sm" variant={r === range ? "primary" : "ghost"} onClick={() => setRange(r)}>{r}</Button>)}</div>}
        />
        <div className="border-t border-border p-4">{series.data && <SeriesChart points={series.data.points} unit={series.data.signal.unit} limits={limits} />}</div>
      </Card>
      <Card>
        <CardHeader title="Alarm limits" description="An alarm opens when the value stays beyond the limit for the delay, and clears when it comes back." />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {rules.data?.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <Badge tone={SEVERITY_TONE[r.severity]}>{r.severity}</Badge>
              <span className="font-medium">{r.name}</span>
              <span className="text-muted">{OPS[r.op]} {r.threshold}{r.op === "outside" ? `–${r.threshold2}` : ""} {r.unit ?? ""}{r.delaySeconds ? ` for ${r.delaySeconds} s` : ""}{r.createMaintenance ? " · raises a maintenance request" : ""}</span>
              {manage && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => saveRule({ signalId: id, name: r.name, op: r.op, threshold: r.threshold, threshold2: r.threshold2, delaySeconds: r.delaySeconds, severity: r.severity, notify: r.notify, createMaintenance: r.createMaintenance, isActive: !r.isActive }, r.id)}>{r.isActive ? "Turn off" : "Turn on"}</Button>}
            </li>
          ))}
          {rules.data && !rules.data.length && <li className="px-4 py-4 text-center text-muted">No limits set.</li>}
        </ul>
        {manage && (
          <form
            className="grid gap-3 border-t border-border p-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveRule({ signalId: id, name: rule.name, op: rule.op, threshold: Number(rule.threshold), threshold2: rule.op === "outside" ? Number(rule.threshold2) : null, delaySeconds: Number(rule.delaySeconds), severity: rule.severity, notify: rule.notify, createMaintenance: rule.createMaintenance });
            }}
          >
            <Field label="Name">{(p) => <Input {...p} value={rule.name} placeholder="Mould overheating" onChange={(e) => setRule({ ...rule, name: e.target.value })} />}</Field>
            <Field label="When the value is">{(p) => <Select {...p} value={rule.op} onChange={(e) => setRule({ ...rule, op: e.target.value })}>{Object.entries(OPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
            <div className="flex gap-2">
              <Field label={rule.op === "outside" ? "Low" : "Limit"}>{(p) => <Input {...p} type="number" step="any" value={rule.threshold} onChange={(e) => setRule({ ...rule, threshold: e.target.value })} />}</Field>
              {rule.op === "outside" && <Field label="High">{(p) => <Input {...p} type="number" step="any" value={rule.threshold2} onChange={(e) => setRule({ ...rule, threshold2: e.target.value })} />}</Field>}
            </div>
            <Field label="For at least (seconds)">{(p) => <Input {...p} type="number" min={0} value={rule.delaySeconds} onChange={(e) => setRule({ ...rule, delaySeconds: e.target.value })} />}</Field>
            <Field label="Severity">{(p) => <Select {...p} value={rule.severity} onChange={(e) => setRule({ ...rule, severity: e.target.value })}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></Select>}</Field>
            <div className="flex flex-col justify-end gap-1 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={rule.notify} onChange={(e) => setRule({ ...rule, notify: e.target.checked })} /> Notify</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={rule.createMaintenance} onChange={(e) => setRule({ ...rule, createMaintenance: e.target.checked })} /> Raise a maintenance request</label>
            </div>
            <div className="sm:col-span-3"><Button type="submit" disabled={rule.name.length < 2 || rule.threshold === ""}>Add limit</Button></div>
          </form>
        )}
      </Card>
    </div>
  );
}
