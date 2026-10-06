"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/documents";
import { S } from "@/lib/sales";

interface Row { customerId: string; name: string; code: string; creditLimit: string | null; invoices: number; total: string; notDue: string; d30: string; d60: string; d90: string; over90: string; oldestDue: string | null }
type Buckets = Pick<Row, "total" | "notDue" | "d30" | "d60" | "d90" | "over90">;

const COLS: [keyof Buckets, string][] = [["notDue", "Not due"], ["d30", "1–30 days"], ["d60", "31–60"], ["d90", "61–90"], ["over90", "Over 90"], ["total", "Total"]];

export default function ReceivablesPage() {
  const r = useQuery({ queryKey: ["sales", "receivables"], queryFn: () => api<{ customers: Row[]; totals: Buckets }>("/sales/receivables") });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Receivables" description="What customers owe on approved invoices (after credit notes), aged by due date." />
      <Card>
        {r.isLoading && <LoadingBlock />}
        {r.error && <div className="p-5"><ErrorBlock error={r.error} /></div>}
        {r.data && !r.data.customers.length && <EmptyState title="Nothing outstanding" description="Unpaid approved invoices appear here." />}
        {!!r.data?.customers.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  {COLS.map(([k, l]) => <th key={k} className="px-4 py-2.5 text-right font-medium">{l}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.data.customers.map((c) => (
                  <tr key={c.customerId}>
                    <td className="px-4 py-3">
                      <Link href={`${S.invoices}?customer=${c.customerId}`} className="font-medium hover:underline">{c.name}</Link>
                      <p className="text-xs text-muted">{c.invoices} invoice{c.invoices === 1 ? "" : "s"} · oldest due {formatDate(c.oldestDue)}{c.creditLimit && ` · limit ${formatMoney(c.creditLimit)}`}</p>
                    </td>
                    {COLS.map(([k]) => (
                      <td key={k} className={`px-4 py-3 text-right tabular-nums ${k === "total" ? "font-medium" : ""} ${["d60", "d90", "over90"].includes(k) && Number(c[k]) > 0 ? "text-danger" : ""}`}>
                        {Number(c[k]) ? formatMoney(c[k]) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold">
                <tr>
                  <td className="px-4 py-3">Total</td>
                  {COLS.map(([k]) => <td key={k} className="px-4 py-3 text-right tabular-nums">{formatMoney(r.data!.totals[k])}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
