"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { INVENTORY_KEY, type LedgerRow } from "@/lib/inventory";
import { useWarehouses, type Item } from "@/lib/masters";
import { LedgerTable } from "./ledger-table";

export default function LedgerPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Ledger />
    </Suspense>
  );
}

function Ledger() {
  const params = useSearchParams();
  const warehouses = useWarehouses();
  const [itemId, setItemId] = useState(params.get("itemId") ?? "");
  const [warehouseId, setWarehouseId] = useState(params.get("warehouseId") ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const item = useQuery({ queryKey: ["masters", "items", itemId], queryFn: () => api<Item>(`/masters/items/${itemId}`), enabled: !!itemId });
  const filters = { itemId: itemId || undefined, warehouseId: warehouseId || undefined, from: from || undefined, to: to || undefined };

  const ledger = useInfiniteQuery({
    queryKey: [...INVENTORY_KEY, "ledger", filters],
    queryFn: ({ pageParam }) => api<{ items: LedgerRow[]; nextCursor: string | null }>("/inventory/ledger", { query: { ...filters, limit: 100, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = ledger.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Stock ledger" description="Every stock movement, newest first. Entries are never edited: cancellations appear as reversal rows." />
      <Card>
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Item">
            {() =>
              itemId ? (
                <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-border px-3 text-sm">
                  <span className="truncate">{item.data ? `${item.data.code} · ${item.data.name}` : "Loading…"}</span>
                  <button type="button" onClick={() => setItemId("")} aria-label="Clear item" className="text-muted hover:text-foreground">
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <ItemPicker stockOnly onPick={(it) => setItemId(it.id)} placeholder="All items" />
              )
            }
          </Field>
          <Field label="Warehouse">
            {(p) => (
              <Select {...p} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">All warehouses</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="From">{(p) => <Input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="To">{(p) => <Input {...p} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
        {ledger.isLoading && <LoadingBlock />}
        {ledger.error && (
          <div className="p-5">
            <ErrorBlock error={ledger.error} />
          </div>
        )}
        {ledger.data && <LedgerTable rows={rows} hideItem={!!itemId} />}
        {ledger.hasNextPage && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="secondary" size="sm" loading={ledger.isFetchingNextPage} onClick={() => ledger.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
