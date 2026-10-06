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
  kind: string;
  reason: string;
  grandTotal: string;
  invoiceNumber: string | null;
  customer: { name: string };
}

export default function CreditNotesPage() {
  return (
    <DocList<Row>
      title="Credit notes"
      description="Sales returns and price adjustments against invoices, with GST reversed at the invoice's rates."
      apiPath={S.credits}
      route={S.credits}
      queryKey={S.credits}
      empty={{ title: "No credit notes", description: "Raise one from an approved invoice." }}
      columns={[
        { label: "Date", render: (r) => <span className="text-muted">{formatDate(r.docDate)}</span> },
        { label: "Customer", render: (r) => r.customer.name },
        { label: "Invoice", render: (r) => r.invoiceNumber },
        { label: "Type", render: (r) => <Badge>{r.kind === "return" ? "Return" : "Price adjustment"}</Badge> },
        { label: "Reason", render: (r) => <span className="block max-w-56 truncate text-muted">{r.reason}</span> },
        { label: "Amount", align: "right", render: (r) => formatMoney(r.grandTotal) },
      ]}
    />
  );
}
