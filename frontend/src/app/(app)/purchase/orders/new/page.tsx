"use client";

import { PageHeader } from "@/components/ui/page";
import { PoForm } from "../po-form";

export default function NewPurchaseOrderPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="New purchase order" description="Saved as a draft until you submit it for approval." />
      <PoForm />
    </div>
  );
}
