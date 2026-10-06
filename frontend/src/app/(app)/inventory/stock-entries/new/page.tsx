"use client";

import { PageHeader } from "@/components/ui/page";
import { StockEntryForm } from "../stock-entry-form";

export default function NewStockEntryPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="New stock entry" description="Saved as a draft. Stock moves when the entry is submitted and approved." />
      <StockEntryForm />
    </div>
  );
}
