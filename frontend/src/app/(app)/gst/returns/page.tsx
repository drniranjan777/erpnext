"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatMoney, formatQty } from "@/lib/documents";
import { PeriodBar, thisMonth } from "../_components/period";
import { DataTable } from "@/components/ui/data-table";

interface HsnRow { section: "b2b" | "b2c"; hsn: string; description: string; uqc: string; uqcName: string; gstRate: string; qty: string; totalValue: string; taxable: string; igst: string; cgst: string; sgst: string; cess: string }
type Totals = { lines: number; taxable: string; igst: string; cgst: string; sgst: string; cess: string; totalValue: string };
interface Hsn { rows: HsnRow[]; totals: { b2b: Totals; b2c: Totals }; missingHsn: number }
interface Docs { rows: { nature: string; docType: string; from: string; to: string; total: number; cancelled: number; netIssued: number }[] }

export default function GstReturnsPage() {
  const [period, setPeriod] = useState(thisMonth());
  const hsn = useQuery({ queryKey: ["gst", "hsn", period], queryFn: () => api<Hsn>("/gst/hsn-summary", { query: { ...period } }) });
  const docs = useQuery({ queryKey: ["gst", "docs", period], queryFn: () => api<Docs>("/gst/documents-issued", { query: { ...period } }) });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="GSTR-1 helpers" description="HSN-wise summary of outward supplies (table 12) and documents issued (table 13), from posted invoices and credit notes." />
      <Card>
        <PeriodBar value={period} onChange={setPeriod} csvPath="/gst/hsn-summary" csvName={`HSN_summary_${period.from}_${period.to}.csv`} />
        {hsn.isLoading && <LoadingBlock />}
        {hsn.error && <div className="p-5"><ErrorBlock error={hsn.error} /></div>}
        {hsn.data && !hsn.data.rows.length && <EmptyState title="No outward supplies" description="Nothing was invoiced in this period." />}
        {!!hsn.data?.missingHsn && <div className="px-5 pt-4"><Alert tone="warning">{hsn.data.missingHsn} row(s) have no HSN code. Add HSN codes to those items.</Alert></div>}
        {(["b2b", "b2c"] as const).map((sec) => {
          const rows = hsn.data?.rows.filter((r) => r.section === sec) ?? [];
          if (!rows.length) return null;
          const t = hsn.data!.totals[sec];
          return (
            <div key={sec} className="overflow-x-auto">
              <h2 className="px-5 pb-2 pt-5 text-sm font-semibold">{sec === "b2b" ? "B2B (registered recipients)" : "B2C (unregistered, consumers, exports)"}</h2>
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">HSN</th>
                    <th className="px-4 py-2 font-medium">Description</th>
                    <th className="px-4 py-2 font-medium">UQC</th>
                    <th className="px-4 py-2 text-right font-medium">Qty</th>
                    <th className="px-4 py-2 text-right font-medium">Rate</th>
                    <th className="px-4 py-2 text-right font-medium">Taxable</th>
                    <th className="px-4 py-2 text-right font-medium">IGST</th>
                    <th className="px-4 py-2 text-right font-medium">CGST</th>
                    <th className="px-4 py-2 text-right font-medium">SGST/UTGST</th>
                    <th className="px-4 py-2 text-right font-medium">Cess</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={`${r.hsn}${r.uqc}${r.gstRate}`}>
                      <td className="px-4 py-2 font-mono">{r.hsn || "—"}</td>
                      <td className="max-w-56 truncate px-4 py-2">{r.description}</td>
                      <td className="px-4 py-2">{r.uqc}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatQty(r.qty)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.gstRate}%</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.taxable)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.igst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.cgst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.sgst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.cess)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border font-semibold">
                  <tr>
                    <td className="px-4 py-2" colSpan={5}>Total ({t.lines} lines)</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(t.taxable)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(t.igst)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(t.cgst)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(t.sgst)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(t.cess)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })}
      </Card>
      <Card>
        <CardHeader title="Documents issued" />
        {docs.data && !docs.data.rows.length && <EmptyState title="No documents" />}
        {!!docs.data?.rows.length && (
          <DataTable
            rows={docs.data.rows}
            rowKey={(r) => String(`${r.docType}${r.from}`)}
            exportName="gst-returns"
            storageKey="gst-returns-1"
            columns={[
              { key: "nature-of-document", label: "Nature of document", locked: true, className: "whitespace-normal", render: (r) => <>{r.nature}</> },
              { key: "from", label: "From", className: "font-mono whitespace-normal", render: (r) => <>{r.from}</> },
              { key: "to", label: "To", className: "font-mono whitespace-normal", render: (r) => <>{r.to}</> },
              { key: "total", label: "Total", align: "right", render: (r) => <>{r.total}</> },
              { key: "cancelled", label: "Cancelled", align: "right", render: (r) => <>{r.cancelled}</> },
              { key: "net-issued", label: "Net issued", align: "right", render: (r) => <>{r.netIssued}</> },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
