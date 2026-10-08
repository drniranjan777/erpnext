"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { formatDate, formatMoney } from "@/lib/documents";
import { portalApi } from "@/lib/portal";
import { DataTable } from "@/components/ui/data-table";

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
          <DataTable
            rows={inv.data}
            rowKey={(i) => String(i.id)}
            exportName="app-portal-invoices"
            storageKey="app-portal-invoices-0"
            empty={<p className="px-4 py-6 text-center text-sm text-muted">No invoices yet.</p>}
            columns={[
              { key: "invoice", label: "Invoice", locked: true, className: "whitespace-normal", render: (i) => <><Link className="text-primary hover:underline" href={`/portal/invoices/${i.id}`}>{i.number}</Link>{i.eInvoice && <span className="ml-1 text-xs text-muted">e-invoice</span>}</> },
              { key: "date", label: "Date", className: "whitespace-normal", render: (i) => <>{formatDate(i.docDate)}</> },
              { key: "due", label: "Due", className: "whitespace-normal", render: (i) => <>{i.dueDate ? formatDate(i.dueDate) : "–"}</> },
              { key: "your-po", label: "Your PO", className: "whitespace-normal", render: (i) => <>{i.customerPoNo ?? "–"}</> },
              { key: "amount", label: "Amount", align: "right", render: (i) => <>{formatMoney(i.grandTotal)}</> },
              { key: "balance", label: "Balance", align: "right", render: (i) => <>{formatMoney(i.outstanding)}</> },
              { key: "col6", label: "", noSort: true, className: "whitespace-normal", render: (i) => <><Badge tone={TONE[i.state as keyof typeof TONE]}>{i.state}</Badge></> },
            ]}
          />
        </Card>
      )}
      {tab === "payments" && pay.data && (
        <Card>
          <DataTable
            rows={pay.data}
            rowKey={(p) => String(p.id)}
            exportName="app-portal-invoices"
            storageKey="app-portal-invoices-1"
            empty={<p className="px-4 py-6 text-center text-sm text-muted">No payments recorded yet.</p>}
            columns={[
              { key: "receipt", label: "Receipt", locked: true, className: "font-mono text-xs whitespace-normal", render: (p) => <>{p.number}</> },
              { key: "date", label: "Date", className: "whitespace-normal", render: (p) => <>{formatDate(p.docDate)}</> },
              { key: "mode", label: "Mode", className: "uppercase whitespace-normal", render: (p) => <>{p.mode}</> },
              { key: "reference", label: "Reference", className: "whitespace-normal", render: (p) => <>{[p.instrumentNo, p.reference].filter(Boolean).join(" · ") || "–"}</> },
              { key: "tds", label: "TDS", align: "right", render: (p) => <>{Number(p.tdsDeducted) ? formatMoney(p.tdsDeducted) : "–"}</> },
              { key: "amount", label: "Amount", align: "right", render: (p) => <>{formatMoney(p.amount)}</> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
