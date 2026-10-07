"use client";

import { NcrForm } from "@/components/quality/ncr-form";
import { PageHeader } from "@/components/ui/page";

export default function NewNcrPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="New non-conformance report" description="Rejected inspection lots can raise an NCR straight from the inspection." />
      <NcrForm />
    </div>
  );
}
