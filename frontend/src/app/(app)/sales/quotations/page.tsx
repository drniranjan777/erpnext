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
  title: string | null;
  customer: { name: string };
  validUntil: string | null;
  grandTotal: string;
  marginPct: string | null;
  maxDiscountPct: string;
}

export default function QuotationsPage() {
  return (
    <DocList<Row>
      title="Quotations"
      description="Priced offers with margin, discount approval and validity. Approved quotations become sales orders in one click."
      apiPath={S.quotations}
      route={S.quotations}
      queryKey={S.quotations}
      newHref={`${S.quotations}/new`}
      newLabel="New quotation"
      newPermission="sales.quotations.manage"
      searchPlaceholder="Number or customer"
      empty={{ title: "No quotations", description: "Quote prices to a customer from the price list." }}
      tabs={[
        { value: "all", label: "All", query: {} },
        { value: "draft", label: "Drafts", query: { status: "draft" } },
        { value: "pending", label: "Pending approval", query: { status: "pending_approval" } },
        { value: "approved", label: "Open", query: { status: "approved" } },
        { value: "completed", label: "Converted", query: { status: "completed" } },
        { value: "cancelled", label: "Cancelled", query: { status: "cancelled" } },
      ]}
      columns={[
        { label: "Date", render: (r) => <span className="text-muted">{formatDate(r.docDate)}</span> },
        { label: "Customer", render: (r) => <span className="block max-w-56 truncate">{r.customer.name}</span> },
        { label: "Valid until", render: (r) => formatDate(r.validUntil) },
        { label: "Margin", align: "right", render: (r) => (r.marginPct === null ? "—" : <Badge tone={Number(r.marginPct) < 10 ? "danger" : "neutral"}>{Number(r.marginPct).toFixed(1)}%</Badge>) },
        { label: "Total", align: "right", render: (r) => formatMoney(r.grandTotal) },
      ]}
    />
  );
}
