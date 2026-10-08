"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Gateway } from "@/lib/iot";
import { askText } from "@/components/ui/ask";

interface Model { id: string; name: string; version: string; classes: string[]; minConfidence: number; artifactUrl: string | null; validation: { precision?: number; recall?: number; samples?: number } | null; status: string; deployedAt: string | null; deployments: { gatewayCode: string; status: string | null; result: string | null }[] }
interface Stats { total: number; defects: number; defectRatePct: number | null; avgConfidence: number | null; uncertainPct: number | null; byClass: { defectClass: string; count: number }[]; reviewed: number; accuracyPct: number | null; falseRejects: number; escapes: number }
interface Monitor { id: string; name: string; version: string; status: string; validation: Model["validation"]; recent: Stats; baseline: Stats; drift: string[]; machines: (Stats & { machineCode: string })[] }
interface Inspection { id: string; ts: string; result: string; defectClass: string | null; confidence: number; imageUrl: string | null; review: string | null; actualClass: string | null; machineCode: string | null; modelName: string | null; modelVersion: string | null; workOrderNumber: string | null }

/** Vision inspection on the edge: model versions, results from the line, reviews and model health. */
export default function VisionPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("vision.models.manage");
  const models = useQuery({ queryKey: ["/vision/models"], queryFn: () => api<Model[]>("/vision/models") });
  const monitor = useQuery({ queryKey: ["/vision/monitoring"], queryFn: () => api<Monitor[]>("/vision/monitoring"), refetchInterval: 60000 });
  const [filter, setFilter] = useState("toReview");
  const inspections = useQuery({ queryKey: ["/vision/inspections", filter], queryFn: () => api<Inspection[]>("/vision/inspections", { query: filter === "toReview" ? { toReview: "true" } : filter === "defect" ? { result: "defect" } : {} }), refetchInterval: 30000 });
  const [creating, setCreating] = useState(false);
  const [deploying, setDeploying] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["/vision"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Vision inspection" description="Camera inspection runs on the edge gateway next to the line. Models are versioned and sent to gateways from here; results come back with the defect found and how sure the model is. Review doubtful results so accuracy is measured." actions={manage && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> Register model</Button>} />
      {error && <Alert>{error}</Alert>}
      {monitor.data?.map((m) => (
        <Card key={m.id}>
          <CardHeader title={`${m.name} ${m.version}`} description={m.validation ? `Validation: precision ${Math.round((m.validation.precision ?? 0) * 100)} %, recall ${Math.round((m.validation.recall ?? 0) * 100)} % on ${m.validation.samples ?? "–"} images` : undefined} action={<Badge tone={m.status === "deployed" ? "success" : "neutral"}>{m.status}</Badge>} />
          <div className="grid gap-3 border-t border-border p-4 text-sm sm:grid-cols-5">
            <div><p className="text-xs text-muted">Inspected (24 h)</p><p className="text-xl font-semibold">{m.recent.total}</p></div>
            <div><p className="text-xs text-muted">Defect rate</p><p className="text-xl font-semibold">{m.recent.defectRatePct ?? "–"} %</p><p className="text-xs text-muted">7 days before: {m.baseline.defectRatePct ?? "–"} %</p></div>
            <div><p className="text-xs text-muted">Average confidence</p><p className="text-xl font-semibold">{m.recent.avgConfidence ?? "–"}</p><p className="text-xs text-muted">uncertain {m.recent.uncertainPct ?? "–"} %</p></div>
            <div><p className="text-xs text-muted">Reviewed accuracy</p><p className="text-xl font-semibold">{m.recent.accuracyPct ?? "–"} %</p><p className="text-xs text-muted">{m.recent.reviewed} reviewed · {m.recent.falseRejects} false rejects · {m.recent.escapes} escapes</p></div>
            <div><p className="text-xs text-muted">Defects</p><p className="text-xs">{m.recent.byClass.map((c) => `${c.defectClass} ${c.count}`).join(" · ") || "none"}</p></div>
          </div>
          {m.drift.length > 0 && <div className="px-4 pb-4"><Alert tone="warning">Model behaviour changed: {m.drift.join("; ")}. Check the camera and lighting, the material, or retrain.</Alert></div>}
          {m.machines.length > 0 && <p className="border-t border-border px-4 py-2 text-xs text-muted">By machine: {m.machines.map((x) => `${x.machineCode} ${x.defectRatePct} % of ${x.total}`).join(" · ")}</p>}
        </Card>
      ))}
      <Card>
        <CardHeader title="Model versions" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {models.data?.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className="font-medium">{m.name} {m.version}</span>
              <Badge tone={m.status === "deployed" ? "success" : m.status === "draft" ? "warning" : "neutral"}>{m.status}</Badge>
              <span className="text-xs text-muted">{m.classes.join(", ")} · threshold {m.minConfidence}</span>
              <span className="text-xs">{m.deployments.map((d) => `${d.gatewayCode}: ${d.status === "done" ? "loaded" : d.status ?? "–"}`).join(" · ")}</span>
              {manage && m.status !== "retired" && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDeploying(m)}>Deploy</Button>}
            </li>
          ))}
          {models.data && !models.data.length && <li className="px-4 py-6 text-center text-muted">No models registered.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Results" action={<Select className="h-9 w-44" aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="toReview">To review</option><option value="defect">Defects</option><option value="all">All</option></Select>} />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {inspections.data?.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <Badge tone={i.result === "defect" ? "danger" : "success"}>{i.result === "defect" ? (i.defectClass ?? "defect") : "ok"}</Badge>
              <span className="tabular-nums">{Math.round(i.confidence * 100)} %</span>
              <span>{i.machineCode ?? "–"}{i.workOrderNumber ? ` · ${i.workOrderNumber}` : ""}</span>
              <span className="text-xs text-muted" title={formatDateTime(i.ts)}>{timeAgo(i.ts)}</span>
              {i.imageUrl && <a className="text-xs text-primary hover:underline" href={i.imageUrl} target="_blank" rel="noreferrer">image</a>}
              <span className="ml-auto flex gap-1">
                {i.review ? (
                  <Badge tone={i.review === "correct" ? "success" : "warning"}>{i.review === "correct" ? "confirmed" : `wrong${i.actualClass ? `: ${i.actualClass}` : ""}`}</Badge>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => run(() => api(`/vision/inspections/${i.id}/review`, { body: { review: "correct" } }))}>Right</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { const actualClass = i.result === "ok" ? await askText("Which defect was it?") : null; if (i.result !== "ok" || actualClass) run(() => api(`/vision/inspections/${i.id}/review`, { body: { review: "wrong", actualClass } })); }}>Wrong</Button>
                  </>
                )}
              </span>
            </li>
          ))}
          {inspections.data && !inspections.data.length && <li className="px-4 py-6 text-center text-muted">Nothing here.</li>}
        </ul>
      </Card>
      {creating && <CreateModel onClose={() => { setCreating(false); qc.invalidateQueries({ queryKey: ["/vision"] }); }} />}
      {deploying && <Deploy model={deploying} onClose={() => { setDeploying(null); qc.invalidateQueries({ queryKey: ["/vision"] }); }} />}
    </div>
  );
}

