"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { INVENTORY_KEY, SE_ROUTE, type ExpiringBatch, type StockLevel } from "@/lib/inventory";
import { useItemGroups, useWarehouses } from "@/lib/masters";

export default function StockLevelsPage() {
  const { can } = useAuth();
  const warehouses = useWarehouses();
  const groups = useItemGroups();
  const [warehouseId, setWarehouseId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [belowReorder, setBelowReorder] = useState(false);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const filters = { warehouseId: warehouseId || undefined, groupId: groupId || undefined, q: search || undefined, belowReorder: belowReorder ? "true" : undefined };

  const levels = useQuery({
    queryKey: [...INVENTORY_KEY, "levels", filters],
    queryFn: () => api<{ items: StockLevel[]; totals: { value: string; items: number } }>("/inventory/stock", { query: { ...filters, limit: 500 } }),
  });
  const expiring = useQuery({
    queryKey: [...INVENTORY_KEY, "expiring", 30, warehouseId],
    queryFn: () => api<ExpiringBatch[]>("/inventory/batches/expiring", { query: { days: 30, warehouseId: warehouseId || undefined } }),
  });
  const rows = levels.data?.items ?? [];
  const reorderCount = rows.filter((r) => r.belowReorder).length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Stock levels"
        description="On-hand quantity and value by item. Available excludes quarantine, rejected and transit stores."
        actions={
          can("inventory.entries.manage") && (
            <Link href={`${SE_ROUTE}/new`}>
              <Button>
                <Plus className="size-4" aria-hidden /> Stock entry
              </Button>
            </Link>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Stock value" value={levels.data ? formatMoney(levels.data.totals.value) : "—"} />
        <Stat label="Items in stock" value={levels.data ? String(levels.data.totals.items) : "—"} />
        <Stat label="Expiring in 30 days" value={expiring.data ? String(expiring.data.length) : "—"} tone={expiring.data?.length ? "warning" : undefined} />
      </div>

      {!!expiring.data?.length && (
        <Card>
          <CardHeader title="Batches expiring soon" description="Use these first (FEFO), or move expired stock to a scrap / rejected store." />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 font-medium">Batch</th>
                  <th className="px-4 py-2 font-medium">Warehouse</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 font-medium">Expiry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {expiring.data.slice(0, 20).map((b) => (
                  <tr key={`${b.itemId}-${b.batchNo}-${b.warehouseId}`}>
                    <td className="px-4 py-2">
                      <Link href={`/inventory/stock/${b.itemId}`} className="hover:underline">
                        <span className="font-mono text-xs text-muted">{b.itemCode}</span> {b.itemName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{b.batchNo}</td>
                    <td className="px-4 py-2">{b.warehouseCode}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                      {formatQty(b.qty)} {b.uom}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {formatDate(b.expiryDate)} <Badge tone={b.daysLeft < 0 ? "danger" : "warning"}>{b.daysLeft < 0 ? "Expired" : `${b.daysLeft} days`}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Select className="w-full sm:w-52" aria-label="Warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">All warehouses</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </Select>
          <Select className="w-full sm:w-44" aria-label="Item group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">All groups</option>
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          <Checkbox label="Below reorder level" checked={belowReorder} onChange={(e) => setBelowReorder(e.target.checked)} />
          <form
            className="relative w-full sm:ml-auto sm:w-64"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9" placeholder="Item name or code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
          </form>
        </div>

        {levels.isLoading && <LoadingBlock />}
        {levels.error && (
          <div className="p-5">
            <ErrorBlock error={levels.error} />
          </div>
        )}
        {levels.data && rows.length === 0 && (
          <EmptyState
            title={belowReorder ? "Nothing below reorder level" : search || warehouseId || groupId ? "No stock matches" : "No stock yet"}
            description={belowReorder ? "Items appear here when available stock falls to their reorder level." : "Post an opening stock entry to get started."}
          />
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            {reorderCount > 0 && !belowReorder && (
              <p className="flex items-center gap-2 border-y border-border bg-warning-soft px-4 py-2 text-sm">
                <AlertTriangle className="size-4 text-warning" aria-hidden /> {reorderCount} item{reorderCount === 1 ? " is" : "s are"} at or below reorder level.
              </p>
            )}
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Group</th>
                  <th className="px-4 py-2.5 text-right font-medium">On hand</th>
                  <th className="px-4 py-2.5 text-right font-medium">Available</th>
                  <th className="px-4 py-2.5 text-right font-medium">Reorder at</th>
                  <th className="px-4 py-2.5 text-right font-medium">Avg rate</th>
                  <th className="px-4 py-2.5 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.itemId} className="hover:bg-surface-muted/60">
                    <td className="px-4 py-2.5">
                      <Link href={`/inventory/stock/${r.itemId}`} className="font-medium text-primary hover:underline">
                        {r.name}
                      </Link>
                      <p className="font-mono text-xs text-muted">{r.code}</p>
                    </td>
                    <td className="px-4 py-2.5 text-muted">{r.group ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                      {formatQty(r.qty)} <span className="text-xs text-muted">{r.uom}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                      {formatQty(r.available)}
                      {r.belowReorder && (
                        <Badge tone="warning" className="ml-2">
                          Reorder{r.suggestedOrderQty ? ` ${formatQty(r.suggestedOrderQty)}` : ""}
                        </Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted">{r.reorderLevel ? formatQty(r.reorderLevel) : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted">{r.valuationRate ? formatMoney(r.valuationRate) : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatMoney(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "warning" ? "text-warning" : ""}`}>{value}</p>
    </Card>
  );
}
