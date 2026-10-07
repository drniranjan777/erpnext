"use client";

import { DrawingForm } from "@/components/engineering/drawing-form";
import { PageHeader } from "@/components/ui/page";

export default function NewDrawingPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="New drawing" />
      <DrawingForm />
    </div>
  );
}
