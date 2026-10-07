"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import type { Catalogue } from "@/lib/reports";

interface Schedule { id: string; name: string; savedReportId: string | null; reportKey: string | null; reportTitle: string | null; params: Record<string, string>; frequency: "daily" | "weekly" | "monthly"; weekday: number | null; monthDay: number | null; hour: number; recipients: string[]; format: string; isActive: boolean; nextRunAt: string | null; lastRunAt: string | null; lastStatus: string | null; lastError: string | null }
interface Saved { id: string; name: string }

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** Relative periods for standard reports with from / to dates. */
const PERIODS: Record<string, { label: string; from: string; to: string }> = {
  mtd: { label: "This month to date", from: "month_start", to: "today" },
  last_month: { label: "Last month", from: "prev_month_start", to: "prev_month_end" },
  fytd: { label: "Financial year to date", from: "fy_start", to: "today" },
  yesterday: { label: "Yesterday", from: "yesterday", to: "yesterday" },
  wtd: { label: "This week to date", from: "week_start", to: "today" },
};

export default function SchedulesPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Schedules />
    </Suspense>
  );
}

function Schedules() {
  const qc = useQueryClient();
  const search = useSearchParams();
  const list = useQuery({ queryKey: ["report-schedules"], queryFn: () => api<Schedule[]>("/report-schedules") });
  const [creating, setCreating] = useState(!!search.get("report"));
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["report-schedules"] });
  async function runNow(s: Schedule) {
    setMsg(null);
    try {
      const r = await api<{ status: string; error: string | null }>(`/report-schedules/${s.id}/run`, { method: "POST" });
      setMsg(r.status === "sent" ? { tone: "success", text: `${s.name} sent to ${s.recipients.join(", ")}.` } : { tone: "danger", text: r.error ?? "Could not send." });
      refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }
  async function remove(s: Schedule) {
    try {
      await api(`/report-schedules/${s.id}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }
  const when = (s: Schedule) => `${s.frequency === "daily" ? "Every day" : s.frequency === "weekly" ? `Every ${DAYS[(s.weekday ?? 1) - 1]}` : `On day ${s.monthDay} of each month`} at ${String(s.hour).padStart(2, "0")}:00`;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/reports" className="text-sm text-muted hover:text-foreground">← Reports</Link>
        <PageHeader title="Scheduled reports" description="Reports emailed as Excel or CSV attachments, on your schedule (India time). Each runs with your access at the time it is sent." actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New schedule</Button>} />
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {creating && <ScheduleForm initialReport={search.get("report") ?? ""} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} />}
      {list.isLoading && <LoadingBlock />}
      {list.error && <ErrorBlock error={list.error} />}
      <div className="space-y-3">
        {list.data?.map((s) => (
          <Card key={s.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="space-y-1 text-sm">
              <p className="font-medium">{s.name} {!s.isActive && <Badge tone="warning">Paused</Badge>}</p>
              <p className="text-muted">{s.reportTitle ?? "Saved report"} · {when(s)} · {s.format.toUpperCase()} to {s.recipients.join(", ")}</p>
              <p className="text-xs text-muted">
                {s.nextRunAt && s.isActive ? `Next: ${formatDateTime(s.nextRunAt)}` : "Not scheduled"}
                {s.lastRunAt && ` · Last: ${formatDateTime(s.lastRunAt)} `}
                {s.lastStatus && <Badge tone={s.lastStatus === "sent" ? "success" : "danger"} className="ml-1">{s.lastStatus === "sent" ? "Sent" : "Failed"}</Badge>}
              </p>
              {s.lastError && <p className="text-xs text-danger">{s.lastError}</p>}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => runNow(s)}><Send className="size-4" aria-hidden /> Send now</Button>
              <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => remove(s)}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
          </Card>
        ))}
        {list.data && !list.data.length && !creating && <Card className="p-6 text-center text-sm text-muted">No schedules yet.</Card>}
      </div>
    </div>
  );
}

function ScheduleForm({ initialReport, onClose, onSaved }: { initialReport: string; onClose: () => void; onSaved: () => void }) {
  const catalogue = useQuery({ queryKey: ["reports", "catalogue"], queryFn: () => api<Catalogue>("/reports") });
  const saved = useQuery({ queryKey: ["report-builder", "saved-list"], queryFn: () => api<Saved[]>("/report-builder/saved") });
  const [f, setF] = useState({ name: "", report: initialReport ? `std:${initialReport}` : "", period: "mtd", frequency: "daily" as Schedule["frequency"], weekday: 1, monthDay: 1, hour: 8, recipients: "", format: "xlsx", isActive: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const std = f.report.startsWith("std:") ? catalogue.data?.reports.find((r) => r.key === f.report.slice(4)) : undefined;
  const hasPeriod = std?.kind === "query" && std.params.some((p) => p.key === "from");

  async function save() {
    setBusy(true);
    setError(null);
    setErrors({});
    const period = PERIODS[f.period];
    const body = {
      name: f.name || (std?.title ?? "Scheduled report"),
      reportKey: std ? std.key : null,
      savedReportId: f.report.startsWith("saved:") ? f.report.slice(6) : null,
      params: hasPeriod ? { from: period.from, to: period.to } : {},
      frequency: f.frequency,
      weekday: f.frequency === "weekly" ? f.weekday : null,
      monthDay: f.frequency === "monthly" ? f.monthDay : null,
      hour: f.hour,
      recipients: f.recipients.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean),
      format: f.format,
      isActive: f.isActive,
    };
    try {
      await api("/report-schedules", { body });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Report" required error={errors.reportKey}>
          {(p) => (
            <Select {...p} value={f.report} onChange={(e) => setF({ ...f, report: e.target.value })}>
              <option value="">Choose…</option>
              {saved.data?.length ? <optgroup label="My reports">{saved.data.map((s) => <option key={s.id} value={`saved:${s.id}`}>{s.name}</option>)}</optgroup> : null}
              <optgroup label="Standard reports">{catalogue.data?.reports.filter((r) => r.kind === "query").map((r) => <option key={r.key} value={`std:${r.key}`}>{r.title}</option>)}</optgroup>
            </Select>
          )}
        </Field>
        <Field label="Name" hint="Shown in the email subject">{(p) => <Input {...p} value={f.name} placeholder={std?.title} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        {hasPeriod && <Field label="Period covered">{(p) => <Select {...p} value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>{Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>}
        <Field label="How often" error={errors.frequency}>{(p) => <Select {...p} value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Schedule["frequency"] })}><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></Select>}</Field>
        {f.frequency === "weekly" && <Field label="Day" error={errors.weekday}>{(p) => <Select {...p} value={String(f.weekday)} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</Select>}</Field>}
        {f.frequency === "monthly" && <Field label="Day of month" error={errors.monthDay}>{(p) => <Select {...p} value={String(f.monthDay)} onChange={(e) => setF({ ...f, monthDay: Number(e.target.value) })}>{Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Select>}</Field>}
        <Field label="At (India time)">{(p) => <Select {...p} value={String(f.hour)} onChange={(e) => setF({ ...f, hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select>}</Field>
        <Field label="Email to" required error={errors.recipients} hint="Separate addresses with commas" className="sm:col-span-2">{(p) => <Input {...p} value={f.recipients} onChange={(e) => setF({ ...f, recipients: e.target.value })} />}</Field>
        <Field label="Format">{(p) => <Select {...p} value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}><option value="xlsx">Excel</option><option value="csv">CSV</option></Select>}</Field>
        <div className="flex items-end pb-2"><Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /></div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={busy} disabled={!f.report}>Schedule</Button>
      </div>
    </Card>
  );
}
