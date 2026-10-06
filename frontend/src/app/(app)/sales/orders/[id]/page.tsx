"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Truck, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed, ApprovalProgress, StatusBadge } from "@/components/documents/document-parts";
import { TaxSummary } from "@/components/documents/tax-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { keys, S, type SalesOrder } from "@/lib/sales";
import { CustomerBlock, SellingLinesTable } from "../../_components/parts";

export default function SalesOrderPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const key = keys.detail(S.orders, id);
  const so = useQuery({ queryKey: key, queryFn: () => api<SalesOrder>(`${S.orders}/${id}`) });
  const [dialog, setDialog] = useState<"override" | "close" | null>(null);
  const [reason, setReason] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const submit = useMutation({
    mutationFn: (overrideReason?: string) => api(`${S.orders}/${id}/submit`, { body: { version: so.data!.version, creditOverrideReason: overrideReason || null } }),
    onSuccess: () => {
      setDialog(null);
      refresh();
    },
    onError: (e) => e instanceof ApiError && e.status === 403 && can("sales.orders.credit_override") && setDialog("override"),
  });
  const close = useMutation({ mutationFn: () => api(`${S.orders}/${id}/short-close`, { body: { version: so.data!.version, reason } }), onSuccess: () => { setDialog(null); refresh(); } });

  if (so.isLoading) return <LoadingBlock />;
  if (so.error) return <ErrorBlock error={so.error} />;
  const d = so.data!;
  const credit = d.creditCheck;
  const editable = d.can.submit;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: S.orders, label: "Sales orders" }}
        badges={<>{d.closedAt && <Badge tone="warning">Short-closed</Badge>}{d.withLut && <Badge>Export / LUT</Badge>}</>}
        subtitle={`${d.customer.name}${d.customerPoNo ? ` · PO ${d.customerPoNo}` : ""} · ${formatMoney(d.grandTotal)}`}
        actions={
          <>
            {d.canDeliver && (
              <Link href={`${S.deliveries}/new?order=${d.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
                <Truck className="size-4" aria-hidden /> Deliver
              </Link>
            )}
            {d.canInvoice && (
              <Link href={`${S.invoices}/new?customer=${d.customer.id}&order=${d.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted">
                <FileText className="size-4" aria-hidden /> Invoice
              </Link>
            )}
            {d.canShortClose && (
              <Button variant="ghost" onClick={() => setDialog("close")}>
                <XCircle className="size-4" aria-hidden /> Short-close
              </Button>
            )}
            {editable ? (
              <>
                <Link href={`${S.orders}/${d.id}/edit`} className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted">Edit</Link>
                <Button loading={submit.isPending} onClick={() => submit.mutate(undefined)}>Submit</Button>
              </>
            ) : null}
            <DocumentActions doc={{ ...d, can: { ...d.can, submit: false, edit: false } }} apiBase={S.orders} routeBase={S.orders} printHref={`/print/sales/${d.id}`} queryKey={key} />
          </>
        }
      />
      <DocStatusAlerts doc={d} />
      {submit.error && !dialog && <Alert>{submit.error instanceof ApiError ? submit.error.message : "Could not submit."}</Alert>}
      {d.closedAt && <Alert tone="warning">Short-closed: {d.closeReason}</Alert>}
      {credit && (credit.exceeded || d.creditOverrideReason) && (
        <Alert tone="warning">
          Credit check: {credit.reasons.join("; ")}.{d.creditOverrideReason && ` Overridden: ${d.creditOverrideReason}`}
        </Alert>
      )}
      <CustomerBlock
        customer={d.customer}
        billing={d.billingAddress}
        shipping={d.shippingAddress}
        extra={
          <>
            <Info label="Dispatch from" value={d.warehouse ? `${d.warehouse.code} · ${d.warehouse.name}` : null} />
            <Info label="Dispatch by" value={formatDate(d.expectedDate)} />
            <Info label="Payment" value={d.paymentTerms ?? (d.creditDays !== null ? `${d.creditDays} days` : null)} />
            <Info label="Margin" value={d.marginPct === null ? null : `${Number(d.marginPct).toFixed(1)}%`} />
            {credit && <Info label="Customer exposure" value={`${formatMoney(credit.exposure)}${credit.limit ? ` of ${formatMoney(credit.limit)} limit` : ""}`} />}
          </>
        }
      />
      <Card>
        <CardHeader title="Items" />
        <SellingLinesTable lines={d.lines} extra={{ label: "Delivered / invoiced", render: (l) => <>{l.isStockItem ? formatQty(l.deliveredQty) : "—"} / {formatQty(l.invoicedQty)}</> }} />
        <div className="border-t border-border px-5 py-4">
          <TaxSummary tax={d} stateTaxLabel={d.stateTaxLabel} totalLabel="Order total" />
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Deliveries" />
          <ul className="divide-y divide-border text-sm">
            {d.deliveries.map((x) => (
              <li key={x.id} className="flex items-center justify-between px-5 py-2">
                <Link href={`${S.deliveries}/${x.id}`} className="text-primary hover:underline">{x.number ?? "Draft"}</Link>
                <span className="text-muted">{formatDate(x.docDate)}</span>
                <StatusBadge status={x.status} />
              </li>
            ))}
            {!d.deliveries.length && <li className="px-5 py-3 text-muted">None yet</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Invoices" />
          <ul className="divide-y divide-border text-sm">
            {d.invoices.map((x) => (
              <li key={x.id} className="flex items-center justify-between px-5 py-2">
                <Link href={`${S.invoices}/${x.id}`} className="text-primary hover:underline">{x.number ?? "Draft"}</Link>
                <span className="tabular-nums">{formatMoney(x.amount)}</span>
                <StatusBadge status={x.status} />
              </li>
            ))}
            {!d.invoices.length && <li className="px-5 py-3 text-muted">None yet</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Approval" />
          <div className="px-5 py-4"><ApprovalProgress steps={d.approvals} /></div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4"><ActivityFeed documentId={d.id} /></div>
      </Card>

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === "override" ? "Credit limit exceeded" : "Short-close this order"}
        description={dialog === "override" ? (submit.error as Error | null)?.message : "Quantities not yet delivered or invoiced will no longer be supplied."}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            {dialog === "override" ? (
              <Button loading={submit.isPending} disabled={reason.trim().length < 3} onClick={() => submit.mutate(reason)}>Override and submit</Button>
            ) : (
              <Button variant="danger" loading={close.isPending} disabled={reason.trim().length < 3} onClick={() => close.mutate()}>Short-close</Button>
            )}
          </>
        }
      >
        {close.error && <Alert>{(close.error as Error).message}</Alert>}
        <Field label="Reason" required>{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Dialog>
    </div>
  );
}
