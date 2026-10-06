"use client";

import { S, type SalesOrder } from "@/lib/sales";
import { EditDocPage } from "../../../_components/parts";
import { SellingForm } from "../../../_components/selling-form";

export default function EditSalesOrderPage() {
  return <EditDocPage<SalesOrder> apiBase={S.orders} title="sales order" render={(o) => <SellingForm mode="order" api={S.orders} existing={o} />} />;
}
