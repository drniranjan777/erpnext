"use client";

import { PageHeader } from "@/components/ui/page";
import { S } from "@/lib/sales";
import { SellingForm } from "../../_components/selling-form";

export default function NewSalesOrderPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="New sales order" description="The customer's credit is checked when you submit." />
      <SellingForm mode="order" api={S.orders} />
    </div>
  );
}
