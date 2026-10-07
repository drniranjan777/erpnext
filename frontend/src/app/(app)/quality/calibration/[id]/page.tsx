"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { GaugeDialog } from "@/components/quality/gauge-dialog";
import { Info } from "@/components/documents/doc-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { QMS, type Gauge, type GrrResult } from "@/lib/qms";

interface Cal { id: string; calibratedOn: string; calibratedBy: string; certificateNo: string | null; result: "pass" | "adjusted" | "fail"; points: { nominal: string; actual: string; error: string }[]; nextDue: string | null; notes: string | null }
interface Study { id: string; studyDate: string; characteristic: string; tolerance: string | null; operators: string[]; result: GrrResult }
interface GaugeView extends Gauge { calibrations: Cal[]; studies: Study[] }
const RESULT = { pass: "success", adjusted: "warning", fail: "danger" } as const;
const VERDICT = { acceptable: "success", marginal: "warning", unacceptable: "danger" } as const;

export default function GaugePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const manage = can("quality.calibration.manage");
  const q = useQuery({ queryKey: [QMS, "gauges", id], queryFn: () => api<GaugeView>(`${QMS}/gauges/${id}`) });
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const g = q.data!;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`${g.code} ${g.name}`} description={g.status === "in_use" ? `Calibrated every ${g.intervalDays} days${g.nextDue ? `; next due ${formatDate(g.nextDue)}` : ""}.` : "Out of service: do not use for inspection."} actions={<span className="flex gap-2"><Link href="/quality/calibration" className="text-sm underline">All gauges</Link>{manage && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}</span>} />
      {editing && <GaugeDialog gauge={g} onClose={() => setEditing(false)} />}
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Kind" value={g.kind} />
          <Info label="Range · least count" value={`${g.range ?? "–"} · ${g.leastCount ?? "–"}`} />
          <Info label="Make · serial" value={`${g.make ?? "–"} · ${g.serialNo ?? "–"}`} />
          <Info label="Location" value={g.location ?? "–"} />
          <Info label="Calibrated" value={g.calibrationSource === "external" ? "By an accredited lab" : "In-house"} />
          <Info label="Acceptance" value={g.acceptance ?? "–"} />
          <Info label="Status" value={<Badge tone={g.status === "in_use" ? "success" : "danger"}>{g.status.replace(/_/g, " ")}</Badge>} />
        </dl>
      </Card>
      {manage && g.status !== "scrapped" && <CalibrationForm gauge={g} />}
      <Card>
        <CardHeader title="Calibration history" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {g.calibrations.map((c) => (
            <li key={c.id} className="space-y-1 px-5 py-3">
              <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{formatDate(c.calibratedOn)}</span><Badge tone={RESULT[c.result]}>{c.result}</Badge><span className="text-muted">{c.calibratedBy}{c.certificateNo && ` · certificate ${c.certificateNo}`}{c.nextDue && ` · next due ${formatDate(c.nextDue)}`}</span></p>
              {c.points.length > 0 && <p className="text-xs text-muted">{c.points.map((p) => `${p.nominal} → ${p.actual} (${Number(p.error) > 0 ? "+" : ""}${p.error})`).join(" · ")}</p>}
              {c.notes && <p className="text-xs">{c.notes}</p>}
            </li>
          ))}
          {!g.calibrations.length && <li className="px-5 py-3 text-muted">No calibrations recorded.</li>}
        </ul>
      </Card>
      {manage && <GrrForm gaugeId={g.id} />}
      <Card>
        <CardHeader title="Gauge R&R studies" description="< 10 % acceptable, 10–30 % marginal, > 30 % unacceptable; ndc ≥ 5 wanted." />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {g.studies.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="font-medium">{formatDate(s.studyDate)}</span>
              <span>{s.characteristic}</span>
              <Badge tone={VERDICT[s.result.verdict]}>{s.result.verdict}</Badge>
              <span className="text-muted">%GRR {s.result.pctGrr}{s.result.pctTolerance !== null && ` · %tolerance ${s.result.pctTolerance}`} · ndc {s.result.ndc} · EV {s.result.pctEv}% AV {s.result.pctAv}% PV {s.result.pctPv}%</span>
              <span className="text-xs text-muted">{s.result.operators} operators × {s.result.parts} parts × {s.result.trials} trials</span>
            </li>
          ))}
          {!g.studies.length && <li className="px-5 py-3 text-muted">No studies.</li>}
        </ul>
      </Card>
    </div>
  );
}

