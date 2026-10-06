"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Alert } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { PR_API, prKeys, type Requisition } from "@/lib/purchase";
import { RequisitionForm } from "../../requisition-form";

export default function EditRequisitionPage() {
  const { id } = useParams<{ id: string }>();
  const pr = useQuery({ queryKey: prKeys.detail(id), queryFn: () => api<Requisition>(`${PR_API}/${id}`) });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={pr.data ? `Edit ${pr.data.displayNumber}` : "Edit requisition"} />
      {pr.isLoading && <LoadingBlock />}
      {pr.error && <ErrorBlock error={pr.error} />}
      {pr.data && !pr.data.can.edit && <Alert tone="warning">This requisition can no longer be edited.</Alert>}
      {pr.data?.can.edit && <RequisitionForm existing={pr.data} />}
    </div>
  );
}
