"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { PeriodBar, thisMonth } from "../_components/period";

interface Itc04 {
  table4: { jobWorkerGstin: string | null; jobWorkerState: string; challanNo: string; challanDate: string; typeOfGoods: string; description: string; uqc: string; qty: string; taxableValue: string; igstRate: string; cgstRate: string; sgstRate: string }[];
  table5a: { jobWorkerGstin: string | null; jobWorkerState: string; originalChallanNo: string; originalChallanDate: string; jobWorkerChallanNo: string; jobWorkerChallanDate: string; natureOfJob: string; description: string; uqc: string; qty: string; lossUqc: string; lossQty: string }[];
}

const th = "px-3 py-2 font-medium";
const td = "px-3 py-2";

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
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                    <tr><th className={th}>Job worker</th><th className={th}>Challan</th><th className={th}>Goods</th><th className={th}>Description</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Taxable</th><th className={`${th} text-right`}>IGST / CGST / SGST %</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {q.data.table4.map((r, i) => (
                      <tr key={i}>
                        <td className={td}><span className="font-mono text-xs">{r.jobWorkerGstin ?? "Unregistered"}</span><p className="text-xs text-muted">{r.jobWorkerState}</p></td>
                        <td className={td}><span className="font-mono">{r.challanNo}</span><p className="text-xs text-muted">{formatDate(r.challanDate)}</p></td>
                        <td className={td}>{r.typeOfGoods}</td>
                        <td className={td}>{r.description}</td>
                        <td className={`${td} text-right tabular-nums`}>{formatQty(r.qty)} {r.uqc}</td>
                        <td className={`${td} text-right tabular-nums`}>{formatMoney(r.taxableValue)}</td>
                        <td className={`${td} text-right tabular-nums`}>{r.igstRate} / {r.cgstRate} / {r.sgstRate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Table 5A · Goods received back" />
            {!q.data.table5a.length ? (
              <EmptyState title="Nothing received" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                    <tr><th className={th}>Job worker</th><th className={th}>Original challan</th><th className={th}>Job worker&apos;s challan</th><th className={th}>Job done</th><th className={th}>Description</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Losses</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {q.data.table5a.map((r, i) => (
                      <tr key={i}>
                        <td className={td}><span className="font-mono text-xs">{r.jobWorkerGstin ?? "Unregistered"}</span><p className="text-xs text-muted">{r.jobWorkerState}</p></td>
                        <td className={td}><span className="font-mono">{r.originalChallanNo}</span><p className="text-xs text-muted">{formatDate(r.originalChallanDate)}</p></td>
                        <td className={td}>{r.jobWorkerChallanNo || "—"}<p className="text-xs text-muted">{formatDate(r.jobWorkerChallanDate)}</p></td>
                        <td className={td}>{r.natureOfJob}</td>
                        <td className={td}>{r.description}</td>
                        <td className={`${td} text-right tabular-nums`}>{formatQty(r.qty)} {r.uqc}</td>
                        <td className={`${td} text-right tabular-nums`}>{r.lossQty ? `${formatQty(r.lossQty)} ${r.lossUqc}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
