"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import type { Party } from "@/lib/masters";
import { PiForm } from "../pi-form";

export default function NewPurchaseInvoicePage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <NewPi />
    </Suspense>
  );
}

function NewPi() {
  const params = useSearchParams();
  const vendorId = params.get("vendor");
  const vendor = useQuery({ queryKey: ["masters", "parties", vendorId], queryFn: () => api<Party>(`/masters/parties/${vendorId}`), enabled: !!vendorId });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Enter vendor bill" description="Match the bill to what was received. Saved as a draft until you submit it." />
      {vendorId && vendor.isLoading ? (
        <LoadingBlock />
      ) : (
        <PiForm
          prefill={{
            vendor: vendor.data ? { id: vendor.data.id, code: vendor.data.code, name: vendor.data.name, gstin: vendor.data.gstin, stateCode: vendor.data.stateCode ?? null, creditDays: vendor.data.creditDays } : undefined,
            grnId: params.get("grn") ?? undefined,
          }}
        />
      )}
    </div>
  );
}
