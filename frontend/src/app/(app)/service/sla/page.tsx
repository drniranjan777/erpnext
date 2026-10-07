"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayIST } from "@/lib/documents";
import { SVC } from "@/lib/service";

interface Report { byPriority: { priority: string; tickets: number; responsePct: number | null; resolutionPct: number | null; avgResolutionHours: number | null }[]; byCategory: { category: string; tickets: number }[]; backlog: { open: number; overdue: number; avgRating: number | null } }
interface Settings { targets: Record<string, { response: number; resolution: number }>; businessHours: { start: string; end: string; days: number[] } | null; escalateToId: string | null; defaultWarrantyMonths: number }
const P = ["urgent", "high", "medium", "low"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const tone = (p: number | null) => (p === null ? "neutral" : p >= 95 ? "success" : p >= 80 ? "warning" : "danger");

export default function SlaPage() {
  const { can } = useAuth();
  const [from, setFrom] = useState(() => `${todayIST().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayIST);
  const r = useQuery({ queryKey: [SVC, "report", from, to], queryFn: () => api<Report>(`${SVC}/report`, { query: { from, to } }) });
  const s = useQuery({ queryKey: [SVC, "settings"], queryFn: () => api<Settings>(`${SVC}/settings`) });
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Service levels" description="How often response and resolution targets were met, and the targets themselves." />
      <div className="flex flex-wrap gap-3">
        <Input className="h-9 w-44" type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input className="h-9 w-44" type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {r.isLoading && <LoadingBlock />}
      {r.error && <ErrorBlock error={r.error} />}
      {r.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="px-5 py-4"><p className="text-xs uppercase text-muted">Open now</p><p className="text-2xl font-semibold">{r.data.backlog.open}</p></Card>
            <Card className="px-5 py-4"><p className="text-xs uppercase text-muted">Past their resolution time</p><p className="text-2xl font-semibold text-danger">{r.data.backlog.overdue}</p></Card>
            <Card className="px-5 py-4"><p className="text-xs uppercase text-muted">Customer rating</p><p className="text-2xl font-semibold">{r.data.backlog.avgRating ?? "–"}</p></Card>
          </div>
          <Card>
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Priority</th><th className="px-4 py-2 text-right font-medium">Tickets</th><th className="px-4 py-2 font-medium">Response met</th><th className="px-4 py-2 font-medium">Resolution met</th><th className="px-4 py-2 text-right font-medium">Average time to resolve</th></tr></thead>
              <tbody className="divide-y divide-border">
                {r.data.byPriority.map((p) => (
                  <tr key={p.priority}>
                    <td className="px-4 py-2 capitalize">{p.priority}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.tickets}</td>
                    <td className="px-4 py-2"><Badge tone={tone(p.responsePct)}>{p.responsePct === null ? "–" : `${p.responsePct} %`}</Badge></td>
                    <td className="px-4 py-2"><Badge tone={tone(p.resolutionPct)}>{p.resolutionPct === null ? "–" : `${p.resolutionPct} %`}</Badge></td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.avgResolutionHours === null ? "–" : `${p.avgResolutionHours} h`}</td>
                  </tr>
                ))}
                {!r.data.byPriority.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No tickets in this period.</td></tr>}
              </tbody>
            </table>
            {r.data.byCategory.length > 0 && <p className="border-t border-border px-4 py-2 text-xs text-muted">By category: {r.data.byCategory.map((c) => `${c.category} ${c.tickets}`).join(" · ")}</p>}
          </Card>
        </>
      )}
      {s.data && <SettingsForm s={s.data} manage={can("service.setup.manage")} />}
    </div>
  );
}

function SettingsForm({ s, manage }: { s: Settings; manage: boolean }) {
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ["iam", "users"], queryFn: () => api<{ userId: string; fullName: string }[]>("/iam/users"), retry: false, enabled: manage });
  const [targets, setTargets] = useState(Object.fromEntries(P.map((p) => [p, { response: String((s.targets[p]?.response ?? 0) / 60), resolution: String((s.targets[p]?.resolution ?? 0) / 60) }])));
  const [bh, setBh] = useState({ on: !!s.businessHours, start: s.businessHours?.start ?? "09:00", end: s.businessHours?.end ?? "18:00", days: s.businessHours?.days ?? [1, 2, 3, 4, 5, 6] });
  const [escalateToId, setEscalateToId] = useState(s.escalateToId ?? "");
  const [months, setMonths] = useState(String(s.defaultWarrantyMonths));
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function save() {
    setMsg(null);
    try {
      await api(`${SVC}/settings`, { method: "PUT", body: { targets: Object.fromEntries(P.map((p) => [p, { response: Math.round(Number(targets[p].response) * 60), resolution: Math.round(Number(targets[p].resolution) * 60) }])), businessHours: bh.on ? { start: bh.start, end: bh.end, days: bh.days } : null, escalateToId: escalateToId || null, defaultWarrantyMonths: Number(months) || 12 } });
      setMsg({ tone: "success", text: "Saved. New tickets use these targets." });
      qc.invalidateQueries({ queryKey: [SVC, "settings"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <Card>
      <CardHeader title="Targets" description="Hours to respond and to resolve, by priority. A customer contract can set its own resolution time." />
      <div className="space-y-3 border-t border-border p-4">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div className="grid gap-2 sm:grid-cols-4">
          {P.map((p) => (
            <div key={p} className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-medium capitalize">{p}</p>
              <Field label="Respond (h)">{(pp) => <Input {...pp} inputMode="decimal" disabled={!manage} value={targets[p].response} onChange={(e) => setTargets({ ...targets, [p]: { ...targets[p], response: e.target.value } })} />}</Field>
              <Field label="Resolve (h)">{(pp) => <Input {...pp} inputMode="decimal" disabled={!manage} value={targets[p].resolution} onChange={(e) => setTargets({ ...targets, [p]: { ...targets[p], resolution: e.target.value } })} />}</Field>
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!manage} checked={bh.on} onChange={(e) => setBh({ ...bh, on: e.target.checked })} /> Count only business hours (otherwise round the clock)</label>
        {bh.on && (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From">{(p) => <Input {...p} type="time" value={bh.start} onChange={(e) => setBh({ ...bh, start: e.target.value })} />}</Field>
            <Field label="To">{(p) => <Input {...p} type="time" value={bh.end} onChange={(e) => setBh({ ...bh, end: e.target.value })} />}</Field>
            <div className="flex gap-2 pb-2 text-sm">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={bh.days.includes(i)} onChange={(e) => setBh({ ...bh, days: e.target.checked ? [...bh.days, i].sort() : bh.days.filter((x) => x !== i) })} />{d}</label>)}</div>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Escalations also go to">{(p) => <Select {...p} disabled={!manage} value={escalateToId} onChange={(e) => setEscalateToId(e.target.value)}><option value="">Only the assignee</option>{members.data?.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}</Select>}</Field>
          <Field label="Default warranty (months)">{(p) => <Input {...p} className="w-24" type="number" disabled={!manage} value={months} onChange={(e) => setMonths(e.target.value)} />}</Field>
          {manage && <Button onClick={save}>Save</Button>}
        </div>
      </div>
    </Card>
  );
}
