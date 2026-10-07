"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Param { param: string; unit: string; alertLimit: number | null; actionLimit: number | null; direction: "above" | "below" }
interface Location { id: string; code: string; name: string; room: string | null; grade: string; parameters: Param[]; isActive: boolean; latest: { param: string; value: number; status: string; sampledAt: string }[] | null; excursions: number }
interface Sample { id: string; param: string; value: number; sampledAt: string; status: string; condition: string; notes: string | null; deviationId: string | null; deviationNumber: string | null; locationCode: string; grade: string; sampledBy: string | null }

const PARAMS: Record<string, string> = { viable_settle: "Settle plates", viable_active: "Active air", viable_contact: "Contact plates", particles_0_5: "Particles ≥ 0.5 µm", particles_5_0: "Particles ≥ 5.0 µm", temperature: "Temperature", humidity: "Humidity", diff_pressure: "Pressure differential" };
const TONE: Record<string, "success" | "warning" | "danger"> = { ok: "success", alert: "warning", action: "danger" };

/** Environmental monitoring of clean rooms: results against alert and action limits (EU GMP Annex 1 by default). */
export default function EnvironmentPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("gmp.environment.manage");
  const locations = useQuery({ queryKey: ["/gmp/em/locations"], queryFn: () => api<Location[]>("/gmp/em/locations") });
  const [status, setStatus] = useState("");
  const samples = useQuery({ queryKey: ["/gmp/em/samples", status], queryFn: () => api<Sample[]>("/gmp/em/samples", { query: status ? { status } : {} }) });
  const [sample, setSample] = useState({ locationId: "", param: "", value: "", condition: "in_operation", notes: "" });
  const [newLoc, setNewLoc] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const loc = locations.data?.find((l) => l.id === sample.locationId);
  async function record() {
    setMsg(null);
    try {
      const r = await api<{ status: string; deviationId?: string }>("/gmp/em/samples", { body: { locationId: sample.locationId, param: sample.param, value: Number(sample.value), condition: sample.condition, notes: sample.notes || null } });
      setMsg(r.status === "action" ? { tone: "danger", text: "Action limit exceeded: a deviation was raised." } : r.status === "alert" ? { tone: "warning", text: "Alert limit exceeded." } : { tone: "success", text: "Recorded: within limits." });
      setSample({ ...sample, value: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["/gmp/em"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Environmental monitoring" description="Viable and non-viable counts, temperature, humidity and pressure differentials per location. Locations use EU GMP Annex 1 action limits for their grade unless they set their own; an action-limit result raises a deviation." actions={manage && <Button onClick={() => setNewLoc(true)}><Plus className="size-4" aria-hidden /> Location</Button>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {locations.data?.map((l) => (
          <Card key={l.id} className="p-4 text-sm">
            <div className="flex items-center gap-2"><span className="font-medium">{l.code} · {l.name}</span><Badge className="ml-auto">grade {l.grade}</Badge></div>
            <ul className="mt-2 space-y-0.5">
              {l.parameters.map((p) => {
                const last = l.latest?.find((x) => x.param === p.param);
                return <li key={p.param} className="flex justify-between"><span>{PARAMS[p.param] ?? p.param}</span><span>{last ? <Badge tone={TONE[last.status]}>{last.value} {p.unit}</Badge> : <span className="text-muted">–</span>}</span></li>;
              })}
            </ul>
            {l.excursions > 0 && <p className="mt-2 text-xs text-danger">{l.excursions} excursion(s) in 30 days</p>}
          </Card>
        ))}
      </div>
      {manage && (
        <Card>
          <CardHeader title="Record a result" />
          <div className="flex flex-wrap gap-2 border-t border-border p-4">
            <Select className="h-9 w-56" aria-label="Location" value={sample.locationId} onChange={(e) => setSample({ ...sample, locationId: e.target.value, param: "" })}><option value="">Location…</option>{locations.data?.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</Select>
            <Select className="h-9 w-48" aria-label="Parameter" value={sample.param} onChange={(e) => setSample({ ...sample, param: e.target.value })}><option value="">Parameter…</option>{loc?.parameters.map((p) => <option key={p.param} value={p.param}>{PARAMS[p.param]} ({p.unit})</option>)}</Select>
            <Input className="h-9 w-28" type="number" step="any" aria-label="Result" placeholder="Result" value={sample.value} onChange={(e) => setSample({ ...sample, value: e.target.value })} />
            <Select className="h-9 w-36" aria-label="Condition" value={sample.condition} onChange={(e) => setSample({ ...sample, condition: e.target.value })}><option value="in_operation">In operation</option><option value="at_rest">At rest</option></Select>
            <Input className="h-9 flex-1" aria-label="Notes" placeholder="Notes" value={sample.notes} onChange={(e) => setSample({ ...sample, notes: e.target.value })} />
            <Button disabled={!sample.param || sample.value === ""} onClick={record}>Record</Button>
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="Results" action={<Select className="h-9 w-40" aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All (30 days)</option><option value="alert">Alerts</option><option value="action">Action</option></Select>} />
        <table className="w-full border-t border-border text-sm">
          <tbody className="divide-y divide-border">
            {samples.data?.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-1.5">{formatDateTime(s.sampledAt)}</td>
                <td className="px-4 py-1.5">{s.locationCode} (grade {s.grade})</td>
                <td className="px-4 py-1.5">{PARAMS[s.param] ?? s.param} · {s.condition.replace("_", " ")}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{s.value}</td>
                <td className="px-4 py-1.5"><Badge tone={TONE[s.status]}>{s.status}</Badge>{s.deviationId && <Link className="ml-2 text-xs text-primary hover:underline" href={`/quality/deviations/${s.deviationId}`}>{s.deviationNumber ?? "deviation"}</Link>}</td>
                <td className="px-4 py-1.5 text-xs text-muted">{s.sampledBy}</td>
              </tr>
            ))}
            {samples.data && !samples.data.length && <tr><td className="px-4 py-6 text-center text-muted">No results.</td></tr>}
          </tbody>
        </table>
      </Card>
      {newLoc && <LocationDialog onClose={() => { setNewLoc(false); qc.invalidateQueries({ queryKey: ["/gmp/em"] }); }} />}
    </div>
  );
}

function LocationDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ code: "", name: "", room: "", grade: "C", params: { viable_settle: true, particles_0_5: true } as Record<string, boolean> });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api("/gmp/em/locations", { body: { code: f.code, name: f.name, room: f.room || null, grade: f.grade, parameters: Object.entries(f.params).filter(([, v]) => v).map(([param]) => ({ param, direction: param === "diff_pressure" ? "below" : "above" })) } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New monitoring location" description="Limits default to EU GMP Annex 1 for the grade; set your own alert limits later." footer={<Button disabled={!f.code || f.name.length < 2} onClick={save}>Save</Button>}>
      <div className="space-y-3 text-sm">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label="Code" placeholder="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <Input aria-label="Name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Select aria-label="Grade" value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })}>{["A", "B", "C", "D", "ISO5", "ISO6", "ISO7", "ISO8", "CNC"].map((g) => <option key={g}>{g}</option>)}</Select>
        </div>
        <fieldset className="grid grid-cols-2 gap-1">{Object.entries(PARAMS).map(([k, v]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!f.params[k]} onChange={(e) => setF({ ...f, params: { ...f.params, [k]: e.target.checked } })} /> {v}</label>)}</fieldset>
      </div>
    </Dialog>
  );
}
