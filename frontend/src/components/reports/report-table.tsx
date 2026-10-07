"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { formatCell, NUMERIC, type ReportColumn } from "@/lib/reports";

interface TableData { columns: ReportColumn[]; rows: Record<string, string | number | null>[]; totals: Record<string, string> }

/** Sortable results table with a sticky header and totals row (standard reports and the builder). */
export function ReportTable({ data }: { data: TableData }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const rows = sort
    ? [...data.rows].sort((x, y) => {
        const c = data.columns.find((k) => k.key === sort.key)!;
        const a = x[sort.key];
        const b = y[sort.key];
        if (a === null || a === undefined) return 1;
        if (b === null || b === undefined) return -1;
        return (NUMERIC.includes(c.type) ? Number(a) - Number(b) : String(a).localeCompare(String(b))) * sort.dir;
      })
    : data.rows;
  return (
    <Card className="overflow-hidden">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              {data.columns.map((c) => (
                <th key={c.key} className={`px-3 py-2 font-medium whitespace-nowrap ${NUMERIC.includes(c.type) ? "text-right" : ""}`}>
                  <button className="inline-flex items-center gap-1 uppercase" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: NUMERIC.includes(c.type) ? -1 : 1 }))}>
                    {c.label}
                    {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp className="size-3" aria-label="ascending" /> : <ArrowDown className="size-3" aria-label="descending" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-surface-muted/50">
                {data.columns.map((c) => (
                  <td key={c.key} className={`px-3 py-1.5 ${NUMERIC.includes(c.type) ? "text-right tabular-nums" : ""}`}>
                    {c.link && r[c.link.idKey] ? <Link className="text-primary hover:underline" href={`${c.link.path}/${r[c.link.idKey]}`}>{formatCell(c, r[c.key])}</Link> : formatCell(c, r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={data.columns.length} className="px-3 py-8 text-center text-muted">Nothing for these filters.</td></tr>
            )}
          </tbody>
          {Object.keys(data.totals).length > 0 && rows.length > 0 && (
            <tfoot className="sticky bottom-0 bg-surface-muted font-semibold">
              <tr>
                {data.columns.map((c, i) => (
                  <td key={c.key} className={`px-3 py-2 ${NUMERIC.includes(c.type) ? "text-right tabular-nums" : ""}`}>{data.totals[c.key] !== undefined ? formatCell(c, data.totals[c.key]) : i === 0 ? `Total (${rows.length} rows)` : ""}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
