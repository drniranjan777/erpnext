"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { MT, type Asset } from "@/lib/maintenance";
import { textarea } from "@/lib/qms";

interface Schedule { id: string; title: string; trigger: "time" | "meter"; intervalDays: number | null; intervalMeter: string | null; lastDoneOn: string | null; nextDue: string | null; nextMeter: string | null; checklist: string[]; isActive: boolean; assetId: string | null; assetCode: string | null; assetName: string | null; meterReading: string | null; meterUnit: string | null; toolCode: string | null; state: "overdue" | "due" | "ok" | null; openOrder: string | null }
const STATE = { overdue: { label: "Overdue", tone: "danger" }, due: { label: "Due", tone: "warning" }, ok: { label: "Scheduled", tone: "success" } } as const;

export default function PmPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can("maintenance.orders.manage");
  const q = useQuery({ queryKey: [MT, "pm"], queryFn: () => api<Schedule[]>(`${MT}/pm`) });
  const comp = useQuery({ queryKey: [MT, "pm", "compliance"], queryFn: () => api<{ done: number; onTime: number }>(`${MT}/pm/compliance`) });
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function generate() {
    setMsg(null);
    try {
      const r = await api<{ created: { number: string; title: string }[] }>(`${MT}/pm/generate`, { body: { lookahead: 7 } });
      setMsg({ tone: "success", text: r.created.length ? `Opened ${r.created.length} order${r.created.length === 1 ? "" : "s"}: ${r.created.map((c) => c.title).join(", ")}` : "Nothing is due in the next 7 days." });
      qc.invalidateQueries({ queryKey: [MT] });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Preventive maintenance"
        description="Schedules by calendar or meter. Opening due jobs creates a preventive order with the checklist; signing it off sets the next due date or meter reading. Moulds and dies with a service interval in shots are included."
        actions={manage && <span className="flex gap-2"><Button variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> New schedule</Button><Button onClick={generate}><CalendarPlus className="size-4" aria-hidden /> Open due jobs</Button></span>}
      />
      {comp.data && comp.data.done > 0 && <p className="text-sm text-muted">Last 90 days: {comp.data.done} PM jobs signed off, {Math.round((comp.data.onTime / comp.data.done) * 100)}% on time.</p>}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {adding && <ScheduleForm onClose={() => setAdding(false)} />}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Schedule</th><th className="px-4 py-2 font-medium">Every</th><th className="px-4 py-2 font-medium">Last done</th><th className="px-4 py-2 font-medium">Next</th><th className="px-4 py-2 font-medium">State</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.map((s) => (
                <tr key={s.id} className={s.isActive ? undefined : "opacity-60"}>
                  <td className="px-4 py-2">{s.title}<span className="block text-xs text-muted">{s.assetCode ? <Link className="hover:underline" href={`${MT}/assets/${s.assetId}`}>{s.assetCode} {s.assetName}</Link> : s.toolCode}{s.checklist.length > 0 && ` · ${s.checklist.length} checks`}</span></td>
                  <td className="px-4 py-2">{s.trigger === "time" ? `${s.intervalDays} days` : `${formatQty(s.intervalMeter)} ${s.meterUnit ?? ""}`}</td>
                  <td className="px-4 py-2">{s.lastDoneOn ? formatDate(s.lastDoneOn) : "–"}</td>
                  <td className="px-4 py-2">{s.trigger === "time" ? (s.nextDue ? formatDate(s.nextDue) : "–") : `at ${formatQty(s.nextMeter)} (now ${s.meterReading ? formatQty(s.meterReading) : "–"})`}</td>
                  <td className="px-4 py-2">{s.openOrder ? <Badge tone="primary">Open: {s.openOrder}</Badge> : s.state ? <Badge tone={STATE[s.state].tone}>{STATE[s.state].label}</Badge> : <Badge>Paused</Badge>}</td>
                </tr>
              ))}
              {!q.data.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No PM schedules.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function ScheduleForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const assets = useQuery({ queryKey: [MT, "assets"], queryFn: () => api<Asset[]>(`${MT}/assets`) });
  const [f, setF] = useState({ assetId: "", title: "", trigger: "time", intervalDays: "30", intervalMeter: "", firstDue: "", checklist: "", estimatedMinutes: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const asset = assets.data?.find((a) => a.id === f.assetId);
  async function save() {
    setError(null);
    try {
      await api(`${MT}/pm`, { body: { assetId: f.assetId, title: f.title, trigger: f.trigger, intervalDays: f.trigger === "time" ? Number(f.intervalDays) : null, intervalMeter: f.trigger === "meter" ? f.intervalMeter : null, firstDue: f.firstDue || null, checklist: f.checklist.split("\n").map((x) => x.trim()).filter(Boolean), estimatedMinutes: f.estimatedMinutes ? Number(f.estimatedMinutes) : null } });
      qc.invalidateQueries({ queryKey: [MT, "pm"] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <CardHeader title="New PM schedule" />
      <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-4">
        {error && <div className="sm:col-span-4"><Alert>{error}</Alert></div>}
        <Field label="Asset" required>{(p) => <Select {...p} value={f.assetId} onChange={set("assetId")}><option value="">Choose…</option>{assets.data?.filter((a) => a.status !== "retired").map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</Select>}</Field>
        <Field label="Task" required className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={set("title")} />}</Field>
        <Field label="Trigger">{(p) => <Select {...p} value={f.trigger} onChange={set("trigger")}><option value="time">Every so many days</option><option value="meter" disabled={!!asset && !asset.meterUnit}>Every so much meter</option></Select>}</Field>
        {f.trigger === "time" ? (
          <>
            <Field label="Every (days)">{(p) => <Input {...p} inputMode="numeric" value={f.intervalDays} onChange={set("intervalDays")} />}</Field>
            <Field label="First due" hint="Blank = one interval from today">{(p) => <Input {...p} type="date" value={f.firstDue} onChange={set("firstDue")} />}</Field>
          </>
        ) : (
          <Field label={`Every (${asset?.meterUnit ?? "meter"})`}>{(p) => <Input {...p} inputMode="decimal" value={f.intervalMeter} onChange={set("intervalMeter")} />}</Field>
        )}
        <Field label="Estimated minutes">{(p) => <Input {...p} inputMode="numeric" value={f.estimatedMinutes} onChange={set("estimatedMinutes")} />}</Field>
        <Field label="Checklist" hint="One check per line" className="sm:col-span-4">{(p) => <textarea {...p} rows={4} className={textarea} value={f.checklist} onChange={set("checklist")} />}</Field>
        <div className="flex justify-end gap-2 sm:col-span-4"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.assetId || f.title.trim().length < 3}>Save</Button></div>
      </div>
    </Card>
  );
}
