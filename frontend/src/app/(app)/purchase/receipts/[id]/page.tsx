"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Barcode } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { ActivityFeed, AttachmentsPanel, StatusBadge, Tabs } from "@/components/documents/document-parts";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { GRN_API, GRN_ROUTE, grnKeys, PO_ROUTE, type GoodsReceipt } from "@/lib/purchase";

export default function GoodsReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"activity" | "files">("activity");
  const grn = useQuery({ queryKey: grnKeys.detail(id), queryFn: () => api<GoodsReceipt>(`${GRN_API}/${id}`) });
  const { can } = useAuth();

  if (grn.isLoading) return <LoadingBlock />;
  if (grn.error) return <ErrorBlock error={grn.error} />;
  const d = grn.data!;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <Link href={GRN_ROUTE} className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Goods receipts
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{d.displayNumber}</h1>
              <StatusBadge status={d.status} />
            </div>
            <p className="mt-1 text-sm text-muted">
              {d.vendor.name} · against{" "}
              <Link href={`${PO_ROUTE}/${d.purchaseOrder.id}`} className="text-primary hover:underline">
                {d.purchaseOrder.number}
              </Link>
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {d.status === "approved" && can("purchase.invoices.manage") && (
              <Link href={`/purchase/invoices/new?vendor=${d.vendor.id}&grn=${d.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
                Enter bill
              </Link>
            )}
            {d.status === "approved" && (
              <Link href={`/print/labels?grn=${d.id}`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted">
                <Barcode className="size-4" aria-hidden /> Labels
              </Link>
            )}
            <DocumentActions doc={d} apiBase={GRN_API} routeBase={GRN_ROUTE} printHref={`/print/goods-receipts/${d.id}`} queryKey={grnKeys.detail(id)} />
          </div>
        </div>
      </div>

      {d.status === "approved" && <Alert tone="success">Posted to stock in {d.warehouse.code} on {formatDateTime(d.approvedAt)}. To correct it, cancel this GRN (stock and the PO are reversed) and receive again.</Alert>}
      {d.status === "cancelled" && <Alert tone="warning">Cancelled on {formatDateTime(d.cancelledAt)}: {d.cancelReason}</Alert>}
      {d.can.approve && <Alert tone="warning">This receipt is waiting for your approval. Stock moves when it is approved.</Alert>}

      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Receipt date" value={formatDate(d.docDate)} />
          <Info label="Received into" value={`${d.warehouse.code} · ${d.warehouse.name}`} />
          <Info label="Supplier invoice" value={d.supplierInvoiceNo ? `${d.supplierInvoiceNo}${d.supplierInvoiceDate ? ` · ${formatDate(d.supplierInvoiceDate)}` : ""}` : null} />
          <Info label="Delivery challan" value={d.challanNo} />
          <Info label="Gate entry" value={d.gateEntryNo} />
          <Info label="Vehicle" value={d.vehicleNo} />
          <Info label="Transporter / LR" value={[d.transporter, d.lrNo && `LR ${d.lrNo}`].filter(Boolean).join(" · ") || null} />
          <Info label="Received by" value={d.createdBy} />
        </dl>
      </Card>

      <Card>
        <CardHeader title="Items" action={<span className="text-sm text-muted">Accepted value <strong className="ml-1 text-foreground tabular-nums">{formatMoney(d.amount)}</strong></span>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">PO line</th>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 font-medium">Batch / serials</th>
                <th className="px-4 py-2 text-right font-medium">Ordered</th>
                <th className="px-4 py-2 text-right font-medium">Received</th>
                <th className="px-4 py-2 text-right font-medium">Rejected</th>
                <th className="px-4 py-2 text-right font-medium">Accepted</th>
                <th className="px-4 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border align-top">
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 text-muted">{l.poLineNo}</td>
                  <td className="px-4 py-2.5">
                    {l.itemName}
                    <p className="font-mono text-xs text-muted">{l.itemCode}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {l.batchNo && <span className="font-mono">{l.batchNo}</span>}
                    {l.expiryDate && <span className="block text-muted">exp {formatDate(l.expiryDate)}</span>}
                    {l.serialNos?.length ? <span className="block font-mono text-muted">{l.serialNos.join(", ")}</span> : null}
                    {!l.batchNo && !l.serialNos?.length && <span className="text-muted">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted">
                    {formatQty(l.orderedQty)} {l.uomCode}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatQty(l.receivedQty)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                    {Number(l.rejectedQty) ? <span className="text-danger">{formatQty(l.rejectedQty)}</span> : "—"}
                    {l.rejectionReason && <p className="text-xs text-muted">{l.rejectionReason}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums">{formatQty(l.acceptedQty)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatMoney(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.notes && <p className="border-t border-border px-5 py-3 text-sm whitespace-pre-wrap">{d.notes}</p>}
      </Card>

      <Card>
        <div className="px-5 pt-2">
          <Tabs
            tabs={[
              { value: "activity", label: "Activity" },
              { value: "files", label: "Files" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        <div className="px-5 py-4">{tab === "activity" ? <ActivityFeed documentId={d.id} /> : <AttachmentsPanel documentId={d.id} readOnly={d.status === "cancelled"} />}</div>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{value || "—"}</dd>
    </div>
  );
}
