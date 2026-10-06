"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Alert } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { PI_API, piKeys, type PurchaseInvoice } from "@/lib/purchase";
import { PiForm } from "../../pi-form";

export default function EditPurchaseInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const pi = useQuery({ queryKey: piKeys.detail(id), queryFn: () => api<PurchaseInvoice>(`${PI_API}/${id}`) });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={pi.data ? `Edit ${pi.data.displayNumber}` : "Edit bill"} />
      {pi.isLoading && <LoadingBlock />}
      {pi.error && <ErrorBlock error={pi.error} />}
      {pi.data && !pi.data.can.edit && <Alert tone="warning">This bill can no longer be edited.</Alert>}
      {pi.data?.can.edit && <PiForm existing={pi.data} />}
    </div>
  );
}
