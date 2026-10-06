"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed, StatusBadge } from "@/components/documents/document-parts";
import { EwayBillPanel } from "@/components/gst/eway-bill-panel";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { type Challan, JW } from "@/lib/jobwork";

export default function ChallanPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const key = [JW.challans, id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Challan>(`${JW.challans}/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: JW.challans, label: "Job-work challans" }}
        subtitle={`${d.jobWorker.name} · ${d.process} · ${formatMoney(d.totalValue)}`}
        actions={
          <>
            {d.canReceive && (
              <Link href={`${JW.receipts}/new?challan=${d.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
                <PackageCheck className="size-4" aria-hidden /> Receive back
              </Link>
            )}
            <DocumentActions doc={d} apiBase={JW.challans} routeBase={JW.challans} printHref={`/print/documents/${d.id}`} queryKey={key} hideEdit />
          </>
        }
      />
      <DocStatusAlerts doc={d} approvedNote={`Sent. The material sits in ${d.jobWorkWarehouse?.code ?? "the job worker's warehouse"} until it comes back.`} />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Job worker" value={<>{d.jobWorker.name}<span className="block font-mono text-xs text-muted">{d.jobWorker.gstin ?? "Unregistered"}</span></>} />
          <Info label="Sent from" value={d.warehouse ? `${d.warehouse.code} · ${d.warehouse.name}` : null} />
          <Info label="Held at" value={d.jobWorkWarehouse?.code} />
          <Info label="Expected back" value={formatDate(d.expectedReturnDate)} />
          <Info label="Vehicle" value={[d.transporter, d.vehicleNo].filter(Boolean).join(" · ")} />
          <Info label="E-way bill" value={d.ewayBillNo} mono />
          <Info label="Still at job worker" value={formatQty(d.pendingQty)} />
        </dl>
      </Card>
      {(d.status === "approved" || d.status === "completed") && <EwayBillPanel documentId={d.id} onChange={() => qc.invalidateQueries({ queryKey: key })} />}
      <Card>
        <CardHeader title="Material" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 text-right font-medium">Sent</th>
                <th className="px-4 py-2 text-right font-medium">Value</th>
                <th className="px-4 py-2 text-right font-medium">Consumed</th>
                <th className="px-4 py-2 text-right font-medium">Returned</th>
                <th className="px-4 py-2 text-right font-medium">Loss</th>
                <th className="px-4 py-2 text-right font-medium">Still out</th>
                <th className="px-4 py-2 font-medium">Due back</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5">{l.description}<p className="font-mono text-xs text-muted">{l.itemCode}{l.batchNo && ` · ${l.batchNo}`} · {l.goodsType === "capital_goods" ? "capital goods" : "inputs"}</p></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(l.qty)} {l.uomCode}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.value)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(l.consumedQty)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(l.returnedQty)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(l.lossQty)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatQty(l.pendingQty)}</td>
                  <td className={`px-4 py-2.5 ${l.daysToDue !== null && l.daysToDue < 30 ? "text-danger" : ""}`}>{formatDate(l.dueBy)}{l.daysToDue !== null && <span className="block text-xs text-muted">{l.daysToDue < 0 ? "deemed supplied: pay GST" : `${l.daysToDue} days left`}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Receipts" />
          <ul className="divide-y divide-border text-sm">
            {d.receipts.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2">
                <Link href={`${JW.receipts}/${r.id}`} className="text-primary hover:underline">{r.number ?? "Draft"}</Link>
                <span className="text-muted">{formatDate(r.docDate)}{r.jwChallanNo && ` · their ${r.jwChallanNo}`}</span>
                <span className="tabular-nums">{formatMoney(r.jobCharges)}</span>
                <StatusBadge status={r.status as Challan["status"]} />
              </li>
            ))}
            {!d.receipts.length && <li className="px-5 py-3 text-muted">Nothing received yet</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Activity" />
          <div className="px-5 py-4"><ActivityFeed documentId={d.id} /></div>
        </Card>
      </div>
    </div>
  );
}
