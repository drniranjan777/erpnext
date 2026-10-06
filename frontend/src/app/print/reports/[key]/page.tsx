"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatCell, NUMERIC, type ReportResult } from "@/lib/reports";

/** Any report on A4 landscape, for printing or saving as PDF. */
export default function PrintReportPage() {
  return (
    <Suspense>
      <PrintReport />
    </Suspense>
  );
}

function PrintReport() {
  const { key } = useParams<{ key: string }>();
  const search = useSearchParams();
  const { status } = useAuth();
  const q = useQuery({ queryKey: ["reports", "print", key, search.toString()], queryFn: () => api<ReportResult>(`/reports/${key}?${search.toString()}`), enabled: status === "authenticated" });
  const d = q.data;
  return (
    <PrintShell title={d?.title ?? "Report"} ready={!!d}>
      {d && (
        <div className="mx-auto max-w-[297mm] bg-white p-6 text-[10px] text-black shadow print:max-w-none print:p-0 print:shadow-none">
          <style>{"@page { size: A4 landscape; margin: 10mm; } thead { display: table-header-group; } tr { break-inside: avoid; }"}</style>
          <h1 className="text-base font-bold">{d.title}</h1>
          <p className="mb-3">{Object.entries(d.params).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-black text-left">
                {d.columns.map((c) => <th key={c.key} className={`py-1 pr-2 ${NUMERIC.includes(c.type) ? "text-right" : ""}`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-300">
                  {d.columns.map((c) => <td key={c.key} className={`py-0.5 pr-2 ${NUMERIC.includes(c.type) ? "text-right tabular-nums" : ""}`}>{formatCell(c, r[c.key])}</td>)}
                </tr>
              ))}
            </tbody>
            {Object.keys(d.totals).length > 0 && (
              <tfoot>
                <tr className="border-t border-black font-bold">
                  {d.columns.map((c, i) => <td key={c.key} className={`py-1 pr-2 ${NUMERIC.includes(c.type) ? "text-right" : ""}`}>{d.totals[c.key] !== undefined ? formatCell(c, d.totals[c.key]) : i === 0 ? "Total" : ""}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
          {d.truncated && <p className="mt-2">First 10,000 rows only.</p>}
        </div>
      )}
    </PrintShell>
  );
}
