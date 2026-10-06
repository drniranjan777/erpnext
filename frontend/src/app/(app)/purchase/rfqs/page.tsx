"use client";

import { DocList } from "@/components/documents/doc-list";
import { formatDate, type DocumentStatus } from "@/lib/documents";
import { RFQ_API, RFQ_ROUTE } from "@/lib/purchase";

interface Row {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  title: string | null;
  responseDueDate: string | null;
  vendors: number;
  responded: number;
}

export default function RfqsPage() {
  return (
    <DocList<Row>
      title="Requests for quotation"
      description="Ask several vendors for prices, compare quotes side by side with their track record, and award orders."
      apiPath={RFQ_API}
      route={RFQ_ROUTE}
      queryKey={RFQ_ROUTE}
      newHref={`${RFQ_ROUTE}/new`}
      newLabel="New RFQ"
      newPermission="purchase.rfq.manage"
      empty={{ title: "No RFQs", description: "Create one to compare vendor prices before ordering." }}
      tabs={[
        { value: "all", label: "All", query: {} },
        { value: "draft", label: "Drafts", query: { status: "draft" } },
        { value: "open", label: "Open for quotes", query: { status: "approved" } },
        { value: "awarded", label: "Awarded", query: { status: "completed" } },
        { value: "cancelled", label: "Cancelled", query: { status: "cancelled" } },
      ]}
      columns={[
        { label: "Date", render: (r) => <span className="text-muted">{formatDate(r.docDate)}</span> },
        { label: "Items", render: (r) => <span className="block max-w-md truncate">{r.title}</span> },
        { label: "Quotes due", render: (r) => formatDate(r.responseDueDate) },
        { label: "Responses", render: (r) => `${r.responded} of ${r.vendors}` },
      ]}
    />
  );
}
