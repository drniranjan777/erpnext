"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { SopForm } from "@/components/quality/sop-form";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { QMS, type Sop } from "@/lib/qms";

export default function EditSopPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: [QMS, "sops", id], queryFn: () => api<Sop>(`${QMS}/sops/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Edit ${q.data!.sopCode} v${q.data!.sopVersion}`} />
      <SopForm sop={q.data!} />
    </div>
  );
}
