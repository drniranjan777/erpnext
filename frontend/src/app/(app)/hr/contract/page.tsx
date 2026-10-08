"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save } from "lucide-react";
import { useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { HR, type OrgRow } from "@/lib/hr";
import { inr } from "@/lib/payroll";
import { DataTable } from "@/components/ui/data-table";

interface Contractor { id: string; code: string; name: string; licenceNo: string | null; licenceValidUntil: string | null; maxWorkers: number | null; work: string | null; locationId: string | null; location: string | null; workers: number; isActive: boolean; pfCode: string | null; esiCode: string | null; contactName: string | null; mobile: string | null }
interface Worker { id: string; code: string; name: string; contractorId: string; contractor: string; skill: string; dailyWage: string; uan: string | null; joinedOn: string; leftOn: string | null }
interface Compliance { workers: { workerId: string; code: string; name: string; contractor: string; present: number; otHours: number; minDaily: number | null; rate: number; dueGross: number; grossPaid: number | null; shortfall: number; issues: string[] }[]; contractors: { id: string; name: string; workers: number; withIssues: number; shortfall: number; alerts: string[] }[] }
type Tab = "contractors" | "workers" | "attendance" | "wages" | "compliance" | "minimum";
const SKILLS = { unskilled: "Unskilled", semi_skilled: "Semi-skilled", skilled: "Skilled", highly_skilled: "Highly skilled" };
const lastMonth = () => {
  const d = new Date(`${todayIST().slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

export default function ContractLabourPage() {
  const { can } = useAuth();
  const manage = can("hr.contract.manage");
  const [tab, setTab] = useState<Tab>("compliance");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Contract labour" description="Contractors and their CLRA licences, contract workers, gate attendance, and the check that contractors pay at least what is due (the principal employer is liable if they don't)." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "compliance", label: "Wage compliance" }, { value: "contractors", label: "Contractors" }, { value: "workers", label: "Workers" }, { value: "attendance", label: "Gate attendance" }, { value: "wages", label: "Wages paid" }, { value: "minimum", label: "Minimum wages" }]} />
      {tab === "contractors" && <Contractors manage={manage} />}
      {tab === "workers" && <Workers manage={manage} />}
      {tab === "attendance" && <Attendance manage={manage} />}
      {tab === "wages" && <Wages manage={manage} />}
      {tab === "compliance" && <ComplianceView />}
      {tab === "minimum" && <MinimumWages manage={manage} />}
    </div>
  );
}

function useAct() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  async function act(path: string, body: unknown, method: "POST" | "PUT" = "POST") {
    setError(null);
    try {
      await api(path, { method, body });
      await qc.invalidateQueries({ queryKey: [HR, "contract"] });
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      return false;
    }
  }
  return { error, act };
}

const useContractors = () => useQuery({ queryKey: [HR, "contract", "contractors"], queryFn: () => api<Contractor[]>(`${HR}/contractors`) });

function Contractors({ manage }: { manage: boolean }) {
  const q = useContractors();
  const [editing, setEditing] = useState<Contractor | "new" | null>(null);
  const today = todayIST();
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <>
      {manage && <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Contractor</Button>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {q.data!.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <span className="w-20 font-mono text-xs text-muted">{c.code}</span>
              <button className="font-medium text-primary hover:underline" disabled={!manage} onClick={() => setEditing(c)}>{c.name}</button>
              <span className="text-xs text-muted">{[c.work, c.location].filter(Boolean).join(" · ")}</span>
              <span className="ml-auto text-xs">{c.workers}{c.maxWorkers ? ` of ${c.maxWorkers}` : ""} workers</span>
              {c.licenceNo ? <Badge tone={c.licenceValidUntil && c.licenceValidUntil < today ? "danger" : "neutral"}>{c.licenceNo}{c.licenceValidUntil && ` · to ${formatDate(c.licenceValidUntil)}`}</Badge> : <Badge tone="warning">no licence</Badge>}
            </li>
          ))}
          {!q.data!.length && <li className="px-5 py-6 text-center text-muted">No contractors yet.</li>}
        </ul>
      </Card>
      {editing && <ContractorDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ContractorDialog({ row, onClose }: { row: Contractor | null; onClose: () => void }) {
  const { error, act } = useAct();
  const locs = useQuery({ queryKey: [HR, "org", "locations"], queryFn: () => api<OrgRow[]>(`${HR}/org/locations`) });
  const [f, setF] = useState({ code: row?.code ?? "", name: row?.name ?? "", licenceNo: row?.licenceNo ?? "", licenceValidUntil: row?.licenceValidUntil ?? "", maxWorkers: row?.maxWorkers ? String(row.maxWorkers) : "", work: row?.work ?? "", locationId: row?.locationId ?? "", pfCode: row?.pfCode ?? "", esiCode: row?.esiCode ?? "", contactName: row?.contactName ?? "", mobile: row?.mobile ?? "", isActive: row?.isActive ?? true });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => v || null;
  async function save() {
    const body = { ...f, licenceNo: n(f.licenceNo), licenceValidUntil: n(f.licenceValidUntil), maxWorkers: f.maxWorkers ? Number(f.maxWorkers) : null, work: n(f.work), locationId: n(f.locationId), pfCode: n(f.pfCode), esiCode: n(f.esiCode), contactName: n(f.contactName), mobile: n(f.mobile) };
    if (await act(row ? `${HR}/contractors/${row.id}` : `${HR}/contractors`, body, row ? "PUT" : "POST")) onClose();
  }
  return (
    <Dialog open onClose={onClose} title={row ? row.name : "New contractor"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={set("code")} />}</Field>
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={set("name")} />}</Field>
        <Field label="CLRA licence no.">{(p) => <Input {...p} value={f.licenceNo} onChange={set("licenceNo")} />}</Field>
        <Field label="Licence valid until">{(p) => <Input {...p} type="date" value={f.licenceValidUntil} onChange={set("licenceValidUntil")} />}</Field>
        <Field label="Workers allowed">{(p) => <Input {...p} type="number" value={f.maxWorkers} onChange={set("maxWorkers")} />}</Field>
        <Field label="Location">{(p) => <Select {...p} value={f.locationId} onChange={set("locationId")}><option value="">—</option>{locs.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}</Field>
        <Field label="Nature of work" className="sm:col-span-2">{(p) => <Input {...p} value={f.work} onChange={set("work")} />}</Field>
        <Field label="PF code">{(p) => <Input {...p} value={f.pfCode} onChange={set("pfCode")} />}</Field>
        <Field label="ESI code">{(p) => <Input {...p} value={f.esiCode} onChange={set("esiCode")} />}</Field>
        <Field label="Contact person">{(p) => <Input {...p} value={f.contactName} onChange={set("contactName")} />}</Field>
        <Field label="Mobile">{(p) => <Input {...p} value={f.mobile} onChange={set("mobile")} />}</Field>
      </div>
    </Dialog>
  );
}

const useWorkers = (current = true) => useQuery({ queryKey: [HR, "contract", "workers", current], queryFn: () => api<Worker[]>(`${HR}/contract-workers`, { query: { current: current ? "true" : undefined } }) });

function Workers({ manage }: { manage: boolean }) {
  const q = useWorkers(false);
  const contractors = useContractors();
  const { error, act } = useAct();
  const [f, setF] = useState({ contractorId: "", code: "", name: "", skill: "unskilled", dailyWage: "", uan: "", joinedOn: todayIST() });
  if (q.isLoading) return <LoadingBlock />;
  return (
    <Card>
      <DataTable
        rows={q.data ?? []}
        rowKey={(w) => String(w.id)}
        exportName="hr-contract"
        storageKey="hr-contract-0"
        empty={<p className="px-4 py-6 text-center text-sm text-muted">No contract workers.</p>}
        columns={[
          { key: "worker", label: "Worker", locked: true, className: "whitespace-normal", render: (w) => <><span className="font-medium">{w.name}</span> <span className="font-mono text-xs text-muted">{w.code}</span></> },
          { key: "contractor", label: "Contractor", className: "whitespace-normal", render: (w) => <>{w.contractor}</> },
          { key: "skill", label: "Skill", className: "whitespace-normal", render: (w) => <>{SKILLS[w.skill as keyof typeof SKILLS] ?? w.skill}</> },
          { key: "daily-wage", label: "Daily wage", align: "right", render: (w) => <>{inr(w.dailyWage)}</> },
          { key: "uan", label: "UAN", className: "font-mono text-xs whitespace-normal", render: (w) => <>{w.uan ?? "–"}</> },
          { key: "engaged", label: "Engaged", className: "text-xs whitespace-normal", render: (w) => <>{formatDate(w.joinedOn)}{w.leftOn && ` – ${formatDate(w.leftOn)}`}</> },
        ]}
      />
      {manage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Contractor">{(p) => <Select {...p} value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}><option value="">Choose…</option>{contractors.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Code">{(p) => <Input {...p} className="w-24" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
          <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Skill">{(p) => <Select {...p} value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value })}>{Object.entries(SKILLS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Daily wage">{(p) => <Input {...p} className="w-24" inputMode="decimal" value={f.dailyWage} onChange={(e) => setF({ ...f, dailyWage: e.target.value })} />}</Field>
          <Field label="UAN">{(p) => <Input {...p} className="w-36" value={f.uan} onChange={(e) => setF({ ...f, uan: e.target.value })} />}</Field>
          <Field label="Joined">{(p) => <Input {...p} type="date" value={f.joinedOn} onChange={(e) => setF({ ...f, joinedOn: e.target.value })} />}</Field>
          <Button size="sm" disabled={!f.contractorId || !f.code || !f.name || !Number(f.dailyWage)} onClick={async () => (await act(`${HR}/contract-workers`, { ...f, dailyWage: Number(f.dailyWage), uan: f.uan || null })) && setF({ ...f, code: "", name: "", uan: "" })}><Plus className="size-4" aria-hidden /> Add</Button>
        </div>
      )}
    </Card>
  );
}

function Attendance({ manage }: { manage: boolean }) {
  const [date, setDate] = useState(todayIST);
  const workers = useWorkers(true);
  const { error, act } = useAct();
  const [marks, setMarks] = useState<Record<string, { status: string; otHours: string }>>({});
  const [saved, setSaved] = useState(false);
  const month = useQuery({ queryKey: [HR, "contract", "muster", date.slice(0, 7)], queryFn: () => api<{ rows: { id: string; days: Record<string, string> }[] }>(`${HR}/contract-attendance`, { query: { month: date.slice(0, 7) } }) });
  const current = (w: Worker) => marks[w.id] ?? { status: month.data?.rows.find((r) => r.id === w.id)?.days[date] ?? "P", otHours: "0" };
  const engaged = workers.data?.filter((w) => w.joinedOn <= date && (!w.leftOn || w.leftOn >= date)) ?? [];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <Input className="h-9 w-44" type="date" max={todayIST()} aria-label="Date" value={date} onChange={(e) => { setDate(e.target.value); setMarks({}); setSaved(false); }} />
        {manage && <Button size="sm" disabled={!engaged.length} onClick={async () => setSaved(await act(`${HR}/contract-attendance`, { date, entries: engaged.map((w) => ({ workerId: w.id, status: current(w).status, otHours: Number(current(w).otHours) || 0 })) }))}><Save className="size-4" aria-hidden /> Save attendance</Button>}
        {saved && <span className="text-sm text-success">Saved.</span>}
      </div>
      {error && <div className="p-4"><Alert>{error}</Alert></div>}
      <ul className="divide-y divide-border text-sm">
        {engaged.map((w) => (
          <li key={w.id} className="flex items-center gap-3 px-5 py-1.5">
            <span className="flex-1"><span className="font-medium">{w.name}</span> <span className="text-xs text-muted">{w.contractor}</span></span>
            {(["P", "HD", "A"] as const).map((s) => <label key={s} className="flex items-center gap-1 text-xs"><input type="radio" name={`s-${w.id}`} disabled={!manage} checked={current(w).status === s} onChange={() => setMarks({ ...marks, [w.id]: { ...current(w), status: s } })} /> {s}</label>)}
            <Input aria-label="Overtime hours" className="h-8 w-16" inputMode="decimal" disabled={!manage} value={current(w).otHours} onChange={(e) => setMarks({ ...marks, [w.id]: { ...current(w), otHours: e.target.value } })} />
          </li>
        ))}
        {!engaged.length && <li className="px-5 py-6 text-center text-muted">No workers engaged on this day.</li>}
      </ul>
    </Card>
  );
}

function Wages({ manage }: { manage: boolean }) {
  const [month, setMonth] = useState(lastMonth);
  const q = useQuery({ queryKey: [HR, "contract", "compliance", month], queryFn: () => api<Compliance>(`${HR}/contract-compliance`, { query: { month } }) });
  const { error, act } = useAct();
  const [rows, setRows] = useState<Record<string, { daysPaid: string; grossPaid: string; pfDeducted: string; esiDeducted: string }>>({});
  const val = (w: Compliance["workers"][number]) => rows[w.workerId] ?? { daysPaid: String(w.present), grossPaid: w.grossPaid !== null ? String(w.grossPaid) : "", pfDeducted: "", esiDeducted: "" };
  const set = (id: string, w: Compliance["workers"][number], k: string, v: string) => setRows({ ...rows, [id]: { ...val(w), [k]: v } });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <Input className="h-9 w-44" type="month" aria-label="Month" value={month} onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setRows({}); } }} />
        <span className="text-xs text-muted">Enter what each contractor reports paying (from their wage register).</span>
        {manage && <Button size="sm" className="ml-auto" disabled={!Object.keys(rows).length} onClick={async () => (await act(`${HR}/contract-wages`, { month, entries: Object.entries(rows).filter(([, r]) => r.grossPaid !== "").map(([workerId, r]) => ({ workerId, daysPaid: Number(r.daysPaid) || 0, grossPaid: Number(r.grossPaid) || 0, pfDeducted: Number(r.pfDeducted) || 0, esiDeducted: Number(r.esiDeducted) || 0 })) })) && setRows({})}><Save className="size-4" aria-hidden /> Save</Button>}
      </div>
      {error && <div className="p-4"><Alert>{error}</Alert></div>}
      {q.isLoading && <LoadingBlock />}
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Worker</th><th className="px-2 py-2 text-right font-medium">Attended</th><th className="px-2 py-2 font-medium">Days paid</th><th className="px-2 py-2 font-medium">Gross paid</th><th className="px-2 py-2 font-medium">PF</th><th className="px-2 py-2 font-medium">ESI</th></tr></thead>
        <tbody className="divide-y divide-border">
          {q.data?.workers.map((w) => (
            <tr key={w.workerId}>
              <td className="px-4 py-1.5"><span className="font-medium">{w.name}</span> <span className="text-xs text-muted">{w.contractor}</span></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{w.present}</td>
              {(["daysPaid", "grossPaid", "pfDeducted", "esiDeducted"] as const).map((k) => <td key={k} className="px-2 py-1.5"><Input aria-label={k} className="h-8 w-24" inputMode="decimal" disabled={!manage} value={val(w)[k]} onChange={(e) => set(w.workerId, w, k, e.target.value)} /></td>)}
            </tr>
          ))}
        </tbody>
      </table></div>
    </Card>
  );
}

function ComplianceView() {
  const [month, setMonth] = useState(lastMonth);
  const q = useQuery({ queryKey: [HR, "contract", "compliance", month], queryFn: () => api<Compliance>(`${HR}/contract-compliance`, { query: { month } }) });
  return (
    <>
      <Input className="h-9 w-44" type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {q.data.contractors.map((c) => (
              <Card key={c.id} className="px-4 py-3 text-sm">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted">{c.workers} workers · {c.withIssues} with issues</p>
                {c.shortfall > 0 && <p className="mt-1 font-medium text-danger">Wages short by {inr(c.shortfall)}</p>}
                {c.alerts.map((a) => <p key={a} className="text-xs text-warning">{a}</p>)}
              </Card>
            ))}
          </div>
          <Card>
            <DataTable
              rows={q.data.workers}
              rowKey={(w) => String(w.workerId)}
              exportName="hr-contract"
              storageKey="hr-contract-2"
              empty={<p className="px-4 py-6 text-center text-sm text-muted">No contract workers engaged in this month.</p>}
              columns={[
                { key: "worker", label: "Worker", locked: true, className: "whitespace-normal", render: (w) => <><span className="font-medium">{w.name}</span><span className="block text-xs text-muted">{w.contractor}</span></> },
                { key: "days", label: "Days", align: "right", render: (w) => <>{w.present}{w.otHours ? ` + ${w.otHours} h OT` : ""}</> },
                { key: "rate-due", label: "Rate due", align: "right", render: (w) => <>{inr(w.rate)}{w.minDaily ? <span className="block text-xs text-muted">min {inr(w.minDaily)}</span> : null}</> },
                { key: "due", label: "Due", align: "right", render: (w) => <>{inr(w.dueGross)}</> },
                { key: "paid", label: "Paid", align: "right", render: (w) => <>{inr(w.grossPaid)}</> },
                { key: "findings", label: "Findings", className: "text-xs whitespace-normal", render: (w) => <>{w.issues.length ? w.issues.map((i) => <span key={i} className="block text-danger">{i}</span>) : <Badge tone="success">OK</Badge>}</> },
              ]}
            />
          </Card>
        </>
      )}
    </>
  );
}

function MinimumWages({ manage }: { manage: boolean }) {
  const q = useQuery({ queryKey: [HR, "contract", "minimum"], queryFn: () => api<{ id: string; stateCode: string; skill: string; dailyRate: string; effectiveFrom: string }[]>(`${HR}/minimum-wages`) });
  const { error, act } = useAct();
  const [f, setF] = useState({ stateCode: "36", skill: "unskilled", dailyRate: "", effectiveFrom: todayIST() });
  return (
    <Card>
      <p className="px-5 py-3 text-sm text-muted">Enter the notified minimum daily wage (basic + VDA) for each state and skill; the newest revision on or before a month is used.</p>
      <ul className="divide-y divide-border border-t border-border text-sm">
        {q.data?.map((m) => <li key={m.id} className="flex gap-3 px-5 py-2"><span className="w-16 font-mono">{m.stateCode}</span><span className="w-36">{SKILLS[m.skill as keyof typeof SKILLS] ?? m.skill}</span><span className="tabular-nums">{inr(m.dailyRate)} a day</span><span className="text-xs text-muted">from {formatDate(m.effectiveFrom)}</span></li>)}
        {q.data && !q.data.length && <li className="px-5 py-4 text-muted">None entered.</li>}
      </ul>
      {manage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
          {error && <Alert>{error}</Alert>}
          <Field label="State code">{(p) => <Input {...p} className="w-20" maxLength={2} value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value })} />}</Field>
          <Field label="Skill">{(p) => <Select {...p} value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value })}>{Object.entries(SKILLS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="₹ a day">{(p) => <Input {...p} className="w-24" inputMode="decimal" value={f.dailyRate} onChange={(e) => setF({ ...f, dailyRate: e.target.value })} />}</Field>
          <Field label="From">{(p) => <Input {...p} type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />}</Field>
          <Button size="sm" disabled={!Number(f.dailyRate)} onClick={async () => (await act(`${HR}/minimum-wages`, { ...f, dailyRate: Number(f.dailyRate) })) && setF({ ...f, dailyRate: "" })}><Plus className="size-4" aria-hidden /> Add</Button>
        </div>
      )}
    </Card>
  );
}
