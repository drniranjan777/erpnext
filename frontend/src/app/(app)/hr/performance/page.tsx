"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { HR, type OrgRow } from "@/lib/hr";
import { inr } from "@/lib/payroll";

interface Cycle { id: string; name: string; fromDate: string; toDate: string; status: "goal_setting" | "review" | "closed"; incrementGuide: Record<string, number> }
interface Goal { id: string; kra: string | null; title: string; target: string | null; weight: string; selfRating: number | null; selfComment: string | null; managerRating: number | null; managerComment: string | null }
interface GoalView { employeeId: string; isSelf: boolean; goals: Goal[]; cycle: Cycle; appraisal: { finalRating: number | null; incrementPct: string | null } | null }
interface Appraisal { employeeId: string; code: string; fullName: string; department: string | null; designation: string | null; selfScore: number | null; managerScore: number | null; goals: number; rated: number; finalRating: number | null; incrementPct: string | null; newCtc: string | null; effectiveFrom: string | null; appliedAt: string | null; currentCtc: string | null }
const STATUS = { goal_setting: "Goal setting", review: "Review", closed: "Closed" };
type Tab = "mine" | "team" | "calibrate";

export default function PerformancePage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const cycles = useQuery({ queryKey: [HR, "cycles"], queryFn: () => api<Cycle[]>(`${HR}/performance/cycles`) });
  const [cycleId, setCycleId] = useState("");
  const [tab, setTab] = useState<Tab>("mine");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cycle = cycles.data?.find((c) => c.id === (cycleId || cycles.data?.[0]?.id));
  async function setStatus(status: Cycle["status"]) {
    setError(null);
    try {
      await api(`${HR}/performance/cycles/${cycle!.id}/status`, { body: { status } });
      qc.invalidateQueries({ queryKey: [HR] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const manage = can("hr.performance.manage");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Performance" description="Goals and KRAs set at the start of the cycle, self and manager ratings at the end, then calibration and increments." actions={manage && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New cycle</Button>} />
      {cycles.isLoading && <LoadingBlock />}
      {cycles.data && !cycles.data.length && <p className="text-sm text-muted">No review cycle yet.</p>}
      {cycle && (
        <div className="flex flex-wrap items-center gap-3">
          <Select className="h-9 w-56" aria-label="Cycle" value={cycle.id} onChange={(e) => setCycleId(e.target.value)}>{cycles.data!.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <span className="text-sm text-muted">{formatDate(cycle.fromDate)} – {formatDate(cycle.toDate)}</span>
          <Badge tone={cycle.status === "review" ? "warning" : cycle.status === "closed" ? "neutral" : "primary"}>{STATUS[cycle.status]}</Badge>
          {manage && cycle.status === "goal_setting" && <Button size="sm" variant="secondary" onClick={() => setStatus("review")}>Start the review</Button>}
          {manage && cycle.status === "review" && <Button size="sm" variant="secondary" onClick={() => setStatus("closed")}>Close the cycle</Button>}
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {cycle && (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: "mine", label: "My goals" }, { value: "team", label: "My team" }, ...(can("hr.performance.read") ? [{ value: "calibrate" as const, label: "All employees" }] : [])]} />
          {tab === "mine" && <Goals cycle={cycle} />}
          {tab === "team" && <Team cycle={cycle} />}
          {tab === "calibrate" && <Calibrate cycle={cycle} manage={manage} />}
        </>
      )}
      {creating && <CycleDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function Goals({ cycle, employeeId }: { cycle: Cycle; employeeId?: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [HR, "goals", cycle.id, employeeId ?? "me"], queryFn: () => api<GoalView>(`${HR}/performance/cycles/${cycle.id}/goals`, { query: { employeeId } }), retry: false });
  const [f, setF] = useState({ kra: "", title: "", target: "", weight: "" });
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: [HR, "goals"] });
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      return false;
    }
  }
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const v = q.data!;
  const total = v.goals.reduce((s, g) => s + Number(g.weight), 0);
  const rateField = v.isSelf ? "selfRating" : "managerRating";
  return (
    <Card>
      <CardHeader title={`Goals · ${total} % of 100 %`} description={v.appraisal?.finalRating ? `Final rating ${v.appraisal.finalRating}/5${v.appraisal.incrementPct ? ` · increment ${Number(v.appraisal.incrementPct)} %` : ""}` : undefined} />
      {error && <div className="px-5"><Alert>{error}</Alert></div>}
      <ul className="divide-y divide-border border-t border-border text-sm">
        {v.goals.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
            <Badge>{Number(g.weight)} %</Badge>
            <span className="flex-1"><span className="font-medium">{g.title}</span>{g.kra && <span className="text-xs text-muted"> · {g.kra}</span>}{g.target && <span className="block text-xs text-muted">Target: {g.target}</span>}</span>
            <span className="text-xs text-muted">self {g.selfRating ?? "–"} · manager {g.managerRating ?? "–"}</span>
            {cycle.status === "review" && (
              <Select aria-label="Rating" className="h-8 w-20" value={String(g[rateField] ?? "")} onChange={(e) => e.target.value && run(() => api(`${HR}/performance/goals/${g.id}/rate`, { body: { rating: Number(e.target.value) } }))}>
                <option value="">Rate</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            )}
            {cycle.status === "goal_setting" && <Button size="sm" variant="ghost" aria-label="Remove goal" onClick={() => run(() => api(`${HR}/performance/goals/${g.id}`, { method: "DELETE" }))}><Trash2 className="size-3.5" aria-hidden /></Button>}
          </li>
        ))}
        {!v.goals.length && <li className="px-5 py-4 text-muted">No goals yet.</li>}
      </ul>
      {cycle.status === "goal_setting" && total < 100 && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
          <Field label="KRA">{(p) => <Input {...p} className="w-32" value={f.kra} onChange={(e) => setF({ ...f, kra: e.target.value })} />}</Field>
          <Field label="Goal">{(p) => <Input {...p} className="w-72" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Target">{(p) => <Input {...p} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />}</Field>
          <Field label="Weight %">{(p) => <Input {...p} className="w-20" type="number" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} />}</Field>
          <Button size="sm" disabled={f.title.trim().length < 3 || !Number(f.weight)} onClick={async () => (await run(() => api(`${HR}/performance/cycles/${cycle.id}/goals`, { body: { employeeId, kra: f.kra || null, title: f.title, target: f.target || null, weight: Number(f.weight) } }))) && setF({ kra: "", title: "", target: "", weight: "" })}><Plus className="size-4" aria-hidden /> Add</Button>
        </div>
      )}
    </Card>
  );
}

