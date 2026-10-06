"use client";

import { DocList } from "@/components/documents/doc-list";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoney, type DocumentStatus } from "@/lib/documents";
import { DN_API, DN_ROUTE } from "@/lib/purchase";

interface Row {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  kind: "return" | "price_adjustment";
  reason: string;
  grandTotal: string;
  supplierInvoiceNo: string;
  vendor: { name: string };
}

export default function DebitNotesPage() {
  return (
    <DocList<Row>
      title="Debit notes"
      description="Purchase returns and price adjustments against vendor bills, with the GST reversed."
      apiPath={DN_API}
      route={DN_ROUTE}
      queryKey={DN_ROUTE}
      empty={{ title: "No debit notes", description: "Raise one from an approved purchase invoice." }}
      columns={[
        { label: "Date", render: (r) => <span className="text-muted">{formatDate(r.docDate)}</span> },
        { label: "Vendor", render: (r) => r.vendor.name },
        { label: "Against bill", render: (r) => <span className="font-mono text-xs">{r.supplierInvoiceNo}</span> },
        { label: "Type", render: (r) => <Badge>{r.kind === "return" ? "Return" : "Price adjustment"}</Badge> },
        { label: "Reason", render: (r) => <span className="block max-w-56 truncate text-muted">{r.reason}</span> },
        { label: "Amount", align: "right", render: (r) => formatMoney(r.grandTotal) },
      ]}
    />
  );
}
