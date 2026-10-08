"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty, todayIST } from "@/lib/documents";
import { QMS } from "@/lib/qms";
import { DataTable } from "@/components/ui/data-table";

type Tab = "incidents" | "waste" | "epr" | "licences";
interface Incident { id: string; occurredAt: string; kind: string; severity: string; location: string; description: string; personInvolved: string | null; lostDays: number; rootCause: string | null; status: "open" | "closed" }
interface Waste { id: string; category: string; qty: string; unit: string; generatedOn: string; storedAt: string | null; disposedOn: string | null; disposalAgency: string | null; manifestNo: string | null; storedTooLong: boolean }
interface Epr { id: string; category: string; fiscalYear: string; targetKg: string; achievedKg: string; pct: string | null }
interface Licence { id: string; name: string; kind: string; authority: string; number: string | null; validUntil: string | null; state: "expired" | "renew_now" | "valid" | "no_expiry"; daysLeft: number | null }
const LIC = { expired: { label: "Expired", tone: "danger" }, renew_now: { label: "Renew now", tone: "warning" }, valid: { label: "Valid", tone: "success" }, no_expiry: { label: "No expiry", tone: "neutral" } } as const;

function useCall(keys: unknown[]) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  async function call(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: keys });
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      return false;
    }
  }
  return { error, call };
}

export default function HsePage() {
  const [tab, setTab] = useState<Tab>("incidents");
  const stats = useQuery({ queryKey: [QMS, "hse", "stats"], queryFn: () => api<{ incidents: number; injuries: number; nearMisses: number; lostDays: number; open: number; daysSinceLostTime: number | null }>(`${QMS}/hse/stats`) });
  const s = stats.data;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Health, safety and environment" description="Incidents and near misses, the hazardous waste register, EPR targets and the licences and permits the plant runs on." />
      {s && (
        <div className="grid gap-3 sm:grid-cols-5">
          {[["Days without lost time", s.daysSinceLostTime ?? "–"], ["Incidents this year", s.incidents], ["Injuries", s.injuries], ["Near misses", s.nearMisses], ["Lost days", s.lostDays]].map(([l, v]) => <Card key={l} className="p-4"><p className="text-xs uppercase tracking-wide text-muted">{l}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p></Card>)}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "incidents", label: "Incidents" }, { value: "waste", label: "Hazardous waste" }, { value: "epr", label: "EPR" }, { value: "licences", label: "Licences & permits" }]} />
      {tab === "incidents" && <Incidents />}
      {tab === "waste" && <WasteTab />}
      {tab === "epr" && <EprTab />}
      {tab === "licences" && <Licences />}
    </div>
  );
}

