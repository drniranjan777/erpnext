"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Plus, Users } from "lucide-react";
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
import { todayIST } from "@/lib/documents";
import { HR, type OrgRow } from "@/lib/hr";
import { LEVEL_TONE, LEVELS } from "@/lib/talent";

interface Skill { id: string; code: string; name: string; category: string | null; appliesTo: string | null; validityMonths: number | null }
interface Matrix { skills: Skill[]; rows: { id: string; code: string; fullName: string; department: string | null; levels: Record<string, { level: number; assessedOn: string; expired: boolean }> }[]; cover: Record<string, number> }
interface Training { id: string; title: string; skill: string | null; skillLevel: number | null; trainer: string | null; startsAt: string; hours: string; venue: string | null; capacity: number | null; status: string; nominated: number; attended: number }
interface TrainingView extends Training { attendees: { employeeId: string; code: string; fullName: string; attended: boolean | null; passed: boolean | null; score: number | null }[] }
type Tab = "matrix" | "trainings";

export default function SkillsPage() {
  const [tab, setTab] = useState<Tab>("matrix");
  return (
    <div className="space-y-6">
      <PageHeader title="Skills & training" description="Skill matrix on the ILUO scale (I learning, L with help, U on their own, O can train others), and the training calendar. A pass raises the skill level." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "matrix", label: "Skill matrix" }, { value: "trainings", label: "Training calendar" }]} />
      {tab === "matrix" ? <MatrixView /> : <Trainings />}
    </div>
  );
}

