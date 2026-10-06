"use client";

import { DocList } from "@/components/documents/doc-list";
import { formatDate, formatMoney, type DocumentStatus } from "@/lib/documents";
import { LC_API, LC_ROUTE } from "@/lib/purchase";

interface Row {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  title: string | null;
  method: string;
  totalCharges: string;
  unabsorbed: string;
}

export default function LandedCostsPage() {
  return (
    <DocList<Row>
      title="Landed costs"
      description="Freight, customs duty, insurance and clearing added to the cost of received stock."
      apiPath={LC_API}
      route={LC_ROUTE}
      queryKey={LC_ROUTE}
      newHref={`${LC_ROUTE}/new`}
      newLabel="New landed cost"
      newPermission="purchase.invoices.manage"
      empty={{ title: "No landed costs", description: "Add freight or duty to goods receipts so stock carries its full cost." }}
      columns={[
        { label: "Date", render: (r) => <span className="text-muted">{formatDate(r.docDate)}</span> },
        { label: "Charges on", render: (r) => <span className="block max-w-md truncate">{r.title}</span> },
        { label: "Split by", render: (r) => r.method },
        { label: "Total", align: "right", render: (r) => formatMoney(r.totalCharges) },
        { label: "Not in stock", align: "right", render: (r) => (Number(r.unabsorbed) ? formatMoney(r.unabsorbed) : "—") },
      ]}
    />
  );
}
