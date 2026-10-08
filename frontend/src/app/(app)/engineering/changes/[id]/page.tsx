"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
import { formatDate, formatMoney, formatQty, type DocumentStatus } from "@/lib/documents";
import { CHANGE_KIND, ENG, STAGE, docPath, type Change, type DocRef, type Impact } from "@/lib/engineering";

const C = `${ENG}/changes`;

function Ref({ r }: { r: DocRef | null }) {
  if (!r) return <span className="text-muted">–</span>;
  const href = docPath(r);
  const text = r.number ?? r.title ?? "Draft";
  return (
    <span className="inline-flex items-center gap-2">
      {href ? <Link className="underline" href={href}>{text}</Link> : text}
      <StatusBadge status={r.status as DocumentStatus} />
    </span>
  );
}

function ImpactTable({ impact }: { impact: Impact }) {
  return (
    <div className="overflow-x-auto border-t border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-4 py-2 text-right font-medium">In stock</th>
            <th className="px-4 py-2 text-right font-medium">Orders making it</th>
            <th className="px-4 py-2 text-right font-medium">Orders using it</th>
            <th className="px-4 py-2 text-right font-medium">On order</th>
            <th className="px-4 py-2 text-right font-medium">Open sales</th>
            <th className="px-4 py-2 font-medium">Used in</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {impact.lines.map((l) => (
            <tr key={l.itemId}>
              <td className="px-4 py-2"><span className="font-mono text-xs text-muted">{l.code}</span> {l.name}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.stockQty)} {l.uom}<span className="block text-xs text-muted">{formatMoney(l.stockValue)}</span></td>
              <td className="px-4 py-2 text-right tabular-nums">{l.workOrdersMaking.count ? <>{l.workOrdersMaking.count} · {formatQty(l.workOrdersMaking.qty)}</> : "–"}{l.workOrdersOnCurrentVersion > 0 && <span className="block text-xs text-warning">{l.workOrdersOnCurrentVersion} on the current version</span>}</td>
              <td className="px-4 py-2 text-right tabular-nums">{l.workOrdersUsing.count ? <>{l.workOrdersUsing.count} · {formatQty(l.workOrdersUsing.qty)}</> : "–"}</td>
              <td className="px-4 py-2 text-right tabular-nums">{Number(l.onOrder) ? formatQty(l.onOrder) : "–"}</td>
              <td className="px-4 py-2 text-right tabular-nums">{Number(l.openSales) ? formatQty(l.openSales) : "–"}</td>
              <td className="px-4 py-2 text-xs">{l.usedIn.length ? l.usedIn.join(", ") : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ChangePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const key = [ENG, "changes", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Change>(`${C}/${id}`) });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  async function implement() {
    setBusy(true);
    setError(null);
    try {
      await api(`${C}/${d.id}/implement`, { body: { version: d.version, notes: notes || null } });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  const t = d.impact.totals;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DocPageHeader doc={d} back={{ href: C, label: "Engineering changes" }} badges={<Badge tone={STAGE[d.stage].tone}>{STAGE[d.stage].label}</Badge>} subtitle={`${CHANGE_KIND[d.kind]} change · ${d.reason}`} actions={<DocumentActions doc={d} apiBase={C} routeBase={C} queryKey={key} />} />
      <DocStatusAlerts doc={d} approvedNote={d.stage === "implemented" ? undefined : "Approved: this is now a change notice. Implement it once the new versions are approved."} />
      {d.stage === "implemented" && <Alert tone="success">Implemented {formatDateTime(d.implementedAt)}{d.implementationNotes ? `: ${d.implementationNotes}` : "."}</Alert>}
      {error && <Alert>{error}</Alert>}
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Priority" value={d.priority} />
          <Info label="Effective from" value={d.effectiveDate ? formatDate(d.effectiveDate) : "On implementation"} />
          <Info label="Existing stock" value={d.dispositionLabel} />
          <Info label="Raised" value={formatDate(d.docDate)} />
          {d.rpn !== null && <Info label="Risk" value={<Badge tone={d.riskLevel === "high" ? "danger" : d.riskLevel === "medium" ? "warning" : "success"}>{d.riskLevel} · RPN {d.rpn} ({d.severity}×{d.occurrence}×{d.detection})</Badge>} />}
          {d.validationRequired && <Info label="Validation" value="Required before release" />}
          {d.regulatoryImpact && <Info label="Regulatory" value="Notification needed" />}
        </dl>
        {d.description && <p className="whitespace-pre-line border-t border-border px-5 py-4 text-sm">{d.description}</p>}
      </Card>
      <Card>
        <CardHeader title="Affected items" />
        <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 font-medium">In use now</th><th className="px-4 py-2 font-medium">New version</th><th className="px-4 py-2 font-medium">Remarks</th></tr></thead>
          <tbody className="divide-y divide-border">
            {d.items.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2"><span className="font-mono text-xs text-muted">{l.item.code}</span> {l.item.name}</td>
                <td className="px-4 py-2"><Ref r={l.from} /></td>
                <td className="px-4 py-2"><Ref r={l.to} /></td>
                <td className="px-4 py-2 text-muted">{l.remarks ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      <Card>
        <CardHeader title={d.stage === "request" ? "Impact" : "Impact at approval"} description={`${t.openWorkOrders} open work order${t.openWorkOrders === 1 ? "" : "s"} · ${formatMoney(t.stockValue)} of stock · ${t.itemsOnOrder} item${t.itemsOnOrder === 1 ? "" : "s"} on order · used in ${t.parents} product${t.parents === 1 ? "" : "s"}`} />
        <ImpactTable impact={d.impact} />
      </Card>
      {d.liveImpact && d.stage !== "implemented" && (
        <Card>
          <CardHeader title="Impact now" />
          <ImpactTable impact={d.liveImpact} />
        </Card>
      )}
      {d.canImplement && (
        <Card className="flex flex-wrap items-end gap-3 p-5">
          <div className="min-w-64 flex-1"><Input aria-label="Implementation notes" placeholder="Implementation notes (cut-in point, what was done with stock)" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <Button onClick={implement} loading={busy}><CheckCheck className="size-4" aria-hidden /> Mark implemented</Button>
        </Card>
      )}
      <AttachmentsPanel documentId={d.id} readOnly={d.status === "cancelled"} />
      <ActivityFeed documentId={d.id} />
    </div>
  );
}
