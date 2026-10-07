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

interface Ppap { id: string; code: string; itemCode: string; itemName: string; customer: string | null; level: number; reason: string; status: string; customer_comments: string | null; elements: { no: number; name: string; requirement: string; status: string; reference: string | null; notes: string | null }[]; open: { no: number }[]; evidence: { fmeas: { id: string; code: string; kind: string }[]; controlPlans: { id: string; code: string; phase: string }[]; inspections: { id: string; number: string | null; result: string }[]; drawings: { drawingNo: string; revision: string }[] }; psw: { meaning: string; reason: string | null; signedBy: string; signedAt: string }[] }

const REQ: Record<string, string> = { S: "submit", R: "retain", "*": "as specified" };
const TONE: Record<string, "neutral" | "warning" | "success"> = { not_started: "neutral", in_progress: "warning", complete: "success", na: "neutral" };

/** One PPAP: element status with evidence, PSW signature and the customer's decision. */
export default function PpapDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("auto.apqp.manage");
  const q = useQuery({ queryKey: ["/auto/ppap", id], queryFn: () => api<Ppap>(`/auto/ppap/${id}`) });
  const [refs, setRefs] = useState<Record<number, string>>({});
  const [psw, setPsw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = q.data;
  if (!s) return null;
  const editable = s.status === "draft" || s.status === "rejected";
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["/auto/ppap"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title={`PPAP ${s.code}`} description={`${s.itemCode} · ${s.itemName}${s.customer ? ` · ${s.customer}` : ""} · level ${s.level} · ${s.reason.replace("_", " ")}`} actions={<Badge tone={s.status === "approved" ? "success" : s.status === "rejected" ? "danger" : "warning"}>{s.status}</Badge>} />
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title="Elements" description={s.open.length ? `${s.open.length} element(s) still to complete before the PSW can be signed.` : "Everything to submit is complete."} />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {s.elements.map((e) => (
            <li key={e.no} className="flex flex-wrap items-center gap-2 px-4 py-1.5">
              <span className="w-6 text-right text-xs text-muted">{e.no}</span>
              <span className="flex-1">{e.name} <span className="text-xs text-muted">({REQ[e.requirement]})</span>{e.reference ? <span className="block text-xs text-muted">{e.reference}</span> : null}</span>
              {editable && manage && e.no !== 18 ? (
                <>
                  <Input className="h-8 w-48" aria-label="Reference" placeholder="Reference / document" value={refs[e.no] ?? e.reference ?? ""} onChange={(ev) => setRefs({ ...refs, [e.no]: ev.target.value })} />
                  <Select className="h-8 w-36" aria-label="Status" value={e.status} onChange={(ev) => run(() => api(`/auto/ppap/${id}/elements`, { body: { no: e.no, status: ev.target.value, reference: refs[e.no] ?? e.reference ?? null } }))}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="complete">Complete</option><option value="na">Not applicable</option></Select>
                </>
              ) : (
                <Badge tone={TONE[e.status]}>{e.status.replace("_", " ")}</Badge>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Evidence in the system" />
        <div className="space-y-1 border-t border-border p-4 text-sm">
          <p>FMEAs: {s.evidence.fmeas.map((f) => <Link key={f.id} className="mr-2 text-primary hover:underline" href={`/auto/fmea/${f.id}`}>{f.code}</Link>)}{!s.evidence.fmeas.length && "none"}</p>
          <p>Control plans: {s.evidence.controlPlans.map((c) => `${c.code} (${c.phase.replace("_", " ")})`).join(", ") || "none"}</p>
          <p>Drawings: {s.evidence.drawings.map((d) => `${d.drawingNo} rev ${d.revision}`).join(", ") || "none"}</p>
          <p>Inspections: {s.evidence.inspections.map((i) => `${i.number ?? "draft"} ${i.result}`).join(", ") || "none"}</p>
        </div>
      </Card>
      {s.psw.length > 0 && <Card className="p-4 text-sm">{s.psw.map((p) => <p key={p.signedAt}><strong>{p.meaning}</strong> — {p.signedBy}, {formatDateTime(p.signedAt)}: “{p.reason}”</p>)}{s.customer_comments && <p className="mt-1">Customer: {s.customer_comments}</p>}</Card>}
      {manage && (
        <div className="flex flex-wrap gap-2">
          {editable && <Button disabled={s.open.length > 0} onClick={() => setPsw(true)}>Sign the PSW and submit</Button>}
          {s.status === "submitted" && (["approved", "interim", "rejected"] as const).map((d) => <Button key={d} variant={d === "rejected" ? "danger" : "secondary"} onClick={() => run(() => api(`/auto/ppap/${id}/decision`, { body: { decision: d, comments: window.prompt("Customer comments") } }))}>Customer: {d}</Button>)}
        </div>
      )}
      {psw && <ESignDialog meaning="Part submission warrant signed" reasonRequired reasonLabel="Declaration" onClose={() => setPsw(false)} onSign={async (password, declaration) => { await api(`/auto/ppap/${id}/submit`, { body: { password, declaration } }); qc.invalidateQueries({ queryKey: ["/auto/ppap"] }); }} />}
    </div>
  );
}