function Incidents() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: [QMS, "hse", "incidents"], queryFn: () => api<Incident[]>(`${QMS}/hse/incidents`) });
  const { error, call } = useCall([QMS, "hse"]);
  const [f, setF] = useState(() => ({ occurredAt: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16), kind: "near_miss", severity: "minor", location: "", description: "", personInvolved: "", lostDays: "0" }));
  const [closing, setClosing] = useState<Record<string, string>>({});
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Report an incident" description="Anyone can report. Near misses matter: report them too." />
        <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-4">
          {error && <div className="sm:col-span-4"><Alert>{error}</Alert></div>}
          <Field label="When">{(p) => <Input {...p} type="datetime-local" value={f.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} />}</Field>
          <Field label="What">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="near_miss">Near miss</option><option value="injury">Injury</option><option value="property_damage">Property damage</option><option value="environmental">Environmental</option><option value="fire">Fire</option><option value="other">Other</option></Select>}</Field>
          <Field label="Severity">{(p) => <Select {...p} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="minor">Minor</option><option value="major">Major</option><option value="serious">Serious</option><option value="fatal">Fatal</option></Select>}</Field>
          <Field label="Where">{(p) => <Input {...p} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />}</Field>
          <Field label="What happened" className="sm:col-span-2">{(p) => <Input {...p} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
          <Field label="Person involved">{(p) => <Input {...p} value={f.personInvolved} onChange={(e) => setF({ ...f, personInvolved: e.target.value })} />}</Field>
          <Field label="Days lost">{(p) => <Input {...p} inputMode="numeric" value={f.lostDays} onChange={(e) => setF({ ...f, lostDays: e.target.value })} />}</Field>
          <div className="flex justify-end sm:col-span-4"><Button disabled={f.location.trim().length < 2 || f.description.trim().length < 3} onClick={async () => { if (await call(() => api(`${QMS}/hse/incidents`, { body: { ...f, occurredAt: new Date(`${f.occurredAt}:00+05:30`).toISOString(), personInvolved: f.personInvolved || null, lostDays: Number(f.lostDays) || 0 } }))) setF({ ...f, location: "", description: "", personInvolved: "", lostDays: "0" }); }}><Plus className="size-4" aria-hidden /> Report</Button></div>
        </div>
      </Card>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((i) => (
              <li key={i.id} className="space-y-1 px-5 py-3">
                <p className="flex flex-wrap items-center gap-2"><Badge tone={i.kind === "injury" || i.kind === "fire" ? "danger" : "warning"}>{i.kind.replace(/_/g, " ")}</Badge><span className="font-medium">{i.location}</span><span className="text-muted">{formatDateTime(i.occurredAt)} · {i.severity}{i.lostDays ? ` · ${i.lostDays} days lost` : ""}</span>{i.status === "closed" ? <Badge tone="success">Closed</Badge> : <Badge>Open</Badge>}</p>
                <p>{i.description}{i.personInvolved && <span className="text-muted"> ({i.personInvolved})</span>}</p>
                {i.rootCause && <p className="text-xs text-muted">Root cause: {i.rootCause}</p>}
                {i.status === "open" && can("hse.register.manage") && (
                  <div className="flex gap-2 pt-1">
                    <Input className="h-8 flex-1" aria-label="Root cause" placeholder="Root cause, to close" value={closing[i.id] ?? ""} onChange={(e) => setClosing({ ...closing, [i.id]: e.target.value })} />
                    <Button size="sm" variant="secondary" disabled={(closing[i.id] ?? "").trim().length < 3} onClick={() => call(() => api(`${QMS}/hse/incidents/${i.id}/close`, { body: { rootCause: closing[i.id] } }))}>Close</Button>
                  </div>
                )}
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-4 text-center text-muted">No incidents reported.</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}

function WasteTab() {
  const { can } = useAuth();
  const manage = can("hse.register.manage");
  const q = useQuery({ queryKey: [QMS, "hse", "waste"], queryFn: () => api<{ entries: Waste[]; stored: { category: string; unit: string; qty: string }[] }>(`${QMS}/hse/waste`) });
  const { error, call } = useCall([QMS, "hse"]);
  const [f, setF] = useState({ category: "", qty: "", unit: "kg", generatedOn: todayIST(), storedAt: "" });
  const [dispose, setDispose] = useState<{ id: string; disposedOn: string; disposalAgency: string; manifestNo: string } | null>(null);
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {manage && (
        <Card className="grid gap-3 p-4 sm:grid-cols-6">
          <Field label="Category (Schedule I)" className="sm:col-span-2">{(p) => <Input {...p} placeholder="5.1 Used or spent oil" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />}</Field>
          <Field label="Quantity">{(p) => <Input {...p} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
          <Field label="Unit">{(p) => <Select {...p} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{["kg", "t", "l", "kl", "nos"].map((u) => <option key={u} value={u}>{u}</option>)}</Select>}</Field>
          <Field label="Generated on">{(p) => <Input {...p} type="date" value={f.generatedOn} onChange={(e) => setF({ ...f, generatedOn: e.target.value })} />}</Field>
          <div className="flex items-end"><Button disabled={!f.category.trim() || !f.qty} onClick={async () => { if (await call(() => api(`${QMS}/hse/waste`, { body: { ...f, storedAt: f.storedAt || null } }))) setF({ ...f, category: "", qty: "" }); }}><Plus className="size-4" aria-hidden /> Add</Button></div>
        </Card>
      )}
      {q.isLoading && <LoadingBlock />}
      {q.data && (
        <>
          {q.data.stored.length > 0 && <p className="text-sm text-muted">In store: {q.data.stored.map((s) => `${s.category} ${formatQty(s.qty)} ${s.unit}`).join(" · ")}</p>}
          <Card>
            <DataTable
              rows={q.data.entries}
              rowKey={(w) => String(w.id)}
              exportName="hse"
              storageKey="hse-0"
              empty={<p className="px-4 py-6 text-center text-sm text-muted">Nothing recorded.</p>}
              columns={[
                { key: "waste", label: "Waste", locked: true, className: "whitespace-normal", render: (w) => <>{w.category}{w.storedTooLong && <Badge tone="danger" className="ml-2">Over 90 days</Badge>}</> },
                { key: "qty", label: "Qty", align: "right", render: (w) => <>{formatQty(w.qty)} {w.unit}</> },
                { key: "generated", label: "Generated", className: "whitespace-normal", render: (w) => <>{formatDate(w.generatedOn)}</> },
                { key: "disposal", label: "Disposal", className: "whitespace-normal", render: (w) => <>{w.disposedOn ? <>{formatDate(w.disposedOn)} · {w.disposalAgency}{w.manifestNo && <span className="text-xs text-muted"> · manifest {w.manifestNo}</span>}</> : manage && <Button size="sm" variant="ghost" onClick={() => setDispose({ id: w.id, disposedOn: todayIST(), disposalAgency: "", manifestNo: "" })}>Record disposal</Button>}</> },
              ]}
            />
          </Card>
        </>
      )}
      {dispose && (
        <Card className="grid gap-3 p-4 sm:grid-cols-4">
          <Field label="Disposed on">{(p) => <Input {...p} type="date" value={dispose.disposedOn} onChange={(e) => setDispose({ ...dispose, disposedOn: e.target.value })} />}</Field>
          <Field label="TSDF / recycler">{(p) => <Input {...p} value={dispose.disposalAgency} onChange={(e) => setDispose({ ...dispose, disposalAgency: e.target.value })} />}</Field>
          <Field label="Form 10 manifest">{(p) => <Input {...p} value={dispose.manifestNo} onChange={(e) => setDispose({ ...dispose, manifestNo: e.target.value })} />}</Field>
          <div className="flex items-end gap-2"><Button variant="secondary" onClick={() => setDispose(null)}>Cancel</Button><Button disabled={dispose.disposalAgency.trim().length < 2} onClick={async () => { if (await call(() => api(`${QMS}/hse/waste/${dispose.id}/dispose`, { body: { disposedOn: dispose.disposedOn, disposalAgency: dispose.disposalAgency, manifestNo: dispose.manifestNo || null } }))) setDispose(null); }}>Save</Button></div>
        </Card>
      )}
    </div>
  );
}

function EprTab() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: [QMS, "hse", "epr"], queryFn: () => api<Epr[]>(`${QMS}/hse/epr`) });
  const { error, call } = useCall([QMS, "hse"]);
  const fy = (() => { const t = todayIST(); const y = Number(t.slice(0, 4)) - (Number(t.slice(5, 7)) < 4 ? 1 : 0); return `${y}-${String(y + 1).slice(2)}`; })();
  const [f, setF] = useState({ category: "plastic_packaging", fiscalYear: fy, targetKg: "", achievedKg: "" });
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {can("hse.register.manage") && (
        <Card className="grid gap-3 p-4 sm:grid-cols-5">
          <Field label="Category">{(p) => <Select {...p} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="plastic_packaging">Plastic packaging</option><option value="e_waste">E-waste</option><option value="battery">Batteries</option><option value="tyre">Tyres</option><option value="used_oil">Used oil</option></Select>}</Field>
          <Field label="Financial year">{(p) => <Input {...p} value={f.fiscalYear} onChange={(e) => setF({ ...f, fiscalYear: e.target.value })} />}</Field>
          <Field label="Target (kg)">{(p) => <Input {...p} inputMode="decimal" value={f.targetKg} onChange={(e) => setF({ ...f, targetKg: e.target.value })} />}</Field>
          <Field label="Achieved (kg)">{(p) => <Input {...p} inputMode="decimal" value={f.achievedKg} onChange={(e) => setF({ ...f, achievedKg: e.target.value })} />}</Field>
          <div className="flex items-end"><Button disabled={!f.targetKg} onClick={() => call(() => api(`${QMS}/hse/epr`, { method: "PUT", body: { ...f, achievedKg: f.achievedKg || "0" } }))}>Save</Button></div>
        </Card>
      )}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((e) => (
              <li key={e.id} className="px-5 py-3">
                <div className="flex justify-between"><span>{e.category.replace(/_/g, " ")} · {e.fiscalYear}</span><span className="tabular-nums">{formatQty(e.achievedKg)} of {formatQty(e.targetKg)} kg ({e.pct ?? 0}%)</span></div>
                <div className="mt-1 h-2 rounded-full bg-surface-muted"><div className={`h-full rounded-full ${Number(e.pct) >= 100 ? "bg-success" : "bg-warning"}`} style={{ width: `${Math.min(100, Number(e.pct) || 0)}%` }} /></div>
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-4 text-center text-muted">No EPR obligations recorded.</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Licences() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: [QMS, "hse", "licences"], queryFn: () => api<Licence[]>(`${QMS}/hse/licences`) });
  const { error, call } = useCall([QMS, "hse"]);
  const [f, setF] = useState({ name: "", kind: "factory", authority: "", number: "", validUntil: "", renewalLeadDays: "60" });
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {can("hse.register.manage") && (
        <Card className="grid gap-3 p-4 sm:grid-cols-6">
          <Field label="Licence / permit" className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{[["factory", "Factory licence"], ["pollution_cte", "Consent to establish"], ["pollution_cto", "Consent to operate"], ["fire_noc", "Fire NOC"], ["peso", "PESO"], ["fssai", "FSSAI"], ["drug", "Drug licence"], ["boiler", "Boiler"], ["trade", "Trade licence"], ["other", "Other"]].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Authority">{(p) => <Input {...p} value={f.authority} onChange={(e) => setF({ ...f, authority: e.target.value })} />}</Field>
          <Field label="Valid until">{(p) => <Input {...p} type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />}</Field>
          <div className="flex items-end"><Button disabled={!f.name.trim() || !f.authority.trim()} onClick={async () => { if (await call(() => api(`${QMS}/hse/licences`, { body: { ...f, number: f.number || null, validUntil: f.validUntil || null, renewalLeadDays: Number(f.renewalLeadDays) || 60 } }))) setF({ ...f, name: "", authority: "", number: "", validUntil: "" }); }}><Plus className="size-4" aria-hidden /> Add</Button></div>
        </Card>
      )}
      {q.data && (
        <Card>
          <DataTable
            rows={q.data}
            rowKey={(l) => String(l.id)}
            exportName="hse"
            storageKey="hse-1"
            empty={<p className="px-4 py-6 text-center text-sm text-muted">No licences recorded.</p>}
            columns={[
              { key: "licence", label: "Licence", locked: true, className: "whitespace-normal", render: (l) => <>{l.name}{l.number && <span className="block text-xs text-muted">{l.number}</span>}</> },
              { key: "authority", label: "Authority", className: "whitespace-normal", render: (l) => <>{l.authority}</> },
              { key: "valid-until", label: "Valid until", className: "whitespace-normal", render: (l) => <>{l.validUntil ? formatDate(l.validUntil) : "–"}{l.daysLeft !== null && l.daysLeft >= 0 && <span className="block text-xs text-muted">{l.daysLeft} days left</span>}</> },
              { key: "state", label: "State", className: "whitespace-normal", render: (l) => <><Badge tone={LIC[l.state].tone}>{LIC[l.state].label}</Badge></> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
