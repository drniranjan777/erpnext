"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { TMS } from "@/lib/tms";

interface Transporter { id: string; partyId: string; name: string; gstin: string | null; transporterGstId: string | null; isActive: boolean; vehicles: number }
interface Vehicle { id: string; regNo: string; ownership: string; vehicleType: string; capacityKg: string | null; transporter: string | null; driverName: string | null; driverPhone: string | null; isActive: boolean }
interface Contract { id: string; number: string; transporter: string; validFrom: string; validTo: string; rates: number; isActive: boolean }
type RateRow = { fromCity: string; toCity: string; toState: string; vehicleType: string; basis: string; rate: string; minCharge: string; perStop: string };
const blank: RateRow = { fromCity: "", toCity: "", toState: "", vehicleType: "", basis: "per_kg", rate: "", minCharge: "", perStop: "" };

export default function TmsSetupPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can("tms.setup.manage");
  const transporters = useQuery({ queryKey: [TMS, "transporters"], queryFn: () => api<Transporter[]>(`${TMS}/transporters`) });
  const vehicles = useQuery({ queryKey: [TMS, "vehicles"], queryFn: () => api<Vehicle[]>(`${TMS}/vehicles`) });
  const contracts = useQuery({ queryKey: [TMS, "contracts"], queryFn: () => api<Contract[]>(`${TMS}/contracts`) });
  const vendors = useQuery({ queryKey: ["/masters/parties", "vendors"], queryFn: () => api<{ items: { id: string; name: string }[] }>("/masters/parties", { query: { role: "vendor", limit: 200 } }), enabled: manage });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [tr, setTr] = useState("");
  const [v, setV] = useState({ regNo: "", vehicleType: "", ownership: "hired", capacityKg: "", transporterId: "", driverName: "", driverPhone: "" });
  const [c, setC] = useState({ transporterId: "", validFrom: "", validTo: "", rates: [{ ...blank }] });
  async function run(fn: () => Promise<unknown>, done: string, reset?: () => void) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      reset?.();
      qc.invalidateQueries({ queryKey: [TMS] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const n = (s: string) => (s ? Number(s) : null);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Transport setup" description="Transporters (vendors with their GST transporter ID), vehicles, and freight rate contracts by lane and vehicle type." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Transporters" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {transporters.data?.map((t) => <li key={t.id} className="flex gap-3 px-5 py-2"><span className="font-medium">{t.name}</span><span className="font-mono text-xs text-muted">{t.transporterGstId ?? "no transporter ID"}</span><span className="ml-auto text-xs text-muted">{t.vehicles} vehicle(s)</span></li>)}
        </ul>
        {manage && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
            <Field label="Vendor">{(p) => <Select {...p} className="w-64" value={tr} onChange={(e) => setTr(e.target.value)}><option value="">Choose…</option>{vendors.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
            <Button variant="secondary" disabled={!tr} onClick={() => run(() => api(`${TMS}/transporters`, { body: { partyId: tr } }), "Transporter added.", () => setTr(""))}>Add transporter</Button>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Vehicles" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {vehicles.data?.map((x) => <li key={x.id} className="flex flex-wrap gap-3 px-5 py-2"><span className="font-mono">{x.regNo}</span><Badge>{x.vehicleType}</Badge><span className="text-xs text-muted">{[x.ownership, x.capacityKg && `${formatQty(x.capacityKg)} kg`, x.transporter, x.driverName].filter(Boolean).join(" · ")}</span></li>)}
        </ul>
        {manage && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
            <Field label="Registration">{(p) => <Input {...p} className="w-36" value={v.regNo} onChange={(e) => setV({ ...v, regNo: e.target.value })} />}</Field>
            <Field label="Type">{(p) => <Input {...p} className="w-28" placeholder="17ft" value={v.vehicleType} onChange={(e) => setV({ ...v, vehicleType: e.target.value })} />}</Field>
            <Field label="Owned / hired">{(p) => <Select {...p} value={v.ownership} onChange={(e) => setV({ ...v, ownership: e.target.value })}><option value="hired">Hired</option><option value="own">Own</option></Select>}</Field>
            <Field label="Capacity (kg)">{(p) => <Input {...p} className="w-24" inputMode="decimal" value={v.capacityKg} onChange={(e) => setV({ ...v, capacityKg: e.target.value })} />}</Field>
            <Field label="Transporter">{(p) => <Select {...p} value={v.transporterId} onChange={(e) => setV({ ...v, transporterId: e.target.value })}><option value="">None</option>{transporters.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
            <Field label="Driver">{(p) => <Input {...p} className="w-32" value={v.driverName} onChange={(e) => setV({ ...v, driverName: e.target.value })} />}</Field>
            <Field label="Phone">{(p) => <Input {...p} className="w-32" value={v.driverPhone} onChange={(e) => setV({ ...v, driverPhone: e.target.value })} />}</Field>
            <Button variant="secondary" disabled={v.regNo.length < 6 || v.vehicleType.length < 2} onClick={() => run(() => api(`${TMS}/vehicles`, { body: { ...v, capacityKg: n(v.capacityKg), transporterId: v.transporterId || null, driverName: v.driverName || null, driverPhone: v.driverPhone || null } }), "Vehicle added.", () => setV({ regNo: "", vehicleType: "", ownership: "hired", capacityKg: "", transporterId: "", driverName: "", driverPhone: "" }))}>Add vehicle</Button>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Rate contracts" description="The most specific lane wins: a city beats a state beats any; a named vehicle type beats any." />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {contracts.data?.map((x) => <li key={x.id} className="flex gap-3 px-5 py-2"><span className="font-mono text-xs">{x.number}</span><span>{x.transporter}</span><span className="text-xs text-muted">{formatDate(x.validFrom)} to {formatDate(x.validTo)} · {x.rates} lane(s)</span></li>)}
        </ul>
        {manage && (
          <div className="space-y-3 border-t border-border p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Transporter">{(p) => <Select {...p} value={c.transporterId} onChange={(e) => setC({ ...c, transporterId: e.target.value })}><option value="">Choose…</option>{transporters.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
              <Field label="From">{(p) => <Input {...p} type="date" value={c.validFrom} onChange={(e) => setC({ ...c, validFrom: e.target.value })} />}</Field>
              <Field label="To">{(p) => <Input {...p} type="date" value={c.validTo} onChange={(e) => setC({ ...c, validTo: e.target.value })} />}</Field>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th>From city</th><th>To city</th><th>To state</th><th>Vehicle</th><th>Basis</th><th>Rate ₹</th><th>Minimum ₹</th><th>Per extra drop ₹</th><th /></tr></thead>
              <tbody>
                {c.rates.map((r, i) => {
                  const upd = (k: keyof RateRow, val: string) => setC({ ...c, rates: c.rates.map((x, j) => (j === i ? { ...x, [k]: val } : x)) });
                  return (
                    <tr key={i}>
                      <td><Input aria-label="From city" value={r.fromCity} onChange={(e) => upd("fromCity", e.target.value)} /></td>
                      <td><Input aria-label="To city" value={r.toCity} onChange={(e) => upd("toCity", e.target.value)} /></td>
                      <td><Input aria-label="To state code" className="w-16" placeholder="27" value={r.toState} onChange={(e) => upd("toState", e.target.value)} /></td>
                      <td><Input aria-label="Vehicle type" className="w-24" value={r.vehicleType} onChange={(e) => upd("vehicleType", e.target.value)} /></td>
                      <td><Select aria-label="Basis" value={r.basis} onChange={(e) => upd("basis", e.target.value)}><option value="per_kg">per kg</option><option value="per_trip">per trip</option><option value="per_km">per km</option></Select></td>
                      <td><Input aria-label="Rate" className="w-24" inputMode="decimal" value={r.rate} onChange={(e) => upd("rate", e.target.value)} /></td>
                      <td><Input aria-label="Minimum" className="w-24" inputMode="decimal" value={r.minCharge} onChange={(e) => upd("minCharge", e.target.value)} /></td>
                      <td><Input aria-label="Per extra drop" className="w-24" inputMode="decimal" value={r.perStop} onChange={(e) => upd("perStop", e.target.value)} /></td>
                      <td><Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setC({ ...c, rates: c.rates.length > 1 ? c.rates.filter((_, j) => j !== i) : [{ ...blank }] })}><Trash2 className="size-3.5" aria-hidden /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex justify-between">
              <Button size="sm" variant="ghost" onClick={() => setC({ ...c, rates: [...c.rates, { ...blank }] })}><Plus className="size-4" aria-hidden /> Lane</Button>
              <Button
                disabled={!c.transporterId || !c.validFrom || !c.validTo || !c.rates.some((r) => Number(r.rate) > 0)}
                onClick={() => run(() => api(`${TMS}/contracts`, { body: { transporterId: c.transporterId, validFrom: c.validFrom, validTo: c.validTo, rates: c.rates.filter((r) => Number(r.rate) > 0).map((r) => ({ fromCity: r.fromCity || null, toCity: r.toCity || null, toState: r.toState || null, vehicleType: r.vehicleType || null, basis: r.basis, rate: Number(r.rate), minCharge: n(r.minCharge), perStop: n(r.perStop) })) } }), "Contract saved.", () => setC({ transporterId: "", validFrom: "", validTo: "", rates: [{ ...blank }] }))}
              >
                Save contract
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
