"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Alert } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { SE_API, seKeys, type StockEntry } from "@/lib/inventory";
import { StockEntryForm } from "../../stock-entry-form";

export default function EditStockEntryPage() {
  const { id } = useParams<{ id: string }>();
  const se = useQuery({ queryKey: seKeys.detail(id), queryFn: () => api<StockEntry>(`${SE_API}/${id}`) });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={se.data ? `Edit ${se.data.displayNumber}` : "Edit stock entry"} />
      {se.isLoading && <LoadingBlock />}
      {se.error && <ErrorBlock error={se.error} />}
      {se.data && !se.data.can.edit && <Alert tone="warning">This stock entry can no longer be edited.</Alert>}
      {se.data?.can.edit && <StockEntryForm existing={se.data} />}
    </div>
  );
}
