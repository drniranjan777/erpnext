"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed, ApprovalProgress } from "@/components/documents/document-parts";
import { TaxSummary } from "@/components/documents/tax-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/documents";
import { keys, S, type Quotation, type SalesOrder } from "@/lib/sales";
import { CustomerBlock, SellingLinesTable } from "../../_components/parts";

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useQuery({ queryKey: keys.detail(S.quotations, id), queryFn: () => api<Quotation>(`${S.quotations}/${id}`) });
  const toOrder = useMutation({ mutationFn: () => api<SalesOrder>(`${S.quotations}/${id}/order`, { body: {} }), onSuccess: (o) => router.push(`${S.orders}/${o.id}/edit`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: S.quotations, label: "Quotations" }}
        badges={<>{d.expired && d.status === "approved" && <Badge tone="warning">Expired</Badge>}</>}
        subtitle={`${d.customer.name} · ${formatMoney(d.grandTotal)}${d.validUntil ? ` · valid until ${formatDate(d.validUntil)}` : ""}`}
        actions={
          <>
            {d.canOrder && (
              <Button loading={toOrder.isPending} onClick={() => toOrder.mutate()}>
                <ShoppingCart className="size-4" aria-hidden /> Make sales order
              </Button>
            )}
            <DocumentActions doc={d} apiBase={S.quotations} routeBase={S.quotations} printHref={`/print/sales/${d.id}`} queryKey={keys.detail(S.quotations, id)} />
          </>
        }
      />
      <DocStatusAlerts doc={d} approvedNote={d.expired ? "Approved but expired: amend it with a new validity date to convert it." : "Approved. Send it to the customer, then make a sales order when they confirm."} />
      {toOrder.error && <Alert>{toOrder.error instanceof ApiError ? toOrder.error.message : "Could not create the order."}</Alert>}
      {d.order && (
        <Alert tone="success">
          Converted into sales order{" "}
          <Link href={`${S.orders}/${d.order.id}`} className="font-medium underline">
            {d.order.number ?? "(draft)"}
          </Link>
          .
        </Alert>
      )}
      <CustomerBlock customer={d.customer} billing={d.billingAddress} shipping={d.shippingAddress} extra={<><Info label="Enquiry ref." value={d.customerEnquiryRef} /><Info label="Payment" value={d.paymentTerms ?? (d.creditDays !== null ? `${d.creditDays} days` : null)} /><Info label="Margin" value={d.marginPct === null ? null : `${Number(d.marginPct).toFixed(1)}% (cost ${formatMoney(d.costTotal)})`} /></>} />
      <Card>
        <CardHeader title="Items" />
        <SellingLinesTable lines={d.lines} extra={{ label: "Margin", render: (l) => (l.marginPct === null ? "—" : `${Number(l.marginPct).toFixed(1)}%`) }} />
        <div className="border-t border-border px-5 py-4">
          <TaxSummary tax={d} stateTaxLabel={d.stateTaxLabel} totalLabel="Quoted total" />
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Approval" />
          <div className="px-5 py-4">{d.status === "draft" && !d.approvals.length ? <p className="text-sm text-muted">Rules check the discount and margin when you submit.</p> : <ApprovalProgress steps={d.approvals} />}</div>
        </Card>
        <Card>
          <CardHeader title="Activity" />
          <div className="px-5 py-4">
            <ActivityFeed documentId={d.id} />
          </div>
        </Card>
      </div>
    </div>
  );
}
