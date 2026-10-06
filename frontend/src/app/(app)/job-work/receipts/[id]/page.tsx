"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed } from "@/components/documents/document-parts";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { JW, type Receipt } from "@/lib/jobwork";

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const key = [JW.receipts, id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Receipt>(`${JW.receipts}/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  const outputs = d.lines.filter((l) => l.kind === "output");
  const materials = d.lines.filter((l) => l.kind === "material");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: `${JW.challans}/${d.challan.id}`, label: `Challan ${d.challan.number ?? ""}` }}
        subtitle={`${d.jobWorker.name}${d.natureOfJob ? ` · ${d.natureOfJob}` : ""}`}
        actions={<DocumentActions doc={d} apiBase={JW.receipts} routeBase={JW.receipts} queryKey={key} hideEdit />}
      />
      <DocStatusAlerts doc={d} approvedNote="Posted. Material left the job worker's warehouse; processed goods are in stock." />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Challan" value={<Link href={`${JW.challans}/${d.challan.id}`} className="text-primary hover:underline">{d.challan.number}</Link>} />
          <Info label="Their challan" value={d.jwChallanNo ? `${d.jwChallanNo}${d.jwChallanDate ? ` of ${formatDate(d.jwChallanDate)}` : ""}` : null} />
          <Info label="Received into" value={`${d.warehouse.code} · ${d.warehouse.name}`} />
          <Info label="Job charges" value={formatMoney(d.jobCharges)} />
        </dl>
      </Card>
      <Card>
        <CardHeader title="Received" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {outputs.map((l) => (
            <li key={l.id} className="flex justify-between gap-3 px-5 py-2">
              <span>{l.itemName} <span className="font-mono text-xs text-muted">{l.itemCode}{l.batchNo && ` · ${l.batchNo}`}</span></span>
              <span className="tabular-nums">{formatQty(l.qty)} {l.uomCode} · {formatMoney(l.value)}</span>
            </li>
          ))}
          {!outputs.length && <li className="px-5 py-3 text-muted">Only unprocessed material came back</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Material settled" />
        <table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 text-right font-medium">Consumed</th><th className="px-4 py-2 text-right font-medium">Returned</th><th className="px-4 py-2 text-right font-medium">Loss</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {materials.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2">{l.itemName}<p className="font-mono text-xs text-muted">{l.itemCode}</p></td>
                <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.consumedQty)} {l.uomCode}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.returnedQty)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.lossQty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4"><ActivityFeed documentId={d.id} /></div>
      </Card>
    </div>
  );
}
