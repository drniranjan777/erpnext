"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Alert } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { PROC, type Formula } from "@/lib/process";
import { FormulaForm } from "../../formula-form";

export default function EditFormulaPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: [`${PROC}/formulas`, id], queryFn: () => api<Formula>(`${PROC}/formulas/${id}`) });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={q.data ? `Edit ${q.data.item.code} v${q.data.formulaVersion}` : "Edit formula"} />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && !q.data.can.edit && <Alert tone="warning">This formula is approved. Make a new version to change it.</Alert>}
      {q.data?.can.edit && <FormulaForm existing={q.data} />}
    </div>
  );
}
