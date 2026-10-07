"use client";

import { DeviationForm } from "@/components/quality/deviation-form";
import { PageHeader } from "@/components/ui/page";

export default function NewDeviationPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="New deviation" />
      <DeviationForm />
    </div>
  );
}
