"use client";

import { PageHeader } from "@/components/ui/page";
import { WorkOrderForm } from "../work-order-form";

export default function NewWorkOrderPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="New work order" description="Materials and operations are taken from the BOM. Release it when you are ready to start." />
      <WorkOrderForm />
    </div>
  );
}
