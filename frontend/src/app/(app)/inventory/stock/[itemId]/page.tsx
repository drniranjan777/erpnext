"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatQty, todayIST } from "@/lib/documents";
import { INVENTORY_KEY, type ItemStock, type LedgerRow } from "@/lib/inventory";
import { WAREHOUSE_TYPES } from "@/lib/masters";
import { LedgerTable } from "../../ledger/ledger-table";

export default function ItemStockPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const data = useQuery({ queryKey: [...INVENTORY_KEY, "item-stock", itemId], queryFn: () => api<ItemStock>(`/inventory/stock/${itemId}`) });
  const ledger = useQuery({
    queryKey: [...INVENTORY_KEY, "ledger", { itemId }],
    queryFn: () => api<{ items: LedgerRow[] }>("/inventory/ledger", { query: { itemId, limit: 50 } }),
  });

  if (data.isLoading) return <LoadingBlock />;
  if (data.error) return <ErrorBlock error={data.error} />;
  const { item, byWarehouse, byBatch } = data.data!;
  const totalQty = byWarehouse.reduce((s, w) => s + Number(w.qty), 0);
  const totalValue = byWarehouse.reduce((s, w) => s + Number(w.value), 0);
  const today = todayIST();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <Link href="/inventory/stock" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Stock levels
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{item.name}</h1>
          <span className="font-mono text-sm text-muted">{item.code}</span>
          <Badge>{item.valuationMethod === "fifo" ? "FIFO" : "Weighted average"}</Badge>
          {item.trackBatch && <Badge>Batches</Badge>}
          {item.trackSerial && <Badge>Serials</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted">
          {formatQty(totalQty)} {item.uom} on hand · {formatMoney(totalValue)}
          {item.reorderLevel && ` · reorder at ${formatQty(item.reorderLevel)}`} ·{" "}
          <Link href={`/masters/items/${item.id}`} className="text-primary hover:underline">
            Item master
          </Link>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="By warehouse" />
          {byWarehouse.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">No stock in any warehouse.</p>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Warehouse</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Rate</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byWarehouse.map((w) => (
                  <tr key={w.warehouseId}>
                    <td className="px-4 py-2">
                      {w.code} · {w.name}
                      {!w.isNettable && (
                        <Badge tone="warning" className="ml-2">
                          {WAREHOUSE_TYPES[w.type as keyof typeof WAREHOUSE_TYPES] ?? w.type}
                        </Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatQty(w.qty)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-muted">{w.valuationRate ? formatMoney(w.valuationRate) : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatMoney(w.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>

        {item.trackBatch && (
          <Card>
            <CardHeader title="By batch" description="Earliest expiry first" />
            {byBatch.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No batches in stock.</p>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Batch</th>
                    <th className="px-4 py-2 font-medium">Warehouse</th>
                    <th className="px-4 py-2 text-right font-medium">Qty</th>
                    <th className="px-4 py-2 font-medium">Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {byBatch.map((b) => (
                    <tr key={`${b.batchId}-${b.warehouseId}`}>
                      <td className="px-4 py-2 font-mono text-xs">{b.batchNo}</td>
                      <td className="px-4 py-2">{b.warehouseCode}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatQty(b.qty)}</td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {formatDate(b.expiryDate)}
                        {b.expiryDate && b.expiryDate < today && (
                          <Badge tone="danger" className="ml-2">
                            Expired
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </Card>
        )}
      </div>

      <Card>
        <CardHeader
          title="Recent movements"
          action={
            <Link href={`/inventory/ledger?itemId=${item.id}`} className="text-sm text-primary hover:underline">
              Full ledger
            </Link>
          }
        />
        {ledger.isLoading ? <LoadingBlock /> : <LedgerTable rows={ledger.data?.items ?? []} hideItem />}
      </Card>
    </div>
  );
}
