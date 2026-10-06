"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/documents";
import type { VendorPerformance } from "@/lib/purchase";

const tone = (v: number | null) => (v === null ? "neutral" : v >= 95 ? "success" : v >= 85 ? "warning" : "danger");

export default function VendorPerformancePage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const report = useQuery({ queryKey: ["purchase", "vendor-performance", from, to], queryFn: () => api<VendorPerformance[]>("/purchase/vendor-performance", { query: { from: from || undefined, to: to || undefined } }) });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Vendor performance" description="Scorecards from real transactions: quantity accepted at receipt, deliveries on time against the PO date, and billing above order rates." />
      <Card>
        <div className="flex flex-wrap gap-3 px-4 py-3">
          <Field label="From">{(p) => <Input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="To">{(p) => <Input {...p} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
        {report.isLoading && <LoadingBlock />}
        {report.error && (
          <div className="p-5">
            <ErrorBlock error={report.error} />
          </div>
        )}
        {report.data && !report.data.length && <EmptyState title="No vendor activity" description="Scores appear once orders and goods receipts are posted." />}
        {!!report.data?.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Vendor</th>
                  <th className="px-4 py-2.5 text-right font-medium">Score</th>
                  <th className="px-4 py-2.5 text-right font-medium">Accepted</th>
                  <th className="px-4 py-2.5 text-right font-medium">On time</th>
                  <th className="px-4 py-2.5 text-right font-medium">Avg delay</th>
                  <th className="px-4 py-2.5 text-right font-medium">Orders</th>
                  <th className="px-4 py-2.5 text-right font-medium">Order value</th>
                  <th className="px-4 py-2.5 text-right font-medium">Billed above PO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.data.map((r) => (
                  <tr key={r.vendorId}>
                    <td className="px-4 py-3">
                      <Link href={`/masters/parties/${r.vendorId}`} className="font-medium hover:underline">
                        {r.vendor.name}
                      </Link>
                      {r.vendor.msmeCategory && <Badge className="ml-2">MSME</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right">{r.score === null ? <span className="text-muted">—</span> : <Badge tone={tone(r.score)}>{r.score}</Badge>}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.acceptancePct === null ? "—" : `${r.acceptancePct}%`}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.onTimePct === null ? "—" : `${r.onTimePct}%`}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{r.avgDelayDays === null ? "—" : `${r.avgDelayDays} d`}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.orders}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(r.orderValue)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${Number(r.rateVariance) > 0 ? "text-danger" : "text-muted"}`}>{Number(r.rateVariance) ? formatMoney(r.rateVariance) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
