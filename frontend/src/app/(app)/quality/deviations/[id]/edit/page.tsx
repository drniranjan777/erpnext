"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { DeviationForm } from "@/components/quality/deviation-form";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { QMS, type Deviation } from "@/lib/qms";

export default function EditDeviationPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: [QMS, "deviations", id], queryFn: () => api<Deviation>(`${QMS}/deviations/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Edit ${q.data!.displayNumber}`} />
      <DeviationForm deviation={q.data!} />
    </div>
  );
}
