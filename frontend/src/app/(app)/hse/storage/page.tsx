"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Usage { id: string; warehouse: string; hazardClass: string; maxKg: number; licence: string | null; licenceValidUntil: string | null; note: string | null; kg: number; pct: number | null; breach: boolean; items: { item: string; kg: number }[] }
interface Storage { usage: Usage[]; clashes: { warehouse: string; a: string; b: string }[]; unlimited: { warehouse: string; item: string; hazardClass: string | null; kg: number }[] }
interface Wh { id: string; code: string; name: string }
interface Lic { id: string; name: string; kind: string; number: string | null }

const CLASSES = ["petroleum_a", "petroleum_b", "petroleum_c", "2", "3", "4", "5", "5.1", "5.2", "6", "8", "9"];

/** Hazardous inventory against the storage limits of each location. */
export default function StoragePage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const s = useQuery({ queryKey: ["/hse/storage"], queryFn: () => api<Storage>("/hse/storage") });
  const wh = useQuery({ queryKey: ["/inventory/warehouses"], queryFn: () => api<Wh[]>("/inventory/warehouses") });
  const lic = useQuery({ queryKey: ["/qms/hse/licences"], queryFn: () => api<Lic[]>("/qms/hse/licences"), enabled: can("hse.storage.manage") });
  const [f, setF] = useState({ warehouseId: "", hazardClass: "petroleum_a", maxKg: "", licenceId: "", note: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/hse/storage"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Hazardous storage" description="Stock of each hazard class (from the issued SDS) against the most each location may hold under its PESO, factory or MSIHC limits, and incompatible classes kept together." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {s.data?.clashes.map((c, i) => <Alert key={i} tone="warning">{c.warehouse}: {c.a} must be stored apart from {c.b}.</Alert>)}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {s.data?.usage.map((u) => (
            <li key={u.id} className="space-y-1 px-4 py-2.5">
              <p className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{u.warehouse}</span>
                <span>{u.hazardClass.startsWith("petroleum_") ? `Petroleum class ${u.hazardClass.slice(10).toUpperCase()}` : `UN class ${u.hazardClass}`}</span>
                <Badge tone={u.breach ? "danger" : (u.pct ?? 0) > 85 ? "warning" : "success"}>{u.kg.toLocaleString("en-IN")} / {u.maxKg.toLocaleString("en-IN")} kg ({u.pct ?? 0} %)</Badge>
                <span className="text-xs text-muted">{u.licence ?? u.note ?? ""}{u.licenceValidUntil ? ` · valid until ${u.licenceValidUntil}` : ""}</span>
                {can("hse.storage.manage") && <button type="button" className="ml-auto text-xs text-danger hover:underline" onClick={() => run(() => api(`/hse/storage/limits/${u.id}`, { method: "DELETE" }), "Limit removed.")}>Remove</button>}
              </p>
              <div className="h-1.5 rounded bg-surface-muted"><div className={`h-1.5 rounded ${u.breach ? "bg-danger" : "bg-primary"}`} style={{ width: `${Math.min(100, u.pct ?? 0)}%` }} /></div>
              {u.items.length > 0 && <p className="text-xs text-muted">{u.items.map((x) => `${x.item}: ${x.kg} kg`).join(" · ")}</p>}
            </li>
          ))}
          {s.data && !s.data.usage.length && <li className="px-4 py-6 text-center text-muted">No storage limits set.</li>}
        </ul>
      </Card>
      {s.data && s.data.unlimited.length > 0 && (
        <Card>
          <CardHeader title="Hazardous stock in locations without a limit" />
          <ul className="divide-y divide-border border-t border-border text-sm">{s.data.unlimited.map((u, i) => <li key={i} className="px-4 py-1.5">{u.warehouse}: {u.item} (class {u.hazardClass ?? "petroleum"}) {u.kg} kg</li>)}</ul>
        </Card>
      )}
      {can("hse.storage.manage") && (
        <Card>
          <CardHeader title="Set a limit" />
          <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
            <Select className="h-9 w-48" aria-label="Location" value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">Location…</option>{wh.data?.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</Select>
            <Select className="h-9 w-40" aria-label="Class" value={f.hazardClass} onChange={(e) => setF({ ...f, hazardClass: e.target.value })}>{CLASSES.map((c) => <option key={c} value={c}>{c.startsWith("petroleum_") ? `Petroleum ${c.slice(10).toUpperCase()}` : `UN class ${c}`}</option>)}</Select>
            <Input className="h-9 w-32" type="number" min={0} aria-label="Most kg" placeholder="Max kg" value={f.maxKg} onChange={(e) => setF({ ...f, maxKg: e.target.value })} />
            <Select className="h-9 w-56" aria-label="Licence" value={f.licenceId} onChange={(e) => setF({ ...f, licenceId: e.target.value })}><option value="">Licence (optional)</option>{lic.data?.map((l) => <option key={l.id} value={l.id}>{l.name} {l.number ?? ""}</option>)}</Select>
            <Input className="h-9 flex-1" aria-label="Note" placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            <Button disabled={!f.warehouseId || !Number(f.maxKg)} onClick={() => run(() => api("/hse/storage/limits", { body: { warehouseId: f.warehouseId, hazardClass: f.hazardClass, maxKg: Number(f.maxKg), licenceId: f.licenceId || null, note: f.note || null } }), "Limit saved.")}>Save</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
