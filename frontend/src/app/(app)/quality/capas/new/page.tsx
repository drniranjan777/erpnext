"use client";

import { CapaForm } from "@/components/quality/capa-form";
import { PageHeader } from "@/components/ui/page";

export default function NewCapaPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="New CAPA" description="NCRs and customer complaints can raise a CAPA directly." />
      <CapaForm />
    </div>
  );
}
