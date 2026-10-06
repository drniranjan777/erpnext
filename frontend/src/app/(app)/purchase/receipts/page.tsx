"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { PackageCheck, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge, Tabs } from "@/components/documents/document-parts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, type DocumentStatus } from "@/lib/documents";
import { GRN_API, GRN_ROUTE, grnKeys, PO_ROUTE, type GrnListItem } from "@/lib/purchase";

type Tab = "all" | DocumentStatus;
const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Posted" },
  { value: "cancelled", label: "Cancelled" },
];

export default function GoodsReceiptsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const filters = { status: tab === "all" ? undefined : tab, q: search || undefined };
  const list = useInfiniteQuery({
    queryKey: grnKeys.list(filters),
    queryFn: ({ pageParam }) => api<{ items: GrnListItem[]; nextCursor: string | null }>(GRN_API, { query: { ...filters, limit: 50, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Goods receipts"
        description="GRNs against purchase orders. Accepted goods go into stock at the order's net rate."
        actions={
          can("purchase.receipts.manage") && (
            <Link href={`${GRN_ROUTE}/new`}>
              <Button>
                <PackageCheck className="size-4" aria-hidden /> Receive goods
              </Button>
            </Link>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3 px-4 pt-3">
          <div className="min-w-0 flex-1">
            <Tabs tabs={TABS} value={tab} onChange={setTab} />
          </div>
          <form
            className="relative mb-2 w-full sm:w-72"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9" placeholder="GRN, vendor, invoice or challan" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search receipts" />
          </form>
        </div>
        {list.isLoading && <LoadingBlock />}
        {list.error && (
          <div className="p-5">
            <ErrorBlock error={list.error} />
          </div>
        )}
        {list.data && items.length === 0 && <EmptyState title="No goods receipts" description="Receive goods from an approved purchase order." />}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Vendor</th>
                  <th className="px-4 py-2.5 font-medium">PO</th>
                  <th className="px-4 py-2.5 font-medium">Supplier invoice</th>
                  <th className="px-4 py-2.5 font-medium">Into</th>
                  <th className="px-4 py-2.5 text-right font-medium">Value</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-muted/60">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={`${GRN_ROUTE}/${r.id}`} className="font-medium text-primary hover:underline">
                        {r.number ?? "Draft"}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(r.docDate)}</td>
                    <td className="max-w-xs truncate px-4 py-3">{r.vendor.name}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={`${PO_ROUTE}/${r.poId}`} className="hover:underline">
                        {r.poNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted">{r.supplierInvoiceNo ?? "—"}</td>
                    <td className="px-4 py-3">{r.warehouse.code}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatMoney(r.amount)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.hasNextPage && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="secondary" size="sm" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
