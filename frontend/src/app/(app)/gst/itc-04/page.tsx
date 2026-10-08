"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { PeriodBar, thisMonth } from "../_components/period";
import { DataTable } from "@/components/ui/data-table";

interface Itc04 {
  table4: { jobWorkerGstin: string | null; jobWorkerState: string; challanNo: string; challanDate: string; typeOfGoods: string; description: string; uqc: string; qty: string; taxableValue: string; igstRate: string; cgstRate: string; sgstRate: string }[];
  table5a: { jobWorkerGstin: string | null; jobWorkerState: string; originalChallanNo: string; originalChallanDate: string; jobWorkerChallanNo: string; jobWorkerChallanDate: string; natureOfJob: string; description: string; uqc: string; qty: string; lossUqc: string; lossQty: string }[];
}


export default function Itc04Page() {
  const [period, setPeriod] = useState(thisMonth());
  const q = useQuery({ queryKey: ["gst", "itc04", period], queryFn: () => api<Itc04>("/job-work/itc-04", { query: { ...period } }) });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="ITC-04" description="Goods sent to job workers and received back, in the layout of the GST offline tool. Filed half-yearly (annually below ₹5 crore turnover)." />
      <Card>
        <PeriodBar value={period} onChange={setPeriod} csvPath="/job-work/itc-04" csvName={`ITC-04_${period.from}_${period.to}.csv`} />
        {q.isLoading && <LoadingBlock />}
        {q.error && <div className="p-5"><ErrorBlock error={q.error} /></div>}
      </Card>
      {q.data && (
        <>
          <Card>
            <CardHeader title="Table 4 · Goods sent to job workers" />
            {!q.data.table4.length ? (
              <EmptyState title="Nothing sent" />
            ) : (
              <div className="overflow-x-auto">
                <DataTable
                  rows={q.data.table4}
                  rowKey={(_r, i) => String(i)}
                  exportName="gst-itc-04"
                  storageKey="gst-itc-04-0"
                  columns={[
                    { key: "job-worker", label: "Job worker", locked: true, className: "whitespace-normal", render: (r) => <><span className="font-mono text-xs">{r.jobWorkerGstin ?? "Unregistered"}</span><p className="text-xs text-muted">{r.jobWorkerState}</p></> },
                    { key: "challan", label: "Challan", className: "whitespace-normal", render: (r) => <><span className="font-mono">{r.challanNo}</span><p className="text-xs text-muted">{formatDate(r.challanDate)}</p></> },
                    { key: "goods", label: "Goods", className: "whitespace-normal", render: (r) => <>{r.typeOfGoods}</> },
                    { key: "description", label: "Description", className: "whitespace-normal", render: (r) => <>{r.description}</> },
                    { key: "qty", label: "Qty", align: "right", render: (r) => <>{formatQty(r.qty)} {r.uqc}</> },
                    { key: "taxable", label: "Taxable", align: "right", render: (r) => <>{formatMoney(r.taxableValue)}</> },
                    { key: "igst-cgst-sgst", label: "IGST / CGST / SGST %", align: "right", render: (r) => <>{r.igstRate} / {r.cgstRate} / {r.sgstRate}</> },
                  ]}
                />
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Table 5A · Goods received back" />
            {!q.data.table5a.length ? (
              <EmptyState title="Nothing received" />
            ) : (
              <div className="overflow-x-auto">
                <DataTable
                  rows={q.data.table5a}
                  rowKey={(_r, i) => String(i)}
                  exportName="gst-itc-04"
                  storageKey="gst-itc-04-1"
                  columns={[
                    { key: "job-worker", label: "Job worker", locked: true, className: "whitespace-normal", render: (r) => <><span className="font-mono text-xs">{r.jobWorkerGstin ?? "Unregistered"}</span><p className="text-xs text-muted">{r.jobWorkerState}</p></> },
                    { key: "original-challan", label: "Original challan", className: "whitespace-normal", render: (r) => <><span className="font-mono">{r.originalChallanNo}</span><p className="text-xs text-muted">{formatDate(r.originalChallanDate)}</p></> },
                    { key: "job-worker-apos-s-challan", label: "Job worker&apos;s challan", className: "whitespace-normal", render: (r) => <>{r.jobWorkerChallanNo || "—"}<p className="text-xs text-muted">{formatDate(r.jobWorkerChallanDate)}</p></> },
                    { key: "job-done", label: "Job done", className: "whitespace-normal", render: (r) => <>{r.natureOfJob}</> },
                    { key: "description", label: "Description", className: "whitespace-normal", render: (r) => <>{r.description}</> },
                    { key: "qty", label: "Qty", align: "right", render: (r) => <>{formatQty(r.qty)} {r.uqc}</> },
                    { key: "losses", label: "Losses", align: "right", render: (r) => <>{r.lossQty ? `${formatQty(r.lossQty)} ${r.lossUqc}` : "—"}</> },
                  ]}
                />
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
