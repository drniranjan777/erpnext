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
  taxKind: string;
  grandTotal: string;
  outstanding: string;
  dueDate: string | null;
  daysToDue: number | null;
  irn: string | null;
}

const KIND: Record<string, string> = { tax_invoice: "Tax invoice", bill_of_supply: "Bill of supply", export: "Export", sez: "SEZ" };

export default function SalesInvoicesPage() {
  return (
    <DocList<Row>
      title="Sales invoices"
      description="Tax invoices, bills of supply and export invoices, with receivables and due dates."
      apiPath={S.invoices}
      route={S.invoices}
      queryKey={S.invoices}
      newHref={`${S.invoices}/new`}
      newLabel="New invoice"
      newPermission="sales.invoices.manage"
      searchPlaceholder="Number, customer or PO no."
      empty={{ title: "No invoices", description: "Invoice deliveries, order lines or a direct sale." }}
      tabs={[
        { value: "all", label: "All", query: {} },
        { value: "draft", label: "Drafts", query: { status: "draft" } },
        { value: "unpaid", label: "Unpaid", query: { pending: "true" } },
        { value: "approved", label: "Posted", query: { status: "approved" } },
        { value: "cancelled", label: "Cancelled", query: { status: "cancelled" } },
      ]}
      columns={[
        { label: "Date", render: (r) => <span className="text-muted">{formatDate(r.docDate)}</span> },
        { label: "Customer", render: (r) => <span className="block max-w-56 truncate">{r.customer.name}</span> },
        { label: "Type", render: (r) => <>{KIND[r.taxKind] ?? r.taxKind}{r.irn && <Badge tone="success" className="ml-1">IRN</Badge>}</> },
        {
          label: "Due",
          render: (r) => (
            <>
              {formatDate(r.dueDate)}
              {Number(r.outstanding) > 0 && r.daysToDue !== null && <span className={`block text-xs ${r.daysToDue < 0 ? "text-danger" : "text-muted"}`}>{r.daysToDue < 0 ? `${-r.daysToDue} days overdue` : `in ${r.daysToDue} days`}</span>}
            </>
          ),
        },
        { label: "Total", align: "right", render: (r) => formatMoney(r.grandTotal) },
        { label: "Outstanding", align: "right", render: (r) => (Number(r.outstanding) > 0 ? formatMoney(r.outstanding) : "—") },
      ]}
    />
  );
}
