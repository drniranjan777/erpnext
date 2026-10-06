"use client";

import { PageHeader } from "@/components/ui/page";
import { RequisitionForm } from "../requisition-form";

export default function NewRequisitionPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="New purchase requisition" description="Saved as a draft until you submit it for approval." />
      <RequisitionForm />
    </div>
  );
}
