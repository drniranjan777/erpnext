"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Alert } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { PO_API, poKeys, type PurchaseOrder } from "@/lib/purchase";
import { PoForm } from "../../po-form";

export default function EditPurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const po = useQuery({ queryKey: poKeys.detail(id), queryFn: () => api<PurchaseOrder>(`${PO_API}/${id}`) });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={po.data ? `Edit ${po.data.displayNumber}` : "Edit purchase order"} />
      {po.isLoading && <LoadingBlock />}
      {po.error && <ErrorBlock error={po.error} />}
      {po.data && !po.data.can.edit && <Alert tone="warning">This order can no longer be edited. Amend it instead.</Alert>}
      {po.data?.can.edit && <PoForm existing={po.data} />}
    </div>
  );
}
