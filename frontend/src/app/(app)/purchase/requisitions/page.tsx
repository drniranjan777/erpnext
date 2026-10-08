"use client";

import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge, Tabs } from "@/components/documents/document-parts";
import { SavedViews } from "@/components/saved-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { Alert } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, type DocumentStatus } from "@/lib/documents";
import { PR_API, PR_ROUTE, PRIORITY_META, prKeys, type RequisitionListItem } from "@/lib/purchase";
import { DataTable } from "@/components/ui/data-table";

type Tab = "all" | "mine" | DocumentStatus;

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mine", label: "Mine" },
  { value: "draft", label: "Drafts" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

export default function RequisitionsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const filters = { status: tab === "all" || tab === "mine" ? undefined : tab, mine: tab === "mine" ? "true" : undefined, q: search || undefined };

  const list = useInfiniteQuery({
    queryKey: prKeys.list(filters),
    queryFn: ({ pageParam }) =>
      api<{ items: RequisitionListItem[]; nextCursor: string | null }>(PR_API, { query: { ...filters, limit: 50, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const router = useRouter();
  // Draft requisition for every item at or below its reorder level (net of stock on order).
  const reorder = useMutation({
    mutationFn: () => api<{ id: string }>(`${PR_API}/from-reorder`, { body: {} }),
    onSuccess: (pr) => router.push(`${PR_ROUTE}/${pr.id}`),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Purchase requisitions"
        description="Internal requests to buy materials and services, routed for approval before a purchase order is raised."
        actions={
          can("purchase.requisitions.manage") && (
            <>
              <Button variant="secondary" loading={reorder.isPending} onClick={() => reorder.mutate()}>
                <RefreshCw className="size-4" aria-hidden /> From reorder list
              </Button>
              <Link href={`${PR_ROUTE}/new`}>
                <Button>
                  <Plus className="size-4" aria-hidden /> New requisition
                </Button>
              </Link>
            </>
          )
        }
      />

      {reorder.error && <Alert tone={reorder.error instanceof ApiError && reorder.error.status === 409 ? "success" : "danger"}>{reorder.error instanceof ApiError ? reorder.error.message : "Could not check the reorder list."}</Alert>}
      <Card>
        <div className="border-b border-border px-4 py-2.5">
          <SavedViews
            entity="purchase_requisitions"
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
            className="relative mb-2 w-full sm:w-64"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9" placeholder="Search number or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search requisitions" />
          </form>
        </div>

        {list.isLoading && <LoadingBlock />}
        {list.error && <div className="p-5"><ErrorBlock error={list.error} /></div>}
        {list.data && items.length === 0 && (
          <EmptyState
            title={search ? "No matching requisitions" : "No requisitions yet"}
            description={search ? "Try a different number or word." : "Create one when your team needs materials or services."}
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
              exportName="purchase-requisitions"
              storageKey="purchase-requisitions-0"
              columns={[
                { key: "number", label: "Number", locked: true, render: (r) => <><Link href={`${PR_ROUTE}/${r.id}`} className="font-medium text-primary hover:underline">
                                      {r.number ? `${r.number}${r.revision ? ` (Rev ${r.revision})` : ""}` : "Draft"}
                                    </Link></> },
                { key: "date", label: "Date", className: "text-muted", render: (r) => <>{formatDate(r.docDate)}</> },
                { key: "title", label: "Title", className: "max-w-xs whitespace-normal", render: (r) => <><p className="truncate">{r.title}</p>
                                    <p className="truncate text-xs text-muted">
                                      {r.createdBy}
                                      {r.department && ` · ${r.department}`}
                                    </p></> },
                { key: "priority", label: "Priority", className: "whitespace-normal", render: (r) => <><Badge tone={PRIORITY_META[r.priority].tone}>{PRIORITY_META[r.priority].label}</Badge></> },
                { key: "required-by", label: "Required by", className: "text-muted", render: (r) => <>{formatDate(r.requiredBy)}</> },
                { key: "est-value", label: "Est. value", align: "right", render: (r) => <>{formatMoney(r.amount)}</> },
                { key: "status", label: "Status", className: "whitespace-normal", render: (r) => <><StatusBadge status={r.status} /></> },
              ]}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
