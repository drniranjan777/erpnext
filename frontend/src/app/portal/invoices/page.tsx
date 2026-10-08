"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { formatDate, formatMoney } from "@/lib/documents";
import { portalApi } from "@/lib/portal";

interface Invoice { id: string; number: string; docDate: string; dueDate: string | null; grandTotal: string; outstanding: string; customerPoNo: string | null; eInvoice: boolean; ewayBillNo: string | null; state: string }
interface Payment { id: string; number: string; docDate: string; amount: string; mode: string; instrumentNo: string | null; reference: string | null; tdsDeducted: string }
const TONE = { paid: "success", overdue: "danger", "part paid": "warning", open: "primary" } as const;

export default function PortalInvoices() {
  const [tab, setTab] = useState<"invoices" | "payments">("invoices");
  const inv = useQuery({ queryKey: ["portal", "invoices"], queryFn: () => portalApi<Invoice[]>("/portal/invoices") });
  const pay = useQuery({ queryKey: ["portal", "payments"], queryFn: () => portalApi<Payment[]>("/portal/payments"), enabled: tab === "payments" });
  const q = tab === "invoices" ? inv : pay;
  return (
    <div className="space-y-6">
      <PageHeader title="Invoices & payments" description="Tax invoices raised on you and the payments we have received." />
      <div className="flex gap-1 text-sm">
        {(["invoices", "payments"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 capitalize ${tab === t ? "bg-primary/10 font-medium text-primary" : "text-muted"}`}>{t}</button>
        ))}
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {tab === "invoices" && inv.data && (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Invoice</th><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Due</th><th className="px-4 py-2 font-medium">Your PO</th><th className="px-4 py-2 text-right font-medium">Amount</th><th className="px-4 py-2 text-right font-medium">Balance</th><th className="px-4 py-2 font-medium" /></tr></thead>
            <tbody className="divide-y divide-border">
              {inv.data.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2"><Link className="text-primary hover:underline" href={`/portal/invoices/${i.id}`}>{i.number}</Link>{i.eInvoice && <span className="ml-1 text-xs text-muted">e-invoice</span>}</td>
                  <td className="px-4 py-2">{formatDate(i.docDate)}</td>
                  <td className="px-4 py-2">{i.dueDate ? formatDate(i.dueDate) : "–"}</td>
                  <td className="px-4 py-2">{i.customerPoNo ?? "–"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(i.grandTotal)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(i.outstanding)}</td>
                  <td className="px-4 py-2"><Badge tone={TONE[i.state as keyof typeof TONE]}>{i.state}</Badge></td>
                </tr>
              ))}
              {!inv.data.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No invoices yet.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
      {tab === "payments" && pay.data && (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Receipt</th><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Mode</th><th className="px-4 py-2 font-medium">Reference</th><th className="px-4 py-2 text-right font-medium">TDS</th><th className="px-4 py-2 text-right font-medium">Amount</th></tr></thead>
            <tbody className="divide-y divide-border">
              {pay.data.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-mono text-xs">{p.number}</td>
                  <td className="px-4 py-2">{formatDate(p.docDate)}</td>
                  <td className="px-4 py-2 uppercase">{p.mode}</td>
                  <td className="px-4 py-2">{[p.instrumentNo, p.reference].filter(Boolean).join(" · ") || "–"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(p.tdsDeducted) ? formatMoney(p.tdsDeducted) : "–"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(p.amount)}</td>
                </tr>
              ))}
              {!pay.data.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No payments recorded yet.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
