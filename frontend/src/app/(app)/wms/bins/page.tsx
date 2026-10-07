"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, Printer, Unlock } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { NoWmsWarehouse, WarehouseSelect } from "@/components/wms/warehouse-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CONDITION_TONE, CONDITIONS, useWarehouseParam, WMS, type Bin, type Zone } from "@/lib/wms";

export default function LayoutPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Layout />
    </Suspense>
  );
}

function Layout() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { wh, loading, current } = useWarehouseParam();
  const [zoneId, setZoneId] = useState("");
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<null | { kind: "zone"; zone: Zone | null } | { kind: "generate" } | { kind: "bin"; bin: Bin | null }>(null);
  const zones = useQuery({ queryKey: [WMS, "zones", wh], queryFn: () => api<Zone[]>(`${WMS}/warehouses/${wh}/zones`), enabled: !!wh });
  const bins = useQuery({ queryKey: [WMS, "bins", wh, zoneId, q], queryFn: () => api<Bin[]>(`${WMS}/warehouses/${wh}/bins`, { query: { zoneId: zoneId || undefined, q: q || undefined } }), enabled: !!wh });
  if (loading) return <LoadingBlock />;
  if (!wh || !current) return <NoWmsWarehouse />;
  const manage = can("wms.setup.manage");
  const refresh = () => qc.invalidateQueries({ queryKey: [WMS] });
  async function toggle(b: Bin) {
    const reason = b.isBlocked ? null : window.prompt(`Why block ${b.code}?`);
    if (!b.isBlocked && !reason) return;
    await api(`${WMS}/bins/${b.id}/block`, { body: { blocked: !b.isBlocked, reason } }).catch(() => null);
    refresh();
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`Layout · ${current.code}`} description="Zones by use and storage condition, and the bins in them. Pick sequence is the walking order from the dock." actions={<WarehouseSelect />} />
      <Card>
        <CardHeader title="Zones" action={manage && <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "zone", zone: null })}><Plus className="size-4" aria-hidden /> Zone</Button>} />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {zones.data?.map((z) => (
            <li key={z.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <span className="font-mono text-xs">{z.code}</span>
              <span className="font-medium">{z.name}</span>
              <Badge>{z.kind}</Badge>
              <Badge tone={CONDITION_TONE[z.condition]}>{z.condition}</Badge>
              <span className="text-xs text-muted">{z.bins} bin(s)</span>
              {!z.isActive && <Badge>inactive</Badge>}
              {manage && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDialog({ kind: "zone", zone: z })}>Edit</Button>}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader
          title="Bins"
          action={
            <span className="flex flex-wrap gap-2">
              <Link href={`/print/bin-labels?wh=${wh}${zoneId ? `&zone=${zoneId}` : ""}`} target="_blank"><Button size="sm" variant="ghost"><Printer className="size-4" aria-hidden /> Labels</Button></Link>
              {manage && <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "generate" })}>Create a block</Button>}
              {manage && <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "bin", bin: null })}><Plus className="size-4" aria-hidden /> Bin</Button>}
            </span>
          }
        />
        <div className="flex flex-wrap gap-3 border-t border-border px-5 py-3">
          <Select className="h-9 w-48" aria-label="Zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)}><option value="">All zones</option>{zones.data?.map((z) => <option key={z.id} value={z.id}>{z.code}</option>)}</Select>
          <Input className="h-9 w-48" placeholder="Bin code" aria-label="Bin code" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Bin</th><th className="px-4 py-2 font-medium">Zone</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 font-medium">Capacity</th><th className="px-4 py-2 font-medium">Fixed item</th><th className="px-4 py-2 text-right font-medium">Walk</th><th className="px-4 py-2 font-medium" /></tr></thead>
          <tbody className="divide-y divide-border">
            {bins.data?.map((b) => (
              <tr key={b.id} className={b.isActive ? "" : "text-muted"}>
                <td className="px-4 py-2"><Link className="font-mono text-primary hover:underline" href={`${WMS}/scan?wh=${wh}&bin=${encodeURIComponent(b.code)}`}>{b.code}</Link>{b.items > 0 && <span className="ml-1 text-xs text-muted">{b.items} item(s)</span>}</td>
                <td className="px-4 py-2">{b.zone} <Badge tone={CONDITION_TONE[b.condition]}>{b.condition}</Badge></td>
                <td className="px-4 py-2">{b.binType}</td>
                <td className="px-4 py-2 text-xs">{[b.maxWeightKg && `${Number(b.maxWeightKg)} kg`, b.maxVolumeM3 && `${Number(b.maxVolumeM3)} m³`, b.maxQty && `${Number(b.maxQty)} units`].filter(Boolean).join(" · ") || "–"}</td>
                <td className="px-4 py-2">{b.fixedItem ?? "–"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{b.pickSequence}</td>
                <td className="px-4 py-2 text-right">
                  {b.isBlocked && <Badge tone="danger">blocked{b.blockReason ? `: ${b.blockReason}` : ""}</Badge>}
                  {can("wms.tasks.execute") && <Button size="sm" variant="ghost" aria-label={b.isBlocked ? "Unblock" : "Block"} onClick={() => toggle(b)}>{b.isBlocked ? <Unlock className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}</Button>}
                  {manage && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "bin", bin: b })}>Edit</Button>}
                </td>
              </tr>
            ))}
            {bins.data && !bins.data.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No bins.</td></tr>}
          </tbody>
        </table>
      </Card>
      {dialog?.kind === "zone" && <ZoneDialog wh={wh} zone={dialog.zone} onClose={() => { setDialog(null); refresh(); }} />}
      {dialog?.kind === "generate" && <GenerateDialog zones={zones.data ?? []} onClose={() => { setDialog(null); refresh(); }} />}
      {dialog?.kind === "bin" && <BinDialog zones={zones.data ?? []} bin={dialog.bin} onClose={() => { setDialog(null); refresh(); }} />}
    </div>
  );
}

