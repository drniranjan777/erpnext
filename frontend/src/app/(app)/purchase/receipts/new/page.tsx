"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { EmptyState, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/documents";
import { GRN_ROUTE, PO_API, type PoListItem } from "@/lib/purchase";
import { GrnForm } from "../grn-form";

export default function NewGoodsReceiptPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <NewGrn />
    </Suspense>
  );
}

function NewGrn() {
  const po = useSearchParams().get("po");
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Receive goods" description="Record what arrived against a purchase order. Accepted quantity goes into stock when the GRN is posted." />
      {po ? <GrnForm poId={po} /> : <PickOrder />}
    </div>
  );
}

/** Approved orders with quantity still to receive. */
function PickOrder() {
  const list = useInfiniteQuery({
    queryKey: ["/purchase/orders", "list", { pendingReceipt: "true" }],
    queryFn: ({ pageParam }) => api<{ items: PoListItem[]; nextCursor: string | null }>(PO_API, { query: { pendingReceipt: "true", limit: 50, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  if (list.isLoading) return <LoadingBlock />;
  return (
    <Card>
      {!items.length ? (
        <EmptyState title="No orders waiting for goods" description="Approved purchase orders with quantity still to receive appear here." />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((o) => (
            <li key={o.id}>
              <Link href={`${GRN_ROUTE}/new?po=${o.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-surface-muted/60">
                <span className="font-medium text-primary">{o.number}</span>
                <span className="min-w-0 flex-1 truncate">{o.vendor.name}</span>
                <span className="text-sm text-muted">Expected {formatDate(o.expectedDate)}</span>
                <span className="text-sm tabular-nums text-muted">{o.receivedPct}% received</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
