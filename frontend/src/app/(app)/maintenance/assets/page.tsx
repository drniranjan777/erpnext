"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatQty } from "@/lib/documents";
import { ASSET_STATUS, MT, type Asset } from "@/lib/maintenance";

interface Machine { id: string; code: string; name: string }

export default function AssetsPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: [MT, "assets"], queryFn: () => api<Asset[]>(`${MT}/assets`) });
  const crit = useQuery({ queryKey: [MT, "critical-spares"], queryFn: () => api<{ itemId: string; code: string; name: string; assets: string; minQty: string; stock: string }[]>(`${MT}/assets/critical-spares`) });
  const [adding, setAdding] = useState(false);
  const rows = q.data ?? [];
  // Depth-first order with indentation by level in the tree.
  const ordered: { a: Asset; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => rows.filter((r) => r.parentId === parent).forEach((r) => { ordered.push({ a: r, depth }); walk(r.id, depth + 1); });
  walk(null, 0);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Assets" description="The plant as a tree: plant, lines, machines, assemblies and components, with criticality, status, meters and warranty." actions={can("maintenance.orders.manage") && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Add asset</Button>} />
      {!!crit.data?.length && <Alert tone="warning">Critical spares below minimum: {crit.data.map((c) => `${c.code} (${formatQty(c.stock)} of ${formatQty(c.minQty)}, for ${c.assets})`).join("; ")}</Alert>}
      {adding && <AssetForm assets={rows} onClose={() => setAdding(false)} />}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Asset</th><th className="px-4 py-2 font-medium">Level</th><th className="px-4 py-2 font-medium">Criticality</th><th className="px-4 py-2 font-medium">Meter</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {ordered.map(({ a, depth }) => (
                <tr key={a.id}>
                  <td className="px-4 py-2" style={{ paddingLeft: `${1 + depth * 1.25}rem` }}><Link href={`${MT}/assets/${a.id}`} className="font-mono font-medium hover:underline">{a.code}</Link> {a.name}{a.machineCode && <span className="ml-1 text-xs text-muted">· {a.machineCode}</span>}{a.openJobs > 0 && <Badge tone="warning" className="ml-2">{a.openJobs} open</Badge>}</td>
                  <td className="px-4 py-2">{a.level}</td>
                  <td className="px-4 py-2"><Badge tone={a.criticality === "A" ? "danger" : a.criticality === "B" ? "warning" : "neutral"}>{a.criticality}</Badge></td>
                  <td className="px-4 py-2 tabular-nums">{a.meterUnit ? `${a.meterReading ? formatQty(a.meterReading) : "–"} ${a.meterUnit}` : "–"}</td>
                  <td className="px-4 py-2"><Badge tone={ASSET_STATUS[a.status]}>{a.status}</Badge>{a.inWarranty && <Badge tone="primary" className="ml-1">Warranty</Badge>}</td>
                </tr>
              ))}
              {!ordered.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No assets yet.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}

function AssetForm({ assets, onClose }: { assets: Asset[]; onClose: () => void }) {
  const qc = useQueryClient();
  const machines = useQuery({ queryKey: ["manufacturing", "machines"], queryFn: () => api<Machine[]>("/manufacturing/machines") });
  const [f, setF] = useState({ code: "", name: "", level: "machine", parentId: "", machineId: "", location: "", make: "", model: "", serialNo: "", criticality: "B", meterUnit: "", warrantyUntil: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setError(null);
    const opt = (v: string) => v || null;
    try {
      await api(`${MT}/assets`, { body: { ...f, parentId: opt(f.parentId), machineId: opt(f.machineId), location: opt(f.location), make: opt(f.make), model: opt(f.model), serialNo: opt(f.serialNo), meterUnit: opt(f.meterUnit), warrantyUntil: opt(f.warrantyUntil) } });
      qc.invalidateQueries({ queryKey: [MT, "assets"] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <CardHeader title="New asset" />
      <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-4">
        {error && <div className="sm:col-span-4"><Alert>{error}</Alert></div>}
        <Field label="Code" required>{(p) => <Input {...p} className="font-mono uppercase" value={f.code} onChange={set("code")} />}</Field>
        <Field label="Name" required className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={set("name")} />}</Field>
        <Field label="Level">{(p) => <Select {...p} value={f.level} onChange={set("level")}>{["plant", "line", "machine", "assembly", "component", "utility"].map((l) => <option key={l} value={l}>{l}</option>)}</Select>}</Field>
        <Field label="Part of">{(p) => <Select {...p} value={f.parentId} onChange={set("parentId")}><option value="">(top level)</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</Select>}</Field>
        <Field label="Shop-floor machine">{(p) => <Select {...p} value={f.machineId} onChange={set("machineId")}><option value="">None</option>{machines.data?.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}</Select>}</Field>
        <Field label="Criticality">{(p) => <Select {...p} value={f.criticality} onChange={set("criticality")}><option value="A">A: production stops</option><option value="B">B</option><option value="C">C</option></Select>}</Field>
        <Field label="Meter unit" hint="hours, km, strokes…">{(p) => <Input {...p} value={f.meterUnit} onChange={set("meterUnit")} />}</Field>
        <Field label="Make">{(p) => <Input {...p} value={f.make} onChange={set("make")} />}</Field>
        <Field label="Model">{(p) => <Input {...p} value={f.model} onChange={set("model")} />}</Field>
        <Field label="Serial no.">{(p) => <Input {...p} value={f.serialNo} onChange={set("serialNo")} />}</Field>
        <Field label="Warranty until">{(p) => <Input {...p} type="date" value={f.warrantyUntil} onChange={set("warrantyUntil")} />}</Field>
        <div className="flex justify-end gap-2 sm:col-span-4"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.code.trim() || f.name.trim().length < 2}>Save</Button></div>
      </div>
    </Card>
  );
}
