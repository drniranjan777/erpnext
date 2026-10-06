"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Barcode, Plus, Search, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
} from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney, formatQty } from "@/lib/documents";
import { ITEM_TYPES, useItemGroups, type ItemListRow } from "@/lib/masters";

export default function ItemsPage() {
  const { can } = useAuth();
  const groups = useItemGroups();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [groupId, setGroupId] = useState("");
  const [active, setActive] = useState("true");
  const filters = {
    q: search || undefined,
    type: type || undefined,
    groupId: groupId || undefined,
    active,
  };

  const list = useInfiniteQuery({
    queryKey: ["masters", "items", filters],
    queryFn: ({ pageParam }) =>
      api<{ items: ItemListRow[]; nextCursor: string | null }>(
        "/masters/items",
        { query: { ...filters, limit: 50, cursor: pageParam } },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Items"
        description="Raw materials, components, finished goods, consumables and services, with HSN, GST, units and stock rules."
        actions={
          <>
            <Link href="/print/labels" target="_blank">
              <Button variant="ghost">
                <Barcode className="size-4" aria-hidden /> Labels
              </Button>
            </Link>
            {can("masters.items.manage") && (
              <>
                <Link href="/masters/import">
                  <Button variant="secondary">
                    <Upload className="size-4" aria-hidden /> Import
                  </Button>
                </Link>
                <Link href="/masters/items/new">
                  <Button>
                    <Plus className="size-4" aria-hidden /> New item
                  </Button>
                </Link>
              </>
            )}
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-border p-3">
          <form
            className="relative min-w-60 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
            }}
          >
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              className="pl-9"
              placeholder="Name, code, HSN or barcode"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search items"
            />
          </form>
          <Select
            className="w-auto"
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Item type"
          >
            <option value="">All types</option>
            {Object.entries(ITEM_TYPES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select
            className="w-auto"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            aria-label="Item group"
          >
            <option value="">All groups</option>
            {groups.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          <Select
            className="w-auto"
            value={active}
            onChange={(e) => setActive(e.target.value)}
            aria-label="Status"
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
            <option value="all">All</option>
          </Select>
        </div>
        {list.isLoading && <LoadingBlock />}
        {list.error && (
          <div className="p-5">
            <ErrorBlock error={list.error} />
          </div>
        )}
        {list.data && !rows.length && (
          <EmptyState
            title={
              search || type || groupId ? "No matching items" : "No items yet"
            }
            description="Add items one by one, or import your item list from Tally / Excel (coming in Sprint 2.3)."
          />
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Code</th>
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">HSN</th>
                  <th className="px-4 py-2.5 text-right font-medium">GST</th>
                  <th className="px-4 py-2.5 font-medium">Unit</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Reorder at
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Selling rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-muted/60">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/masters/items/${r.id}`}
                        className="font-mono font-medium text-primary hover:underline"
                      >
                        {r.code}
                      </Link>
                    </td>
                    <td className="max-w-sm px-4 py-3">
                      <p className="truncate">{r.name}</p>
                      <p className="flex flex-wrap gap-1 text-xs text-muted">
                        {r.group}
                        {r.trackBatch && <Badge>Batch</Badge>}
                        {r.trackSerial && <Badge>Serial</Badge>}
                        {!r.isStockItem && <Badge>Non-stock</Badge>}
                        {!r.isActive && <Badge tone="warning">Inactive</Badge>}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {ITEM_TYPES[r.type]}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.hsnCode ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.gstRate !== null ? `${Number(r.gstRate)}%` : "—"}
                    </td>
                    <td className="px-4 py-3">{r.baseUom}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.reorderLevel ? formatQty(r.reorderLevel) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.sellingRate ? formatMoney(r.sellingRate) : "—"}
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
