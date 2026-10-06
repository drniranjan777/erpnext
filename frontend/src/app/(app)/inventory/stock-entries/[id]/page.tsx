"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Barcode } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CustomFieldValues, useCustomFields } from "@/components/custom-fields";
import { DocumentActions } from "@/components/documents/document-actions";
import {
  ActivityFeed,
  ApprovalProgress,
  AttachmentsPanel,
  StatusBadge,
  Tabs,
} from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import {
  INVENTORY_KEY,
  SE_API,
  SE_ROUTE,
  seKeys,
  type LedgerRow,
  type StockEntry,
} from "@/lib/inventory";

type Tab = "postings" | "activity" | "files";

export default function StockEntryPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("activity");
  const se = useQuery({
    queryKey: seKeys.detail(id),
    queryFn: () => api<StockEntry>(`${SE_API}/${id}`),
  });
  const customDefs = useCustomFields("stock_entry");
  const posted =
    se.data?.status === "approved" ||
    (se.data?.status === "cancelled" && !!se.data.approvedAt);
  const ledger = useQuery({
    queryKey: [...INVENTORY_KEY, "ledger", { voucherId: id }],
    queryFn: () =>
      api<{ items: LedgerRow[] }>("/inventory/ledger", {
        query: { voucherId: id, limit: 500 },
      }),
    enabled: posted && tab === "postings",
  });

  if (se.isLoading) return <LoadingBlock />;
  if (se.error) return <ErrorBlock error={se.error} />;
  const d = se.data!;
  const valued = d.lines.some((l) => l.amount);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <Link
          href={SE_ROUTE}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Stock entries
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{d.displayNumber}</h1>
              <StatusBadge status={d.status} />
              <Badge>{d.purposeLabel}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{d.title}</p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {d.status === "approved" && d.toWarehouse && (
              <Link
                href={`/print/labels?entry=${d.id}`}
                target="_blank"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
              >
                <Barcode className="size-4" aria-hidden /> Labels
              </Link>
            )}
            <DocumentActions
              doc={d}
              apiBase={SE_API}
              routeBase={SE_ROUTE}
              queryKey={seKeys.detail(id)}
            />
          </div>
        </div>
      </div>

      {d.status === "approved" && (
        <Alert tone="success">
          Posted. Stock was updated on {formatDateTime(d.approvedAt)}. To
          correct it, cancel this entry (stock is reversed) and create a new
          one.
        </Alert>
      )}
      {d.status === "rejected" && (
        <Alert>
          Rejected. Edit and resubmit, or cancel it. See the activity below for
          the reason.
        </Alert>
      )}
      {d.status === "cancelled" && (
        <Alert tone="warning">
          Cancelled on {formatDateTime(d.cancelledAt)}: {d.cancelReason}
        </Alert>
      )}
      {d.can.approve && (
        <Alert tone="warning">
          This stock entry is waiting for your approval. Stock moves when it is
          approved.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
              <Info label="Posting date" value={formatDate(d.docDate)} />
              <div>
                <dt className="text-xs text-muted">Warehouse</dt>
                <dd className="mt-0.5 flex items-center gap-1.5">
                  {d.fromWarehouse && (
                    <span>
                      {d.fromWarehouse.code} · {d.fromWarehouse.name}
                    </span>
                  )}
                  {d.fromWarehouse && d.toWarehouse && (
                    <ArrowRight
                      className="size-3.5 text-muted"
                      aria-label="to"
                    />
                  )}
                  {d.toWarehouse && (
                    <span>
                      {d.toWarehouse.code} · {d.toWarehouse.name}
                    </span>
                  )}
                </dd>
              </div>
              <Info label="Reference" value={d.reference} />
              <Info label="Reason" value={d.reason} />
              <Info label="Company" value={d.company.name} />
              <Info label="Created by" value={d.createdBy} />
              <CustomFieldValues
                defs={customDefs.data ?? []}
                values={d.customFields}
              />
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Items"
              action={
                valued && (
                  <span className="text-sm text-muted">
                    Value{" "}
                    <strong className="ml-1 text-foreground tabular-nums">
                      {formatMoney(d.amount)}
                    </strong>
                  </span>
                )
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Item</th>
                    <th className="px-4 py-2 text-right font-medium">Qty</th>
                    <th className="px-4 py-2 font-medium">Batch / serials</th>
                    <th className="px-4 py-2 text-right font-medium">Rate</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border align-top">
                  {d.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2.5 text-muted">{l.lineNo}</td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/inventory/stock/${l.itemId}`}
                          className="hover:underline"
                        >
                          <span className="font-mono text-xs text-muted">
                            {l.itemCode}
                          </span>{" "}
                          {l.itemName}
                        </Link>
                        {l.remarks && (
                          <p className="text-xs text-muted">{l.remarks}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                        {formatQty(l.qty)} {l.uomCode}
                        {Number(l.conversionFactor) !== 1 && (
                          <p className="text-xs text-muted">
                            = {formatQty(l.baseQty)} base
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {l.batchNo && (
                          <p>
                            <span className="font-mono">{l.batchNo}</span>
                            {l.expiryDate && (
                              <span className="text-muted">
                                {" "}
                                · exp {formatDate(l.expiryDate)}
                              </span>
                            )}
                          </p>
                        )}
                        {l.serialNos?.length ? (
                          <p className="font-mono text-muted">
                            {l.serialNos.join(", ")}
                          </p>
                        ) : null}
                        {!l.batchNo && !l.serialNos?.length && (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                        {l.rate ? formatMoney(l.rate) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                        {formatMoney(l.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.notes && (
              <div className="border-t border-border px-5 py-4 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Notes
                </p>
                <p className="mt-1 whitespace-pre-wrap">{d.notes}</p>
              </div>
            )}
          </Card>

          <Card>
            <div className="px-5 pt-2">
              <Tabs
                tabs={[
                  { value: "activity", label: "Activity" },
                  ...(posted
                    ? [{ value: "postings" as const, label: "Stock postings" }]
                    : []),
                  { value: "files", label: "Files" },
                ]}
                value={tab}
                onChange={setTab}
              />
            </div>
            <div className="px-5 py-4">
              {tab === "activity" && <ActivityFeed documentId={d.id} />}
              {tab === "files" && (
                <AttachmentsPanel
                  documentId={d.id}
                  readOnly={d.status === "cancelled"}
                />
              )}
              {tab === "postings" &&
                (ledger.isLoading ? (
                  <LoadingBlock />
                ) : (
                  <Postings rows={ledger.data?.items ?? []} />
                ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Approval" />
            <div className="px-5 py-4">
              {d.status === "draft" && !d.approvals.length ? (
                <p className="text-sm text-muted">
                  Without an approval workflow for stock entries, submitting
                  posts the stock straight away.
                </p>
              ) : (
                <ApprovalProgress steps={d.approvals} />
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Timeline" />
            <dl className="space-y-2 px-5 py-4 text-sm">
              <Info
                label="Created"
                value={formatDateTime(d.createdAt)}
                inline
              />
              <Info
                label="Submitted"
                value={d.submittedAt ? formatDateTime(d.submittedAt) : null}
                inline
              />
              <Info
                label="Posted"
                value={d.approvedAt ? formatDateTime(d.approvedAt) : null}
                inline
              />
              <Info label="Fiscal year" value={d.fiscalYear} inline />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Info({
  label,
  value,
  inline,
}: {
  label: string;
  value: string | null | undefined;
  inline?: boolean;
}) {
  return (
    <div className={inline ? "flex justify-between gap-4" : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={inline ? "text-right" : "mt-0.5"}>{value || "—"}</dd>
    </div>
  );
}

function Postings({ rows }: { rows: LedgerRow[] }) {
  if (!rows.length)
    return <p className="text-sm text-muted">No stock postings.</p>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-5 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Warehouse</th>
            <th className="px-3 py-2 text-right font-medium">Qty</th>
            <th className="px-3 py-2 text-right font-medium">Value</th>
            <th className="px-5 py-2 text-right font-medium">Balance after</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {[...rows].reverse().map((r) => (
            <tr key={r.id} className={r.isReversal ? "text-muted" : undefined}>
              <td className="px-5 py-2">
                <span className="font-mono text-xs">{r.itemCode}</span>{" "}
                {r.itemName}
                {r.batchNo && (
                  <span className="text-xs text-muted"> · {r.batchNo}</span>
                )}
                {r.isReversal && <Badge className="ml-2">Reversal</Badge>}
              </td>
              <td className="px-3 py-2">{r.warehouseCode}</td>
              <td
                className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${Number(r.qty) < 0 ? "text-danger" : "text-success"}`}
              >
                {Number(r.qty) > 0 ? "+" : ""}
                {formatQty(r.qty)} {r.uom}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {formatMoney(r.value)}
              </td>
              <td className="whitespace-nowrap px-5 py-2 text-right tabular-nums">
                {formatQty(r.balanceQty)} · {formatMoney(r.balanceValue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