function CalibrationForm({ gauge }: { gauge: Gauge }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ calibratedOn: todayIST(), calibratedBy: "", certificateNo: "", result: "pass", nextDue: "", notes: "" });
  const [points, setPoints] = useState([{ nominal: "", actual: "" }]);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${QMS}/gauges/${gauge.id}/calibrations`, { body: { ...f, certificateNo: f.certificateNo || null, nextDue: f.nextDue || null, notes: f.notes || null, points: points.filter((p) => p.nominal && p.actual) } });
      setF({ ...f, calibratedBy: "", certificateNo: "", nextDue: "", notes: "" });
      setPoints([{ nominal: "", actual: "" }]);
      qc.invalidateQueries({ queryKey: [QMS, "gauges"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <CardHeader title="Record a calibration" />
      <div className="space-y-3 border-t border-border p-5">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Calibrated on">{(p) => <Input {...p} type="date" value={f.calibratedOn} onChange={(e) => setF({ ...f, calibratedOn: e.target.value })} />}</Field>
          <Field label="By" required>{(p) => <Input {...p} placeholder="Lab or person" value={f.calibratedBy} onChange={(e) => setF({ ...f, calibratedBy: e.target.value })} />}</Field>
          <Field label="Certificate no.">{(p) => <Input {...p} value={f.certificateNo} onChange={(e) => setF({ ...f, certificateNo: e.target.value })} />}</Field>
          <Field label="Result">{(p) => <Select {...p} value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option value="pass">Pass</option><option value="adjusted">Adjusted and passed</option><option value="fail">Fail (take out of service)</option></Select>}</Field>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Points checked</p>
          {points.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="h-9 w-32" aria-label="Nominal" placeholder="Nominal" inputMode="decimal" value={p.nominal} onChange={(e) => setPoints(points.map((x, j) => (j === i ? { ...x, nominal: e.target.value } : x)))} />
              <Input className="h-9 w-32" aria-label="Actual" placeholder="Actual" inputMode="decimal" value={p.actual} onChange={(e) => setPoints(points.map((x, j) => (j === i ? { ...x, actual: e.target.value } : x)))} />
              {p.nominal && p.actual && <span className="text-xs text-muted">error {+(Number(p.actual) - Number(p.nominal)).toFixed(6)}</span>}
              {points.length > 1 && <Button size="sm" variant="ghost" aria-label="Remove point" onClick={() => setPoints(points.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>}
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setPoints([...points, { nominal: "", actual: "" }])}><Plus className="size-4" aria-hidden /> Point</Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Next due" hint={`Blank = ${gauge.intervalDays} days on`}>{(p) => <Input {...p} type="date" value={f.nextDue} onChange={(e) => setF({ ...f, nextDue: e.target.value })} />}</Field>
          <Field label="Notes" className="min-w-64 flex-1">{(p) => <Input {...p} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
          <Button onClick={save} disabled={f.calibratedBy.trim().length < 2}>Record</Button>
        </div>
      </div>
    </Card>
  );
}

function GrrForm({ gaugeId }: { gaugeId: string }) {
  const qc = useQueryClient();
  const [shape, setShape] = useState({ operators: 3, parts: 5, trials: 2 });
  const [names, setNames] = useState(["", "", ""]);
  const [f, setF] = useState({ studyDate: todayIST(), characteristic: "", tolerance: "" });
  const [cells, setCells] = useState<Record<string, string>>({});
  const [result, setResult] = useState<GrrResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = (o: number, p: number, t: number) => `${o}-${p}-${t}`;
  async function run() {
    setError(null);
    const measurements = Array.from({ length: shape.operators }, (_, o) => Array.from({ length: shape.parts }, (_, p) => Array.from({ length: shape.trials }, (_, t) => Number(cells[key(o, p, t)]))));
    if (measurements.flat(2).some((v) => Number.isNaN(v) || cells[key(0, 0, 0)] === undefined)) return setError("Fill in every reading");
    try {
      const s = await api<{ result: GrrResult }>(`${QMS}/gauges/${gaugeId}/grr`, { body: { ...f, tolerance: f.tolerance || null, operators: names.slice(0, shape.operators).map((n, i) => n || `Operator ${i + 1}`), measurements } });
      setResult(s.result);
      qc.invalidateQueries({ queryKey: [QMS, "gauges", gaugeId] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <CardHeader title="New gauge R&R study" description="Each operator measures each part, the same number of times, in random order." />
      <div className="space-y-3 border-t border-border p-5">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-6">
          <Field label="Date">{(p) => <Input {...p} type="date" value={f.studyDate} onChange={(e) => setF({ ...f, studyDate: e.target.value })} />}</Field>
          <Field label="Characteristic" className="sm:col-span-2">{(p) => <Input {...p} value={f.characteristic} onChange={(e) => setF({ ...f, characteristic: e.target.value })} />}</Field>
          <Field label="Tolerance (USL − LSL)">{(p) => <Input {...p} inputMode="decimal" value={f.tolerance} onChange={(e) => setF({ ...f, tolerance: e.target.value })} />}</Field>
          <Field label="Operators / parts / trials">{(p) => <Select {...p} value={`${shape.operators}-${shape.parts}-${shape.trials}`} onChange={(e) => { const [o, pa, t] = e.target.value.split("-").map(Number); setShape({ operators: o, parts: pa, trials: t }); setCells({}); }}>{["3-10-3", "3-10-2", "3-5-2", "2-10-2", "2-5-2"].map((s) => <option key={s} value={s}>{s.replace(/-/g, " / ")}</option>)}</Select>}</Field>
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead><tr><th className="px-2 py-1 text-left text-xs text-muted">Operator</th><th className="px-2 py-1 text-left text-xs text-muted">Trial</th>{Array.from({ length: shape.parts }, (_, p) => <th key={p} className="px-1 py-1 text-xs text-muted">Part {p + 1}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: shape.operators }, (_, o) =>
                Array.from({ length: shape.trials }, (_, t) => (
                  <tr key={`${o}-${t}`}>
                    <td className="px-2 py-1">{t === 0 && <Input className="h-8 w-28" aria-label={`Operator ${o + 1} name`} placeholder={`Operator ${o + 1}`} value={names[o] ?? ""} onChange={(e) => setNames(names.map((n, j) => (j === o ? e.target.value : n)))} />}</td>
                    <td className="px-2 py-1 text-xs text-muted">{t + 1}</td>
                    {Array.from({ length: shape.parts }, (_, p) => <td key={p} className="px-1 py-1"><Input className="h-8 w-20 text-right" inputMode="decimal" aria-label={`Operator ${o + 1}, part ${p + 1}, trial ${t + 1}`} value={cells[key(o, p, t)] ?? ""} onChange={(e) => setCells({ ...cells, [key(o, p, t)]: e.target.value })} /></td>)}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end"><Button onClick={run} disabled={!f.characteristic.trim()}>Calculate and save</Button></div>
        {result && <Alert tone={result.verdict === "acceptable" ? "success" : "danger"}>%GRR {result.pctGrr}{result.pctTolerance !== null && `, %tolerance ${result.pctTolerance}`}, ndc {result.ndc}: {result.verdict}.</Alert>}
      </div>
    </Card>
  );
}
