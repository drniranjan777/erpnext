"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, apiDownload } from "@/lib/api";
import { todayIST } from "@/lib/documents";
import { DataTable } from "@/components/ui/data-table";

interface Gstr1 { gstin: string; summary: Record<string, number>; json: { fp: string; b2b: { ctin: string; inv: unknown[] }[]; b2cs: { sply_ty: string; pos: string; rt: number; txval: number; iamt: number; camt: number; samt: number }[] } }

const SECTIONS: [string, string][] = [
  ["b2b", "B2B invoices (4A, 4B, 6B, 6C)"],
  ["b2cl", "B2C large, inter-state above ₹1 lakh (5)"],
  ["b2cs", "B2C small, rate and state-wise rows (7)"],
  ["exp", "Exports (6A)"],
  ["cdnr", "Credit / debit notes, registered (9B)"],
  ["cdnur", "Credit / debit notes, unregistered (9B)"],
  ["hsnLines", "HSN summary rows (12)"],
];

export default function Gstr1Page() {
  const [period, setPeriod] = useState(todayIST().slice(0, 7));
  const q = useQuery({ queryKey: ["gst", "gstr1", period], queryFn: () => api<Gstr1>("/gst/gstr1", { query: { period } }), retry: false });
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="GSTR-1"
        description="Outward supplies of the month from posted invoices and credit notes. Download the JSON and upload it in the GST offline tool or portal."
        actions={q.data ? <Button variant="secondary" onClick={() => apiDownload(`/gst/gstr1?period=${period}&download=true`, `GSTR1_${q.data!.gstin}_${q.data!.json.fp}.json`)}><Download className="size-4" aria-hidden /> JSON</Button> : undefined}
      />
      <Card>
        <div className="px-5 py-4"><Field label="Return period">{(f) => <Input {...f} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />}</Field></div>
        {q.isLoading && <LoadingBlock />}
        {q.error && <div className="p-5"><ErrorBlock error={q.error} /></div>}
        {q.data && (
          <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
            <tbody className="divide-y divide-border">
              <tr><td className="px-5 py-2">Invoices reported</td><td className="px-5 py-2 text-right font-medium tabular-nums">{q.data.summary.invoices}</td></tr>
              {SECTIONS.map(([k, label]) => (
                <tr key={k}><td className="px-5 py-2 text-muted">{label}</td><td className="px-5 py-2 text-right tabular-nums">{q.data!.summary[k] ?? 0}</td></tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      {!!q.data?.json.b2cs.length && (
        <Card>
          <CardHeader title="B2C small (table 7)" />
          <DataTable
            rows={q.data.json.b2cs}
            rowKey={(_r, i) => String(i)}
            exportName="gst-gstr1"
            storageKey="gst-gstr1-1"
            columns={[
              { key: "type", label: "Type", locked: true, className: "whitespace-normal", render: (r) => <>{r.sply_ty}</> },
              { key: "state", label: "State", className: "whitespace-normal", render: (r) => <>{r.pos}</> },
              { key: "rate", label: "Rate", align: "right", render: (r) => <>{r.rt}%</> },
              { key: "taxable", label: "Taxable", align: "right", render: (r) => <>{r.txval.toFixed(2)}</> },
              { key: "igst", label: "IGST", align: "right", render: (r) => <>{r.iamt.toFixed(2)}</> },
              { key: "cgst", label: "CGST", align: "right", render: (r) => <>{r.camt.toFixed(2)}</> },
              { key: "sgst", label: "SGST", align: "right", render: (r) => <>{r.samt.toFixed(2)}</> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
