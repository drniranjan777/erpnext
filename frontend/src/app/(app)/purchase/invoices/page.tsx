"use client";

import { DocList } from "@/components/documents/doc-list";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoney } from "@/lib/documents";
import { PI_API, PI_ROUTE, type PiListItem } from "@/lib/purchase";

const MATCH: Record<string, string> = { three_way: "3-way", two_way: "2-way", none: "No PO" };

export default function PurchaseInvoicesPage() {
  return (
    <DocList<PiListItem>
      title="Purchase invoices"
      description="Vendor bills matched to goods receipts and orders, with ITC, TDS and payment due dates (MSME bills within 45 days)."
      apiPath={PI_API}
      route={PI_ROUTE}
      queryKey={PI_ROUTE}
      newHref={`${PI_ROUTE}/new`}
      newLabel="Enter bill"
      newPermission="purchase.invoices.manage"
      searchPlaceholder="Number, vendor or bill no."
      empty={{ title: "No purchase invoices", description: "Enter vendor bills against goods receipts or service orders." }}
      tabs={[
        { value: "all", label: "All", query: {} },
        { value: "draft", label: "Drafts", query: { status: "draft" } },
        { value: "pending", label: "Pending approval", query: { status: "pending_approval" } },
        { value: "outstanding", label: "To pay", query: { outstanding: "true" } },
        { value: "msme", label: "MSME dues", query: { outstanding: "true", msme: "true" } },
        { value: "cancelled", label: "Cancelled", query: { status: "cancelled" } },
      ]}
      columns={[
        { label: "Vendor", render: (r) => <span className="block max-w-56 truncate">{r.vendor.name}</span> },
        {
          label: "Bill",
          render: (r) => (
            <>
              <span className="font-mono text-xs">{r.supplierInvoiceNo}</span>
              <span className="block text-xs text-muted">{formatDate(r.supplierInvoiceDate)}</span>
            </>
          ),
        },
        { label: "Match", render: (r) => <Badge tone={r.matchType === "three_way" ? "success" : "neutral"}>{MATCH[r.matchType]}</Badge> },
        {
          label: "Due",
          render: (r) =>
            r.dueDate ? (
              <>
                {formatDate(r.dueDate)}
                {r.vendorMsme && ["micro", "small"].includes(r.vendorMsme) && <Badge className="ml-1">MSME</Badge>}
                {Number(r.outstanding) > 0 && r.daysToDue !== null && (
                  <span className={`block text-xs ${r.daysToDue < 0 ? "text-danger" : r.daysToDue <= 7 ? "text-warning" : "text-muted"}`}>
                    {r.daysToDue < 0 ? `${-r.daysToDue} days overdue` : `in ${r.daysToDue} days`}
                  </span>
                )}
              </>
            ) : (
              "—"
            ),
        },
        { label: "Payable", align: "right", render: (r) => formatMoney(r.netPayable) },
        { label: "Outstanding", align: "right", render: (r) => (Number(r.outstanding) > 0 ? formatMoney(r.outstanding) : "—") },
      ]}
    />
  );
}
