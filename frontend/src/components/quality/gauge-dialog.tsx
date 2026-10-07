"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { QMS, type Gauge } from "@/lib/qms";

export function GaugeDialog({ gauge, onClose }: { gauge?: Gauge; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: gauge?.code ?? "", name: gauge?.name ?? "", kind: gauge?.kind ?? "vernier", make: gauge?.make ?? "", serialNo: gauge?.serialNo ?? "", range: gauge?.range ?? "", leastCount: gauge?.leastCount ?? "", location: gauge?.location ?? "", owner: gauge?.owner ?? "", calibrationSource: gauge?.calibrationSource ?? "external", intervalDays: String(gauge?.intervalDays ?? 365), acceptance: gauge?.acceptance ?? "", lastCalibrated: gauge?.lastCalibrated ?? "", status: gauge?.status ?? "in_use" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    setError(null);
    const opt = (v: string) => v || null;
    try {
      await api(gauge ? `${QMS}/gauges/${gauge.id}` : `${QMS}/gauges`, { method: gauge ? "PUT" : "POST", body: { ...f, make: opt(f.make), serialNo: opt(f.serialNo), range: opt(f.range), leastCount: opt(f.leastCount), location: opt(f.location), owner: opt(f.owner), acceptance: opt(f.acceptance), lastCalibrated: opt(f.lastCalibrated), intervalDays: Number(f.intervalDays) || 365 } });
      qc.invalidateQueries({ queryKey: [QMS, "gauges"] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} size="lg" title={gauge ? `Edit ${gauge.code}` : "New gauge"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Code" required>{(p) => <Input {...p} className="font-mono uppercase" value={f.code} onChange={set("code")} />}</Field>
        <Field label="Name" required className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={set("name")} />}</Field>
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={set("kind")}>{["vernier", "micrometer", "gauge", "balance", "thermometer", "pressure", "other"].map((k) => <option key={k} value={k}>{k}</option>)}</Select>}</Field>
        <Field label="Range">{(p) => <Input {...p} placeholder="0–150 mm" value={f.range} onChange={set("range")} />}</Field>
        <Field label="Least count">{(p) => <Input {...p} placeholder="0.02 mm" value={f.leastCount} onChange={set("leastCount")} />}</Field>
        <Field label="Make">{(p) => <Input {...p} value={f.make} onChange={set("make")} />}</Field>
        <Field label="Serial no.">{(p) => <Input {...p} value={f.serialNo} onChange={set("serialNo")} />}</Field>
        <Field label="Location">{(p) => <Input {...p} value={f.location} onChange={set("location")} />}</Field>
        <Field label="Calibrated">{(p) => <Select {...p} value={f.calibrationSource} onChange={set("calibrationSource")}><option value="external">By an accredited lab</option><option value="internal">In-house</option></Select>}</Field>
        <Field label="Interval (days)">{(p) => <Input {...p} inputMode="numeric" value={f.intervalDays} onChange={set("intervalDays")} />}</Field>
        <Field label="Last calibrated" hint="For a gauge already in use">{(p) => <Input {...p} type="date" value={f.lastCalibrated} onChange={set("lastCalibrated")} />}</Field>
        <Field label="Acceptance criteria" className="sm:col-span-2">{(p) => <Input {...p} placeholder="± 0.02 mm at every point" value={f.acceptance} onChange={set("acceptance")} />}</Field>
        {gauge && <Field label="Status">{(p) => <Select {...p} value={f.status} onChange={set("status")}><option value="in_use">In use</option><option value="out_of_service">Out of service</option><option value="scrapped">Scrapped</option></Select>}</Field>}
      </div>
    </Dialog>
  );
}
