"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Alert } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { MFG, type WorkOrder } from "@/lib/manufacturing";
import { WorkOrderForm } from "../../work-order-form";

export default function EditWorkOrderPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: [`${MFG}/work-orders`, id],
    queryFn: () => api<WorkOrder>(`${MFG}/work-orders/${id}`),
  });
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={q.data ? `Edit ${q.data.displayNumber}` : "Edit work order"} />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && !q.data.can.edit && <Alert tone="warning">This work order has been released and can no longer be edited.</Alert>}
      {q.data?.can.edit && <WorkOrderForm existing={q.data} />}
    </div>
  );
}
