"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { formatDate, formatMoney, formatQty, STATUS_META, type DocumentStatus } from "@/lib/documents";
import { portalApi } from "@/lib/portal";

interface Order { id: string; number: string; docDate: string; status: DocumentStatus; grandTotal: string; taxableTotal: string; taxTotal: string; customerPoNo: string | null; expectedDate: string | null; lines: { lineNo: number; itemCode: string; description: string; qty: string; deliveredQty: string; invoicedQty: string; rate: string; discountPct: string; lineTotal: string; deliveryDate: string | null }[] }

export default function PortalOrder() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["portal", "order", id], queryFn: () => portalApi<Order>(`/portal/orders/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const o = q.data!;
  return (
    <div className="space-y-6">
      <Link href="/portal/orders" className="text-sm text-primary hover:underline">← Orders</Link>
      <PageHeader title={`Order ${o.number}`} description={`${formatDate(o.docDate)}${o.customerPoNo ? ` · your PO ${o.customerPoNo}` : ""}${o.expectedDate ? ` · expected ${formatDate(o.expectedDate)}` : ""}`} actions={<Badge tone={STATUS_META[o.status]?.tone}>{STATUS_META[o.status]?.label ?? o.status}</Badge>} />
      <Card>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 text-right font-medium">Ordered</th><th className="px-4 py-2 text-right font-medium">Delivered</th><th className="px-4 py-2 text-right font-medium">Invoiced</th><th className="px-4 py-2 text-right font-medium">Rate</th><th className="px-4 py-2 text-right font-medium">Amount</th></tr></thead>
          <tbody className="divide-y divide-border">
            {o.lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="px-4 py-2"><span className="font-mono text-xs text-muted">{l.itemCode}</span> {l.description}{l.deliveryDate && <span className="block text-xs text-muted">due {formatDate(l.deliveryDate)}</span>}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.qty)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.deliveredQty)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.invoicedQty)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.rate)}{Number(l.discountPct) > 0 && <span className="block text-xs text-muted">less {l.discountPct} %</span>}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border text-sm">
            <tr><td colSpan={5} className="px-4 py-1 text-right text-muted">Taxable value</td><td className="px-4 py-1 text-right tabular-nums">{formatMoney(o.taxableTotal)}</td></tr>
            <tr><td colSpan={5} className="px-4 py-1 text-right text-muted">GST</td><td className="px-4 py-1 text-right tabular-nums">{formatMoney(o.taxTotal)}</td></tr>
            <tr><td colSpan={5} className="px-4 py-2 text-right font-medium">Total</td><td className="px-4 py-2 text-right font-semibold tabular-nums">{formatMoney(o.grandTotal)}</td></tr>
          </tfoot>
        </table>
      </Card>
    </div>
  );
}
