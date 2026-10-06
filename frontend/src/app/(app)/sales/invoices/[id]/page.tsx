"use client";

import { useQuery } from "@tanstack/react-query";
import { FileMinus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed, StatusBadge } from "@/components/documents/document-parts";
import { TaxSummary } from "@/components/documents/tax-summary";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatMoney, formatQty } from "@/lib/documents";
import { keys, S, type SalesInvoice } from "@/lib/sales";
import { CustomerBlock, due, SellingLinesTable } from "../../_components/parts";
import { EInvoicePanel } from "./e-invoice";

const KIND: Record<string, string> = { tax_invoice: "Tax invoice", bill_of_supply: "Bill of supply", export: "Export invoice", sez: "SEZ supply" };

export default function SalesInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const key = keys.detail(S.invoices, id);
  const inv = useQuery({ queryKey: key, queryFn: () => api<SalesInvoice>(`${S.invoices}/${id}`) });
  if (inv.isLoading) return <LoadingBlock />;
  if (inv.error) return <ErrorBlock error={inv.error} />;
  const d = inv.data!;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: S.invoices, label: "Sales invoices" }}
        badges={<Badge>{KIND[d.taxKind] ?? d.taxKind}</Badge>}
        subtitle={`${d.customer.name} · ${formatMoney(d.grandTotal)}`}
        actions={
          <>
            {d.canCreditNote && (
              <Link href={`${S.credits}/new?invoice=${d.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted">
                <FileMinus className="size-4" aria-hidden /> Credit note
              </Link>
            )}
            <DocumentActions doc={d} apiBase={S.invoices} routeBase={S.invoices} printHref={`/print/sales/${d.id}`} queryKey={key} hideEdit />
          </>
        }
      />
      <DocStatusAlerts doc={d} />
      <CustomerBlock
        customer={d.customer}
        billing={d.billingAddress}
        shipping={d.shippingAddress}
        extra={
          <>
            <Info label="Place of supply" value={d.placeOfSupplyName ? `${d.placeOfSupplyName} (${d.placeOfSupply})` : null} />
            <Info label="Due" value={due(d.dueDate, d.daysToDue, d.outstanding)} />
            <Info label="Outstanding" value={`${formatMoney(d.outstanding)}${Number(d.creditedAmount) ? ` (after ${formatMoney(d.creditedAmount)} credited)` : ""}`} />
            <Info label="Order" value={d.order ? <Link href={`${S.orders}/${d.order.id}`} className="text-primary hover:underline">{d.order.number}</Link> : null} />
            <Info label="Dispatch" value={[d.transporter, d.vehicleNo, d.lrNo && `LR ${d.lrNo}`].filter(Boolean).join(" · ")} />
            <Info label="Margin" value={d.marginPct === null ? null : `${Number(d.marginPct).toFixed(1)}% (cost ${formatMoney(d.costTotal)})`} />
          </>
        }
      />
      {d.status === "approved" && <EInvoicePanel invoice={d} />}
      <Card>
        <CardHeader title="Lines" />
        <SellingLinesTable lines={d.lines} extra={{ label: "Returned", render: (l) => (Number(l.returnedQty) ? formatQty(l.returnedQty) : "—") }} />
        <div className="border-t border-border px-5 py-4">
          <TaxSummary tax={d} stateTaxLabel={d.stateTaxLabel} totalLabel="Invoice total" />
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Credit notes" />
          <ul className="divide-y divide-border text-sm">
            {d.creditNotes.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-5 py-2">
                <Link href={`${S.credits}/${c.id}`} className="text-primary hover:underline">{c.number ?? "Draft"}</Link>
                <span className="text-muted">{c.kind === "return" ? "Return" : "Price adjustment"}</span>
                <span className="tabular-nums">{formatMoney(c.amount)}</span>
                <StatusBadge status={c.status} />
              </li>
            ))}
            {!d.creditNotes.length && <li className="px-5 py-3 text-muted">None</li>}
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
