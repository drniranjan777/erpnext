"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/documents";
import { MFG, type Machine, type Tool, type WorkCenter } from "@/lib/manufacturing";

type Edit = { kind: "wc"; row?: WorkCenter } | { kind: "machine"; row?: Machine } | { kind: "tool"; row?: Tool } | null;

export default function ResourcesPage() {
  const { can } = useAuth();
  const manage = can("manufacturing.engineering.manage");
  const qc = useQueryClient();
  const wcs = useQuery({ queryKey: [MFG, "wc"], queryFn: () => api<WorkCenter[]>(`${MFG}/work-centers`) });
  const machines = useQuery({ queryKey: [MFG, "machines"], queryFn: () => api<Machine[]>(`${MFG}/machines`) });
  const tools = useQuery({ queryKey: [MFG, "tools"], queryFn: () => api<Tool[]>(`${MFG}/tools`) });
  const [edit, setEdit] = useState<Edit>(null);
  const hourly = (w: WorkCenter) => Number(w.labourRate) + Number(w.machineRate) + Number(w.overheadRate);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Work centres, machines and tools" description="Where operations run, what they cost per hour, and the moulds and dies they use." />
      <Card>
        <CardHeader title="Work centres" action={manage ? <Button size="sm" variant="secondary" onClick={() => setEdit({ kind: "wc" })}><Plus className="size-4" aria-hidden /> Add</Button> : undefined} />
        <table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Work centre</th><th className="px-4 py-2 font-medium">Kind</th><th className="px-4 py-2 text-right font-medium">Capacity / day</th><th className="px-4 py-2 text-right font-medium">Labour</th><th className="px-4 py-2 text-right font-medium">Machine</th><th className="px-4 py-2 text-right font-medium">Overhead</th><th className="px-4 py-2 text-right font-medium">Per hour</th></tr></thead>
          <tbody className="divide-y divide-border">
            {(wcs.data ?? []).map((w) => (
              <tr key={w.id} className={manage ? "cursor-pointer hover:bg-surface-muted/50" : ""} onClick={() => manage && setEdit({ kind: "wc", row: w })}>
                <td className="px-4 py-2"><span className="font-mono text-xs text-muted">{w.code}</span> {w.name}{!w.isActive && <Badge className="ml-1">Inactive</Badge>}</td>
                <td className="px-4 py-2 capitalize">{w.kind}</td>
                <td className="px-4 py-2 text-right tabular-nums">{(Number(w.hoursPerDay) * w.units).toFixed(1)} h</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(w.labourRate)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(w.machineRate)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(w.overheadRate)}</td>
                <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(hourly(w))}</td>
              </tr>
            ))}
            {wcs.data && !wcs.data.length && <tr><td colSpan={7} className="px-4 py-3 text-muted">No work centres yet</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Machines" action={manage && wcs.data?.length ? <Button size="sm" variant="secondary" onClick={() => setEdit({ kind: "machine" })}><Plus className="size-4" aria-hidden /> Add</Button> : undefined} />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {(machines.data ?? []).map((m) => <li key={m.id} className={`flex justify-between gap-3 px-5 py-2 ${manage ? "cursor-pointer hover:bg-surface-muted/50" : ""}`} onClick={() => manage && setEdit({ kind: "machine", row: m })}><span><span className="font-mono text-xs text-muted">{m.code}</span> {m.name}</span><span className="text-muted">{m.workCenter}{m.capacity && ` · ${m.capacity}`}</span></li>)}
            {machines.data && !machines.data.length && <li className="px-5 py-3 text-muted">None</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Moulds, dies and tools" action={manage ? <Button size="sm" variant="secondary" onClick={() => setEdit({ kind: "tool" })}><Plus className="size-4" aria-hidden /> Add</Button> : undefined} />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {(tools.data ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2">
                <button type="button" className="text-left" disabled={!manage} onClick={() => setEdit({ kind: "tool", row: t })}><span className="font-mono text-xs text-muted">{t.code}</span> {t.name}<span className="block text-xs text-muted">{t.kind} · {t.cavities} cavity · {t.shotsUsed.toLocaleString("en-IN")}{t.lifeShots && ` / ${t.lifeShots.toLocaleString("en-IN")}`} shots</span></button>
                <span className="flex items-center gap-2">
                  {t.lifeUsedPct !== null && <Badge tone={t.lifeUsedPct > 90 ? "danger" : t.lifeUsedPct > 75 ? "warning" : "neutral"}>{t.lifeUsedPct}% life</Badge>}
                  {t.maintenanceDue && <Badge tone="warning">Maintenance due</Badge>}
                  {t.maintenanceDue && manage && <Button size="sm" variant="ghost" onClick={async () => { await api(`${MFG}/tools/${t.id}/maintained`, { method: "POST" }); qc.invalidateQueries({ queryKey: [MFG, "tools"] }); }}>Done</Button>}
                </span>
              </li>
            ))}
            {tools.data && !tools.data.length && <li className="px-5 py-3 text-muted">None</li>}
          </ul>
        </Card>
      </div>
      {edit && <EditDialog edit={edit} wcs={wcs.data ?? []} machines={machines.data ?? []} onClose={() => setEdit(null)} onDone={() => qc.invalidateQueries({ queryKey: [MFG] })} />}
    </div>
  );
}

