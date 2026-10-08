"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatCell, NUMERIC, type ReportColumn } from "@/lib/reports";

interface TableData { columns: ReportColumn[]; rows: Record<string, string | number | null>[]; totals: Record<string, string> }
type Row = TableData["rows"][number];

/** Results table for standard reports and the builder: sort, columns, export, paging and totals. */
export function ReportTable({ data, name = "report" }: { data: TableData; name?: string }) {
  const columns: Column<Row>[] = data.columns.map((c, i) => {
    const numeric = NUMERIC.includes(c.type);
    return {
      key: c.key,
      label: c.label,
      align: numeric ? "right" : undefined,
      locked: i === 0,
      value: (r) => (r[c.key] == null ? null : numeric ? Number(r[c.key]) : String(r[c.key])),
      render: (r) =>
        c.link && r[c.link.idKey] ? (
          <Link className="text-primary hover:underline" href={`${c.link.path}/${r[c.link.idKey]}`}>
            {formatCell(c, r[c.key])}
          </Link>
        ) : (
          formatCell(c, r[c.key])
        ),
    };
  });
  const hasTotals = Object.keys(data.totals).length > 0 && data.rows.length > 0;
  const totals = hasTotals
    ? Object.fromEntries(data.columns.map((c, i) => [c.key, data.totals[c.key] !== undefined ? formatCell(c, data.totals[c.key]) : i === 0 ? `Total (${data.rows.length} rows)` : null]))
    : undefined;
  return (
    <Card className="overflow-hidden">
      <DataTable<Row>
        rows={data.rows}
        rowKey={(_r, i) => String(i)}
        columns={columns}
        storageKey={`report-${name}`}
        exportName={name}
        totals={totals}
        empty={<p className="px-4 py-8 text-center text-sm text-muted">Nothing for these filters.</p>}
      />
    </Card>
  );
}
