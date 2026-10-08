"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { portalApi } from "@/lib/portal";

interface Invoice {
  id: string; number: string; docDate: string; dueDate: string | null; grandTotal: string; taxableTotal: string; cgstTotal: string; sgstTotal: string; igstTotal: string; outstanding: string; irn: string | null; ewayBillNo: string | null; vehicleNo: string | null; transporter: string | null;
  lines: { lineNo: number; itemCode: string; description: string; hsnCode: string | null; qty: string; rate: string; gstRate: string; taxableValue: string; lineTotal: string }[];
}

export default function PortalInvoice() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["portal", "invoice", id], queryFn: () => portalApi<Invoice>(`/portal/invoices/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const i = q.data!;
  const tax = [["CGST", i.cgstTotal], ["SGST", i.sgstTotal], ["IGST", i.igstTotal]].filter(([, v]) => Number(v) > 0);
  return (
    <div className="space-y-6">
      <Link href="/portal/invoices" className="text-sm text-primary hover:underline">← Invoices</Link>
      <PageHeader title={`Invoice ${i.number}`} description={`${formatDate(i.docDate)}${i.dueDate ? ` · due ${formatDate(i.dueDate)}` : ""} · balance ${formatMoney(i.outstanding)}`} />
      {(i.irn || i.ewayBillNo) && (
        <Card className="px-5 py-3 text-xs text-muted">
          {i.irn && <p className="break-all">IRN {i.irn}</p>}
          {i.ewayBillNo && <p>e-Way bill {i.ewayBillNo}{i.vehicleNo && ` · vehicle ${i.vehicleNo}`}{i.transporter && ` · ${i.transporter}`}</p>}
        </Card>
      )}
      <Card>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 font-medium">HSN</th><th className="px-4 py-2 text-right font-medium">Qty</th><th className="px-4 py-2 text-right font-medium">Rate</th><th className="px-4 py-2 text-right font-medium">GST</th><th className="px-4 py-2 text-right font-medium">Taxable</th><th className="px-4 py-2 text-right font-medium">Total</th></tr></thead>
          <tbody className="divide-y divide-border">
            {i.lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="px-4 py-2"><span className="font-mono text-xs text-muted">{l.itemCode}</span> {l.description}</td>
                <td className="px-4 py-2">{l.hsnCode ?? "–"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.qty)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.rate)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(l.gstRate)} %</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.taxableValue)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border">
            <tr><td colSpan={6} className="px-4 py-1 text-right text-muted">Taxable value</td><td className="px-4 py-1 text-right tabular-nums">{formatMoney(i.taxableTotal)}</td></tr>
            {tax.map(([k, v]) => <tr key={k}><td colSpan={6} className="px-4 py-1 text-right text-muted">{k}</td><td className="px-4 py-1 text-right tabular-nums">{formatMoney(v)}</td></tr>)}
            <tr><td colSpan={6} className="px-4 py-2 text-right font-medium">Invoice total</td><td className="px-4 py-2 text-right font-semibold tabular-nums">{formatMoney(i.grandTotal)}</td></tr>
          </tfoot>
        </table></div>
      </Card>
    </div>
  );
}
