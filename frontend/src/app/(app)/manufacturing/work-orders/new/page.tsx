"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import type { WorkOrder } from "@/lib/manufacturing";
import { WorkOrderForm } from "../work-order-form";

export default function NewWorkOrderPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="New work order" description="Materials and operations come from the BOM (or the formula, for a process batch). Release it when you are ready to start." />
      <Suspense fallback={<LoadingBlock />}>
        <Prefilled />
      </Suspense>
    </div>
  );
}

/** ?kind=batch&item=… (from a formula page) pre-fills the form. */
function Prefilled() {
  const search = useSearchParams();
  const kind = search.get("kind") === "batch" ? ("batch" as WorkOrder["kind"]) : undefined;
  const itemId = search.get("item");
  const item = useQuery({ queryKey: ["masters", "items", itemId], queryFn: () => api<{ id: string; code: string; name: string }>(`/masters/items/${itemId}`), enabled: !!itemId });
  if (itemId && item.isLoading) return <LoadingBlock />;
  return <WorkOrderForm initial={{ kind, item: item.data ? { id: item.data.id, label: `${item.data.code} ${item.data.name}` } : undefined }} />;
}
