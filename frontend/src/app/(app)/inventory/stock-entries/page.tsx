"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge, Tabs } from "@/components/documents/document-parts";
import { SavedViews } from "@/components/saved-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, type DocumentStatus } from "@/lib/documents";
import { PURPOSE_META, SE_API, SE_ROUTE, seKeys, type Purpose, type StockEntryListItem } from "@/lib/inventory";
import { DataTable } from "@/components/ui/data-table";

type Tab = "all" | DocumentStatus;

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Posted" },
  { value: "cancelled", label: "Cancelled" },
];

export default function StockEntriesPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("all");
  const [purpose, setPurpose] = useState<Purpose | "">("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const filters = { status: tab === "all" ? undefined : tab, purpose: purpose || undefined, q: search || undefined };

  const list = useInfiniteQuery({
    queryKey: seKeys.list(filters),
    queryFn: ({ pageParam }) => api<{ items: StockEntryListItem[]; nextCursor: string | null }>(SE_API, { query: { ...filters, limit: 50, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Stock entries"
        description="Opening stock, receipts, issues, transfers and adjustments. Stock moves when an entry is approved; cancelling reverses it."
        actions={
          can("inventory.entries.manage") && (
            <Link href={`${SE_ROUTE}/new`}>
              <Button>
                <Plus className="size-4" aria-hidden /> New stock entry
              </Button>
            </Link>
          )
        }
      />

      <Card>
        <div className="border-b border-border px-4 py-2.5">
          <SavedViews
            entity="stock_entries"
            current={{ tab, purpose, search }}
            onApply={(f) => {
              setTab((f.tab as Tab) ?? "all");
              setPurpose((f.purpose as Purpose) ?? "");
              setSearch((f.search as string) ?? "");
              setQ((f.search as string) ?? "");
            }}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3 px-4 pt-3">
          <div className="min-w-0 flex-1">
            <Tabs tabs={TABS} value={tab} onChange={setTab} />
          </div>
          <Select className="mb-2 w-full sm:w-48" aria-label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose | "")}>
            <option value="">All purposes</option>
            {Object.entries(PURPOSE_META).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </Select>
          <form
            className="relative mb-2 w-full sm:w-64"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9" placeholder="Number, title or reference" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stock entries" />
          </form>
        </div>

        {list.isLoading && <LoadingBlock />}
        {list.error && (
          <div className="p-5">
            <ErrorBlock error={list.error} />
          </div>
        )}
        {list.data && items.length === 0 && (
          <EmptyState
            title={search || purpose ? "No matching stock entries" : "No stock entries yet"}
            description={search || purpose ? "Try a different filter." : "Start with an opening stock entry for each warehouse."}
          />
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <DataTable
              rows={items}
              hasMore={list.hasNextPage}
              loadingMore={list.isFetchingNextPage}
              onLoadMore={() => void list.fetchNextPage()}
              rowKey={(r) => String(r.id)}
              exportName="inventory-stock-entries"
              storageKey="inventory-stock-entries-0"
              columns={[
                { key: "number", label: "Number", locked: true, render: (r) => <><Link href={`${SE_ROUTE}/${r.id}`} className="font-medium text-primary hover:underline">
                                      {r.number ?? "Draft"}
                                    </Link></> },
                { key: "date", label: "Date", className: "text-muted", render: (r) => <>{formatDate(r.docDate)}</> },
                { key: "purpose", label: "Purpose", render: (r) => <><Badge>{r.purposeLabel}</Badge></> },
                { key: "items", label: "Items", className: "max-w-xs whitespace-normal", render: (r) => <><p className="truncate">{r.title}</p>
                                    <p className="truncate text-xs text-muted">
                                      {r.createdBy}
                                      {r.reference && ` · Ref ${r.reference}`}
                                    </p></> },
                { key: "warehouse", label: "Warehouse", className: "text-muted", render: (r) => <><span className="inline-flex items-center gap-1">
                                      {r.fromWarehouse?.code}
                                      {r.fromWarehouse && r.toWarehouse && <ArrowRight className="size-3.5" aria-label="to" />}
                                      {r.toWarehouse?.code}
                                    </span></> },
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
