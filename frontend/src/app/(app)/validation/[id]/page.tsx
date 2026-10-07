"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ESignDialog } from "@/components/esign-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Test { id: string; protocol: string; ref: string; title: string; requirementIds: string[]; steps: string[]; expected: string; automated: string | null; actual: string | null; result: string; evidence: string | null; executedAt: string | null }
interface Req { id: string; module: string; title: string; text: string; gxp: string; part11: boolean; fs: string; risk: { severity: number; probability: number; detectability: number; note?: string | null }; priority: string; testing: string }
interface Project { id: string; name: string; systemVersion: string; status: string; gampCategory: number; intendedUse: string | null; requirements: Req[]; tests: Test[]; approvals: { document: string; role: string; signedBy: string; signedAt: string; meaning: string }[]; trace: { requirementId: string; title: string; priority: string; tests: { ref: string; result: string }[]; status: string }[]; summary: { IQ: Record<string, number>; OQ: Record<string, number>; PQ: Record<string, number>; fitForUse: boolean }; documents: Record<string, string> }

const RESULT: Record<string, "neutral" | "success" | "danger" | "warning"> = { pending: "neutral", pass: "success", fail: "danger", na: "warning" };
const PRIO: Record<string, "danger" | "warning" | "neutral"> = { high: "danger", medium: "warning", low: "neutral" };
const TRACE: Record<string, "success" | "danger" | "warning" | "neutral"> = { covered: "success", failed: "danger", pending: "neutral", gap: "warning" };

