"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, apiDownload, ApiError, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayIST } from "@/lib/documents";
import { HR, type OrgRow } from "@/lib/hr";

interface Summary { employableDays: number; processedDays: number; present: number; absent: number; missedPunches: number; weeklyOffs: number; holidays: number; paidLeave: number; unpaidLeave: number; payableDays: number; lopDays: number; lateDays: number; otHours: number; locked: boolean }
interface Month { month: string; dates: string[]; rows: { employeeId: string; code: string; fullName: string; department: string | null; days: Record<string, string>; summary: Summary }[] }
interface DayView { day: { status: string; firstIn: string | null; lastOut: string | null; workedMinutes: number; lateMinutes: number; earlyMinutes: number; otMinutes: number; payableDays: string } | null; punches: { id: string; punchedAt: string; source: string; insideFence: boolean | null; distanceMetres: number | null; hasSelfie: boolean }[] }

const TONE: Record<string, string> = { P: "bg-success/15 text-success", HD: "bg-warning/15 text-warning", A: "bg-danger/15 text-danger", MP: "bg-danger/10 text-danger", WO: "text-muted", H: "bg-primary/10 text-primary" };
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "–");
const hm = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;

export default function AttendancePage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => todayIST().slice(0, 7));
  const [departmentId, setDepartmentId] = useState("");
  const [open, setOpen] = useState<{ employeeId: string; name: string; date: string } | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const depts = useQuery({ queryKey: [HR, "org", "departments"], queryFn: () => api<OrgRow[]>(`${HR}/org/departments`) });
  const q = useQuery({ queryKey: [HR, "attendance", month, departmentId], queryFn: () => api<Month>(`${HR}/attendance/month`, { query: { month, departmentId: departmentId || undefined } }) });
  const refresh = () => qc.invalidateQueries({ queryKey: [HR, "attendance"] });

  async function process() {
    setBusy(true);
    setMsg(null);
    try {
      const last = q.data?.dates.at(-1) ?? `${month}-28`;
      const r = await api<{ days: number }>(`${HR}/attendance/process`, { body: { from: `${month}-01`, to: last } });
      setMsg({ tone: "success", text: `${r.days} employee-days processed.` });
      refresh();
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }
  async function importFile(f: File) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiUpload<{ received: number; inserted: number; duplicates: number; unknownCodes: string[]; invalid: { line: number }[] }>(`${HR}/attendance/punches/import`, f);
      setMsg({ tone: r.unknownCodes.length || r.invalid.length ? "danger" : "success", text: `${r.inserted} punches added, ${r.duplicates} already there${r.unknownCodes.length ? `; unknown codes ${r.unknownCodes.join(", ")}` : ""}${r.invalid.length ? `; ${r.invalid.length} rows with unreadable times (lines ${r.invalid.map((i) => i.line).join(", ")})` : ""}.` });
      refresh();
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Upload failed" });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Muster roll: P present, HD half day, A absent, MP missed punch, WO weekly off, H holiday, or the leave code. Click a day for its punches."
        actions={
          can("hr.attendance.manage") && (
            <span className="flex gap-2">
              <input ref={file} type="file" accept=".csv,.xlsx,.txt" className="hidden" aria-label="Punch file" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
              <Button variant="secondary" disabled={busy} onClick={() => file.current?.click()}><Upload className="size-4" aria-hidden /> Import punches</Button>
              <Button disabled={busy} onClick={process}><RefreshCw className="size-4" aria-hidden /> Process month</Button>
            </span>
          )
        }
      />
      <div className="flex flex-wrap gap-3">
        <Input className="h-9 w-44" type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <Select className="h-9 w-56" aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">All departments</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="sticky left-0 bg-surface-muted px-3 py-2 text-left font-medium">Employee</th>
                {q.data.dates.map((d) => <th key={d} className="px-1 py-2 font-medium tabular-nums">{Number(d.slice(8))}</th>)}
                <th className="px-2 py-2 font-medium">Payable</th><th className="px-2 py-2 font-medium">LOP</th><th className="px-2 py-2 font-medium">OT h</th><th className="px-2 py-2 font-medium">Late</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="sticky left-0 whitespace-nowrap bg-surface px-3 py-1.5"><span className="font-medium">{r.fullName}</span> <span className="font-mono text-muted">{r.code}</span>{r.summary.locked && <Badge className="ml-1">locked</Badge>}</td>
                  {q.data!.dates.map((d) => {
                    const c = r.days[d];
                    return (
                      <td key={d} className="p-0.5 text-center">
                        {c ? <button className={`w-8 rounded px-0.5 py-1 font-medium ${TONE[c] ?? "bg-surface-muted"}`} onClick={() => setOpen({ employeeId: r.employeeId, name: r.fullName, date: d })}>{c}</button> : <span className="text-muted">·</span>}
                      </td>
                    );
                  })}
                  <td className="px-2 text-right tabular-nums">{r.summary.payableDays}</td>
                  <td className="px-2 text-right tabular-nums">{r.summary.lopDays}</td>
                  <td className="px-2 text-right tabular-nums">{r.summary.otHours}</td>
                  <td className="px-2 text-right tabular-nums">{r.summary.lateDays}</td>
                </tr>
              ))}
              {!q.data.rows.length && <tr><td colSpan={q.data.dates.length + 5} className="px-4 py-6 text-center text-muted">No employees.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      {open && <DayDialog {...open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DayDialog({ employeeId, name, date, onClose }: { employeeId: string; name: string; date: string; onClose: () => void }) {
  const q = useQuery({ queryKey: [HR, "attendance", "day", employeeId, date], queryFn: () => api<DayView>(`${HR}/attendance/day`, { query: { employeeId, date } }) });
  const d = q.data?.day;
  return (
    <Dialog open onClose={onClose} title={`${name} · ${date}`} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {q.isLoading && <LoadingBlock />}
      {d && (
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs text-muted">Status</dt><dd className="capitalize">{d.status.replace("_", " ")}</dd></div>
          <div><dt className="text-xs text-muted">In · out</dt><dd>{time(d.firstIn)} · {time(d.lastOut)}</dd></div>
          <div><dt className="text-xs text-muted">Worked</dt><dd>{hm(d.workedMinutes)}</dd></div>
          <div><dt className="text-xs text-muted">Late · early</dt><dd>{d.lateMinutes}m · {d.earlyMinutes}m</dd></div>
          <div><dt className="text-xs text-muted">Overtime</dt><dd>{hm(d.otMinutes)}</dd></div>
          <div><dt className="text-xs text-muted">Payable</dt><dd>{Number(d.payableDays)}</dd></div>
        </dl>
      )}
      <ul className="mt-4 divide-y divide-border rounded border border-border text-sm">
        {q.data?.punches.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-3 py-1.5">
            <span className="tabular-nums">{time(p.punchedAt)}</span><Badge>{p.source}</Badge>
            {p.insideFence === false && <Badge tone="warning">{p.distanceMetres} m outside</Badge>}
            {p.hasSelfie && <button className="text-xs text-primary hover:underline" onClick={() => apiDownload(`${HR}/attendance/punches/${p.id}/selfie`, `selfie-${date}.jpg`)}>selfie</button>}
          </li>
        ))}
        {q.data && !q.data.punches.length && <li className="px-3 py-2 text-muted">No punches.</li>}
      </ul>
    </Dialog>
  );
}