function useSave(onClose: () => void) {
  const [error, setError] = useState<string | null>(null);
  async function save(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return { error, save };
}

function ZoneDialog({ wh, zone, onClose }: { wh: string; zone: Zone | null; onClose: () => void }) {
  const [f, setF] = useState({ code: zone?.code ?? "", name: zone?.name ?? "", kind: zone?.kind ?? "storage", condition: zone?.condition ?? "ambient", sequence: String(zone?.sequence ?? 10), isActive: zone?.isActive ?? true });
  const { error, save } = useSave(onClose);
  const fixedKind = zone && ["receiving", "dispatch"].includes(zone.kind);
  return (
    <Dialog open onClose={onClose} title={zone ? `Zone ${zone.code}` : "New zone"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save(() => api(zone ? `${WMS}/zones/${zone.id}` : `${WMS}/zones`, { method: zone ? "PUT" : "POST", body: { warehouseId: wh, ...f, sequence: Number(f.sequence) } }))}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Use">{(p) => <Select {...p} disabled={!!fixedKind} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{["storage", "staging", "quarantine", "receiving", "dispatch"].map((k) => <option key={k} value={k}>{k}</option>)}</Select>}</Field>
        <Field label="Storage condition">{(p) => <Select {...p} value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
        <Field label="Order" hint="Lower zones come first on walks">{(p) => <Input {...p} type="number" value={f.sequence} onChange={(e) => setF({ ...f, sequence: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>
      </div>
    </Dialog>
  );
}

function GenerateDialog({ zones, onClose }: { zones: Zone[]; onClose: () => void }) {
  const storage = zones.filter((z) => !["receiving", "dispatch"].includes(z.kind));
  const [f, setF] = useState({ zoneId: storage[0]?.id ?? "", aisles: "A, B", racks: "10", shelves: "4", positions: "1", binType: "shelf", maxWeightKg: "", maxVolumeM3: "" });
  const { error, save } = useSave(onClose);
  const aisles = f.aisles.split(",").map((a) => a.trim()).filter(Boolean);
  const total = aisles.length * Number(f.racks || 0) * Number(f.shelves || 0) * Number(f.positions || 0);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create a block of bins"
      description="Codes are aisle-rack-shelf (and position), e.g. A-01-1. Pick sequence walks up one aisle and down the next."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!f.zoneId || !total} onClick={() => save(() => api(`${WMS}/bins/generate`, { body: { zoneId: f.zoneId, aisles, racks: Number(f.racks), shelves: Number(f.shelves), positions: Number(f.positions), binType: f.binType, maxWeightKg: f.maxWeightKg ? Number(f.maxWeightKg) : null, maxVolumeM3: f.maxVolumeM3 ? Number(f.maxVolumeM3) : null } }))}>Create {total || ""} bins</Button></>}
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Zone">{(p) => <Select {...p} value={f.zoneId} onChange={(e) => setF({ ...f, zoneId: e.target.value })}>{storage.map((z) => <option key={z.id} value={z.id}>{z.code} · {z.name}</option>)}</Select>}</Field>
        <Field label="Aisles" hint="Comma separated">{(p) => <Input {...p} value={f.aisles} onChange={(e) => setF({ ...f, aisles: e.target.value })} />}</Field>
        <Field label="Racks per aisle">{(p) => <Input {...p} type="number" value={f.racks} onChange={(e) => setF({ ...f, racks: e.target.value })} />}</Field>
        <Field label="Shelves per rack">{(p) => <Input {...p} type="number" value={f.shelves} onChange={(e) => setF({ ...f, shelves: e.target.value })} />}</Field>
        <Field label="Positions per shelf">{(p) => <Input {...p} type="number" value={f.positions} onChange={(e) => setF({ ...f, positions: e.target.value })} />}</Field>
        <Field label="Bin type">{(p) => <Select {...p} value={f.binType} onChange={(e) => setF({ ...f, binType: e.target.value })}>{["shelf", "pallet", "floor", "bulk"].map((t) => <option key={t} value={t}>{t}</option>)}</Select>}</Field>
        <Field label="Max weight (kg)">{(p) => <Input {...p} inputMode="decimal" value={f.maxWeightKg} onChange={(e) => setF({ ...f, maxWeightKg: e.target.value })} />}</Field>
        <Field label="Max volume (m³)">{(p) => <Input {...p} inputMode="decimal" value={f.maxVolumeM3} onChange={(e) => setF({ ...f, maxVolumeM3: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function BinDialog({ zones, bin, onClose }: { zones: Zone[]; bin: Bin | null; onClose: () => void }) {
  const [f, setF] = useState({
    zoneId: bin?.zoneId ?? zones[0]?.id ?? "",
    code: bin?.code ?? "",
    binType: bin?.binType ?? "shelf",
    maxWeightKg: bin?.maxWeightKg ? String(Number(bin.maxWeightKg)) : "",
    maxVolumeM3: bin?.maxVolumeM3 ? String(Number(bin.maxVolumeM3)) : "",
    maxQty: bin?.maxQty ? String(Number(bin.maxQty)) : "",
    pickSequence: String(bin?.pickSequence ?? 1000),
    isActive: bin?.isActive ?? true,
  });
  const [fixed, setFixed] = useState<{ id: string; label: string } | null>(bin?.fixedItemId ? { id: bin.fixedItemId, label: bin.fixedItem ?? "" } : null);
  const { error, save } = useSave(onClose);
  const n = (v: string) => (v ? Number(v) : null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={bin ? `Bin ${bin.code}` : "New bin"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save(() => api(bin ? `${WMS}/bins/${bin.id}` : `${WMS}/bins`, { method: bin ? "PUT" : "POST", body: { zoneId: f.zoneId, code: f.code, binType: f.binType, maxWeightKg: n(f.maxWeightKg), maxVolumeM3: n(f.maxVolumeM3), maxQty: n(f.maxQty), pickSequence: Number(f.pickSequence), fixedItemId: fixed?.id ?? null, isActive: f.isActive, aisle: bin?.aisle, rack: bin?.rack, shelf: bin?.shelf, position: bin?.position, gridX: bin?.gridX, gridY: bin?.gridY } }))}>Save</Button></>}
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Zone">{(p) => <Select {...p} value={f.zoneId} onChange={(e) => setF({ ...f, zoneId: e.target.value })}>{zones.map((z) => <option key={z.id} value={z.id}>{z.code}</option>)}</Select>}</Field>
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
        <Field label="Type">{(p) => <Select {...p} value={f.binType} onChange={(e) => setF({ ...f, binType: e.target.value })}>{["shelf", "pallet", "floor", "bulk", "staging"].map((t) => <option key={t} value={t}>{t}</option>)}</Select>}</Field>
        <Field label="Pick sequence">{(p) => <Input {...p} type="number" value={f.pickSequence} onChange={(e) => setF({ ...f, pickSequence: e.target.value })} />}</Field>
        <Field label="Max weight (kg)">{(p) => <Input {...p} inputMode="decimal" value={f.maxWeightKg} onChange={(e) => setF({ ...f, maxWeightKg: e.target.value })} />}</Field>
        <Field label="Max volume (m³)">{(p) => <Input {...p} inputMode="decimal" value={f.maxVolumeM3} onChange={(e) => setF({ ...f, maxVolumeM3: e.target.value })} />}</Field>
        <Field label="Max quantity" hint="Makes it a single-item bin">{(p) => <Input {...p} inputMode="decimal" value={f.maxQty} onChange={(e) => setF({ ...f, maxQty: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>
      </div>
      <div className="mt-3 space-y-1">
        <p className="text-sm font-medium">Fixed item {fixed && <span className="font-normal text-muted">· {fixed.label} <button type="button" className="text-primary" onClick={() => setFixed(null)}>clear</button></span>}</p>
        <ItemPicker stockOnly onPick={(it) => setFixed({ id: it.id, label: `${it.code} ${it.name}` })} placeholder="Item that always lives here (optional)" />
      </div>
    </Dialog>
  );
}
