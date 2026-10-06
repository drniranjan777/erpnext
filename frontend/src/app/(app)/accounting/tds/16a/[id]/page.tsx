"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { ACC } from "@/lib/accounting";
import { formatDate, formatMoney } from "@/lib/documents";

interface F16a {
  quarter: string;
  deductee: { name: string; pan: string | null };
  amountPaid: string;
  tdsDeducted: string;
  transactions: { billId: string; number: string; date: string; section: string; base: string; rate: string; tds: string }[];
  challans: { voucherId: string; section: string; bsrCode: string; challanSerial: string; depositDate: string; amount: string }[];
}

export default function Form16aPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Form16a />
    </Suspense>
  );
}

function Form16a() {
  const { id } = useParams<{ id: string }>();
  const p = useSearchParams();
  const q = useQuery({ queryKey: [ACC, "16a", id, p.toString()], queryFn: () => api<F16a>(`${ACC}/tds/16a/${id}`, { query: { fy: p.get("fy") ?? "", quarter: p.get("quarter") ?? "" } }) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={`Form 16A data · ${d.deductee.name}`} description={`${d.quarter} · PAN ${d.deductee.pan ?? "not available"}. The signed certificate is generated on TRACES; use this to check it.`} actions={<Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print</Button>} />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted">Amount paid / credited</dt><dd className="tabular-nums">{formatMoney(d.amountPaid)}</dd></div>
          <div><dt className="text-xs text-muted">TDS deducted</dt><dd className="tabular-nums">{formatMoney(d.tdsDeducted)}</dd></div>
          <div><dt className="text-xs text-muted">Quarter</dt><dd>{d.quarter}</dd></div>
        </dl>
      </Card>
      <Card>
        <CardHeader title="Transactions" />
        <table className="w-full border-t border-border text-sm">
          <tbody className="divide-y divide-border">
            {d.transactions.map((t) => <tr key={t.billId}><td className="px-4 py-2 font-mono">{t.number}</td><td className="px-4 py-2">{formatDate(t.date)}</td><td className="px-4 py-2">{t.section}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(t.base)}</td><td className="px-4 py-2 text-right">{Number(t.rate)}%</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(t.tds)}</td></tr>)}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader title="Challans" />
        <table className="w-full border-t border-border text-sm">
          <tbody className="divide-y divide-border">
            {d.challans.map((c) => <tr key={c.voucherId}><td className="px-4 py-2">{c.section}</td><td className="px-4 py-2 font-mono">BSR {c.bsrCode}</td><td className="px-4 py-2 font-mono">{c.challanSerial}</td><td className="px-4 py-2">{formatDate(c.depositDate)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(c.amount)}</td></tr>)}
            {!d.challans.length && <tr><td className="px-4 py-3 text-muted">Not deposited yet</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
