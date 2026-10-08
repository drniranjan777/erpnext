"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/documents";
import type { Signal } from "@/lib/iot";

interface Settings { contractDemandKw: number | null; demandIntervalMinutes: 15 | 30; alertPct: number; gridFactor: number; tariffPerKwh: number; mainSignalIds: string[]; lastAlertInterval: string | null }
interface Energy {
  totalKwh: number;
  costInr: number;
  co2Kg: number;
  maxDemandKw: number;
  maxDemandAt: string | null;
  contractDemandKw: number | null;
  settings: Settings;
  meters: { signalId: string; code: string; name: string; machineCode: string | null; kwh: number; main: boolean }[];
  machines: { machineId: string; code: string; name: string; kwh: number; good: number; kwhPerUnit: number | null; co2KgPerUnit: number | null }[];
  items: { itemId: string; code: string; name: string; kwh: number; good: number; kwhPerUnit: number | null }[];
  daily: { day: string; kwh: number; co2Kg: number }[];
}

const n = (v: number, d = 1) => v.toLocaleString("en-IN", { maximumFractionDigits: d });

/** Energy: consumption, cost, demand against the contract, kWh per unit and Scope 2 carbon. */
export default function EnergyPage() {
  const { can } = useAuth();
  const manage = can("iot.devices.manage");
  const [days, setDays] = useState("7");
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ["/plant/energy", days], queryFn: () => api<Energy>("/plant/energy", { query: { from: new Date(Date.now() - Number(days) * 86_400_000).toISOString() } }), refetchInterval: 60000 });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const e = q.data!;
  const maxDay = Math.max(1, ...e.daily.map((d) => d.kwh));
  const demandPct = e.contractDemandKw ? Math.round((e.maxDemandKw / e.contractDemandKw) * 100) : null;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Energy"
        description="From kWh meters connected through the edge gateways. Totals use the incoming meters; machine meters give kWh per part."
        actions={
          <span className="flex gap-2">
            <Select className="h-9 w-32" aria-label="Period" value={days} onChange={(ev) => setDays(ev.target.value)}><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option></Select>
            {manage && <Button variant="ghost" onClick={() => setEdit(true)}>Settings</Button>}
          </span>
        }
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4"><p className="text-sm text-muted">Consumed</p><p className="text-2xl font-semibold tabular-nums">{n(e.totalKwh)} kWh</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Cost (at ₹{e.settings.tariffPerKwh}/kWh)</p><p className="text-2xl font-semibold tabular-nums">{formatMoney(e.costInr)}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Scope 2 carbon</p><p className="text-2xl font-semibold tabular-nums">{n(e.co2Kg / 1000, 2)} t CO₂</p><p className="text-xs text-muted">{e.settings.gridFactor} kg/kWh grid factor</p></Card>
        <Card className="p-4">
          <p className="text-sm text-muted">Maximum demand ({e.settings.demandIntervalMinutes} min)</p>
          <p className={`text-2xl font-semibold tabular-nums ${demandPct !== null && demandPct >= e.settings.alertPct ? "text-danger" : ""}`}>{n(e.maxDemandKw)} kW</p>
          <p className="text-xs text-muted">{e.contractDemandKw ? `${demandPct} % of ${n(e.contractDemandKw)} kW contract` : "Set the contract demand in Settings"}{e.maxDemandAt ? ` · ${formatDateTime(e.maxDemandAt)}` : ""}</p>
        </Card>
      </div>
      {e.daily.length > 0 && (
        <Card>
          <CardHeader title="By day" />
          <div className="flex items-end gap-1 border-t border-border p-4" style={{ height: 160 }}>
            {e.daily.map((d) => (
              <div key={d.day} className="flex h-full flex-1 flex-col justify-end text-center text-[10px]" title={`${d.day}: ${n(d.kwh)} kWh, ${n(d.co2Kg)} kg CO₂`}>
                <div className="rounded-t bg-primary" style={{ height: `${(d.kwh / maxDay) * 100}%`, minHeight: 2 }} />
                <span className="mt-1 text-muted">{d.day.slice(8)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Machines" description="kWh per good part made in the period." />
          <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
            <tbody className="divide-y divide-border">
              {e.machines.map((m) => <tr key={m.machineId}><td className="px-4 py-2">{m.code} · {m.name}</td><td className="px-4 py-2 text-right tabular-nums">{n(m.kwh)} kWh</td><td className="px-4 py-2 text-right tabular-nums">{m.kwhPerUnit !== null ? `${m.kwhPerUnit} kWh/part` : "no parts counted"}</td></tr>)}
              {!e.machines.length && <tr><td className="px-4 py-6 text-center text-muted">No machine meters.</td></tr>}
            </tbody>
          </table></div>
        </Card>
        <Card>
          <CardHeader title="Products" description="Energy of the minutes each machine made the product, per good unit." />
          <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
            <tbody className="divide-y divide-border">
              {e.items.map((i) => <tr key={i.itemId}><td className="px-4 py-2">{i.code} · {i.name}</td><td className="px-4 py-2 text-right tabular-nums">{n(i.good, 0)} made</td><td className="px-4 py-2 text-right tabular-nums">{i.kwhPerUnit !== null ? `${i.kwhPerUnit} kWh/unit` : "–"}</td></tr>)}
              {!e.items.length && <tr><td className="px-4 py-6 text-center text-muted">Needs machine meters and counted job cards.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Meters" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {e.meters.map((m) => <li key={m.signalId} className="flex gap-3 px-4 py-1.5"><span className="font-mono text-xs">{m.code}</span><span className="flex-1">{m.name}{m.main ? " (incoming)" : ""}{m.machineCode ? ` · ${m.machineCode}` : ""}</span><span className="tabular-nums">{n(m.kwh)} kWh</span></li>)}
          {!e.meters.length && <li className="px-4 py-6 text-center text-muted">Add signals measuring &ldquo;Energy meter (kWh)&rdquo; under Signals.</li>}
        </ul>
      </Card>
      {edit && <SettingsDialog settings={e.settings} onClose={() => setEdit(false)} />}
    </div>
  );
}

function SettingsDialog({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const qc = useQueryClient();
  const meters = useQuery({ queryKey: ["/iot/signals"], queryFn: () => api<Signal[]>("/iot/signals"), select: (all) => all.filter((s) => s.purpose === "energy_kwh") });
  const [f, setF] = useState({ contractDemandKw: settings.contractDemandKw === null ? "" : String(settings.contractDemandKw), demandIntervalMinutes: String(settings.demandIntervalMinutes), alertPct: String(settings.alertPct), gridFactor: String(settings.gridFactor), tariffPerKwh: String(settings.tariffPerKwh), mainSignalIds: settings.mainSignalIds });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api("/plant/energy/settings", { method: "PUT", body: { contractDemandKw: f.contractDemandKw === "" ? null : Number(f.contractDemandKw), demandIntervalMinutes: Number(f.demandIntervalMinutes), alertPct: Number(f.alertPct), gridFactor: Number(f.gridFactor), tariffPerKwh: Number(f.tariffPerKwh), mainSignalIds: f.mainSignalIds } });
      qc.invalidateQueries({ queryKey: ["/plant/energy"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Energy settings" footer={<Button onClick={save}>Save</Button>}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contract demand (kW)">{(p) => <Input {...p} type="number" min={0} value={f.contractDemandKw} onChange={(e) => setF({ ...f, contractDemandKw: e.target.value })} />}</Field>
          <Field label="Demand interval">{(p) => <Select {...p} value={f.demandIntervalMinutes} onChange={(e) => setF({ ...f, demandIntervalMinutes: e.target.value })}><option value="15">15 minutes</option><option value="30">30 minutes</option></Select>}</Field>
          <Field label="Warn at % of contract demand">{(p) => <Input {...p} type="number" min={50} max={120} value={f.alertPct} onChange={(e) => setF({ ...f, alertPct: e.target.value })} />}</Field>
          <Field label="Tariff (₹ per kWh)">{(p) => <Input {...p} type="number" step="0.01" min={0} value={f.tariffPerKwh} onChange={(e) => setF({ ...f, tariffPerKwh: e.target.value })} />}</Field>
          <Field label="Grid emission factor (kg CO₂/kWh)" hint="India grid average from the CEA CO₂ database">{(p) => <Input {...p} type="number" step="0.001" min={0} value={f.gridFactor} onChange={(e) => setF({ ...f, gridFactor: e.target.value })} />}</Field>
        </div>
        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">Incoming meters</legend>
          <p className="mb-2 text-xs text-muted">Totals and demand use these; machine meters behind them are not added again. None ticked: all meters are added.</p>
          {meters.data?.map((m) => (
            <label key={m.id} className="flex items-center gap-2"><input type="checkbox" checked={f.mainSignalIds.includes(m.id)} onChange={(e) => setF({ ...f, mainSignalIds: e.target.checked ? [...f.mainSignalIds, m.id] : f.mainSignalIds.filter((x) => x !== m.id) })} /> {m.code} · {m.name}</label>
          ))}
        </fieldset>
      </div>
    </Dialog>
  );
}
