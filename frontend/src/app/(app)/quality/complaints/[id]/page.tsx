"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileWarning, GitPullRequestArrow } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { DocPageHeader, Info } from "@/components/documents/doc-page";
import { ActivityFeed, AttachmentsPanel, StatusBadge } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, formatQty, type DocumentStatus } from "@/lib/documents";
import { COMPLAINT_STAGE, QA, type Complaint } from "@/lib/quality";

export default function ComplaintPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const key = [QA, "complaints", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Complaint>(`${QA}/complaints/${id}`) });
  const [response, setResponse] = useState<string | null>(null);
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
  const text = response ?? d.response ?? "";
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: `${QA}/complaints`, label: "Customer complaints" }}
        badges={<><Badge tone={COMPLAINT_STAGE[d.stage].tone}>{COMPLAINT_STAGE[d.stage].label}</Badge>{d.overdue && <Badge tone="danger">Response overdue</Badge>}{d.isFieldFailure && <Badge tone="danger">Field failure</Badge>}</>}
        subtitle={`${d.customer.name} · ${d.category}`}
        actions={
          d.canManage && (
            <>
              {!d.ncr && d.item && d.qty && can("quality.ncr.manage") && <Button variant="secondary" onClick={() => call(() => api<{ id: string }>(`${QA}/complaints/${d.id}/ncr`, { method: "POST" }), (r) => router.push(`${QA}/ncrs/${r.id}`))}><FileWarning className="size-4" aria-hidden /> Raise NCR</Button>}
              {!d.capa && can("quality.capa.manage") && <Button variant="secondary" onClick={() => call(() => api<{ id: string }>(`${QA}/complaints/${d.id}/capa`, { method: "POST" }), (r) => router.push(`${QA}/capas/${r.id}`))}><GitPullRequestArrow className="size-4" aria-hidden /> Start 8D</Button>}
              {d.stage === "responded" && <Button onClick={() => call(() => api(`${QA}/complaints/${d.id}/close`, { method: "POST" }))}>Close complaint</Button>}
            </>
          )
        }
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Received" value={`${formatDate(d.receivedOn)} by ${d.channel}`} />
          <Info label="Respond by" value={d.responseDue ? formatDate(d.responseDue) : "–"} />
          <Info label="Item" value={d.item ? `${d.item.code} ${d.item.name}` : "–"} />
          <Info label="Quantity / lot" value={`${d.qty ? formatQty(d.qty) : "–"}${d.batchNo ? ` · ${d.batchNo}` : ""}`} />
          {d.isFieldFailure && <Info label="Warranty cost" value={formatMoney(d.warrantyCost)} />}
          <Info label="NCR" value={d.ncr ? <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={`${QA}/ncrs/${d.ncr.id}`}>{d.ncr.number ?? "Draft"} <StatusBadge status={d.ncr.status as DocumentStatus} /></Link> : "–"} />
          <Info label="8D / CAPA" value={d.capa ? <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={`${QA}/capas/${d.capa.id}`}>{d.capa.number ?? "Draft"} <StatusBadge status={d.capa.status as DocumentStatus} /></Link> : "–"} />
        </dl>
        <p className="whitespace-pre-line border-t border-border px-5 py-4 text-sm">{d.description}</p>
      </Card>
      <Card>
        <CardHeader title="Response to the customer" description={d.respondedAt ? `Sent ${formatDateTime(d.respondedAt)}` : undefined} />
        <div className="space-y-3 border-t border-border p-5">
          {d.canManage ? (
            <>
              <textarea aria-label="Response" rows={4} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={text} onChange={(e) => setResponse(e.target.value)} />
              <div className="flex justify-end"><Button disabled={text.trim().length < 3} onClick={() => call(() => api(`${QA}/complaints/${d.id}/response`, { method: "PUT", body: { response: text } }), () => setResponse(null))}>{d.response ? "Update response" : "Record response"}</Button></div>
            </>
          ) : (
            <p className="whitespace-pre-line text-sm">{d.response ?? "Not answered yet."}</p>
          )}
        </div>
      </Card>
      <AttachmentsPanel documentId={d.id} />
      <ActivityFeed documentId={d.id} />
    </div>
  );
}
