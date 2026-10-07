"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
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

interface Shift { id: string; code: string; name: string; startTime: string; endTime: string; breakMinutes: number; graceMinutes: number; halfDayMinutes: number; fullDayMinutes: number; otAfterMinutes: number | null; isActive: boolean }
interface RosterRow { id: string; code: string; fullName: string; department: string | null; rotation: string[]; shiftToday: string | null; offToday: boolean; assignment: { rotateEveryDays: number; weeklyOffs: number[]; fromDate: string } | null }
interface Holiday { id: string; date: string; name: string; isOptional: boolean; location: string | null }
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Tab = "shifts" | "roster" | "holidays";

export default function ShiftsPage() {
  const { can } = useAuth();
  const manage = can("hr.attendance.manage");
  const [tab, setTab] = useState<Tab>("shifts");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Shifts and holidays" description="Shift timings, who works which shift (fixed or rotating), weekly offs and the holiday list." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "shifts", label: "Shifts" }, { value: "roster", label: "Roster" }, { value: "holidays", label: "Holidays" }]} />
      {tab === "shifts" && <Shifts manage={manage} />}
      {tab === "roster" && <Roster manage={manage} />}
      {tab === "holidays" && <Holidays manage={manage} />}
    </div>
  );
}

function Shifts({ manage }: { manage: boolean }) {
  const q = useQuery({ queryKey: [HR, "shifts"], queryFn: () => api<Shift[]>(`${HR}/shifts`) });
  const [editing, setEditing] = useState<Shift | "new" | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <>
      {manage && <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> New shift</Button>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {q.data!.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-2">
              <span className="w-16 font-mono text-xs text-muted">{s.code}</span>
              <span className="font-medium">{s.name}</span>
              <span className="tabular-nums">{s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}</span>
              <span className="text-xs text-muted">break {s.breakMinutes}m · grace {s.graceMinutes}m · full day {s.fullDayMinutes / 60}h · OT after {(s.otAfterMinutes ?? 540) / 60}h</span>
              {!s.isActive && <Badge>inactive</Badge>}
              {manage && <Button className="ml-auto" size="sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Pencil className="size-3.5" aria-hidden /></Button>}
            </li>
          ))}
          {!q.data!.length && <li className="px-5 py-6 text-center text-muted">No shifts yet. Without a roster, the day is the calendar day and Sunday is off.</li>}
        </ul>
      </Card>
      {editing && <ShiftDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ShiftDialog({ row, onClose }: { row: Shift | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: row?.code ?? "", name: row?.name ?? "", startTime: row?.startTime.slice(0, 5) ?? "09:00", endTime: row?.endTime.slice(0, 5) ?? "17:30", breakMinutes: String(row?.breakMinutes ?? 30), graceMinutes: String(row?.graceMinutes ?? 10), halfDayMinutes: String(row?.halfDayMinutes ?? 240), fullDayMinutes: String(row?.fullDayMinutes ?? 450), otAfterMinutes: row?.otAfterMinutes ? String(row.otAfterMinutes) : "", isActive: row?.isActive ?? true });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setError(null);
    const body = { ...f, breakMinutes: Number(f.breakMinutes), graceMinutes: Number(f.graceMinutes), halfDayMinutes: Number(f.halfDayMinutes), fullDayMinutes: Number(f.fullDayMinutes), otAfterMinutes: f.otAfterMinutes ? Number(f.otAfterMinutes) : null };
    try {
      await api(row ? `${HR}/shifts/${row.id}` : `${HR}/shifts`, { method: row ? "PUT" : "POST", body });
      await qc.invalidateQueries({ queryKey: [HR, "shifts"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={row ? `Edit ${row.name}` : "New shift"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={set("code")} />}</Field>
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={set("name")} />}</Field>
        <Field label="Starts">{(p) => <Input {...p} type="time" value={f.startTime} onChange={set("startTime")} />}</Field>
        <Field label="Ends" hint="Before the start = ends next morning">{(p) => <Input {...p} type="time" value={f.endTime} onChange={set("endTime")} />}</Field>
        <Field label="Break (minutes)">{(p) => <Input {...p} type="number" value={f.breakMinutes} onChange={set("breakMinutes")} />}</Field>
        <Field label="Grace for late (minutes)">{(p) => <Input {...p} type="number" value={f.graceMinutes} onChange={set("graceMinutes")} />}</Field>
        <Field label="Half day from (minutes worked)">{(p) => <Input {...p} type="number" value={f.halfDayMinutes} onChange={set("halfDayMinutes")} />}</Field>
        <Field label="Full day from (minutes worked)">{(p) => <Input {...p} type="number" value={f.fullDayMinutes} onChange={set("fullDayMinutes")} />}</Field>
        <Field label="Overtime after (minutes worked)" hint="Blank = 540 (9 hours, Factories Act)">{(p) => <Input {...p} type="number" value={f.otAfterMinutes} onChange={set("otAfterMinutes")} />}</Field>
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>
      </div>
    </Dialog>
  );
}

function Roster({ manage }: { manage: boolean }) {
  const [date, setDate] = useState(todayIST);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const q = useQuery({ queryKey: [HR, "roster", date], queryFn: () => api<RosterRow[]>(`${HR}/roster`, { query: { date } }) });
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-9 w-44" type="date" aria-label="Date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        {manage && <Button disabled={!picked.size} onClick={() => setAssigning(true)}><Users className="size-4" aria-hidden /> Assign shift to {picked.size || "…"}</Button>}
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr>{manage && <th className="w-8 px-4 py-2"><input type="checkbox" aria-label="All" checked={picked.size === q.data.length && q.data.length > 0} onChange={(e) => setPicked(new Set(e.target.checked ? q.data!.map((r) => r.id) : []))} /></th>}<th className="px-4 py-2 font-medium">Employee</th><th className="px-4 py-2 font-medium">On {formatDate(date)}</th><th className="px-4 py-2 font-medium">Rotation</th><th className="px-4 py-2 font-medium">Weekly off</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.map((r) => (
                <tr key={r.id}>
                  {manage && <td className="px-4 py-2"><input type="checkbox" aria-label={`Select ${r.fullName}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>}
                  <td className="px-4 py-2"><span className="font-medium">{r.fullName}</span> <span className="font-mono text-xs text-muted">{r.code}</span><span className="block text-xs text-muted">{r.department ?? ""}</span></td>
                  <td className="px-4 py-2">{r.offToday ? <Badge>off</Badge> : r.shiftToday ? <Badge tone="primary">{r.shiftToday}</Badge> : <span className="text-muted">no roster</span>}</td>
                  <td className="px-4 py-2 text-xs">{r.rotation.length ? `${r.rotation.join(" → ")}${r.rotation.length > 1 ? ` every ${r.assignment?.rotateEveryDays} days` : ""} from ${formatDate(r.assignment!.fromDate)}` : "–"}</td>
                  <td className="px-4 py-2 text-xs">{(r.assignment?.weeklyOffs ?? [0]).map((d) => DAYS[d]).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {assigning && <AssignDialog ids={[...picked]} onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); setPicked(new Set()); }} />}
    </>
  );
}

function AssignDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const shifts = useQuery({ queryKey: [HR, "shifts"], queryFn: () => api<Shift[]>(`${HR}/shifts`) });
  const [f, setF] = useState({ shiftIds: [""] as string[], rotateEveryDays: "7", weeklyOffs: [0] as number[], fromDate: todayIST() });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${HR}/roster`, { body: { employeeIds: ids, shiftIds: f.shiftIds.filter(Boolean), rotateEveryDays: Number(f.rotateEveryDays), weeklyOffs: f.weeklyOffs, fromDate: f.fromDate } });
      await qc.invalidateQueries({ queryKey: [HR, "roster"] });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const active = shifts.data?.filter((s) => s.isActive) ?? [];
  return (
    <Dialog open onClose={onClose} title={`Roster for ${ids.length} employee(s)`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.shiftIds.some(Boolean)}>Assign</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        {f.shiftIds.map((sid, i) => (
          <Field key={i} label={f.shiftIds.length > 1 ? `Shift ${i + 1} of the rotation` : "Shift"}>
            {(p) => <Select {...p} value={sid} onChange={(e) => setF({ ...f, shiftIds: f.shiftIds.map((x, j) => (j === i ? e.target.value : x)) })}><option value="">Choose…</option>{active.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name} ({s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)})</option>)}</Select>}
          </Field>
        ))}
        {f.shiftIds.length < 6 && <Button size="sm" variant="ghost" onClick={() => setF({ ...f, shiftIds: [...f.shiftIds, ""] })}><Plus className="size-4" aria-hidden /> Add a shift to rotate through</Button>}
        {f.shiftIds.length > 1 && <Field label="Rotate every (days)">{(p) => <Input {...p} type="number" min={1} value={f.rotateEveryDays} onChange={(e) => setF({ ...f, rotateEveryDays: e.target.value })} />}</Field>}
        <fieldset className="text-sm"><legend className="mb-1 font-medium">Weekly off</legend><div className="flex flex-wrap gap-3">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={f.weeklyOffs.includes(i)} onChange={(e) => setF({ ...f, weeklyOffs: e.target.checked ? [...f.weeklyOffs, i] : f.weeklyOffs.filter((x) => x !== i) })} />{d}</label>)}</div></fieldset>
        <Field label="From" hint="Replaces any roster from this date">{(p) => <Input {...p} type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function Holidays({ manage }: { manage: boolean }) {
  const qc = useQueryClient();
  const [year, setYear] = useState(() => Number(todayIST().slice(0, 4)));
  const q = useQuery({ queryKey: [HR, "holidays", year], queryFn: () => api<Holiday[]>(`${HR}/holidays`, { query: { year } }) });
  const locs = useQuery({ queryKey: [HR, "org", "locations"], queryFn: () => api<OrgRow[]>(`${HR}/org/locations`) });
  const [f, setF] = useState({ date: "", name: "", locationId: "", isOptional: false });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [HR, "holidays"] });
  async function add() {
    setError(null);
    try {
      await api(`${HR}/holidays`, { body: { ...f, locationId: f.locationId || null } });
      setF({ ...f, date: "", name: "" });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  async function remove(id: string) {
    await api(`${HR}/holidays/${id}`, { method: "DELETE" });
    refresh();
  }
  return (
    <>
      <Select className="h-9 w-32" aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}</Select>
      {error && <Alert>{error}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {q.data?.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-5 py-2">
              <span className="w-28 tabular-nums">{formatDate(h.date)}</span>
              <span className="font-medium">{h.name}</span>
              <span className="text-xs text-muted">{h.location ?? "All locations"}</span>
              {h.isOptional && <Badge>restricted</Badge>}
              {manage && <Button className="ml-auto" size="sm" variant="ghost" aria-label={`Remove ${h.name}`} onClick={() => remove(h.id)}><Trash2 className="size-3.5" aria-hidden /></Button>}
            </li>
          ))}
          {q.data && !q.data.length && <li className="px-5 py-6 text-center text-muted">No holidays for {year}.</li>}
        </ul>
        {manage && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
            <Field label="Date">{(p) => <Input {...p} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
            <Field label="Holiday">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field label="Location">{(p) => <Select {...p} value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">All locations</option>{locs.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}</Field>
            <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={f.isOptional} onChange={(e) => setF({ ...f, isOptional: e.target.checked })} /> Restricted</label>
            <Button size="sm" disabled={!f.date || f.name.trim().length < 2} onClick={add}><Plus className="size-4" aria-hidden /> Add</Button>
          </div>
        )}
      </Card>
    </>
  );
}
