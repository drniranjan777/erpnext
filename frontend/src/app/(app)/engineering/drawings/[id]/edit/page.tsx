"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { DrawingForm } from "@/components/engineering/drawing-form";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { ENG, type Drawing } from "@/lib/engineering";

export default function EditDrawingPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: [ENG, "drawings", id], queryFn: () => api<Drawing>(`${ENG}/drawings/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={`Edit ${q.data!.drawingNo} rev ${q.data!.drawingRevision}`} />
      <DrawingForm drawing={q.data!} />
    </div>
  );
}
