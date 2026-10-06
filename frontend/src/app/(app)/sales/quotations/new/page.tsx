"use client";

import { PageHeader } from "@/components/ui/page";
import { S } from "@/lib/sales";
import { SellingForm } from "../../_components/selling-form";

export default function NewQuotationPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="New quotation" description="Saved as a draft. Discount and margin rules decide whether it needs approval." />
      <SellingForm mode="quotation" api={S.quotations} />
    </div>
  );
}
