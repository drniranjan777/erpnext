"use client";

import { PageHeader } from "@/components/ui/page";
import { FormulaForm } from "../formula-form";

export default function NewFormulaPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="New formula" description="The recipe for one product: ingredients, outputs and the process stages." />
      <FormulaForm />
    </div>
  );
}
