"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import type { Party } from "@/lib/masters";
import { InvoiceForm } from "../invoice-form";

export default function NewSalesInvoicePage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <NewInvoice />
    </Suspense>
  );
}

function NewInvoice() {
  const params = useSearchParams();
  const customerId = params.get("customer");
  const customer = useQuery({ queryKey: ["masters", "parties", customerId], queryFn: () => api<Party>(`/masters/parties/${customerId}`), enabled: !!customerId });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="New invoice" description="Bill posted deliveries, order lines (services, or goods sent with the invoice), or a direct sale." />
      {customerId && customer.isLoading ? (
        <LoadingBlock />
      ) : (
        <InvoiceForm
          prefill={{
            customer: customer.data ? { id: customer.data.id, code: customer.data.code, name: customer.data.name, gstin: customer.data.gstin, stateCode: customer.data.stateCode ?? null, creditDays: customer.data.creditDays } : undefined,
            orderId: params.get("order") ?? undefined,
            deliveryId: params.get("delivery") ?? undefined,
          }}
        />
      )}
    </div>
  );
}