function Team({ cycle }: { cycle: Cycle }) {
  const me = useQuery({ queryKey: [HR, "me"], queryFn: () => api<{ employee: { id: string } }>(`${HR}/me`), retry: false });
  const people = useQuery({ queryKey: [HR, "org-chart"], queryFn: () => api<{ id: string; fullName: string; reportsToId: string | null }[]>(`${HR}/org-chart`), retry: false });
  const [pick, setPick] = useState("");
  const team = people.data?.filter((p) => p.reportsToId === me.data?.employee.id) ?? [];
  if (me.error) return <p className="text-sm text-muted">Your login is not linked to an employee record.</p>;
  return (
    <div className="space-y-3">
      <Select className="h-9 w-64" aria-label="Team member" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Choose a team member…</option>{team.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}</Select>
      {people.error && <p className="text-sm text-muted">The team list needs permission to view employees.</p>}
      {pick && <Goals cycle={cycle} employeeId={pick} />}
    </div>
  );
}

function Calibrate({ cycle, manage }: { cycle: Cycle; manage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [HR, "appraisals", cycle.id], queryFn: () => api<Appraisal[]>(`${HR}/performance/cycles/${cycle.id}/appraisals`) });
  const desigs = useQuery({ queryKey: [HR, "org", "designations"], queryFn: () => api<OrgRow[]>(`${HR}/org/designations`) });
  const [editing, setEditing] = useState<Appraisal | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function apply() {
    if (!window.confirm("Write the calibrated increments into salaries and record promotions?")) return;
    setMsg(null);
    try {
      const r = await api<{ increments: number; promotions: number; skipped: string[] }>(`${HR}/performance/cycles/${cycle.id}/apply`, { body: {} });
      setMsg({ tone: "success", text: `${r.increments} increment(s) and ${r.promotions} promotion(s) applied.${r.skipped.length ? ` Skipped: ${r.skipped.join("; ")}` : ""}` });
      qc.invalidateQueries({ queryKey: [HR, "appraisals"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {manage && cycle.status !== "goal_setting" && <Button variant="secondary" onClick={apply}>Apply increments to salaries</Button>}
      <Card>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Employee</th><th className="px-4 py-2 text-right font-medium">Self</th><th className="px-4 py-2 text-right font-medium">Manager</th><th className="px-4 py-2 text-right font-medium">Final</th><th className="px-4 py-2 text-right font-medium">Increment</th><th className="px-4 py-2 text-right font-medium">New CTC</th><th /></tr></thead>
          <tbody className="divide-y divide-border">
            {q.data!.map((a) => (
              <tr key={a.employeeId}>
                <td className="px-4 py-2"><span className="font-medium">{a.fullName}</span><span className="block text-xs text-muted">{[a.designation, a.department].filter(Boolean).join(" · ")} · {a.rated}/{a.goals} rated</span></td>
                <td className="px-4 py-2 text-right tabular-nums">{a.selfScore ?? "–"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{a.managerScore ?? "–"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{a.finalRating ?? "–"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{a.incrementPct ? `${Number(a.incrementPct)} %` : "–"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{inr(a.newCtc)}{a.appliedAt && <Badge tone="success" className="ml-1">applied</Badge>}</td>
                <td className="px-4 py-2 text-right">{manage && !a.appliedAt && cycle.status !== "goal_setting" && <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Calibrate</Button>}</td>
              </tr>
            ))}
            {!q.data!.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">Nobody has goals in this cycle.</td></tr>}
          </tbody>
        </table>
      </Card>
      {editing && <CalibrateDialog cycle={cycle} a={editing} designations={desigs.data ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}

function CalibrateDialog({ cycle, a, designations, onClose }: { cycle: Cycle; a: Appraisal; designations: OrgRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const suggested = Math.max(1, Math.min(5, Math.round(a.managerScore ?? a.selfScore ?? 3)));
  const [f, setF] = useState({ finalRating: String(a.finalRating ?? suggested), incrementPct: a.incrementPct ? String(Number(a.incrementPct)) : "", effectiveFrom: a.effectiveFrom ?? "", promoteToDesignationId: "", remarks: "" });
  const [error, setError] = useState<string | null>(null);
  const guide = cycle.incrementGuide[f.finalRating];
  async function save() {
    setError(null);
    try {
      await api(`${HR}/performance/cycles/${cycle.id}/calibrate`, { body: { employeeId: a.employeeId, finalRating: Number(f.finalRating), incrementPct: f.incrementPct === "" ? null : Number(f.incrementPct), effectiveFrom: f.effectiveFrom, promoteToDesignationId: f.promoteToDesignationId || null, remarks: f.remarks || null } });
      await qc.invalidateQueries({ queryKey: [HR, "appraisals"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Calibrate: ${a.fullName}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.effectiveFrom}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <p className="mb-3 text-sm text-muted">Self {a.selfScore ?? "–"} · manager {a.managerScore ?? "–"} · current CTC {inr(a.currentCtc)}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Final rating">{(p) => <Select {...p} value={f.finalRating} onChange={(e) => setF({ ...f, finalRating: e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select>}</Field>
        <Field label="Increment %" hint={guide !== undefined ? `Guide for this rating: ${guide} %` : "Blank uses the cycle's guide"}>{(p) => <Input {...p} inputMode="decimal" value={f.incrementPct} onChange={(e) => setF({ ...f, incrementPct: e.target.value })} />}</Field>
        <Field label="Effective from">{(p) => <Input {...p} type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />}</Field>
        <Field label="Promote to">{(p) => <Select {...p} value={f.promoteToDesignationId} onChange={(e) => setF({ ...f, promoteToDesignationId: e.target.value })}><option value="">No promotion</option>{designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <Field label="Remarks" className="sm:col-span-2">{(p) => <Input {...p} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function CycleDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", fromDate: "", toDate: "" });
  const [guide, setGuide] = useState<Record<string, string>>({ "5": "15", "4": "10", "3": "6", "2": "3", "1": "0" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${HR}/performance/cycles`, { body: { ...f, incrementGuide: Object.fromEntries(Object.entries(guide).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])) } });
      await qc.invalidateQueries({ queryKey: [HR, "cycles"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New review cycle" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Create</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(p) => <Input {...p} placeholder="FY 2026-27" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="From">{(p) => <Input {...p} type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} />}</Field>
        <Field label="To">{(p) => <Input {...p} type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} />}</Field>
        <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-medium">Increment guide (% by final rating)</legend><div className="flex gap-2">{["5", "4", "3", "2", "1"].map((r) => <label key={r} className="text-xs">{r}<Input className="w-16" inputMode="decimal" value={guide[r]} onChange={(e) => setGuide({ ...guide, [r]: e.target.value })} /></label>)}</div></fieldset>
      </div>
    </Dialog>
  );
}
