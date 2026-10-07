"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
import { formatQty } from "@/lib/documents";
import { useWarehouseParam, WMS, type Bin } from "@/lib/wms";

interface Tank { id: string; bin: string; itemCode: string; itemName: string; capacityLitres: string; stockUnit: string; tolerancePct: string; bookQty: string; lastDip: { dipMm: string; litres: string; measuredQty: string; variance: string; withinTolerance: boolean; readAt: string } | null }
interface Dip { id: string; dipMm: string; temperatureC: string | null; litres: string; measuredQty: string; bookQty: string; variance: string; withinTolerance: boolean; readAt: string; readBy: string | null; entryNumber: string | null }

export default function TanksPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Tanks />
    </Suspense>
  );
}

function Tanks() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { wh, loading, current } = useWarehouseParam();
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "dip"; tank: Tank } | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const tanks = useQuery({ queryKey: [WMS, "tanks", wh], queryFn: () => api<Tank[]>(`${WMS}/warehouses/${wh}/tanks`), enabled: !!wh });
  const dips = useQuery({ queryKey: [WMS, "dips", history], queryFn: () => api<Dip[]>(`${WMS}/tanks/${history}/dips`), enabled: !!history });
  if (loading) return <LoadingBlock />;
  if (!wh || !current) return <NoWmsWarehouse />;
  const close = () => { setDialog(null); qc.invalidateQueries({ queryKey: [WMS] }); };
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`Tanks and silos · ${current.code}`} description="Dip readings converted to volume with each tank's calibration chart, compared with the book stock. Post the variance as an adjustment when it is real." actions={<><WarehouseSelect />{can("wms.setup.manage") && <Button onClick={() => setDialog({ kind: "new" })}><Plus className="size-4" aria-hidden /> Tank</Button>}</>} />
      <div className="grid gap-4 md:grid-cols-2">
        {tanks.data?.map((t) => {
          const fill = t.stockUnit === "litre" ? Number(t.bookQty) / Number(t.capacityLitres) : null;
          return (
            <Card key={t.id}>
              <CardHeader title={`${t.bin} · ${t.itemCode}`} description={t.itemName} action={can("wms.tasks.execute") && <Button size="sm" onClick={() => setDialog({ kind: "dip", tank: t })}>Record dip</Button>} />
              <div className="space-y-2 border-t border-border p-4 text-sm">
                <p>Book {formatQty(t.bookQty)} {t.stockUnit === "kg" ? "kg" : "L"} of {formatQty(t.capacityLitres)} L{fill !== null && ` (${Math.round(fill * 100)} %)`}</p>
                {fill !== null && <div className="h-2 rounded bg-surface-muted"><div className="h-2 rounded bg-primary" style={{ width: `${Math.min(100, fill * 100)}%` }} /></div>}
                {t.lastDip && <p className="text-xs text-muted">Last dip {Number(t.lastDip.dipMm)} mm = {formatQty(t.lastDip.litres)} L · variance {formatQty(t.lastDip.variance)} <Badge tone={t.lastDip.withinTolerance ? "success" : "warning"}>{t.lastDip.withinTolerance ? "within tolerance" : `outside ±${Number(t.tolerancePct)} %`}</Badge></p>}
                <button type="button" className="text-xs text-primary" onClick={() => setHistory(history === t.id ? null : t.id)}>{history === t.id ? "Hide readings" : "Readings"}</button>
                {history === t.id && (
                  <ul className="divide-y divide-border text-xs">
                    {dips.data?.map((d) => <li key={d.id} className="flex gap-2 py-1"><span>{new Date(d.readAt).toLocaleString("en-IN")}</span><span>{Number(d.dipMm)} mm{d.temperatureC && ` · ${Number(d.temperatureC)} °C`}</span><span className="ml-auto tabular-nums">{formatQty(d.measuredQty)} vs {formatQty(d.bookQty)}</span>{d.entryNumber && <Badge>{d.entryNumber}</Badge>}</li>)}
                  </ul>
                )}
              </div>
            </Card>
          );
        })}
        {tanks.data && !tanks.data.length && <p className="text-sm text-muted">No tanks yet. A tank is a bulk bin with a calibration chart.</p>}
      </div>
      {dialog?.kind === "new" && <TankDialog wh={wh} onClose={close} />}
      {dialog?.kind === "dip" && <DipDialog tank={dialog.tank} canAdjust={can("inventory.entries.manage")} onClose={close} />}
    </div>
  );
}

