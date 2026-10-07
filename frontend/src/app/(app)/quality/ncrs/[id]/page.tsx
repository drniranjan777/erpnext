"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed, AttachmentsPanel } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { DISPOSITION_FIELDS, NCR_SOURCE, QA, type Ncr } from "@/lib/quality";

const N = `${QA}/ncrs`;

export default function NcrPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const key = [QA, "ncrs", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Ncr>(`${N}/${id}`) });
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  async function close() {
    setError(null);
    try {
      await api(`${N}/${d.id}/close`, { body: { version: d.version } });
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  const costs: [string, string][] = [["Scrap", d.scrapCost], ["Rework", d.reworkCost], ["Sorting", d.sortingCost], ["Other", d.otherCost]];
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: N, label: "Non-conformance" }}
        badges={<><Badge>{NCR_SOURCE[d.source]}</Badge><Badge tone={d.severity === "critical" ? "danger" : d.severity === "major" ? "warning" : "neutral"}>{d.severity}</Badge>{d.closedAt && <Badge tone="success">Closed</Badge>}</>}
        subtitle={`${d.item.code} ${d.item.name} · ${formatQty(d.qtyAffected)} ${d.item.uom} · ${d.defectCategory}`}
        actions={
          <>
            {d.canClose && <Button variant="secondary" onClick={close}><CheckCheck className="size-4" aria-hidden /> Close NCR</Button>}
            <DocumentActions doc={d} apiBase={N} routeBase={N} queryKey={key} />
          </>
        }
      />
      {error && <Alert>{error}</Alert>}
      <DocStatusAlerts doc={d} approvedNote={d.closedAt ? `Closed ${formatDateTime(d.closedAt)}.` : "The MRB has decided. Carry out the disposition, then close the NCR."} />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Raised" value={formatDate(d.docDate)} />
          <Info label="Batch" value={d.batchNo ?? "–"} mono />
          <Info label={d.source === "customer" ? "Customer" : "Vendor"} value={d.party?.name ?? "–"} />
          <Info label="From" value={d.inspection ? <Link className="text-primary hover:underline" href={`${QA}/inspections/${d.inspection.id}`}>{d.inspection.number ?? "Inspection"}</Link> : d.workOrder ? <Link className="text-primary hover:underline" href={`/manufacturing/work-orders/${d.workOrder.id}`}>{d.workOrder.number}</Link> : "–"} />
        </dl>
        <div className="space-y-2 border-t border-border px-5 py-4 text-sm">
          <p className="whitespace-pre-line">{d.description}</p>
          {d.containment && <p className="text-muted"><span className="font-medium text-foreground">Containment:</span> {d.containment}</p>}
        </div>
      </Card>
      <Card>
        <CardHeader title="MRB disposition" description={d.dispositionNotes ?? undefined} />
        <dl className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-5">
          {DISPOSITION_FIELDS.map(([k, label]) => <Info key={k} label={label} value={Number(d[k]) ? `${formatQty(d[k])} ${d.item.uom}` : "–"} />)}
        </dl>
      </Card>
      <Card>
        <CardHeader title="Cost of poor quality" description={d.status === "approved" ? undefined : "Fixed when the MRB approves; scrap is then valued at the stock rate."} />
        <dl className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-6">
          {costs.map(([l, v]) => <Info key={l} label={l} value={formatMoney(v)} />)}
          <Info label="Recovered" value={`− ${formatMoney(d.recovered)}`} />
          <Info label="Total" value={<span className="font-semibold">{formatMoney(d.copq)}</span>} />
        </dl>
      </Card>
      <AttachmentsPanel documentId={d.id} readOnly={d.status === "cancelled"} />
      <ActivityFeed documentId={d.id} />
    </div>
  );
}
