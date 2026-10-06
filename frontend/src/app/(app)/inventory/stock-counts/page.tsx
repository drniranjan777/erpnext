"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge, Tabs } from "@/components/documents/document-parts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
} from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, type DocumentStatus } from "@/lib/documents";
import {
  SC_API,
  SC_ROUTE,
  scKeys,
  type StockCountListItem,
} from "@/lib/inventory";

type Tab = "all" | DocumentStatus;
const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Counting" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Posted" },
  { value: "cancelled", label: "Cancelled" },
];

export default function StockCountsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("all");
  const filters = { status: tab === "all" ? undefined : tab };
  const list = useInfiniteQuery({
    queryKey: scKeys.list(filters),
    queryFn: ({ pageParam }) =>
      api<{ items: StockCountListItem[]; nextCursor: string | null }>(SC_API, {
        query: { ...filters, limit: 50, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Physical stock counts"
        description="Count a warehouse (or one item group), compare with the books, and post the differences as adjustments when approved."
        actions={
          can("inventory.entries.manage") && (
            <Link href={`${SC_ROUTE}/new`}>
              <Button>
                <Plus className="size-4" aria-hidden /> New count
              </Button>
            </Link>
          )
        }
      />
      <Card>
        <div className="px-4 pt-3">
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
        </div>
        {list.isLoading && <LoadingBlock />}
        {list.error && (
          <div className="p-5">
            <ErrorBlock error={list.error} />
          </div>
        )}
        {list.data && items.length === 0 && (
          <EmptyState
            title="No stock counts"
            description="Start one for a warehouse: the sheet lists every item and batch the books say is there."
          />
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Warehouse</th>
                  <th className="px-4 py-2.5 font-medium">Progress</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Variance value
                  </th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-muted/60">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`${SC_ROUTE}/${r.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.number ?? "Draft"}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {formatDate(r.docDate)}
                    </td>
                    <td className="px-4 py-3">
                      {r.warehouse.code} · {r.warehouse.name}
                      {r.group && (
                        <p className="text-xs text-muted">{r.group}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted">
                          <div
                            className="h-full bg-primary"
                            style={{
                              width: `${r.lines ? (r.counted / r.lines) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted">
                          {r.counted}/{r.lines}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatMoney(r.amount)}
                    </td>
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
            <Button
              variant="secondary"
              size="sm"
              loading={list.isFetchingNextPage}
              onClick={() => list.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
