"use client";

import { SopForm } from "@/components/quality/sop-form";
import { PageHeader } from "@/components/ui/page";

export default function NewSopPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="New SOP" />
      <SopForm />
    </div>
  );
}