/** One validation: requirements and risk, protocols and execution, traceability, signatures. */
export default function ValidationProjectPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["/validation/projects", id], queryFn: () => api<Project>(`/validation/projects/${id}`) });
  const [tab, setTab] = useState<"req" | "IQ" | "OQ" | "PQ" | "trace">("req");
  const [exec, setExec] = useState<Record<string, { result: string; actual: string; evidence: string }>>({});
  const [signing, setSigning] = useState<{ document: string; role: string } | null>(null);
  const [newPq, setNewPq] = useState({ title: "", requirementIds: "", steps: "", expected: "" });
  const [error, setError] = useState<string | null>(null);
  const p = q.data;
  if (!p) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["/validation/projects"] });
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const open = p.status !== "approved";
  const approved = (doc: string) => p.approvals.some((a) => a.document === doc && a.role === "approver");
  const tests = (proto: string) => p.tests.filter((t) => t.protocol === proto);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={p.name} description={`Release ${p.systemVersion} · GAMP category ${p.gampCategory} · ${p.status}${p.intendedUse ? ` · ${p.intendedUse}` : ""}`} actions={<Link className="text-sm text-primary hover:underline" href={`/print/validation/${id}`}>Print the package</Link>} />
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-4">
        {(["IQ", "OQ", "PQ"] as const).map((k) => <Card key={k} className="p-4 text-sm"><p className="text-muted">{k}</p><p className="text-xl font-semibold">{p.summary[k].pass} / {p.summary[k].total}</p><p className="text-xs">{p.summary[k].fail ? `${p.summary[k].fail} failed · ` : ""}{p.summary[k].pending} to run{approved(k) ? "" : " · protocol not approved"}</p></Card>)}
        <Card className="p-4 text-sm"><p className="text-muted">Fit for intended use</p><p className={`text-xl font-semibold ${p.summary.fitForUse ? "text-success" : ""}`}>{p.summary.fitForUse ? "Yes" : "Not yet"}</p></Card>
      </div>
      <div className="flex flex-wrap gap-1">{([["req", "Requirements & risk"], ["IQ", "IQ"], ["OQ", "OQ"], ["PQ", "PQ"], ["trace", "Traceability & sign-off"]] as const).map(([k, l]) => <Button key={k} size="sm" variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>)}</div>
      {tab === "req" && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {p.requirements.map((r) => (
              <li key={r.id} className="space-y-1 px-4 py-3">
                <p className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{r.id}</span><span className="font-medium">{r.title}</span>{r.part11 && <Badge>Part 11</Badge>}<Badge tone={r.gxp === "direct" ? "warning" : "neutral"}>GxP {r.gxp}</Badge><Badge tone={PRIO[r.priority]} className="ml-auto">{r.priority} risk</Badge></p>
                <p>{r.text}</p>
                <p className="text-xs text-muted">How: {r.fs}</p>
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  {(["severity", "probability", "detectability"] as const).map((k) => (
                    <label key={k} className="flex items-center gap-1">{k}<select disabled={!open || !can("validation.projects.manage")} className="rounded border border-border bg-surface px-1" value={r.risk[k]} onChange={(e) => run(() => api(`/validation/projects/${id}/risks`, { body: { requirementId: r.id, ...r.risk, [k]: Number(e.target.value) } }))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n === 1 ? "low" : n === 2 ? "medium" : "high"}</option>)}</select></label>
                  ))}
                  <span className="text-muted">→ {r.testing}</span>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {(tab === "IQ" || tab === "OQ" || tab === "PQ") && (
        <Card>
          <CardHeader
            title={p.documents[tab]}
            description={approved(tab) ? "Protocol approved: tests can be executed." : "Approve the protocol before executing it."}
            action={<span className="flex gap-2">{!approved(tab) && open && can("validation.documents.approve") && <Button size="sm" onClick={() => setSigning({ document: tab, role: "approver" })}>Approve protocol</Button>}{tab === "IQ" && approved("IQ") && open && <Button size="sm" variant="secondary" onClick={() => run(() => api(`/validation/projects/${id}/iq/run`, { body: {} }))}>Run installation checks</Button>}</span>}
          />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {tests(tab).map((t) => {
              const e = exec[t.id] ?? { result: "pass", actual: "", evidence: "" };
              return (
                <li key={t.id} className="space-y-1 px-4 py-3">
                  <p className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{t.ref}</span><span className="font-medium">{t.title}</span><span className="text-xs text-muted">{t.requirementIds.join(", ")}</span><Badge tone={RESULT[t.result]} className="ml-auto">{t.result}</Badge></p>
                  <ol className="list-decimal pl-6 text-xs">{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  <p className="text-xs">Expected: {t.expected}</p>
                  {t.actual && <p className="text-xs">Actual: {t.actual}{t.executedAt ? ` (${formatDateTime(t.executedAt)})` : ""}</p>}
                  {t.evidence && <p className="text-xs text-muted">Evidence: {t.evidence}</p>}
                  {open && approved(tab) && !t.automated && can("validation.projects.manage") && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Select className="h-8 w-24" aria-label="Result" value={e.result} onChange={(ev) => setExec({ ...exec, [t.id]: { ...e, result: ev.target.value } })}><option value="pass">Pass</option><option value="fail">Fail</option><option value="na">N/A</option></Select>
                      <Input className="h-8 flex-1" aria-label="Actual result" placeholder="Actual result" value={e.actual} onChange={(ev) => setExec({ ...exec, [t.id]: { ...e, actual: ev.target.value } })} />
                      <Input className="h-8 w-56" aria-label="Evidence" placeholder="Evidence (screenshot, record no.)" value={e.evidence} onChange={(ev) => setExec({ ...exec, [t.id]: { ...e, evidence: ev.target.value } })} />
                      <Button size="sm" disabled={e.actual.trim().length < 2} onClick={() => run(() => api(`/validation/projects/${id}/tests/${t.id}/execute`, { body: { result: e.result, actual: e.actual, evidence: e.evidence || null } }))}>Record</Button>
                    </div>
                  )}
                </li>
              );
            })}
            {!tests(tab).length && <li className="px-4 py-6 text-center text-muted">No tests.</li>}
          </ul>
          {tab === "PQ" && open && can("validation.projects.manage") && (
            <div className="space-y-2 border-t border-border p-4 text-sm">
              <p className="font-medium">Add a PQ test (your process, your data)</p>
              <Input aria-label="Title" placeholder="Title" value={newPq.title} onChange={(e) => setNewPq({ ...newPq, title: e.target.value })} />
              <Input aria-label="Requirements" placeholder="Requirement ids, comma separated (e.g. URS-GMP-01, URS-GMP-02)" value={newPq.requirementIds} onChange={(e) => setNewPq({ ...newPq, requirementIds: e.target.value })} />
              <textarea aria-label="Steps" rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2" placeholder="Steps, one per line" value={newPq.steps} onChange={(e) => setNewPq({ ...newPq, steps: e.target.value })} />
              <Input aria-label="Expected" placeholder="Expected result" value={newPq.expected} onChange={(e) => setNewPq({ ...newPq, expected: e.target.value })} />
              <Button size="sm" onClick={() => run(() => api(`/validation/projects/${id}/tests`, { body: { protocol: "PQ", title: newPq.title, requirementIds: newPq.requirementIds.split(",").map((x) => x.trim()).filter(Boolean), steps: newPq.steps.split("\n").map((x) => x.trim()).filter(Boolean), expected: newPq.expected } })).then(() => setNewPq({ title: "", requirementIds: "", steps: "", expected: "" }))}>Add</Button>
            </div>
          )}
        </Card>
      )}
      {tab === "trace" && (
        <>
          <Card>
            <CardHeader title="Traceability matrix" />
            <table className="w-full border-t border-border text-sm">
              <tbody className="divide-y divide-border">
                {p.trace.map((r) => <tr key={r.requirementId}><td className="px-4 py-1.5 font-mono text-xs">{r.requirementId}</td><td className="px-4 py-1.5">{r.title}</td><td className="px-4 py-1.5"><Badge tone={PRIO[r.priority]}>{r.priority}</Badge></td><td className="px-4 py-1.5 text-xs">{r.tests.map((t) => `${t.ref} ${t.result}`).join(" · ") || "–"}</td><td className="px-4 py-1.5"><Badge tone={TRACE[r.status]}>{r.status}</Badge></td></tr>)}
              </tbody>
            </table>
          </Card>
          <Card>
            <CardHeader title="Signatures" />
            <ul className="divide-y divide-border border-t border-border text-sm">
              {p.approvals.map((a, i) => <li key={i} className="px-4 py-1.5"><strong>{a.meaning}</strong> — {a.signedBy}, {formatDateTime(a.signedAt)}</li>)}
              {!p.approvals.length && <li className="px-4 py-3 text-muted">None yet.</li>}
            </ul>
            {open && can("validation.documents.approve") && (
              <div className="flex flex-wrap gap-2 border-t border-border p-4">
                {(["URS", "RA"] as const).map((d) => <Button key={d} size="sm" variant="secondary" onClick={() => setSigning({ document: d, role: "approver" })}>Approve {p.documents[d].toLowerCase()}</Button>)}
                <Button size="sm" disabled={!p.summary.fitForUse} onClick={() => setSigning({ document: "VSR", role: "approver" })}>Approve the summary report</Button>
              </div>
            )}
          </Card>
        </>
      )}
      {signing && <ESignDialog meaning={`${p.documents[signing.document]}: ${signing.role}`} reasonRequired={false} reasonLabel="Comment" onClose={() => setSigning(null)} onSign={async (password, reason) => { await api(`/validation/projects/${id}/sign`, { body: { ...signing, password, reason: reason || null } }); refresh(); }} />}
    </div>
  );
}
