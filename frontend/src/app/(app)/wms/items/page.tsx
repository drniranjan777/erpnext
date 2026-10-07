"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { CONDITIONS, WMS } from "@/lib/wms";

interface Profile { condition: string; hazardClass: string | null; unitWeightKg: string | null; unitVolumeM3: string | null; abcClass: string | null; minShelfLifeDays: number | null; mslLevel: string | null; ownerPartyId: string | null; unitsPerPallet: string | null }
interface Location { warehouse: string; bin: string; batchNo: string | null; expiryDate: string | null; qty: string; batchKey: string; binId: string }

export default function StorageProfiles() {
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Item storage" description="How each item must be stored, what one unit weighs and occupies, and where it is now. Put-away uses this to choose bins." />
      <ItemPicker stockOnly onPick={(it) => setItem({ id: it.id, label: `${it.code} · ${it.name}` })} />
      {item && <ProfileForm key={item.id} id={item.id} label={item.label} />}
    </div>
  );
}

function ProfileForm({ id, label }: { id: string; label: string }) {
  const { can } = useAuth();
  const p = useQuery({ queryKey: [WMS, "profile", id], queryFn: () => api<Profile | null>(`${WMS}/items/${id}/profile`) });
  const locs = useQuery({ queryKey: [WMS, "locations", id], queryFn: () => api<Location[]>(`${WMS}/items/${id}/locations`) });
  if (p.isLoading) return null;
  return (
    <>
      <Form id={id} label={label} p={p.data ?? null} manage={can("wms.setup.manage")} />
      <Card>
        <CardHeader title="Where it is" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {locs.data?.map((l) => (
            <li key={`${l.binId}-${l.batchKey}`} className="flex gap-3 px-5 py-2">
              <span className="font-mono text-xs text-muted">{l.warehouse}</span>
              <span className="font-mono">{l.bin}</span>
              {l.batchNo && <span className="text-xs text-muted">{l.batchNo}{l.expiryDate && ` · exp ${formatDate(l.expiryDate)}`}</span>}
              <span className="ml-auto tabular-nums">{formatQty(l.qty)}</span>
            </li>
          ))}
          {locs.data && !locs.data.length && <li className="px-5 py-4 text-center text-muted">Not in any bin (or not in a warehouse run with bins).</li>}
        </ul>
      </Card>
    </>
  );
}

function Form({ id, label, p, manage }: { id: string; label: string; p: Profile | null; manage: boolean }) {
  const s = (v: string | null | undefined) => (v ? String(Number(v)) : "");
  const [f, setF] = useState({ condition: p?.condition ?? "ambient", hazardClass: p?.hazardClass ?? "", unitWeightKg: s(p?.unitWeightKg), unitVolumeM3: s(p?.unitVolumeM3), abcClass: p?.abcClass ?? "", minShelfLifeDays: p?.minShelfLifeDays ? String(p.minShelfLifeDays) : "", mslLevel: p?.mslLevel ?? "", ownerPartyId: p?.ownerPartyId ?? "", unitsPerPallet: s(p?.unitsPerPallet) });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const clients = useQuery({ queryKey: ["/masters/parties", "customers"], queryFn: () => api<{ items: { id: string; name: string }[] }>("/masters/parties", { query: { role: "customer", limit: 200 } }) });
  async function save() {
    setMsg(null);
    try {
      await api(`${WMS}/items/${id}/profile`, { method: "PUT", body: { condition: f.condition, hazardClass: f.hazardClass || null, unitWeightKg: f.unitWeightKg ? Number(f.unitWeightKg) : null, unitVolumeM3: f.unitVolumeM3 ? Number(f.unitVolumeM3) : null, abcClass: f.abcClass || null, minShelfLifeDays: f.minShelfLifeDays ? Number(f.minShelfLifeDays) : null, mslLevel: f.mslLevel || null, ownerPartyId: f.ownerPartyId || null, unitsPerPallet: f.unitsPerPallet ? Number(f.unitsPerPallet) : null } });
      setMsg({ tone: "success", text: "Saved." });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <Card>
      <CardHeader title={label} />
      <div className="space-y-3 border-t border-border p-5">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Storage condition">{(pp) => <Select {...pp} disabled={!manage} value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
          <Field label="UN hazard class" hint="e.g. 3 flammable liquid, 5.1 oxidiser, 8 corrosive">{(pp) => <Input {...pp} disabled={!manage} value={f.hazardClass} onChange={(e) => setF({ ...f, hazardClass: e.target.value })} />}</Field>
          <Field label="ABC class">{(pp) => <Select {...pp} disabled={!manage} value={f.abcClass} onChange={(e) => setF({ ...f, abcClass: e.target.value })}><option value="">Not set</option><option value="A">A (fast)</option><option value="B">B</option><option value="C">C (slow)</option></Select>}</Field>
          <Field label="Weight per unit (kg)">{(pp) => <Input {...pp} disabled={!manage} inputMode="decimal" value={f.unitWeightKg} onChange={(e) => setF({ ...f, unitWeightKg: e.target.value })} />}</Field>
          <Field label="Volume per unit (m³)">{(pp) => <Input {...pp} disabled={!manage} inputMode="decimal" value={f.unitVolumeM3} onChange={(e) => setF({ ...f, unitVolumeM3: e.target.value })} />}</Field>
          <Field label="Owned by (3PL client)">{(pp) => <Select {...pp} disabled={!manage} value={f.ownerPartyId} onChange={(e) => setF({ ...f, ownerPartyId: e.target.value })}><option value="">Our own stock</option>{clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Units per pallet">{(pp) => <Input {...pp} disabled={!manage} inputMode="decimal" value={f.unitsPerPallet} onChange={(e) => setF({ ...f, unitsPerPallet: e.target.value })} />}</Field>
          <Field label="Moisture sensitivity (MSL)">{(pp) => <Select {...pp} disabled={!manage} value={f.mslLevel} onChange={(e) => setF({ ...f, mslLevel: e.target.value })}><option value="">Not sensitive</option>{["1", "2", "2a", "3", "4", "5", "5a", "6"].map((l) => <option key={l} value={l}>Level {l}</option>)}</Select>}</Field>
          <Field label="Least shelf life at dispatch (days)">{(pp) => <Input {...pp} disabled={!manage} type="number" value={f.minShelfLifeDays} onChange={(e) => setF({ ...f, minShelfLifeDays: e.target.value })} />}</Field>
        </div>
        {manage && <div className="flex justify-end"><Button onClick={save}>Save</Button></div>}
      </div>
    </Card>
  );
}
