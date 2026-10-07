"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { EmployeeForm } from "@/components/hr/employee-form";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { HR, type Employee } from "@/lib/hr";

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: [HR, "employees", id], queryFn: () => api<Employee>(`${HR}/employees/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Edit ${q.data!.fullName}`} />
      <EmployeeForm employee={q.data!} />
    </div>
  );
}
