"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { QA } from "@/lib/quality";

interface Param { id: string; name: string; kind: "numeric" | "attribute"; unit: string | null; lowerLimit: string | null; upperLimit: string | null; plan: string; stage: string; itemId: string; itemCode: string; itemName: string; lots: number }
interface Point { label: string; value: number; rules: number[] }
interface Chart { name: string; limits: { center: number; ucl: number; lcl: number }; points: Point[] }
interface Capability { n: number; mean: number; sigmaWithin: number; sigmaOverall: number; cp: number | null; cpk: number | null; pp: number | null; ppk: number | null }
interface Spc { parameter: { name: string; unit: string | null; lowerLimit: string | null; upperLimit: string | null; kind: string }; type: string | null; subgroups: number; subgroupSize?: number | null; charts: Chart[]; capability: Capability | null }

const RULE = { 1: "Beyond 3σ", 2: "2 of 3 beyond 2σ", 3: "4 of 5 beyond 1σ", 4: "8 in a row on one side" } as const;

function ControlChart({ chart }: { chart: Chart }) {
  const W = 760;
  const H = 220;
  const pad = { l: 56, r: 16, t: 14, b: 34 };
  const vals = chart.points.map((p) => p.value);
  const lo = Math.min(chart.limits.lcl, ...vals);
  const hi = Math.max(chart.limits.ucl, ...vals);
  const span = hi - lo || 1;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - (lo - span * 0.08)) / (span * 1.16));
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * (i + 0.5)) / Math.max(1, chart.points.length);
  const line = (v: number, cls: string, label: string) => (
    <g>
      <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className={cls} strokeDasharray={label === "CL" ? undefined : "4 3"} />
      <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fill-muted text-[10px]">{label} {+v.toFixed(4)}</text>
    </g>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${chart.name} control chart`}>
      {line(chart.limits.ucl, "stroke-danger", "UCL")}
      {line(chart.limits.center, "stroke-success", "CL")}
      {line(chart.limits.lcl, "stroke-danger", "LCL")}
      <polyline fill="none" className="stroke-primary" strokeWidth="1.5" points={chart.points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
      {chart.points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={p.rules.length ? 4.5 : 3} className={p.rules.length ? "fill-danger" : "fill-primary"}>
            <title>{`${p.label}: ${p.value}${p.rules.length ? ` · ${p.rules.map((r) => RULE[r as keyof typeof RULE]).join(", ")}` : ""}`}</title>
          </circle>
          {chart.points.length <= 30 && <text x={x(i)} y={H - pad.b + 14} textAnchor="middle" className="fill-muted text-[9px]">{p.label.slice(0, 8)}</text>}
        </g>
      ))}
    </svg>
  );
}

const capTone = (v: number | null) => (v === null ? "neutral" : v >= 1.33 ? "success" : v >= 1 ? "warning" : "danger");

export default function SpcPage() {
  const params = useQuery({ queryKey: [QA, "spc", "params"], queryFn: () => api<Param[]>(`${QA}/spc/parameters`) });
  const [paramId, setParamId] = useState("");
  const [limit, setLimit] = useState("30");
  const [kind, setKind] = useState("");
  const chosen = params.data?.find((p) => p.id === paramId) ?? params.data?.[0];
  const q = useQuery({ queryKey: [QA, "spc", chosen?.id, limit, kind], queryFn: () => api<Spc>(`${QA}/spc`, { query: { parameterId: chosen!.id, limit, chart: kind || undefined } }), enabled: !!chosen });
  const d = q.data;
  const signals = d?.charts.flatMap((c) => c.points.filter((p) => p.rules.length).map((p) => ({ chart: c.name, ...p }))) ?? [];
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Statistical process control" description="Control charts from inspection readings: each inspection lot is a subgroup. Measured characteristics get X-bar R (or S, or I-MR) with capability; pass / fail ones a p, np, c or u chart. Points breaking a Western Electric rule are marked." />
      {params.isLoading && <LoadingBlock />}
      {params.error && <ErrorBlock error={params.error} />}
      {params.data && !params.data.length && <EmptyState title="No readings yet" description="Charts appear once inspections have readings against a plan's characteristics." />}
      {chosen && (
        <Card className="flex flex-wrap gap-4 p-4">
          <Field label="Characteristic" className="min-w-80">{(p) => <Select {...p} value={chosen.id} onChange={(e) => { setParamId(e.target.value); setKind(""); }}>{params.data!.map((x) => <option key={x.id} value={x.id}>{x.itemCode} · {x.plan} · {x.name} ({x.lots} lots)</option>)}</Select>}</Field>
          <Field label="Last">{(p) => <Select {...p} value={limit} onChange={(e) => setLimit(e.target.value)}>{["10", "30", "60", "100"].map((n) => <option key={n} value={n}>{n} lots</option>)}</Select>}</Field>
          {chosen.kind === "attribute" && <Field label="Chart">{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Automatic</option><option value="p">p: proportion defective</option><option value="np">np: number defective</option><option value="c">c: defects</option><option value="u">u: defects per unit</option></Select>}</Field>}
        </Card>
      )}
      {q.isLoading && chosen && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {d && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="primary">{d.type ?? "Not enough data"}</Badge>
            <span className="text-muted">{d.subgroups} lots{d.subgroupSize ? ` of ${d.subgroupSize}` : ""}{d.parameter.lowerLimit || d.parameter.upperLimit ? ` · spec ${d.parameter.lowerLimit ?? "…"} – ${d.parameter.upperLimit ?? "…"}${d.parameter.unit ? ` ${d.parameter.unit}` : ""}` : ""}</span>
          </div>
          {d.capability && (
            <div className="grid gap-3 sm:grid-cols-6">
              {(["cp", "cpk", "pp", "ppk"] as const).map((k) => (
                <Card key={k} className="p-4"><p className="text-xs uppercase tracking-wide text-muted">{k.toUpperCase().replace("K", "k")}</p><p className="mt-1 text-xl font-semibold tabular-nums">{d.capability![k] ?? "–"}</p>{d.capability![k] !== null && <Badge tone={capTone(d.capability![k])}>{d.capability![k]! >= 1.33 ? "Capable" : d.capability![k]! >= 1 ? "Marginal" : "Not capable"}</Badge>}</Card>
              ))}
              <Card className="p-4"><p className="text-xs uppercase tracking-wide text-muted">Mean</p><p className="mt-1 text-xl font-semibold tabular-nums">{d.capability.mean}</p></Card>
              <Card className="p-4"><p className="text-xs uppercase tracking-wide text-muted">σ within / overall</p><p className="mt-1 text-lg font-semibold tabular-nums">{d.capability.sigmaWithin} / {d.capability.sigmaOverall}</p></Card>
            </div>
          )}
          {d.charts.map((c) => (
            <Card key={c.name}>
              <CardHeader title={c.name} />
              <div className="border-t border-border p-4"><ControlChart chart={c} /></div>
            </Card>
          ))}
          {signals.length > 0 && (
            <Card>
              <CardHeader title="Out-of-control signals" />
              <ul className="divide-y divide-border border-t border-border text-sm">
                {signals.map((s, i) => <li key={i} className="px-5 py-2"><span className="font-mono">{s.label}</span> · {s.chart}: {s.value} · {s.rules.map((r) => RULE[r as keyof typeof RULE]).join(", ")}</li>)}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
