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
import { keys, S, type CreditNote } from "@/lib/sales";

export default function CreditNotePage() {
  const { id } = useParams<{ id: string }>();
  const key = keys.detail(S.credits, id);
  const cn = useQuery({ queryKey: key, queryFn: () => api<CreditNote>(`${S.credits}/${id}`) });
  if (cn.isLoading) return <LoadingBlock />;
  if (cn.error) return <ErrorBlock error={cn.error} />;
  const d = cn.data!;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: S.credits, label: "Credit notes" }}
        badges={<Badge>{d.kind === "return" ? "Sales return" : "Price adjustment"}</Badge>}
        subtitle={`${d.customer.name} · ${d.reason}`}
        actions={<DocumentActions doc={d} apiBase={S.credits} routeBase={S.credits} printHref={`/print/sales/${d.id}`} queryKey={key} hideEdit />}
      />
      <DocStatusAlerts doc={d} approvedNote={d.kind === "return" ? `Posted. Goods came back into ${d.warehouse?.code ?? "stock"} at the cost they left at.` : "Posted. The customer owes less on the invoice."} />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
          <Info label="Invoice" value={<Link href={`${S.invoices}/${d.invoice.id}`} className="text-primary hover:underline">{d.invoice.number}</Link>} />
          <Info label="Invoice date" value={formatDate(d.invoice.docDate)} />
          <Info label="Customer GSTIN" value={d.customer.gstin} mono />
        </dl>
      </Card>
      <Card>
        <CardHeader title="Lines" />
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {d.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2.5">{l.description}<p className="font-mono text-xs text-muted">{l.itemCode}</p></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(l.qty)} {l.uomCode}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.rate)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.taxableValue)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-border px-5 py-4"><TaxSummary tax={d} stateTaxLabel={d.stateTaxLabel} totalLabel="Credit note total" /></div>
      </Card>
      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4"><ActivityFeed documentId={d.id} /></div>
      </Card>
    </div>
  );
}
