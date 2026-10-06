"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Alert } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { MFG, type Bom } from "@/lib/manufacturing";
import { BomForm } from "../../bom-form";

export default function EditBomPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: [`${MFG}/boms`, id], queryFn: () => api<Bom>(`${MFG}/boms/${id}`) });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={q.data ? `Edit ${q.data.item.code} v${q.data.bomVersion}` : "Edit BOM"} />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && !q.data.can.edit && <Alert tone="warning">This BOM is approved. Make a new version to change it.</Alert>}
      {q.data?.can.edit && <BomForm existing={q.data} />}
    </div>
  );
}
