"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequestArrow } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed, AttachmentsPanel, StatusBadge } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, type DocumentStatus } from "@/lib/documents";
import { QMS, RISK_TONE, type Deviation } from "@/lib/qms";

const API = `${QMS}/deviations`;
const ROUTE = "/quality/deviations";

export default function DeviationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const key = [QMS, "deviations", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Deviation>(`${API}/${id}`) });
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  async function call<T>(fn: () => Promise<T>, then?: (r: T) => void) {
    setError(null);
    try {
      const r = await fn();
      await qc.invalidateQueries({ queryKey: key });
      then?.(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: ROUTE, label: "Deviations" }}
        badges={<><Badge>{d.kind}</Badge><Badge tone={RISK_TONE[d.riskLevel]}>Risk {d.riskLevel} · RPN {d.rpn}</Badge>{d.closedAt && <Badge tone="success">Closed</Badge>}{d.expired && <Badge tone="danger">Past its date</Badge>}</>}
        subtitle={d.description}
        actions={
          <>
            {d.status === "approved" && !d.capa && can("quality.capa.manage") && <Button variant="secondary" onClick={() => call(() => api<{ id: string }>(`${API}/${d.id}/capa`, { method: "POST" }), (r) => router.push(`/quality/capas/${r.id}`))}><GitPullRequestArrow className="size-4" aria-hidden /> Raise CAPA</Button>}
            <DocumentActions doc={d} apiBase={API} routeBase={ROUTE} queryKey={key} />
          </>
        }
      />
      {error && <Alert>{error}</Alert>}
      <DocStatusAlerts doc={d} approvedNote={d.closedAt ? `Closed ${formatDateTime(d.closedAt)}: ${d.closureNotes}` : "Approved by QA. Close it once the action is done."} />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Category" value={d.category} />
          <Info label="Item" value={d.item ? `${d.item.code} ${d.item.name}` : "–"} />
          <Info label="Batch" value={d.batchNo ?? "–"} mono />
          {d.kind === "planned" && <Info label="Applies until" value={d.validUntil ? formatDate(d.validUntil) : "–"} />}
          <Info label="Severity / occurrence / detection" value={`${d.severity} / ${d.occurrence} / ${d.detection}`} />
          <Info label="Product impact" value={d.productImpact ? "Yes" : "No"} />
          <Info label="CAPA" value={d.capa ? <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={`/quality/capas/${d.capa.id}`}>{d.capa.number ?? "Draft"} <StatusBadge status={d.capa.status as DocumentStatus} /></Link> : "–"} />
        </dl>
        {(d.impact || d.proposedAction) && (
          <div className="space-y-2 border-t border-border px-5 py-4 text-sm">
            {d.impact && <p><span className="font-medium">Impact:</span> {d.impact}</p>}
            {d.proposedAction && <p><span className="font-medium">Proposed action:</span> {d.proposedAction}</p>}
          </div>
        )}
      </Card>
      {d.canClose && (
        <Card>
          <CardHeader title="Close the deviation" />
          <div className="flex flex-wrap items-end gap-3 border-t border-border p-5">
            <div className="min-w-72 flex-1"><Input aria-label="Closure notes" placeholder="What was done and the outcome (e.g. batch released after testing)" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <Button disabled={notes.trim().length < 3} onClick={() => call(() => api(`${API}/${d.id}/close`, { body: { version: d.version, notes } }))}>Close</Button>
          </div>
        </Card>
      )}
      <AttachmentsPanel documentId={d.id} readOnly={d.status === "cancelled"} />
      <ActivityFeed documentId={d.id} />
    </div>
  );
}
