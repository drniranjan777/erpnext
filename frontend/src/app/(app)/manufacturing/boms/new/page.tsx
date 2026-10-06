"use client";

import { PageHeader } from "@/components/ui/page";
import { BomForm } from "../bom-form";

export default function NewBomPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="New bill of materials" description="Components, by-products and the routing for one item." />
      <BomForm />
    </div>
  );
}
