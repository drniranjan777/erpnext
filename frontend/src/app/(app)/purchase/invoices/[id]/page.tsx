"use client";

import { useQuery } from "@tanstack/react-query";
import { FileMinus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed, ApprovalProgress, AttachmentsPanel, StatusBadge, Tabs } from "@/components/documents/document-parts";
import { TaxSummary } from "@/components/documents/tax-summary";
import { Badge } from "@/components/ui/badge";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { DN_ROUTE, PI_API, PI_ROUTE, piKeys, PO_ROUTE, type PurchaseInvoice } from "@/lib/purchase";

const MATCH = { three_way: "3-way match (PO · GRN · bill)", two_way: "2-way match (PO · bill)", none: "No order" };

export default function PurchaseInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"notes" | "activity" | "files">("activity");
  const pi = useQuery({ queryKey: piKeys.detail(id), queryFn: () => api<PurchaseInvoice>(`${PI_API}/${id}`) });
  if (pi.isLoading) return <LoadingBlock />;
  if (pi.error) return <ErrorBlock error={pi.error} />;
  const d = pi.data!;
  const msme = d.vendor.msme === "micro" || d.vendor.msme === "small";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: PI_ROUTE, label: "Purchase invoices" }}
        badges={
          <>
            <Badge tone={d.matchType === "three_way" ? "success" : "neutral"}>{MATCH[d.matchType]}</Badge>
            {msme && <Badge tone="warning">MSME ({d.vendor.msme})</Badge>}
          </>
        }
        subtitle={
          <>
            {d.vendor.name} · bill <span className="font-mono">{d.supplierInvoiceNo}</span> of {formatDate(d.supplierInvoiceDate)}
          </>
        }
        actions={
          <>
            {d.canDebitNote && (
              <Link href={`${DN_ROUTE}/new?pi=${d.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted">
                <FileMinus className="size-4" aria-hidden /> Debit note
              </Link>
            )}
            <DocumentActions doc={d} apiBase={PI_API} routeBase={PI_ROUTE} printHref={`/print/purchase-invoices/${d.id}`} queryKey={piKeys.detail(id)} />
          </>
        }
      />
      <DocStatusAlerts doc={d} approvedNote="Posted. Billed quantities are recorded, and stock was revalued for any rate difference and for GST without input credit." />
      {d.varianceNeedsNote && d.can.edit && <Alert tone="warning">Some rates differ from the order by more than {Number(d.rateTolerancePct)}%. Edit the bill and explain the difference before submitting.</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
              <Info label="Vendor" value={<Link href={`/masters/parties/${d.vendor.id}`} className="hover:underline">{d.vendor.name}</Link>} />
              <Info label="Vendor GSTIN" value={d.vendor.gstin ?? d.vendor.registration} mono={!!d.vendor.gstin} />
              <Info label="Purchase order" value={d.purchaseOrder ? <Link href={`${PO_ROUTE}/${d.purchaseOrder.id}`} className="text-primary hover:underline">{d.purchaseOrder.number}</Link> : null} />
              <Info label="Payment due" value={d.dueDate ? `${formatDate(d.dueDate)}${Number(d.outstanding) > 0 && d.daysToDue !== null ? (d.daysToDue < 0 ? ` · ${-d.daysToDue} days overdue` : ` · in ${d.daysToDue} days`) : ""}` : null} />
              <Info label="TDS" value={d.tdsSection ? `${d.tdsSection} @ ${Number(d.tdsRate)}% = ${formatMoney(d.tdsAmount)}` : "None"} />
              <Info label="Input tax credit" value={`${formatMoney(d.itcEligibleTax)} claimable${Number(d.itcIneligibleTax) ? ` · ${formatMoney(d.itcIneligibleTax)} not` : ""}`} />
            </dl>
            {d.varianceNote && <p className="border-t border-border px-5 py-3 text-sm"><span className="text-muted">Rate difference: </span>{d.varianceNote}</p>}
          </Card>

          <Card>
            <CardHeader title="Lines" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Item</th>
                    <th className="px-4 py-2 text-right font-medium">Qty</th>
                    <th className="px-4 py-2 text-right font-medium">Rate</th>
                    <th className="px-4 py-2 text-right font-medium">Taxable</th>
                    <th className="px-4 py-2 text-right font-medium">GST</th>
                    <th className="px-4 py-2 text-right font-medium">vs order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border align-top">
                  {d.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2.5 text-muted">{l.lineNo}</td>
                      <td className="px-4 py-2.5">
                        {l.description}
                        <p className="text-xs text-muted">
                          <span className="font-mono">{l.itemCode}</span>
                          {l.grnNumber && ` · ${l.grnNumber}`}
                          {!l.itcEligible && " · no ITC"}
                          {Number(l.returnedQty) > 0 && ` · ${formatQty(l.returnedQty)} returned`}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                        {formatQty(l.qty)} {l.uomCode}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatMoney(l.rate)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatMoney(l.taxableValue)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted">{Number(l.gstRate)}%</td>
                      <td className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${l.outOfTolerance ? "font-medium text-danger" : "text-muted"}`}>
                        {l.expectedRate ? (Number(l.rateVariance) ? `${Number(l.rateVariance) > 0 ? "+" : ""}${formatMoney(l.rateVariance)}` : "Matches") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border px-5 py-4">
              <TaxSummary tax={d} stateTaxLabel={d.stateTaxLabel} totalLabel="Bill total" />
              <dl className="ml-auto mt-2 max-w-sm space-y-1 text-sm">
                {Number(d.tdsAmount) > 0 && (
                  <div className="flex justify-between text-muted">
                    <dt>Less TDS ({d.tdsSection})</dt>
                    <dd className="tabular-nums">−{formatMoney(d.tdsAmount)}</dd>
                  </div>
                )}
                <div className="flex justify-between font-semibold">
                  <dt>Payable to vendor</dt>
                  <dd className="tabular-nums">{formatMoney(d.netPayable)}</dd>
                </div>
              </dl>
            </div>
          </Card>

          <Card>
            <div className="px-5 pt-2">
              <Tabs
                tabs={[
                  { value: "activity", label: "Activity" },
                  { value: "notes", label: "Debit notes", count: d.debitNotes.length || undefined },
                  { value: "files", label: "Files" },
                ]}
                value={tab}
                onChange={setTab}
              />
            </div>
            <div className="px-5 py-4">
              {tab === "activity" && <ActivityFeed documentId={d.id} />}
              {tab === "files" && <AttachmentsPanel documentId={d.id} readOnly={d.status === "cancelled"} />}
              {tab === "notes" &&
                (d.debitNotes.length ? (
                  <ul className="divide-y divide-border text-sm">
                    {d.debitNotes.map((n) => (
                      <li key={n.id} className="flex items-center justify-between gap-3 py-2">
                        <Link href={`${DN_ROUTE}/${n.id}`} className="font-medium text-primary hover:underline">
                          {n.number ?? "Draft"}
                        </Link>
                        <span className="text-muted">{n.kind === "return" ? "Return" : "Price adjustment"}</span>
                        <span className="tabular-nums">{formatMoney(n.amount)}</span>
                        <StatusBadge status={n.status} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No debit notes.</p>
                ))}
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Approval" />
            <div className="px-5 py-4">{d.status === "draft" && !d.approvals.length ? <p className="text-sm text-muted">Approvals start when the bill is submitted.</p> : <ApprovalProgress steps={d.approvals} />}</div>
          </Card>
          {d.notes && (
            <Card>
              <CardHeader title="Notes" />
              <p className="px-5 py-4 text-sm whitespace-pre-wrap">{d.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
