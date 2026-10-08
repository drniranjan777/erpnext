"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ESignDialog } from "@/components/esign-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader, formatDateTime, ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";

interface Review { id: string; workOrderId: string; workOrderNumber: string; item: string; batchNo: string | null; qty: number; stage: string; status: string; exceptions: { key: string; kind: string; severity: string; text: string; link?: string | null }[]; comments: Record<string, { text: string; by: string; at: string }>; pendingComments: number; refreshedAt: string; signatures: { id: string; meaning: string; reason: string | null; signedBy: string; signedAt: string }[] }

/** One batch's review: assess each exception, then sign approve or reject. */
export default function BatchReviewPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["/gmp/batch-reviews", id], queryFn: () => api<Review>(`/gmp/batch-reviews/${id}`) });
  const [text, setText] = useState<Record<string, string>>({});
  const [decide, setDecide] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const r = q.data;
  if (!r) return q.isError ? <ErrorBlock error={q.error} /> : <LoadingBlock />;
  const refresh = () => qc.invalidateQueries({ queryKey: ["/gmp/batch-reviews"] });
  async function comment(key: string) {
    setError(null);
    try {
      await api(`/gmp/batch-reviews/${id}/comments`, { body: { key, text: text[key] } });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const open = r.status === "open";
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title={`Batch record review · ${r.workOrderNumber}`}
        description={`${r.item} · ${r.qty} · ${r.batchNo ? `batch ${r.batchNo} · ` : ""}work order ${r.stage.replace("_", " ")}`}
        actions={<span className="flex gap-2"><Link className="text-sm text-primary hover:underline" href={`/manufacturing/work-orders/${r.workOrderId}`}>Work order</Link>{open && <Button variant="secondary" onClick={async () => { await api("/gmp/batch-reviews", { body: { workOrderId: r.workOrderId } }); refresh(); }}>Refresh exceptions</Button>}</span>}
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title={`Exceptions (${r.exceptions.length})`} description={r.exceptions.length ? "Assess each one: what it means for the batch." : "Nothing went differently from the master instructions: the batch needs no detailed review."} />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {r.exceptions.map((e) => {
            const c = r.comments[e.key];
            return (
              <li key={e.key} className="space-y-1 px-4 py-3">
                <p className="flex items-start gap-2"><Badge tone={e.severity === "major" ? "danger" : "warning"}>{e.severity}</Badge><span className="flex-1">{e.text}</span>{e.link && <Link className="text-xs text-primary hover:underline" href={e.link}>open</Link>}</p>
                {c ? <p className="text-xs text-muted">Assessed by {c.by} {formatDateTime(c.at)}: {c.text}</p> : open && (
                  <div className="flex gap-2"><Input className="h-8 flex-1" aria-label="Assessment" placeholder="Assessment" value={text[e.key] ?? ""} onChange={(ev) => setText({ ...text, [e.key]: ev.target.value })} /><Button size="sm" disabled={(text[e.key] ?? "").trim().length < 2} onClick={() => comment(e.key)}>Save</Button></div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      {r.signatures.length > 0 && (
        <Card>
          <CardHeader title="Signatures" />
          <ul className="border-t border-border p-4 text-sm">{r.signatures.map((s) => <li key={s.id}><strong>{s.meaning}</strong> — {s.signedBy}, {formatDateTime(s.signedAt)}{s.reason ? `: ${s.reason}` : ""}</li>)}</ul>
        </Card>
      )}
      {open && (
        <div className="flex gap-2">
          <Button disabled={r.pendingComments > 0} onClick={() => setDecide(true)}>Approve for release</Button>
          <Button variant="danger" disabled={r.pendingComments > 0} onClick={() => setDecide(false)}>Reject</Button>
          {r.pendingComments > 0 && <span className="self-center text-sm text-muted">{r.pendingComments} exception(s) still to assess</span>}
        </div>
      )}
      {decide !== null && <ESignDialog meaning={decide ? "Batch record reviewed: approved for release" : "Batch record reviewed: rejected"} reasonRequired reasonLabel="Conclusion" onClose={() => setDecide(null)} onSign={async (password, reason) => { await api(`/gmp/batch-reviews/${id}/decide`, { body: { approved: decide, reason, password } }); refresh(); }} />}
    </div>
  );
}
