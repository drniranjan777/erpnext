"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, PackageCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CustomFieldValues, useCustomFields } from "@/components/custom-fields";
import { DocumentActions } from "@/components/documents/document-actions";
import { ActivityFeed, ApprovalProgress, AttachmentsPanel, RevisionsPanel, StatusBadge, Tabs } from "@/components/documents/document-parts";
import { TaxSummary } from "@/components/documents/tax-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { GRN_ROUTE, PO_API, PO_ROUTE, poKeys, type PoLine, type PurchaseOrder } from "@/lib/purchase";

type Tab = "receipts" | "activity" | "files" | "revisions";

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("receipts");
  const [closing, setClosing] = useState(false);
  const po = useQuery({ queryKey: poKeys.detail(id), queryFn: () => api<PurchaseOrder>(`${PO_API}/${id}`) });
  const customDefs = useCustomFields("purchase_order");

  if (po.isLoading) return <LoadingBlock />;
  if (po.error) return <ErrorBlock error={po.error} />;
  const d = po.data!;
  const goods = d.poType === "standard";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <Link href={PO_ROUTE} className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Purchase orders
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{d.displayNumber}</h1>
              <StatusBadge status={d.status} />
              {d.closedAt && <Badge tone="warning">Short-closed</Badge>}
              {!goods && <Badge>Services</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted">
              {d.vendor.name} · {formatMoney(d.grandTotal)}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {d.canReceive && (
              <Link href={`${GRN_ROUTE}/new?po=${d.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
                <PackageCheck className="size-4" aria-hidden /> Receive goods
              </Link>
            )}
            {d.canShortClose && (
              <Button variant="ghost" onClick={() => setClosing(true)}>
                <XCircle className="size-4" aria-hidden /> Short-close
              </Button>
            )}
            <DocumentActions doc={d} apiBase={PO_API} routeBase={PO_ROUTE} printHref={`/print/purchase-orders/${d.id}`} queryKey={poKeys.detail(id)} />
          </div>
        </div>
      </div>

      {d.status === "rejected" && <Alert>Rejected. Edit and resubmit, or cancel it. See the activity below for the reason.</Alert>}
      {d.status === "cancelled" && <Alert tone="warning">Cancelled on {formatDateTime(d.cancelledAt)}: {d.cancelReason}</Alert>}
      {d.closedAt && <Alert tone="warning">Short-closed on {formatDateTime(d.closedAt)}: {d.closeReason}</Alert>}
      {d.can.approve && <Alert tone="warning">This order is waiting for your approval.</Alert>}
      {d.warnings?.length > 0 && <Alert tone="warning">{d.warnings.join(" ")}</Alert>}
      {!d.ourGstin && <Alert tone="warning">Your company has no GSTIN yet, so GST was worked out as inter-state. Add it under Settings → Companies.</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted">Vendor</dt>
                <dd className="mt-0.5">
                  <Link href={`/masters/parties/${d.vendor.id}`} className="font-medium hover:underline">
                    {d.vendor.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {d.vendor.gstin ? <span className="font-mono">{d.vendor.gstin}</span> : d.vendor.registration.replace("_", " ")}
                    {d.vendor.address.city && ` · ${d.vendor.address.city}`}
                  </p>
                </dd>
              </div>
              <Info label="Order date" value={formatDate(d.docDate)} />
              <Info label="Deliver to" value={d.deliveryWarehouse ? `${d.deliveryWarehouse.code} · ${d.deliveryWarehouse.name}` : "—"} />
              <Info label="Expected by" value={formatDate(d.expectedDate)} />
              <Info label="Quotation ref." value={d.vendorQuoteRef} />
              <Info label="Payment" value={d.paymentTerms ?? (d.creditDays !== null ? `${d.creditDays} days credit` : null)} />
              <Info label="Over-receipt allowed" value={Number(d.tolerancePct) ? `${Number(d.tolerancePct)}%` : "None"} />
              <Info label="Created by" value={d.createdBy} />
              <CustomFieldValues defs={customDefs.data ?? []} values={d.customFields} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Items" />
            <LinesTable lines={d.lines} goods={goods} />
            <div className="border-t border-border px-5 py-4">
              <TaxSummary tax={d} stateTaxLabel={d.stateTaxLabel} totalLabel="Order total" />
            </div>
            {(d.terms || d.notes) && (
              <div className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-2">
                {d.terms && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">Terms & conditions</p>
                    <p className="mt-1 whitespace-pre-wrap">{d.terms}</p>
                  </div>
                )}
                {d.notes && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">Notes</p>
                    <p className="mt-1 whitespace-pre-wrap">{d.notes}</p>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card>
            <div className="px-5 pt-2">
              <Tabs
                tabs={[
                  { value: "receipts", label: "Goods receipts", count: d.receipts.length || undefined },
                  { value: "activity", label: "Activity" },
                  { value: "files", label: "Files" },
                  { value: "revisions", label: "Revisions", count: d.revision || undefined },
                ]}
                value={tab}
                onChange={setTab}
              />
            </div>
            <div className="px-5 py-4">
              {tab === "receipts" &&
                (d.receipts.length ? (
                  <ul className="divide-y divide-border text-sm">
                    {d.receipts.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                        <Link href={`${GRN_ROUTE}/${r.id}`} className="font-medium text-primary hover:underline">
                          {r.number ?? "Draft GRN"}
                        </Link>
                        <span className="text-muted">{formatDate(r.docDate)}</span>
                        <span className="tabular-nums">{formatMoney(r.amount)}</span>
                        <StatusBadge status={r.status} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Nothing received yet.</p>
                ))}
              {tab === "activity" && <ActivityFeed documentId={d.id} />}
              {tab === "files" && <AttachmentsPanel documentId={d.id} readOnly={d.status === "cancelled"} />}
              {tab === "revisions" && <RevisionsPanel documentId={d.id} renderSnapshot={(s) => <LinesTable lines={(s.lines as PoLine[]) ?? []} goods={goods} />} />}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Approval" />
            <div className="px-5 py-4">
              {d.status === "draft" && !d.approvals.length ? <p className="text-sm text-muted">Approvals start when the order is submitted.</p> : <ApprovalProgress steps={d.approvals} />}
            </div>
          </Card>
          <Card>
            <CardHeader title="Timeline" />
            <dl className="space-y-2 px-5 py-4 text-sm">
              <Info label="Created" value={formatDateTime(d.createdAt)} inline />
              <Info label="Submitted" value={d.submittedAt ? formatDateTime(d.submittedAt) : null} inline />
              <Info label="Approved" value={d.approvedAt ? formatDateTime(d.approvedAt) : null} inline />
              <Info label="Fiscal year" value={d.fiscalYear} inline />
            </dl>
          </Card>
        </div>
      </div>

      <ShortCloseDialog po={d} open={closing} onClose={() => setClosing(false)} />
    </div>
  );
}

function Info({ label, value, inline }: { label: string; value: string | null | undefined; inline?: boolean }) {
  return (
    <div className={inline ? "flex justify-between gap-4" : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={inline ? "text-right" : "mt-0.5"}>{value || "—"}</dd>
    </div>
  );
}

function LinesTable({ lines, goods }: { lines: PoLine[]; goods: boolean }) {
  return (
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
            <th className="px-4 py-2 text-right font-medium">Amount</th>
            {goods && <th className="px-4 py-2 text-right font-medium">Received</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border align-top">
          {lines.map((l) => (
            <tr key={l.id ?? l.lineNo}>
              <td className="px-4 py-2.5 text-muted">{l.lineNo}</td>
              <td className="px-4 py-2.5">
                <p>{l.description}</p>
                <p className="text-xs text-muted">
                  <span className="font-mono">{l.itemCode}</span>
                  {l.hsnCode && ` · HSN ${l.hsnCode}`}
                  {l.deliveryDate && ` · by ${formatDate(l.deliveryDate)}`}
                </p>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                {formatQty(l.qty)} {l.uomCode}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                {formatMoney(l.rate)}
                {Number(l.discountPct) > 0 && <p className="text-xs text-muted">−{Number(l.discountPct)}%</p>}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatMoney(l.taxableValue)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted">{Number(l.gstRate)}%</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatMoney(l.lineTotal)}</td>
              {goods && (
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                  {formatQty(l.receivedQty)}
                  {Number(l.pendingQty) > 0 ? <p className="text-xs text-muted">{formatQty(l.pendingQty)} pending</p> : <p className="text-xs text-success">Complete</p>}
                  {Number(l.rejectedQty) > 0 && <p className="text-xs text-danger">{formatQty(l.rejectedQty)} rejected</p>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShortCloseDialog({ po, open, onClose }: { po: PurchaseOrder; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const close = useMutation({
    mutationFn: () => api(`${PO_API}/${po.id}/short-close`, { body: { version: po.version, reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: poKeys.detail(po.id) });
      qc.invalidateQueries({ queryKey: [PO_ROUTE] });
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Short-close this order"
      description="The quantity not yet received will no longer be expected. Receipts so far stay as they are."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep open
          </Button>
          <Button variant="danger" loading={close.isPending} disabled={reason.trim().length < 3} onClick={() => close.mutate()}>
            Short-close
          </Button>
        </>
      }
    >
      {close.error && <Alert>{close.error instanceof ApiError ? close.error.message : "Could not short-close."}</Alert>}
      <Field label="Reason" required>
        {(p) => <textarea {...p} rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Dialog>
  );
}
