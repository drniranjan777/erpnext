"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { CapaForm } from "@/components/quality/capa-form";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { QA, type Capa } from "@/lib/quality";

export default function EditCapaPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: [QA, "capas", id], queryFn: () => api<Capa>(`${QA}/capas/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Edit ${q.data!.displayNumber}`} />
      <CapaForm capa={q.data!} />
    </div>
  );
}