function MatrixView() {
  const { can } = useAuth();
  const manage = can("hr.training.manage");
  const qc = useQueryClient();
  const [departmentId, setDepartmentId] = useState("");
  const [cell, setCell] = useState<{ employeeId: string; name: string; skill: Skill; level: number } | null>(null);
  const [newSkill, setNewSkill] = useState(false);
  const depts = useQuery({ queryKey: [HR, "org", "departments"], queryFn: () => api<OrgRow[]>(`${HR}/org/departments`) });
  const q = useQuery({ queryKey: [HR, "matrix", departmentId], queryFn: () => api<Matrix>(`${HR}/skills/matrix`, { query: { departmentId: departmentId || undefined } }) });
  async function assess(level: number) {
    await api(`${HR}/skills/assess`, { body: { employeeId: cell!.employeeId, skillId: cell!.skill.id, level } });
    setCell(null);
    qc.invalidateQueries({ queryKey: [HR, "matrix"] });
  }
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Select className="h-9 w-56" aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">All departments</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        {manage && <Button variant="secondary" onClick={() => setNewSkill(true)}><Plus className="size-4" aria-hidden /> Skill</Button>}
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="sticky left-0 bg-surface-muted px-3 py-2 text-left font-medium">Employee</th>
                {q.data.skills.map((s) => <th key={s.id} className="px-2 py-2 font-medium" title={s.name}>{s.code}<span className="block font-normal">{q.data!.cover[s.id]} can do it alone</span></th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="sticky left-0 whitespace-nowrap bg-surface px-3 py-1.5"><span className="font-medium">{r.fullName}</span> <span className="text-muted">{r.department ?? ""}</span></td>
                  {q.data!.skills.map((s) => {
                    const l = r.levels[s.id];
                    const lvl = l?.level ?? 0;
                    return (
                      <td key={s.id} className="p-0.5 text-center">
                        <button disabled={!manage} title={l ? `${LEVELS[lvl]} · assessed ${l.assessedOn}${l.expired ? " · expired" : ""}` : "Not assessed"} className={`w-10 rounded py-1 font-medium ${LEVEL_TONE[lvl]} ${l?.expired ? "line-through opacity-60" : ""}`} onClick={() => setCell({ employeeId: r.id, name: r.fullName, skill: s, level: lvl })}>{l ? "·ILUO"[lvl] || "–" : "–"}</button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!q.data.skills.length && <tr><td className="px-4 py-6 text-center text-muted">Add the skills your work centres need.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      {cell && (
        <Dialog open onClose={() => setCell(null)} title={`${cell.name}: ${cell.skill.name}`} footer={<Button variant="secondary" onClick={() => setCell(null)}>Close</Button>}>
          <div className="grid gap-2">{LEVELS.map((l, i) => <Button key={i} variant={cell.level === i ? "primary" : "secondary"} onClick={() => assess(i)}>{i} · {l}</Button>)}</div>
        </Dialog>
      )}
      {newSkill && <SkillDialog onClose={() => setNewSkill(false)} />}
    </>
  );
}

function SkillDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: "", name: "", category: "", appliesTo: "", validityMonths: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${HR}/skills`, { body: { ...f, category: f.category || null, appliesTo: f.appliesTo || null, validityMonths: f.validityMonths ? Number(f.validityMonths) : null } });
      await qc.invalidateQueries({ queryKey: [HR, "matrix"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New skill" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Category">{(p) => <Input {...p} placeholder="Machining, welding, safety…" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />}</Field>
        <Field label="Work centre / machine">{(p) => <Input {...p} value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value })} />}</Field>
        <Field label="Re-assess after (months)" hint="Blank = no expiry">{(p) => <Input {...p} type="number" value={f.validityMonths} onChange={(e) => setF({ ...f, validityMonths: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function Trainings() {
  const { can } = useAuth();
  const manage = can("hr.training.manage");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: [HR, "trainings"], queryFn: () => api<Training[]>(`${HR}/trainings`) });
  return (
    <>
      {manage && <Button onClick={() => setCreating(true)}><CalendarPlus className="size-4" aria-hidden /> Plan training</Button>}
      {q.isLoading && <LoadingBlock />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <span className="w-36 text-xs tabular-nums">{new Date(t.startsAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}</span>
                <button className="font-medium text-primary hover:underline" onClick={() => setOpen(t.id)}>{t.title}</button>
                <span className="text-xs text-muted">{[t.trainer, t.venue, `${Number(t.hours)} h`, t.skill && `→ ${t.skill} level ${t.skillLevel}`].filter(Boolean).join(" · ")}</span>
                <span className="ml-auto text-xs text-muted">{t.attended}/{t.nominated}{t.capacity ? ` of ${t.capacity}` : ""}</span>
                <Badge tone={t.status === "done" ? "success" : t.status === "cancelled" ? "neutral" : "primary"}>{t.status}</Badge>
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-6 text-center text-muted">No trainings planned.</li>}
          </ul>
        </Card>
      )}
      {open && <TrainingDialog id={open} manage={manage} onClose={() => setOpen(null)} />}
      {creating && <NewTraining onClose={() => setCreating(false)} />}
    </>
  );
}

function NewTraining({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const skills = useQuery({ queryKey: [HR, "skills"], queryFn: () => api<Skill[]>(`${HR}/skills`) });
  const [f, setF] = useState({ title: "", skillId: "", skillLevel: "2", trainer: "", date: todayIST(), time: "10:00", hours: "4", venue: "", capacity: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${HR}/trainings`, { body: { title: f.title, skillId: f.skillId || null, skillLevel: f.skillId ? Number(f.skillLevel) : null, trainer: f.trainer || null, startsAt: `${f.date}T${f.time}:00+05:30`, hours: Number(f.hours), venue: f.venue || null, capacity: f.capacity ? Number(f.capacity) : null } });
      await qc.invalidateQueries({ queryKey: [HR, "trainings"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Plan a training" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={f.title.trim().length < 2}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Skill">{(p) => <Select {...p} value={f.skillId} onChange={(e) => setF({ ...f, skillId: e.target.value })}><option value="">—</option>{skills.data?.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</Select>}</Field>
        {f.skillId && <Field label="A pass reaches">{(p) => <Select {...p} value={f.skillLevel} onChange={(e) => setF({ ...f, skillLevel: e.target.value })}>{LEVELS.slice(1).map((l, i) => <option key={i + 1} value={i + 1}>{l}</option>)}</Select>}</Field>}
        <Field label="Date">{(p) => <Input {...p} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Time">{(p) => <Input {...p} type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />}</Field>
        <Field label="Hours">{(p) => <Input {...p} inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />}</Field>
        <Field label="Places">{(p) => <Input {...p} type="number" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />}</Field>
        <Field label="Trainer">{(p) => <Input {...p} value={f.trainer} onChange={(e) => setF({ ...f, trainer: e.target.value })} />}</Field>
        <Field label="Venue">{(p) => <Input {...p} value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function TrainingDialog({ id, manage, onClose }: { id: string; manage: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [HR, "trainings", id], queryFn: () => api<TrainingView>(`${HR}/trainings/${id}`) });
  const people = useQuery({ queryKey: [HR, "people"], queryFn: () => api<{ id: string; code: string; fullName: string }[]>(`${HR}/employees/search`), enabled: manage });
  const [pick, setPick] = useState("");
  const [results, setResults] = useState<Record<string, { attended: boolean; passed: boolean }>>({});
  const [error, setError] = useState<string | null>(null);
  async function run(path: string, body: unknown) {
    setError(null);
    try {
      await api(path, { body });
      await qc.invalidateQueries({ queryKey: [HR, "trainings"] });
      qc.invalidateQueries({ queryKey: [HR, "matrix"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const t = q.data;
  const val = (a: TrainingView["attendees"][number]) => results[a.employeeId] ?? { attended: a.attended ?? true, passed: a.passed ?? true };
  return (
    <Dialog open onClose={onClose} title={t?.title ?? "Training"} footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{manage && t && t.status !== "cancelled" && t.attendees.length > 0 && <Button onClick={() => run(`${HR}/trainings/${id}/results`, { results: t.attendees.map((a) => ({ employeeId: a.employeeId, ...val(a) })) })}>Save results</Button>}</>}>
      {q.isLoading && <LoadingBlock />}
      {error && <Alert>{error}</Alert>}
      {t && (
        <div className="space-y-3 text-sm">
          <ul className="divide-y divide-border rounded border border-border">
            {t.attendees.map((a) => (
              <li key={a.employeeId} className="flex items-center gap-3 px-3 py-1.5">
                <span className="flex-1">{a.fullName}</span>
                {manage ? (
                  <>
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={val(a).attended} onChange={(e) => setResults({ ...results, [a.employeeId]: { ...val(a), attended: e.target.checked } })} /> attended</label>
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={val(a).passed} onChange={(e) => setResults({ ...results, [a.employeeId]: { ...val(a), passed: e.target.checked } })} /> passed</label>
                  </>
                ) : (
                  <span className="text-xs text-muted">{a.attended === null ? "nominated" : a.attended ? (a.passed ? "passed" : "attended") : "absent"}</span>
                )}
              </li>
            ))}
            {!t.attendees.length && <li className="px-3 py-2 text-muted">Nobody nominated yet.</li>}
          </ul>
          {manage && t.status === "planned" && (
            <div className="flex gap-2">
              <Select aria-label="Employee" className="flex-1" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Nominate…</option>{people.data?.filter((p) => !t.attendees.some((a) => a.employeeId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.code})</option>)}</Select>
              <Button size="sm" disabled={!pick} onClick={async () => { await run(`${HR}/trainings/${id}/nominate`, { employeeIds: [pick] }); setPick(""); }}><Users className="size-4" aria-hidden /> Add</Button>
              <Button size="sm" variant="ghost" onClick={() => window.confirm("Cancel this training?") && run(`${HR}/trainings/${id}/cancel`, {})}>Cancel training</Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
