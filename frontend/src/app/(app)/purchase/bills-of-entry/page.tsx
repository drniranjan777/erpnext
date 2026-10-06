"use client";

import { DocList } from "@/components/documents/doc-list";
import { formatDate, formatMoney, type DocumentStatus } from "@/lib/documents";

interface Row {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  vendor: { name: string };
  boeNo: string;
  boeDate: string;
  portCode: string;
  assessableTotal: string;
  dutyTotal: string;
  igstTotal: string;
}

const BOE = "/purchase/bills-of-entry";

export default function BillsOfEntryPage() {
  return (
    <DocList<Row>
      title="Bills of Entry"
      description="Customs duty on imports: basic duty and surcharge go into the cost of the goods; import IGST is input tax credit."
      apiPath={BOE}
      route={BOE}
      queryKey={BOE}
      newHref={`${BOE}/new`}
      newLabel="Record Bill of Entry"
      newPermission="purchase.invoices.manage"
      searchPlaceholder="BE number, supplier"
      empty={{ title: "No Bills of Entry", description: "Record the Bill of Entry when imported goods clear customs." }}
      columns={[
        { label: "BE", render: (r) => <><span className="font-mono">{r.boeNo}</span><span className="block text-xs text-muted">{r.portCode} · {formatDate(r.boeDate)}</span></> },
        { label: "Supplier", render: (r) => r.vendor.name },
        { label: "Assessable value", align: "right", render: (r) => formatMoney(r.assessableTotal) },
        { label: "IGST (ITC)", align: "right", render: (r) => formatMoney(r.igstTotal) },
        { label: "Total duty", align: "right", render: (r) => formatMoney(r.dutyTotal) },
      ]}
    />
  );
}
