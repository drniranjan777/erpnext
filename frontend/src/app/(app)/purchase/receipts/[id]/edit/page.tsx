"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Alert } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { GRN_API, grnKeys, type GoodsReceipt } from "@/lib/purchase";
import { GrnForm } from "../../grn-form";

export default function EditGoodsReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const grn = useQuery({ queryKey: grnKeys.detail(id), queryFn: () => api<GoodsReceipt>(`${GRN_API}/${id}`) });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={grn.data ? `Edit ${grn.data.displayNumber}` : "Edit goods receipt"} />
      {grn.isLoading && <LoadingBlock />}
      {grn.error && <ErrorBlock error={grn.error} />}
      {grn.data && !grn.data.can.edit && <Alert tone="warning">This receipt can no longer be edited.</Alert>}
      {grn.data?.can.edit && <GrnForm poId={grn.data.purchaseOrder.id} existing={grn.data} />}
    </div>
  );
}
