"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/documents";
import { S } from "@/lib/sales";
import { cn } from "@/lib/cn";
import { DataTable } from "@/components/ui/data-table";

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
        {r.data && r.data.customers.length > 0 && (
          <DataTable<Row>
            rows={r.data.customers}
            rowKey={(c) => c.customerId}
            exportName="receivables"
            storageKey="sales-receivables"
            totals={Object.fromEntries(COLS.map(([k]) => [k, formatMoney(r.data!.totals[k])]))}
            columns={[
              {
                key: "customer",
                label: "Customer",
                locked: true,
                value: (c) => c.name,
                render: (c) => (
                  <>
                    <Link href={`${S.invoices}?customer=${c.customerId}`} className="font-medium hover:underline">{c.name}</Link>
                    <p className="text-xs text-muted">{c.invoices} invoice{c.invoices === 1 ? "" : "s"} · oldest due {formatDate(c.oldestDue)}{c.creditLimit && ` · limit ${formatMoney(c.creditLimit)}`}</p>
                  </>
                ),
              },
              ...COLS.map(([k, l]) => ({
                key: k,
                label: l,
                align: "right" as const,
                className: cn(k === "total" && "font-medium"),
                value: (c: Row) => Number(c[k]),
                render: (c: Row) => <span className={cn(["d60", "d90", "over90"].includes(k) && Number(c[k]) > 0 && "text-danger")}>{Number(c[k]) ? formatMoney(c[k]) : "—"}</span>,
              })),
            ]}
          />
        )}
      </Card>
    </div>
  );
}
