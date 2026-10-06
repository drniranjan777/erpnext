"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge, Tabs } from "@/components/documents/document-parts";
import { SavedViews } from "@/components/saved-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, type DocumentStatus } from "@/lib/documents";
import { PO_API, PO_ROUTE, poKeys, type PoListItem } from "@/lib/purchase";

type Tab = "all" | "to_receive" | DocumentStatus;
const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "to_receive", label: "To receive" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export default function PurchaseOrdersPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const filters = {
    status: tab === "all" || tab === "to_receive" ? undefined : tab,
    pendingReceipt: tab === "to_receive" ? "true" : undefined,
    q: search || undefined,
  };
  const list = useInfiniteQuery({
    queryKey: poKeys.list(filters),
    queryFn: ({ pageParam }) => api<{ items: PoListItem[]; nextCursor: string | null }>(PO_API, { query: { ...filters, limit: 50, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Purchase orders"
        description="Orders to vendors with GST worked out per line. Goods are received against them with GRNs."
        actions={
          can("purchase.orders.manage") && (
            <Link href={`${PO_ROUTE}/new`}>
              <Button>
                <Plus className="size-4" aria-hidden /> New order
              </Button>
            </Link>
          )
        }
      />
      <Card>
        <div className="border-b border-border px-4 py-2.5">
          <SavedViews
            entity="purchase_orders"
            current={{ tab, search }}
            onApply={(f) => {
              setTab((f.tab as Tab) ?? "all");
              setSearch((f.search as string) ?? "");
              setQ((f.search as string) ?? "");
            }}
          />
        </div>
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
            <Input className="pl-9" placeholder="Number, vendor or quotation ref." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
          </form>
        </div>
        {list.isLoading && <LoadingBlock />}
        {list.error && (
          <div className="p-5">
            <ErrorBlock error={list.error} />
          </div>
        )}
        {list.data && items.length === 0 && <EmptyState title={search ? "No matching orders" : "No purchase orders"} description={search ? "Try another search." : "Create one, or convert an approved requisition."} />}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Vendor</th>
                  <th className="px-4 py-2.5 font-medium">Expected</th>
                  <th className="px-4 py-2.5 font-medium">Received</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-muted/60">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={`${PO_ROUTE}/${r.id}`} className="font-medium text-primary hover:underline">
                        {r.number ? `${r.number}${r.revision ? ` (Rev ${r.revision})` : ""}` : "Draft"}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(r.docDate)}</td>
                    <td className="max-w-xs px-4 py-3">
                      <p className="truncate">{r.vendor.name}</p>
                      <p className="truncate text-xs text-muted">{r.title}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(r.expectedDate)}</td>
                    <td className="px-4 py-3">
                      {r.poType === "service" ? (
                        <Badge>Services</Badge>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted">
                            <div className="h-full bg-primary" style={{ width: `${Math.min(100, r.receivedPct)}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-muted">{r.receivedPct}%</span>
                          {r.closedAt && <Badge>Short-closed</Badge>}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatMoney(r.grandTotal)}</td>
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
