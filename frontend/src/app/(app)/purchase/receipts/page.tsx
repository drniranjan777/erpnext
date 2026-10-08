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
import { DataTable } from "@/components/ui/data-table";

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
            <DataTable
              rows={items}
              hasMore={list.hasNextPage}
              loadingMore={list.isFetchingNextPage}
              onLoadMore={() => void list.fetchNextPage()}
              rowKey={(r) => String(r.id)}
              exportName="purchase-receipts"
              storageKey="purchase-receipts-0"
              columns={[
                { key: "number", label: "Number", locked: true, render: (r) => <><Link href={`${GRN_ROUTE}/${r.id}`} className="font-medium text-primary hover:underline">
                                      {r.number ?? "Draft"}
                                    </Link></> },
                { key: "date", label: "Date", className: "text-muted", render: (r) => <>{formatDate(r.docDate)}</> },
                { key: "vendor", label: "Vendor", className: "max-w-xs truncate whitespace-normal", render: (r) => <>{r.vendor.name}</> },
                { key: "po", label: "PO", render: (r) => <><Link href={`${PO_ROUTE}/${r.poId}`} className="hover:underline">
                                      {r.poNumber}
                                    </Link></> },
                { key: "supplier-invoice", label: "Supplier invoice", className: "text-muted whitespace-normal", render: (r) => <>{r.supplierInvoiceNo ?? "—"}</> },
                { key: "into", label: "Into", className: "whitespace-normal", render: (r) => <>{r.warehouse.code}</> },
                { key: "value", label: "Value", align: "right", render: (r) => <>{formatMoney(r.amount)}</> },
                { key: "status", label: "Status", className: "whitespace-normal", render: (r) => <><StatusBadge status={r.status} /></> },
              ]}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
