"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed } from "@/components/documents/document-parts";
import { TaxSummary } from "@/components/documents/tax-summary";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { DN_API, DN_ROUTE, dnKeys, PI_ROUTE, type DebitNote } from "@/lib/purchase";

export default function DebitNotePage() {
  const { id } = useParams<{ id: string }>();
  const dn = useQuery({ queryKey: dnKeys.detail(id), queryFn: () => api<DebitNote>(`${DN_API}/${id}`) });
  if (dn.isLoading) return <LoadingBlock />;
  if (dn.error) return <ErrorBlock error={dn.error} />;
  const d = dn.data!;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: DN_ROUTE, label: "Debit notes" }}
        badges={<Badge>{d.kind === "return" ? "Return" : "Price adjustment"}</Badge>}
        subtitle={`${d.vendor.name} · ${d.reason}`}
        actions={<DocumentActions doc={d} apiBase={DN_API} routeBase={DN_ROUTE} printHref={`/print/debit-notes/${d.id}`} queryKey={dnKeys.detail(id)} hideEdit />}
      />
      <DocStatusAlerts doc={d} approvedNote={d.kind === "return" ? `Posted. Goods left ${d.warehouse?.code ?? "stock"} and the bill's returned quantity was updated.` : "Posted. Stock still on hand was revalued down."} />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Against bill" value={<Link href={`${PI_ROUTE}/${d.invoice.id}`} className="text-primary hover:underline">{d.invoice.supplierInvoiceNo}</Link>} />
          <Info label="Bill date" value={formatDate(d.invoice.supplierInvoiceDate)} />
          <Info label="Vendor GSTIN" value={d.vendor.gstin} mono />
          <Info label={d.kind === "return" ? "Returned from" : "Date"} value={d.kind === "return" ? (d.warehouse ? `${d.warehouse.code} · ${d.warehouse.name}` : null) : formatDate(d.docDate)} />
        </dl>
      </Card>
      <Card>
        <CardHeader title="Lines" />
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-4 py-2 text-right font-medium">Qty</th>
              <th className="px-4 py-2 text-right font-medium">Rate</th>
              <th className="px-4 py-2 text-right font-medium">Taxable</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2.5 text-muted">{l.lineNo}</td>
                <td className="px-4 py-2.5">
                  {l.description}
                  <p className="font-mono text-xs text-muted">
                    {l.itemCode}
                    {l.batchNo && ` · ${l.batchNo}`}
                  </p>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatQty(l.qty)} {l.uomCode}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.rate)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.taxableValue)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-border px-5 py-4">
          <TaxSummary tax={d} stateTaxLabel={d.stateTaxLabel} totalLabel="Debit note total" />
        </div>
      </Card>
      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4">
          <ActivityFeed documentId={d.id} />
        </div>
      </Card>
    </div>
  );
}
