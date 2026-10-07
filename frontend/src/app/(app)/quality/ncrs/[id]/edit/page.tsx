"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { NcrForm } from "@/components/quality/ncr-form";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { QA, type Ncr } from "@/lib/quality";

export default function EditNcrPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: [QA, "ncrs", id], queryFn: () => api<Ncr>(`${QA}/ncrs/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Edit ${q.data!.displayNumber}`} />
      <NcrForm ncr={q.data!} />
    </div>
  );
}
