"use client";

import { DocList } from "@/components/documents/doc-list";
import { Badge } from "@/components/ui/badge";
import { formatDate, type DocumentStatus } from "@/lib/documents";
import { S } from "@/lib/sales";

interface Row {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  orderNumber: string | null;
  customer: { name: string };
  warehouse: { code: string };
  vehicleNo: string | null;
  deliveredAt: string | null;
}

export default function DeliveriesPage() {
  return (
    <DocList<Row>
      title="Deliveries"
      description="Delivery challans against sales orders. Goods leave stock when a delivery is posted."
      apiPath={S.deliveries}
      route={S.deliveries}
      queryKey={S.deliveries}
      searchPlaceholder="Number, customer, vehicle or LR"
      empty={{ title: "No deliveries", description: "Deliver from an approved sales order." }}
      tabs={[
        { value: "all", label: "All", query: {} },
        { value: "draft", label: "Drafts", query: { status: "draft" } },
        { value: "uninvoiced", label: "Not invoiced", query: { pending: "true" } },
        { value: "approved", label: "Posted", query: { status: "approved" } },
        { value: "cancelled", label: "Cancelled", query: { status: "cancelled" } },
      ]}
      columns={[
        { label: "Date", render: (r) => <span className="text-muted">{formatDate(r.docDate)}</span> },
        { label: "Customer", render: (r) => r.customer.name },
        { label: "Order", render: (r) => r.orderNumber },
        { label: "From", render: (r) => r.warehouse.code },
        { label: "Vehicle", render: (r) => <span className="font-mono text-xs">{r.vehicleNo ?? "—"}</span> },
        { label: "POD", render: (r) => (r.deliveredAt ? <Badge tone="success">Received</Badge> : "—") },
      ]}
    />
  );
}
