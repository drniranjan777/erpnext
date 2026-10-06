"use client";

import { DocList } from "@/components/documents/doc-list";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoney, type DocumentStatus } from "@/lib/documents";
import { S } from "@/lib/sales";

interface Row {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  customer: { name: string };
  customerPoNo: string | null;
  expectedDate: string | null;
  grandTotal: string;
  closedAt: string | null;
  deliveredPct: number;
}

export default function SalesOrdersPage() {
  return (
    <DocList<Row>
      title="Sales orders"
      description="Confirmed customer orders, credit-checked on submission. Deliver, then invoice."
      apiPath={S.orders}
      route={S.orders}
      queryKey={S.orders}
      newHref={`${S.orders}/new`}
      newLabel="New order"
      newPermission="sales.orders.manage"
      searchPlaceholder="Number, customer or PO no."
      empty={{ title: "No sales orders", description: "Create one, or convert an approved quotation." }}
      tabs={[
        { value: "all", label: "All", query: {} },
        { value: "draft", label: "Drafts", query: { status: "draft" } },
        { value: "pending", label: "Pending approval", query: { status: "pending_approval" } },
        { value: "open", label: "To deliver", query: { pending: "true" } },
        { value: "completed", label: "Completed", query: { status: "completed" } },
        { value: "cancelled", label: "Cancelled", query: { status: "cancelled" } },
      ]}
      columns={[
        { label: "Date", render: (r) => <span className="text-muted">{formatDate(r.docDate)}</span> },
        { label: "Customer", render: (r) => <><span className="block max-w-56 truncate">{r.customer.name}</span>{r.customerPoNo && <span className="text-xs text-muted">PO {r.customerPoNo}</span>}</> },
        { label: "Dispatch by", render: (r) => formatDate(r.expectedDate) },
        {
          label: "Delivered",
          render: (r) => (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, r.deliveredPct)}%` }} /></div>
              <span className="text-xs tabular-nums text-muted">{r.deliveredPct}%</span>
              {r.closedAt && <Badge>Short-closed</Badge>}
            </div>
          ),
        },
        { label: "Total", align: "right", render: (r) => formatMoney(r.grandTotal) },
      ]}
    />
  );
}