function CreateModel({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: "", version: "", classes: "", minConfidence: "0.6", artifactUrl: "", precision: "", recall: "", samples: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      const v = f.precision || f.recall ? { precision: f.precision ? Number(f.precision) / 100 : undefined, recall: f.recall ? Number(f.recall) / 100 : undefined, samples: f.samples ? Number(f.samples) : undefined } : null;
      await api("/vision/models", { body: { name: f.name, version: f.version, classes: f.classes.split(",").map((c) => c.trim()).filter(Boolean), minConfidence: Number(f.minConfidence), artifactUrl: f.artifactUrl || null, validation: v } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Register a model version" footer={<Button onClick={save} disabled={!f.name || !f.version || !f.classes}>Register</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <Field label="Name" required>{(p) => <Input {...p} value={f.name} placeholder="crate-surface" onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Version" required>{(p) => <Input {...p} value={f.version} placeholder="1.0" onChange={(e) => setF({ ...f, version: e.target.value })} />}</Field>
        <Field label="Defect classes" required hint="Comma separated">{(p) => <Input {...p} value={f.classes} placeholder="scratch, short_shot, flash" onChange={(e) => setF({ ...f, classes: e.target.value })} />}</Field>
        <Field label="Confidence threshold" hint="Below this, results go for review">{(p) => <Input {...p} type="number" step="0.05" min={0} max={1} value={f.minConfidence} onChange={(e) => setF({ ...f, minConfidence: e.target.value })} />}</Field>
        <Field label="Model file (URL)" className="sm:col-span-2">{(p) => <Input {...p} value={f.artifactUrl} onChange={(e) => setF({ ...f, artifactUrl: e.target.value })} />}</Field>
        <Field label="Validation precision %">{(p) => <Input {...p} type="number" min={0} max={100} value={f.precision} onChange={(e) => setF({ ...f, precision: e.target.value })} />}</Field>
        <Field label="Validation recall %">{(p) => <Input {...p} type="number" min={0} max={100} value={f.recall} onChange={(e) => setF({ ...f, recall: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function Deploy({ model, onClose }: { model: Model; onClose: () => void }) {
  const gateways = useQuery({ queryKey: ["/iot/gateways"], queryFn: () => api<Gateway[]>("/iot/gateways") });
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function deploy() {
    setError(null);
    try {
      await api(`/vision/models/${model.id}/deploy`, { body: { gatewayIds: ids } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Deploy ${model.name} ${model.version}`} description="The gateways load it on their next call; other versions of this model stop being used." footer={<Button disabled={!ids.length} onClick={deploy}>Deploy</Button>}>
      <div className="space-y-2 text-sm">
        {error && <Alert>{error}</Alert>}
        {gateways.data?.map((g) => <label key={g.id} className="flex items-center gap-2"><input type="checkbox" checked={ids.includes(g.id)} onChange={(e) => setIds(e.target.checked ? [...ids, g.id] : ids.filter((x) => x !== g.id))} /> {g.code} · {g.name}{g.online ? "" : " (offline)"}</label>)}
      </div>
    </Dialog>
  );
}
