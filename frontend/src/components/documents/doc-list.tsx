"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Plus, Search, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge, Tabs } from "@/components/documents/document-parts";
import { askConfirm } from "@/components/ui/ask";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { toast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { DocumentStatus } from "@/lib/documents";

export interface DocColumn<T> {
  label: string;
  align?: "right";
  render: (row: T) => React.ReactNode;
}

export interface DocTab {
  value: string;
  label: string;
  /** Query parameters this tab sends. */
  query: Record<string, string | undefined>;
}

const DEFAULT_TABS: DocTab[] = [
  { value: "all", label: "All", query: {} },
  { value: "draft", label: "Drafts", query: { status: "draft" } },
  { value: "pending_approval", label: "Pending approval", query: { status: "pending_approval" } },
  { value: "approved", label: "Posted", query: { status: "approved" } },
  { value: "cancelled", label: "Cancelled", query: { status: "cancelled" } },
];

const MAX_PAGES = 20;

/**
 * Standard document list: header with a "new" button, search, a date range, tabs, and a data
 * table (sort, columns, export, paging) whose first column links to the document and whose
 * last shows the status. Users who can create the document can submit drafts in bulk.
 */
export function DocList<T extends { id: string; number: string | null; status: DocumentStatus }>({
  title,
  description,
  apiPath,
  route,
  queryKey,
  columns,
  tabs = DEFAULT_TABS,
  newHref,
  newLabel,
  newPermission,
  searchPlaceholder,
  empty,
  actions,
}: {
  title: string;
  description: string;
  apiPath: string;
  route: string;
  queryKey: string;
  columns: DocColumn<T>[];
  tabs?: DocTab[];
  newHref?: string;
  newLabel?: string;
  newPermission?: string;
  searchPlaceholder?: string;
  empty: { title: string; description: string };
  actions?: React.ReactNode;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState(tabs[0].value);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = { ...tabs.find((t) => t.value === tab)!.query, q: search || undefined };
  const list = useInfiniteQuery({
    queryKey: [queryKey, "list", query],
    queryFn: ({ pageParam }) => api<{ items: T[]; nextCursor: string | null }>(apiPath, { query: { ...query, limit: 50, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const loaded = list.data?.pages.flatMap((p) => p.items) ?? [];
  const hasDates = loaded.some((r) => typeof (r as { docDate?: unknown }).docDate === "string");
  const dated = hasDates && (from || to);
  // The APIs page by recency, not by date: with a date filter, read on (up to 1,000 rows) so it covers the range.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  const pagesLoaded = list.data?.pages.length ?? 0;
  useEffect(() => {
    if (dated && hasNextPage && !isFetchingNextPage && pagesLoaded < MAX_PAGES) void fetchNextPage();
  }, [dated, hasNextPage, isFetchingNextPage, pagesLoaded, fetchNextPage]);
  const items = dated
    ? loaded.filter((r) => {
        const d = String((r as { docDate?: string }).docDate ?? "").slice(0, 10);
        return (!from || d >= from) && (!to || d <= to);
      })
    : loaded;
  const capped = dated && hasNextPage && pagesLoaded >= MAX_PAGES;
  const canBulk = !!newPermission && can(newPermission);

  async function submitDrafts(rows: T[], clear: () => void) {
    const drafts = rows.filter((r) => r.status === "draft");
    if (!(await askConfirm(`Submit ${drafts.length} draft${drafts.length === 1 ? "" : "s"} for approval?`))) return;
    let ok = 0;
    const failed: string[] = [];
    for (const r of drafts) {
      try {
        const doc = await api<{ version: number; can?: { submit?: boolean } }>(`${apiPath}/${r.id}`);
        if (doc.can && !doc.can.submit) throw new Error("not allowed");
        await api(`${apiPath}/${r.id}/submit`, { body: { version: doc.version } });
        ok++;
      } catch (err) {
        failed.push(`${r.number ?? "Draft"}${err instanceof ApiError ? `: ${err.message}` : ""}`);
      }
    }
    clear();
    void qc.invalidateQueries({ queryKey: [queryKey] });
    if (ok) toast(`${ok} submitted.`);
    if (failed.length) toast(`Could not submit ${failed.length}: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? "…" : ""}`, "danger");
  }

  const tableColumns: Column<T>[] = [
    {
      key: "number",
      label: "Number",
      locked: true,
      value: (r) => r.number ?? "Draft",
      render: (r) => (
        <Link href={`${route}/${r.id}`} className="font-medium whitespace-nowrap text-primary hover:underline">
          {r.number ?? "Draft"}
        </Link>
      ),
    },
    ...columns.map((c) => ({ key: c.label, label: c.label, align: c.align, render: c.render })),
    { key: "status", label: "Status", value: (r) => r.status, render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {actions}
            {newHref && (!newPermission || can(newPermission)) && (
              <Link href={newHref}>
                <Button>
                  <Plus className="size-4" aria-hidden /> {newLabel}
                </Button>
              </Link>
            )}
          </>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {searchPlaceholder && (
            <form
              className="relative w-full sm:w-72"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(q.trim());
              }}
            >
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input className="h-9 pl-9" placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${title.toLowerCase()}`} />
            </form>
          )}
          {hasDates && (
            <div className="flex items-center gap-1.5 text-sm text-muted">
              <CalendarRange className="size-4" aria-hidden />
              <Input type="date" className="h-9 w-[9.5rem]" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
              <span>to</span>
              <Input type="date" className="h-9 w-[9.5rem]" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
              {(from || to) && (
                <button
                  onClick={() => {
                    setFrom("");
                    setTo("");
                  }}
                  className="ml-1 text-sm text-primary hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
          )}
          {(search || dated) && <span className="text-xs text-muted">{dated && list.isFetchingNextPage ? "Reading more rows…" : capped ? "Showing matches in the latest 1,000" : "Filtered"}</span>}
        </div>
        {list.isLoading && <LoadingBlock />}
        {list.error && (
          <div className="p-5">
            <ErrorBlock error={list.error} />
          </div>
        )}
        {list.data && (
          <DataTable<T>
            key={`${tab}|${search}|${from}|${to}`}
            rows={items}
            rowKey={(r) => r.id}
            columns={tableColumns}
            storageKey={queryKey}
            exportName={title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
            toolbar={<Tabs tabs={tabs.map((t) => ({ value: t.value, label: t.label }))} value={tab} onChange={setTab} />}
            bulkActions={
              canBulk
                ? (sel, clear) =>
                    sel.some((r) => r.status === "draft") ? (
                      <Button size="sm" onClick={() => void submitDrafts(sel, clear)}>
                        <Send className="size-4" aria-hidden /> Submit drafts
                      </Button>
                    ) : null
                : () => null
            }
            hasMore={!dated && list.hasNextPage}
            loadingMore={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            empty={<EmptyState title={search || dated ? "Nothing matches" : empty.title} description={search || dated ? "Try another search or date range." : empty.description} />}
          />
        )}
      </Card>
    </div>
  );
}
