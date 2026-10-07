"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { ChangeForm } from "@/components/engineering/change-form";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { ENG, type Change } from "@/lib/engineering";

export default function EditChangePage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: [ENG, "changes", id], queryFn: () => api<Change>(`${ENG}/changes/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Edit ${q.data!.displayNumber}`} />
      <ChangeForm change={q.data!} />
    </div>
  );
}
