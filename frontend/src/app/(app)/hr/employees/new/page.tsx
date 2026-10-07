"use client";

import { EmployeeForm } from "@/components/hr/employee-form";
import { PageHeader } from "@/components/ui/page";

export default function NewEmployeePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Add employee" />
      <EmployeeForm />
    </div>
  );
}
