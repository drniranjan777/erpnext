"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed } from "@/components/documents/document-parts";
import { EwayBillPanel } from "@/components/gst/eway-bill-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { keys, S, type Delivery } from "@/lib/sales";
import { address } from "../../_components/parts";

export default function DeliveryPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const key = keys.detail(S.deliveries, id);
  const dlv = useQuery({ queryKey: key, queryFn: () => api<Delivery>(`${S.deliveries}/${id}`) });
  const pod = useMutation({ mutationFn: () => api(`${S.deliveries}/${id}/pod`, { body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  if (dlv.isLoading) return <LoadingBlock />;
  if (dlv.error) return <ErrorBlock error={dlv.error} />;
  const d = dlv.data!;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: S.deliveries, label: "Deliveries" }}
        badges={d.deliveredAt ? <Badge tone="success">Delivered {formatDateTime(d.deliveredAt)}</Badge> : undefined}
        subtitle={`${d.customer.name} · order ${d.order.number}`}
        actions={
          <>
            {d.canInvoice && (
              <Link href={`${S.invoices}/new?customer=${d.customer.id}&delivery=${d.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
                <FileText className="size-4" aria-hidden /> Invoice
              </Link>
            )}
            {d.status === "approved" && !d.deliveredAt && (
              <Button variant="secondary" loading={pod.isPending} onClick={() => pod.mutate()}>
                <CheckCircle2 className="size-4" aria-hidden /> Mark delivered
              </Button>
            )}
            <DocumentActions doc={d} apiBase={S.deliveries} routeBase={S.deliveries} printHref={`/print/sales/${d.id}`} queryKey={key} hideEdit />
          </>
        }
      />
      <DocStatusAlerts doc={d} approvedNote={`Dispatched from ${d.warehouse.code}. Stock was reduced at cost.`} />
      {(d.status === "approved" || d.status === "completed") && <EwayBillPanel documentId={d.id} />}
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Ship to" value={address(d.shippingAddress)} />
          <Info label="Order" value={<Link href={`${S.orders}/${d.order.id}`} className="text-primary hover:underline">{d.order.number}</Link>} />
          <Info label="Transport" value={[d.transporter, d.vehicleNo, d.lrNo && `LR ${d.lrNo}`].filter(Boolean).join(" · ")} />
          <Info label="Packages" value={d.packages ? `${d.packages}${d.grossWeightKg ? ` · ${Number(d.grossWeightKg)} kg` : ""}` : null} />
        </dl>
      </Card>
      <Card>
        <CardHeader title="Items" />
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-4 py-2 font-medium">Batch / serial</th>
              <th className="px-4 py-2 text-right font-medium">Qty</th>
              <th className="px-4 py-2 text-right font-medium">Invoiced</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2.5">{l.itemName}<p className="font-mono text-xs text-muted">{l.itemCode}</p></td>
                <td className="px-4 py-2.5 font-mono text-xs">{l.batchNo}{l.serialNos?.length ? ` ${l.serialNos.join(", ")}` : ""}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(l.qty)} {l.uomCode}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(l.invoicedQty)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">{d.status === "approved" ? formatMoney(l.costValue) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4"><ActivityFeed documentId={d.id} /></div>
      </Card>
      <p className="text-xs text-muted">Date {formatDate(d.docDate)}</p>
    </div>
  );
}
