"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge, Tabs } from "@/components/documents/document-parts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
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

/**
 * Standard document list: header with a "new" button, tabs, optional search, a table whose
 * first column links to the document, the status badge last, and "load more" paging.
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
  const [tab, setTab] = useState(tabs[0].value);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const query = { ...tabs.find((t) => t.value === tab)!.query, q: search || undefined };
  const list = useInfiniteQuery({
    queryKey: [queryKey, "list", query],
    queryFn: ({ pageParam }) => api<{ items: T[]; nextCursor: string | null }>(apiPath, { query: { ...query, limit: 50, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

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
      <Card>
        <div className="flex flex-wrap items-end gap-3 px-4 pt-3">
          <div className="min-w-0 flex-1">
            <Tabs tabs={tabs.map((t) => ({ value: t.value, label: t.label }))} value={tab} onChange={setTab} />
          </div>
          {searchPlaceholder && (
            <form
              className="relative mb-2 w-full sm:w-72"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(q.trim());
              }}
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input className="pl-9" placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${title.toLowerCase()}`} />
            </form>
          )}
        </div>
        {list.isLoading && <LoadingBlock />}
        {list.error && (
          <div className="p-5">
            <ErrorBlock error={list.error} />
          </div>
        )}
        {list.data && items.length === 0 && <EmptyState title={search ? "Nothing matches" : empty.title} description={search ? "Try another search." : empty.description} />}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  {columns.map((c) => (
                    <th key={c.label} className={`px-4 py-2.5 font-medium ${c.align === "right" ? "text-right" : ""}`}>
                      {c.label}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-muted/60">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={`${route}/${r.id}`} className="font-medium text-primary hover:underline">
                        {r.number ?? "Draft"}
                      </Link>
                    </td>
                    {columns.map((c) => (
                      <td key={c.label} className={`px-4 py-3 ${c.align === "right" ? "whitespace-nowrap text-right tabular-nums" : ""}`}>
                        {c.render(r)}
                      </td>
                    ))}
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
