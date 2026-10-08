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
import { DataTable } from "@/components/ui/data-table";

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
            <DataTable
              rows={report.data}
              rowKey={(r) => String(r.vendorId)}
              exportName="purchase-vendor-performance"
              storageKey="purchase-vendor-performance-0"
              columns={[
                { key: "vendor", label: "Vendor", locked: true, className: "whitespace-normal", render: (r) => <><Link href={`/masters/parties/${r.vendorId}`} className="font-medium hover:underline">
                                      {r.vendor.name}
                                    </Link>
                                    {r.vendor.msmeCategory && <Badge className="ml-2">MSME</Badge>}</> },
                { key: "score", label: "Score", align: "right", render: (r) => <>{r.score === null ? <span className="text-muted">—</span> : <Badge tone={tone(r.score)}>{r.score}</Badge>}</> },
                { key: "accepted", label: "Accepted", align: "right", render: (r) => <>{r.acceptancePct === null ? "—" : `${r.acceptancePct}%`}</> },
                { key: "on-time", label: "On time", align: "right", render: (r) => <>{r.onTimePct === null ? "—" : `${r.onTimePct}%`}</> },
                { key: "avg-delay", label: "Avg delay", align: "right", className: "text-muted", render: (r) => <>{r.avgDelayDays === null ? "—" : `${r.avgDelayDays} d`}</> },
                { key: "orders", label: "Orders", align: "right", render: (r) => <>{r.orders}</> },
                { key: "order-value", label: "Order value", align: "right", render: (r) => <>{formatMoney(r.orderValue)}</> },
                { key: "billed-above-po", label: "Billed above PO", align: "right", render: (r) => <><span className={`${Number(r.rateVariance) > 0 ? "text-danger" : "text-muted"}`}>{Number(r.rateVariance) ? formatMoney(r.rateVariance) : "—"}</span></> },
              ]}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