function TankDialog({ wh, onClose }: { wh: string; onClose: () => void }) {
  const bins = useQuery({ queryKey: [WMS, "bins", wh, "tank"], queryFn: () => api<Bin[]>(`${WMS}/warehouses/${wh}/bins`) });
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [f, setF] = useState({ binId: "", capacityLitres: "", stockUnit: "litre", densityKgPerL: "", tolerancePct: "0.5", chart: "0 0\n1000 5000\n2000 12000" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      const calibration = f.chart.split(/\n+/).map((l) => l.trim().split(/[\s,;]+/).map(Number)).filter((p) => p.length === 2 && p.every((n) => Number.isFinite(n))).map(([mm, litres]) => ({ mm, litres }));
      await api(`${WMS}/tanks`, { body: { binId: f.binId, itemId: item?.id, capacityLitres: Number(f.capacityLitres), stockUnit: f.stockUnit, densityKgPerL: f.densityKgPerL ? Number(f.densityKgPerL) : null, tolerancePct: Number(f.tolerancePct), calibration } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New tank" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!item || !f.binId} onClick={save}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        <Field label="Bin">{(p) => <Select {...p} value={f.binId} onChange={(e) => setF({ ...f, binId: e.target.value })}><option value="">Choose…</option>{bins.data?.filter((b) => !["receiving", "dispatch"].includes(b.zoneKind)).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</Select>}</Field>
        {item ? <p className="text-sm">Holds {item.label}</p> : <ItemPicker stockOnly onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} placeholder="Item stored in the tank" />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Capacity (litres)">{(p) => <Input {...p} inputMode="decimal" value={f.capacityLitres} onChange={(e) => setF({ ...f, capacityLitres: e.target.value })} />}</Field>
          <Field label="Stock kept in">{(p) => <Select {...p} value={f.stockUnit} onChange={(e) => setF({ ...f, stockUnit: e.target.value })}><option value="litre">Litres</option><option value="kg">Kilograms (via density)</option></Select>}</Field>
          {f.stockUnit === "kg" && <Field label="Density (kg/L)">{(p) => <Input {...p} inputMode="decimal" value={f.densityKgPerL} onChange={(e) => setF({ ...f, densityKgPerL: e.target.value })} />}</Field>}
          <Field label="Tolerance (%)">{(p) => <Input {...p} inputMode="decimal" value={f.tolerancePct} onChange={(e) => setF({ ...f, tolerancePct: e.target.value })} />}</Field>
        </div>
        <Field label="Calibration chart" hint="One point per line: dip in mm, then litres">{(p) => <textarea {...p} rows={6} className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm" value={f.chart} onChange={(e) => setF({ ...f, chart: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function DipDialog({ tank, canAdjust, onClose }: { tank: Tank; canAdjust: boolean; onClose: () => void }) {
  const [f, setF] = useState({ dipMm: "", temperatureC: "", adjust: false });
  const [result, setResult] = useState<Dip | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      setResult(await api<Dip>(`${WMS}/tanks/${tank.id}/dips${f.adjust ? "/adjust" : ""}`, { body: { dipMm: Number(f.dipMm), temperatureC: f.temperatureC ? Number(f.temperatureC) : null } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Dip ${tank.bin}`} footer={result ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!f.dipMm} onClick={save}>Record</Button></>}>
      {error && <Alert>{error}</Alert>}
      {result ? (
        <p className="text-sm">{Number(result.dipMm)} mm = {formatQty(result.litres)} L, measured {formatQty(result.measuredQty)} against book {formatQty(result.bookQty)}: variance {formatQty(result.variance)}{result.entryNumber || f.adjust ? ", posted as an adjustment." : "."}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dip (mm)">{(p) => <Input {...p} autoFocus inputMode="decimal" value={f.dipMm} onChange={(e) => setF({ ...f, dipMm: e.target.value })} />}</Field>
          <Field label="Temperature (°C)">{(p) => <Input {...p} inputMode="decimal" value={f.temperatureC} onChange={(e) => setF({ ...f, temperatureC: e.target.value })} />}</Field>
          {canAdjust && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.adjust} onChange={(e) => setF({ ...f, adjust: e.target.checked })} /> Post the variance as a stock adjustment</label>}
        </div>
      )}
    </Dialog>
  );
}
