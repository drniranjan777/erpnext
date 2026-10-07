"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed, AttachmentsPanel } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, todayIST } from "@/lib/documents";
import { CAPA_STAGE, EIGHT_D, FISHBONE, FISHBONE_LABEL, QA, type Capa } from "@/lib/quality";

const C = `${QA}/capas`;
const METHOD = { "5why": "5 Why", fishbone: "Fishbone", "8d": "8D" } as const;

export default function CapaPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const key = [QA, "capas", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Capa>(`${C}/${id}`) });
  const [error, setError] = useState<string | null>(null);
  const [newAction, setNewAction] = useState({ kind: "corrective", action: "", owner: "", dueDate: "" });
  const [check, setCheck] = useState({ effective: true, notes: "" });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  const today = todayIST();
  async function call(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: C, label: "CAPA" }}
        badges={<><Badge>{d.isScar ? "SCAR" : d.kind === "preventive" ? "Preventive" : "Corrective"}</Badge>{d.status === "approved" && <Badge tone={CAPA_STAGE[d.stage].tone}>{CAPA_STAGE[d.stage].label}</Badge>}</>}
        subtitle={d.problem}
        actions={<DocumentActions doc={d} apiBase={C} routeBase={C} queryKey={key} />}
      />
      {error && <Alert>{error}</Alert>}
      <DocStatusAlerts doc={d} approvedNote={d.stage === "closed" ? `Closed ${formatDateTime(d.closedAt)}: verified effective.` : undefined} />
      {d.effectivenessResult === "not_effective" && d.stage !== "closed" && <Alert tone="warning">The last effectiveness check found the actions did not work: {d.effectivenessNotes}</Alert>}
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Raised from" value={d.ncr ? <Link className="text-primary hover:underline" href={`${QA}/ncrs/${d.ncr.id}`}>{d.ncr.number ?? "NCR"}</Link> : d.complaint ? <Link className="text-primary hover:underline" href={`${QA}/complaints/${d.complaint.id}`}>{d.complaint.number ?? "Complaint"}</Link> : d.source} />
          {d.isScar && <Info label="Supplier" value={d.party?.name} />}
          {d.isScar && <Info label="Response due" value={d.responseDue ? formatDate(d.responseDue) : "–"} />}
          {d.item && <Info label="Item" value={`${d.item.code} ${d.item.name}`} />}
          <Info label="Effectiveness check by" value={d.effectivenessDue ? formatDate(d.effectivenessDue) : "–"} />
        </dl>
      </Card>
      <Card>
        <CardHeader title={`Root cause (${METHOD[d.method]})`} />
        <div className="space-y-3 border-t border-border px-5 py-4 text-sm">
          {d.method === "5why" && d.whys.length > 0 && <ol className="list-decimal space-y-1 pl-5">{d.whys.map((w, i) => <li key={i}>{w}</li>)}</ol>}
          {d.method === "fishbone" && (
            <div className="grid gap-3 sm:grid-cols-3">
              {FISHBONE.filter((k) => d.fishbone[k]?.length).map((k) => (
                <div key={k} className="rounded-lg border border-border p-3"><p className="text-xs font-medium uppercase text-muted">{FISHBONE_LABEL[k]}</p><ul className="mt-1 list-disc pl-4">{d.fishbone[k]!.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
              ))}
            </div>
          )}
          {d.method === "8d" && <dl className="grid gap-3 sm:grid-cols-2">{EIGHT_D.filter(([k]) => d.eightD[k]).map(([k, label]) => <Info key={k} label={label} value={<span className="whitespace-pre-line">{d.eightD[k]}</span>} />)}</dl>}
          <p><span className="font-medium">Root cause:</span> {d.rootCause ?? <span className="text-muted">not stated yet</span>}</p>
        </div>
      </Card>
      <Card>
        <CardHeader title="Actions" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {d.actions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              {d.canAct ? <Checkbox aria-label={`Done: ${a.action}`} checked={!!a.doneOn} onChange={(e) => call(() => api(`${C}/${d.id}/actions/${a.id}`, { method: "PUT", body: { done: e.target.checked, notes: a.notes } }))} /> : <span className={`inline-block size-2 rounded-full ${a.doneOn ? "bg-success" : "bg-warning"}`} />}
              <Badge>{a.kind}</Badge>
              <span className={`flex-1 ${a.doneOn ? "text-muted line-through" : ""}`}>{a.action}</span>
              <span className="text-xs text-muted">{a.owner}{a.dueDate && ` · due ${formatDate(a.dueDate)}`}{a.doneOn && ` · done ${formatDate(a.doneOn)}`}</span>
              {!a.doneOn && a.dueDate && a.dueDate < today && <Badge tone="danger">Overdue</Badge>}
            </li>
          ))}
          {!d.actions.length && <li className="px-5 py-3 text-muted">No actions.</li>}
        </ul>
        {d.canAct && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
            <Select className="h-9 w-36" aria-label="Kind" value={newAction.kind} onChange={(e) => setNewAction({ ...newAction, kind: e.target.value })}><option value="containment">Containment</option><option value="corrective">Corrective</option><option value="preventive">Preventive</option></Select>
            <Input className="h-9 min-w-56 flex-1" aria-label="New action" placeholder="Another action" value={newAction.action} onChange={(e) => setNewAction({ ...newAction, action: e.target.value })} />
            <Input className="h-9 w-32" aria-label="Owner" placeholder="Owner" value={newAction.owner} onChange={(e) => setNewAction({ ...newAction, owner: e.target.value })} />
            <Input className="h-9 w-40" type="date" aria-label="Due" value={newAction.dueDate} onChange={(e) => setNewAction({ ...newAction, dueDate: e.target.value })} />
            <Button size="sm" variant="secondary" disabled={newAction.action.trim().length < 3} onClick={() => call(async () => { await api(`${C}/${d.id}/actions`, { body: { ...newAction, owner: newAction.owner || null, dueDate: newAction.dueDate || null } }); setNewAction({ kind: "corrective", action: "", owner: "", dueDate: "" }); })}><Plus className="size-4" aria-hidden /> Add</Button>
          </div>
        )}
      </Card>
      {d.canVerify && (
        <Card>
          <CardHeader title="Effectiveness check" description="All actions are done. Did they stop the problem coming back?" />
          <div className="flex flex-wrap items-end gap-3 border-t border-border p-5">
            <Field label="Result">{(p) => <Select {...p} value={check.effective ? "yes" : "no"} onChange={(e) => setCheck({ ...check, effective: e.target.value === "yes" })}><option value="yes">Effective: close the CAPA</option><option value="no">Not effective: reopen</option></Select>}</Field>
            <Field label="How it was checked" className="min-w-72 flex-1">{(p) => <Input {...p} value={check.notes} onChange={(e) => setCheck({ ...check, notes: e.target.value })} />}</Field>
            <Button disabled={check.notes.trim().length < 3} onClick={() => call(() => api(`${C}/${d.id}/verify`, { body: { version: d.version, ...check } }))}>Record</Button>
          </div>
        </Card>
      )}
      {d.effectivenessResult === "effective" && <Card className="p-5 text-sm"><span className="font-medium">Verified effective:</span> {d.effectivenessNotes}</Card>}
      <AttachmentsPanel documentId={d.id} readOnly={d.status === "cancelled"} />
      <ActivityFeed documentId={d.id} />
    </div>
  );
}
