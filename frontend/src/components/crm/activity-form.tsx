"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { todayIST } from "@/lib/documents";
import { ACTIVITY_LABEL, CRM, type Activity, when } from "@/lib/crm";
import { Badge } from "@/components/ui/badge";

/** The activity timeline of a lead or opportunity, with a form to log or schedule the next one. */
export function ActivityTimeline({ activities, link, canManage }: { activities: Activity[]; link: { leadId?: string; opportunityId?: string }; canManage: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ kind: "call", subject: "", notes: "", done: true, date: todayIST(), time: "11:00" });
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: [CRM] });
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      return false;
    }
  }
  async function add() {
    const ok = await run(() => api(`${CRM}/activities`, { body: { ...link, kind: f.kind, subject: f.subject, notes: f.notes || null, done: f.done, dueAt: f.done ? null : `${f.date}T${f.time}:00+05:30` } }));
    if (ok) setF({ ...f, subject: "", notes: "" });
  }
  return (
    <Card>
      <CardHeader title="Activities" />
      {canManage && (
        <div className="grid gap-2 border-t border-border p-4 sm:grid-cols-6">
          {error && <div className="sm:col-span-6"><Alert>{error}</Alert></div>}
          <Field label="What">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(ACTIVITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Subject" className="sm:col-span-2">{(p) => <Input {...p} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
          <Field label="When">{(p) => <Select {...p} value={f.done ? "done" : "plan"} onChange={(e) => setF({ ...f, done: e.target.value === "done" })}><option value="done">Done now</option><option value="plan">Schedule</option></Select>}</Field>
          {!f.done && <Field label="Date">{(p) => <Input {...p} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>}
          {!f.done && <Field label="Time">{(p) => <Input {...p} type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />}</Field>}
          <Field label="Notes" className="sm:col-span-5">{(p) => <Input {...p} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
          <div className="flex items-end"><Button className="w-full" disabled={f.subject.trim().length < 2} onClick={add}>{f.done ? "Log" : "Schedule"}</Button></div>
        </div>
      )}
      <ul className="divide-y divide-border border-t border-border text-sm">
        {activities.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 px-5 py-2">
            <Badge tone={a.doneAt ? "neutral" : "warning"}>{ACTIVITY_LABEL[a.kind] ?? a.kind}</Badge>
            <span className="font-medium">{a.subject}</span>
            <span className="text-xs text-muted">{a.doneAt ? `done ${when(a.doneAt)}` : `due ${when(a.dueAt)}`}{a.owner && ` · ${a.owner}`}</span>
            {a.outcome && <span className="text-xs">→ {a.outcome}</span>}
            {a.notes && <span className="block w-full text-xs text-muted">{a.notes}</span>}
            {!a.doneAt && canManage && <Button className="ml-auto" size="sm" variant="ghost" onClick={() => { const outcome = window.prompt("Outcome"); if (outcome !== null) run(() => api(`${CRM}/activities/${a.id}/done`, { body: { outcome: outcome || null } })); }}>Done</Button>}
          </li>
        ))}
        {!activities.length && <li className="px-5 py-4 text-muted">No activities yet.</li>}
      </ul>
    </Card>
  );
}
