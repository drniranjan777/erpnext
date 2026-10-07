"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Info } from "@/components/documents/doc-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { QMS, textarea } from "@/lib/qms";

interface Finding { id: string; kind: "major_nc" | "minor_nc" | "observation" | "ofi"; clause: string | null; description: string; capaId: string | null; capaNumber: string | null; capaStage: string | null; closedOn: string | null }
interface Audit { id: string; title: string; standard: string; area: string; plannedDate: string; auditor: string; auditee: string | null; status: "planned" | "done"; doneOn: string | null; summary: string | null; findings: Finding[] }
const KIND = { major_nc: { label: "Major NC", tone: "danger" }, minor_nc: { label: "Minor NC", tone: "warning" }, observation: { label: "Observation", tone: "neutral" }, ofi: { label: "Opportunity", tone: "primary" } } as const;

export default function AuditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("quality.audits.manage");
  const key = [QMS, "audits", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Audit>(`${QMS}/audits/${id}`) });
  const [f, setF] = useState({ kind: "minor_nc", clause: "", description: "" });
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const a = q.data!;
  async function call<T>(fn: () => Promise<T>, then?: (r: T) => void) {
    setError(null);
    try {
      const r = await fn();
      await qc.invalidateQueries({ queryKey: [QMS, "audits"] });
      then?.(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={a.title} description={`${a.standard} · ${a.area}`} actions={<Link href="/quality/audits" className="text-sm underline">All audits</Link>} />
      {error && <Alert>{error}</Alert>}
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Planned" value={formatDate(a.plannedDate)} />
          <Info label="Auditor" value={a.auditor} />
          <Info label="Auditee" value={a.auditee ?? "–"} />
          <Info label="Status" value={a.status === "done" ? `Done ${formatDate(a.doneOn!)}` : "Planned"} />
        </dl>
        {a.summary && <p className="border-t border-border px-5 py-3 text-sm">{a.summary}</p>}
      </Card>
      <Card>
        <CardHeader title="Findings" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {a.findings.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Badge tone={KIND[x.kind].tone}>{KIND[x.kind].label}</Badge>
              {x.clause && <span className="font-mono text-xs text-muted">{x.clause}</span>}
              <span className="flex-1">{x.description}</span>
              {x.capaId ? <Link className="text-xs text-primary hover:underline" href={`/quality/capas/${x.capaId}`}>{x.capaNumber ?? "Draft CAPA"}{x.capaStage && ` · ${x.capaStage}`}</Link> : manage && (x.kind === "major_nc" || x.kind === "minor_nc") && <Button size="sm" variant="secondary" onClick={() => call(() => api<{ id: string }>(`${QMS}/findings/${x.id}/capa`, { method: "POST" }), (r) => router.push(`/quality/capas/${r.id}`))}>Raise CAPA</Button>}
              {x.closedOn ? <Badge tone="success">Closed {formatDate(x.closedOn)}</Badge> : manage && <Button size="sm" variant="ghost" onClick={() => call(() => api(`${QMS}/findings/${x.id}/close`, { method: "POST" }))}>Close</Button>}
            </li>
          ))}
          {!a.findings.length && <li className="px-5 py-3 text-muted">No findings.</li>}
        </ul>
        {manage && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
            <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>
            <Field label="Clause">{(p) => <Input {...p} className="w-24" value={f.clause} onChange={(e) => setF({ ...f, clause: e.target.value })} />}</Field>
            <Field label="Finding" className="min-w-72 flex-1">{(p) => <Input {...p} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
            <Button disabled={f.description.trim().length < 3} onClick={() => call(async () => { await api(`${QMS}/audits/${a.id}/findings`, { body: { ...f, clause: f.clause || null } }); setF({ ...f, clause: "", description: "" }); })}>Add finding</Button>
          </div>
        )}
      </Card>
      {manage && a.status === "planned" && (
        <Card>
          <CardHeader title="Complete the audit" />
          <div className="space-y-3 border-t border-border p-5">
            <textarea aria-label="Summary" rows={3} className={textarea} placeholder="Scope covered, overall conclusion" value={summary} onChange={(e) => setSummary(e.target.value)} />
            <div className="flex justify-end"><Button disabled={summary.trim().length < 3} onClick={() => call(() => api(`${QMS}/audits/${a.id}/done`, { body: { summary } }))}>Mark done</Button></div>
          </div>
        </Card>
      )}
    </div>
  );
}