function EditDialog({ edit, wcs, machines, onClose, onDone }: { edit: NonNullable<Edit>; wcs: WorkCenter[]; machines: Machine[]; onClose: () => void; onDone: () => void }) {
  const r = edit.row as Record<string, unknown> | undefined;
  const [f, setF] = useState<Record<string, string>>((): Record<string, string> => {
    const s = (k: string, d = "") => (r?.[k] === null || r?.[k] === undefined ? d : String(r[k]));
    if (edit.kind === "wc") return { code: s("code"), name: s("name"), kind: s("kind", "machine"), hoursPerDay: s("hoursPerDay", "8"), units: s("units", "1"), efficiencyPct: s("efficiencyPct", "100"), daysPerWeek: s("daysPerWeek", "6"), shiftStart: r?.shiftStart === undefined ? "09:00" : `${String(Math.floor(Number(r.shiftStart) / 60)).padStart(2, "0")}:${String(Number(r.shiftStart) % 60).padStart(2, "0")}`, labourRate: s("labourRate", "0"), machineRate: s("machineRate", "0"), overheadRate: s("overheadRate", "0") };
    if (edit.kind === "machine") return { code: s("code"), name: s("name"), workCenterId: s("workCenterId", wcs[0]?.id ?? ""), make: s("make"), model: s("model"), serialNo: s("serialNo"), capacity: s("capacity"), requiresCleaning: s("requiresCleaning", "false") };
    return { code: s("code"), name: s("name"), kind: s("kind", "mould"), cavities: s("cavities", "1"), lifeShots: s("lifeShots"), maintenanceEvery: s("maintenanceEvery"), machineId: s("machineId"), status: s("status", "available") };
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const path = edit.kind === "wc" ? "work-centers" : edit.kind === "machine" ? "machines" : "tools";
  async function save() {
    setBusy(true);
    setError(null);
    const body =
      edit.kind === "wc"
        ? { ...f, units: Number(f.units), daysPerWeek: Number(f.daysPerWeek), shiftStart: (() => { const [h, m] = f.shiftStart.split(":").map(Number); return (h || 0) * 60 + (m || 0); })() }
        : edit.kind === "tool"
          ? { ...f, cavities: Number(f.cavities), lifeShots: f.lifeShots ? Number(f.lifeShots) : null, maintenanceEvery: f.maintenanceEvery ? Number(f.maintenanceEvery) : null, machineId: f.machineId || null }
          : { ...f, make: f.make || null, model: f.model || null, serialNo: f.serialNo || null, capacity: f.capacity || null, requiresCleaning: f.requiresCleaning === "true" };
    try {
      await api(`${MFG}/${path}${edit.row ? `/${edit.row.id}` : ""}`, { method: edit.row ? "PUT" : "POST", body });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  const title = `${edit.row ? "Edit" : "New"} ${edit.kind === "wc" ? "work centre" : edit.kind}`;
  return (
    <Dialog open onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code">{(p) => <Input {...p} className="font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />}</Field>
          <Field label="Name" className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={set("name")} />}</Field>
        </div>
        {edit.kind === "wc" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={set("kind")}><option value="machine">Machine</option><option value="line">Line</option><option value="manual">Manual</option><option value="subcontract">Sub-contract</option></Select>}</Field>
            <Field label="Hours / day">{(p) => <Input {...p} inputMode="decimal" value={f.hoursPerDay} onChange={set("hoursPerDay")} />}</Field>
            <Field label="Units (parallel)">{(p) => <Input {...p} inputMode="numeric" value={f.units} onChange={set("units")} />}</Field>
            <Field label="Working days">{(p) => <Select {...p} value={f.daysPerWeek} onChange={set("daysPerWeek")}><option value="5">Mon–Fri</option><option value="6">Mon–Sat</option><option value="7">Every day</option></Select>}</Field>
            <Field label="Shift starts">{(p) => <Input {...p} type="time" value={f.shiftStart} onChange={set("shiftStart")} />}</Field>
            <Field label="Efficiency %">{(p) => <Input {...p} inputMode="decimal" value={f.efficiencyPct} onChange={set("efficiencyPct")} />}</Field>
            <Field label="Labour ₹/h">{(p) => <Input {...p} inputMode="decimal" value={f.labourRate} onChange={set("labourRate")} />}</Field>
            <Field label="Machine ₹/h">{(p) => <Input {...p} inputMode="decimal" value={f.machineRate} onChange={set("machineRate")} />}</Field>
            <Field label="Overhead ₹/h">{(p) => <Input {...p} inputMode="decimal" value={f.overheadRate} onChange={set("overheadRate")} />}</Field>
          </div>
        )}
        {edit.kind === "machine" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Work centre">{(p) => <Select {...p} value={f.workCenterId} onChange={set("workCenterId")}>{wcs.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</Select>}</Field>
            <Field label="Capacity">{(p) => <Input {...p} placeholder="250 T, 5-axis…" value={f.capacity} onChange={set("capacity")} />}</Field>
            <Field label="Make">{(p) => <Input {...p} value={f.make} onChange={set("make")} />}</Field>
            <Field label="Serial no.">{(p) => <Input {...p} value={f.serialNo} onChange={set("serialNo")} />}</Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={f.requiresCleaning === "true"} onChange={(e) => setF({ ...f, requiresCleaning: String(e.target.checked) })} />
              Process equipment: must be cleaned before each batch
            </label>
          </div>
        )}
        {edit.kind === "tool" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={set("kind")}><option value="mould">Mould</option><option value="die">Die</option><option value="fixture">Fixture</option><option value="gauge">Gauge</option><option value="tool">Tool</option></Select>}</Field>
            <Field label="Cavities">{(p) => <Input {...p} inputMode="numeric" value={f.cavities} onChange={set("cavities")} />}</Field>
            <Field label="Status">{(p) => <Select {...p} value={f.status} onChange={set("status")}><option value="available">Available</option><option value="in_use">In use</option><option value="maintenance">Maintenance</option><option value="retired">Retired</option></Select>}</Field>
            <Field label="Life (shots)">{(p) => <Input {...p} inputMode="numeric" value={f.lifeShots} onChange={set("lifeShots")} />}</Field>
            <Field label="Service every (shots)">{(p) => <Input {...p} inputMode="numeric" value={f.maintenanceEvery} onChange={set("maintenanceEvery")} />}</Field>
            <Field label="On machine">{(p) => <Select {...p} value={f.machineId} onChange={set("machineId")}><option value="">—</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}</Select>}</Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}
