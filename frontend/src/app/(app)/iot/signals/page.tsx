"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtValue, PROTOCOLS, PURPOSES, type Gateway, type Signal, type SignalSource } from "@/lib/iot";
import { DataTable } from "@/components/ui/data-table";

interface Machine { id: string; code: string; name: string }
interface Warehouse { id: string; code: string; name: string }

const blank = { code: "", name: "", gatewayId: "", machineId: "", warehouseId: "", vehicleNo: "", purpose: "other", unit: "", scale: "1", offset: "0", deadband: "0", isActive: true, source: { protocol: "modbus-tcp" } as SignalSource };
type Form = typeof blank;

/** Signals (tags): what each machine or sensor sends and how the edge agent reads it. */
export default function SignalsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("iot.devices.manage");
  const list = useQuery({ queryKey: ["/iot/signals"], queryFn: () => api<Signal[]>("/iot/signals") });
  const gateways = useQuery({ queryKey: ["/iot/gateways"], queryFn: () => api<Gateway[]>("/iot/gateways") });
  const machines = useQuery({ queryKey: ["/manufacturing/machines"], queryFn: () => api<Machine[]>("/manufacturing/machines"), enabled: manage });
  const warehouses = useQuery({ queryKey: ["/inventory/warehouses"], queryFn: () => api<Warehouse[]>("/inventory/warehouses"), enabled: manage });
  const [edit, setEdit] = useState<{ id: string | null; form: Form } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(s?: Signal) {
    setError(null);
    setEdit(
      s
        ? { id: s.id, form: { code: s.code, name: s.name, gatewayId: s.gatewayId ?? "", machineId: s.machineId ?? "", warehouseId: s.warehouseId ?? "", vehicleNo: s.vehicleNo ?? "", purpose: s.purpose, unit: s.unit ?? "", scale: String(s.scale), offset: String(s.offset), deadband: String(s.deadband), isActive: s.isActive, source: s.source } }
        : { id: null, form: { ...blank, gatewayId: gateways.data?.[0]?.id ?? "" } },
    );
  }
  async function save() {
    if (!edit) return;
    const f = edit.form;
    setBusy(true);
    setError(null);
    const source = Object.fromEntries(Object.entries(f.source).filter(([, v]) => v !== "" && v !== undefined));
    if (source.unitId !== undefined) source.unitId = Number(source.unitId);
    const body = { code: f.code, name: f.name, gatewayId: f.gatewayId || null, machineId: f.machineId || null, warehouseId: f.warehouseId || null, vehicleNo: f.vehicleNo || null, purpose: f.purpose, unit: f.unit || null, scale: Number(f.scale), offset: Number(f.offset), deadband: Number(f.deadband), isActive: f.isActive, source };
    try {
      await (edit.id ? api(`/iot/signals/${edit.id}`, { method: "PUT", body }) : api("/iot/signals", { body }));
      setEdit(null);
      qc.invalidateQueries({ queryKey: ["/iot/signals"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  const f = edit?.form;
  const set = (patch: Partial<Form>) => edit && setEdit({ ...edit, form: { ...edit.form, ...patch } });
  const src = (patch: Partial<SignalSource>) => f && set({ source: { ...f.source, ...patch } as SignalSource });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Signals" description="Each signal is one value from a machine or sensor: a counter, a running state, a temperature, an energy meter. The edge agent downloads this list and reads each signal as set here." actions={manage && <Button onClick={() => open()}><Plus className="size-4" aria-hidden /> Add signal</Button>} />
      <Card>
        <DataTable
          rows={list.data ?? []}
          rowKey={(s) => String(s.id)}
          rowClassName={(s) => s.isActive ? "" : "opacity-60"}
          exportName="iot-signals"
          storageKey="iot-signals-0"
          empty={<p className="px-4 py-6 text-center text-sm text-muted">No signals yet.</p>}
          columns={[
            { key: "signal", label: "Signal", locked: true, className: "whitespace-normal", render: (s) => <><Link className="font-mono text-xs text-primary hover:underline" href={`/iot/signals/${s.id}`}>{s.code}</Link><p>{s.name} <span className="text-xs text-muted">· {PURPOSES[s.purpose] ?? s.purpose}</span></p></> },
            { key: "machine-place", label: "Machine / place", className: "text-xs whitespace-normal", render: (s) => <>{s.machineCode ? `${s.machineCode} ${s.machineName}` : s.warehouseName ?? s.vehicleNo ?? "–"}</> },
            { key: "read-by", label: "Read by", className: "text-xs whitespace-normal", render: (s) => <>{PROTOCOLS[s.source.protocol] ?? s.source.protocol}{s.source.address ? ` · ${s.source.address}` : ""}{s.gatewayCode ? <span className="block text-muted">{s.gatewayCode}</span> : null}</> },
            { key: "last-value", label: "Last value", align: "right", render: (s) => <><span className={`tabular-nums ${s.stale ? "text-muted" : ""}`}>{fmtValue(s.lastValue, s.unit)}</span>{s.lastAt && <span className="block text-[11px] text-muted">{timeAgo(s.lastAt)}</span>}{s.openAlarms > 0 && <Badge tone="danger">alarm</Badge>}</> },
            { key: "col4", label: "", align: "right", noSort: true, render: (s) => <>{manage && <Button size="sm" variant="ghost" onClick={() => open(s)}>Edit</Button>}</> },
          ]}
        />
      </Card>
      <Dialog open={!!edit} onClose={() => setEdit(null)} size="lg" title={edit?.id ? "Edit signal" : "Add a signal"} footer={<Button loading={busy} disabled={!f?.code || (f?.name.length ?? 0) < 2} onClick={save}>Save</Button>}>
        {f && (
          <div className="space-y-3">
            {error && <Alert>{error}</Alert>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tag code" required hint="Unique, e.g. IMM-01.shots">{(p) => <Input {...p} className="font-mono" value={f.code} onChange={(e) => set({ code: e.target.value })} />}</Field>
              <Field label="Name" required>{(p) => <Input {...p} value={f.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
              <Field label="What it measures">{(p) => <Select {...p} value={f.purpose} onChange={(e) => set({ purpose: e.target.value })}>{Object.entries(PURPOSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
              <Field label="Unit">{(p) => <Input {...p} value={f.unit} placeholder="°C, kWh, mm/s" onChange={(e) => set({ unit: e.target.value })} />}</Field>
              <Field label="Machine">{(p) => <Select {...p} value={f.machineId} onChange={(e) => set({ machineId: e.target.value })}><option value="">—</option>{machines.data?.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</Select>}</Field>
              <Field label="Store (for loggers)">{(p) => <Select {...p} value={f.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}><option value="">—</option>{warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field>
              <Field label="Gateway">{(p) => <Select {...p} value={f.gatewayId} onChange={(e) => set({ gatewayId: e.target.value })}><option value="">Any (sent through the API)</option>{gateways.data?.map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}</Select>}</Field>
              <Field label="Read with">{(p) => <Select {...p} value={f.source.protocol} onChange={(e) => set({ source: { protocol: e.target.value as SignalSource["protocol"] } })}>{Object.entries(PROTOCOLS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
              {f.source.protocol === "modbus-tcp" && (
                <>
                  <Field label="PLC address" hint="host:port">{(p) => <Input {...p} value={String(f.source.endpoint ?? "")} placeholder="192.168.1.20:502" onChange={(e) => src({ endpoint: e.target.value })} />}</Field>
                  <Field label="Register">{(p) => <Input {...p} value={String(f.source.address ?? "")} placeholder="40 (zero-based)" onChange={(e) => src({ address: e.target.value })} />}</Field>
                  <Field label="Table">{(p) => <Select {...p} value={String(f.source.table ?? "holding")} onChange={(e) => src({ table: e.target.value })}><option value="holding">Holding register</option><option value="input">Input register</option><option value="coil">Coil</option></Select>}</Field>
                  <Field label="Data type">{(p) => <Select {...p} value={String(f.source.dataType ?? "uint16")} onChange={(e) => src({ dataType: e.target.value })}>{["uint16", "int16", "uint32", "int32", "float32"].map((d) => <option key={d}>{d}</option>)}</Select>}</Field>
                  <Field label="Unit id">{(p) => <Input {...p} type="number" value={String(f.source.unitId ?? 1)} onChange={(e) => src({ unitId: Number(e.target.value) })} />}</Field>
                </>
              )}
              {f.source.protocol === "mqtt" && (
                <>
                  <Field label="Broker">{(p) => <Input {...p} value={String(f.source.endpoint ?? "")} placeholder="mqtt://192.168.1.5:1883" onChange={(e) => src({ endpoint: e.target.value })} />}</Field>
                  <Field label="Topic" hint="+ and # allowed">{(p) => <Input {...p} value={String(f.source.address ?? "")} placeholder="plant1/imm01/shots" onChange={(e) => src({ address: e.target.value })} />}</Field>
                  <Field label="JSON path" hint="Leave empty for a plain number">{(p) => <Input {...p} value={String(f.source.path ?? "")} placeholder="data.value" onChange={(e) => src({ path: e.target.value })} />}</Field>
                </>
              )}
              {f.source.protocol === "http-json" && (
                <>
                  <Field label="URL">{(p) => <Input {...p} value={String(f.source.address ?? "")} placeholder="http://scada.local/api/tags" onChange={(e) => src({ address: e.target.value })} />}</Field>
                  <Field label="JSON path">{(p) => <Input {...p} value={String(f.source.path ?? "")} placeholder="tags.0.value" onChange={(e) => src({ path: e.target.value })} />}</Field>
                </>
              )}
              {f.source.protocol === "simulator" && (
                <Field label="Pattern" hint="sine:min:max:periodSec · counter:perMinute · state:runPct · noise:mean:spread">{(p) => <Input {...p} value={String(f.source.address ?? "")} placeholder="sine:60:85:600" onChange={(e) => src({ address: e.target.value })} />}</Field>
              )}
              <Field label="Scale" hint="value = raw × scale + offset">{(p) => <Input {...p} type="number" step="any" value={f.scale} onChange={(e) => set({ scale: e.target.value })} />}</Field>
              <Field label="Offset">{(p) => <Input {...p} type="number" step="any" value={f.offset} onChange={(e) => set({ offset: e.target.value })} />}</Field>
              <Field label="Deadband" hint="Send only changes larger than this">{(p) => <Input {...p} type="number" step="any" min={0} value={f.deadband} onChange={(e) => set({ deadband: e.target.value })} />}</Field>
              <Field label="Vehicle (for loggers)">{(p) => <Input {...p} value={f.vehicleNo} placeholder="TS08UB4455" onChange={(e) => set({ vehicleNo: e.target.value })} />}</Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Active</label>
          </div>
        )}
      </Dialog>
    </div>
  );
}
