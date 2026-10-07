"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { KIND, MT, type Asset, type MaintenanceOrder } from "@/lib/maintenance";
import { textarea } from "@/lib/qms";

export default function NewMaintenanceOrderPage() {
  const router = useRouter();
  const assets = useQuery({ queryKey: [MT, "assets"], queryFn: () => api<Asset[]>(`${MT}/assets`) });
  const [f, setF] = useState({ kind: "breakdown", assetId: "", problem: "", priority: "high", requestedBy: "", plannedDate: "", machineDown: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<MaintenanceOrder>(`${MT}/orders`, { body: { ...f, assetId: f.assetId || null, requestedBy: f.requestedBy || null, plannedDate: f.plannedDate || null } });
      router.push(`${MT}/orders/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  const usable = assets.data?.filter((a) => a.status !== "retired") ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={f.kind === "breakdown" ? "Report a breakdown" : "New maintenance request"} description="The machine is marked down until the job is signed off. Downtime counts from when it was reported." />
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="What kind of job">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, machineDown: e.target.value === "breakdown" ? true : f.machineDown, priority: e.target.value === "breakdown" ? "high" : "normal" })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Asset" required>{(p) => <Select {...p} value={f.assetId} onChange={set("assetId")}><option value="">Choose…</option>{usable.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}{a.status === "down" ? " (down)" : ""}</option>)}</Select>}</Field>
        <Field label="What is wrong" required className="sm:col-span-2">{(p) => <textarea {...p} rows={3} className={textarea} value={f.problem} onChange={set("problem")} />}</Field>
        <Field label="Priority">{(p) => <Select {...p} value={f.priority} onChange={set("priority")}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select>}</Field>
        <Field label="Reported by">{(p) => <Input {...p} value={f.requestedBy} onChange={set("requestedBy")} />}</Field>
        {f.kind !== "breakdown" && <Field label="Planned for">{(p) => <Input {...p} type="date" value={f.plannedDate} onChange={set("plannedDate")} />}</Field>}
        {f.kind !== "breakdown" && <div className="flex items-end pb-2"><Checkbox label="The machine must stop for this job" checked={f.machineDown} onChange={(e) => setF({ ...f, machineDown: e.target.checked })} /></div>}
      </Card>
      <p className="text-sm text-muted">Attach photos on the order once it is saved.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={save} loading={busy} disabled={!f.assetId || f.problem.trim().length < 3}>{f.kind === "breakdown" ? "Report" : "Raise request"}</Button>
      </div>
    </div>
  );
}
