"use client";

import { ChangeForm } from "@/components/engineering/change-form";
import { PageHeader } from "@/components/ui/page";

export default function NewChangePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="New engineering change" description="Describe the change and the items it touches. You will see its impact on stock and open orders before you submit it for approval." />
      <ChangeForm />
    </div>
  );
}
