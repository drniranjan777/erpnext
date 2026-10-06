"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CustomFieldValues, useCustomFields } from "@/components/custom-fields";
import { DocumentActions } from "@/components/documents/document-actions";
import { ActivityFeed, ApprovalProgress, AttachmentsPanel, RevisionsPanel, StatusBadge, Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { useAuth } from "@/lib/auth";
import { PR_API, PR_ROUTE, PRIORITY_META, prKeys, type Requisition, type RequisitionLine } from "@/lib/purchase";
import { CreatePoDialog } from "../create-po-dialog";

type Tab = "activity" | "files" | "revisions";

export default function RequisitionPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("activity");
  const [ordering, setOrdering] = useState(false);
  const { can } = useAuth();
  const pr = useQuery({ queryKey: prKeys.detail(id), queryFn: () => api<Requisition>(`${PR_API}/${id}`) });
  const customDefs = useCustomFields("purchase_requisition");

  if (pr.isLoading) return <LoadingBlock />;
  if (pr.error) return <ErrorBlock error={pr.error} />;
  const d = pr.data!;
  const closed = d.status === "cancelled" || d.status === "completed";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <Link href={PR_ROUTE} className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Purchase requisitions
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{d.displayNumber}</h1>
              <StatusBadge status={d.status} />
              <Badge tone={PRIORITY_META[d.priority].tone}>{PRIORITY_META[d.priority].label} priority</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{d.title}</p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {d.status === "approved" && can("purchase.orders.manage") && d.lines.some((l) => Number(l.quantity) > Number(l.orderedQty)) && (
              <Button onClick={() => setOrdering(true)}>
                <ShoppingCart className="size-4" aria-hidden /> Create purchase order
              </Button>
            )}
            <DocumentActions doc={d} apiBase={PR_API} routeBase={PR_ROUTE} printHref={`/print/purchase-requisitions/${d.id}`} queryKey={prKeys.detail(id)} />
          </div>
        </div>
      </div>

      {d.status === "rejected" && <Alert>Rejected. Edit and resubmit, or cancel it. See the activity below for the reason.</Alert>}
      {d.status === "cancelled" && <Alert tone="warning">Cancelled on {formatDateTime(d.cancelledAt)}: {d.cancelReason}</Alert>}
      {d.can.approve && <Alert tone="warning">This requisition is waiting for your approval.</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
              <Info label="Date" value={formatDate(d.docDate)} />
              <Info label="Required by" value={formatDate(d.requiredBy)} />
              <Info label="Department" value={d.department} />
              <Info label="Company" value={d.company.name} />
              <Info label="Branch" value={d.branch ? `${d.branch.code} · ${d.branch.name}` : null} />
              <Info label="Requested by" value={d.createdBy} />
              <CustomFieldValues defs={customDefs.data ?? []} values={d.customFields} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Items" action={<span className="text-sm text-muted">Estimated total <strong className="ml-1 text-foreground tabular-nums">{formatMoney(d.amount)}</strong></span>} />
            <LinesTable lines={d.lines} />
            {d.notes && (
              <div className="border-t border-border px-5 py-4 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Notes</p>
                <p className="mt-1 whitespace-pre-wrap">{d.notes}</p>
              </div>
            )}
          </Card>

          <Card>
            <div className="px-5 pt-2">
              <Tabs
                tabs={[
                  { value: "activity", label: "Activity" },
                  { value: "files", label: "Files" },
                  { value: "revisions", label: "Revisions", count: d.revision || undefined },
                ]}
                value={tab}
                onChange={setTab}
              />
            </div>
            <div className="px-5 py-4">
              {tab === "activity" && <ActivityFeed documentId={d.id} />}
              {tab === "files" && <AttachmentsPanel documentId={d.id} readOnly={closed} />}
              {tab === "revisions" && (
                <RevisionsPanel documentId={d.id} renderSnapshot={(s) => <LinesTable lines={(s.lines as RequisitionLine[]) ?? []} />} />
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Approval" />
            <div className="px-5 py-4">
              {d.status === "draft" && !d.approvals.length ? (
                <p className="text-sm text-muted">Approvals start when the requisition is submitted.</p>
              ) : (
                <ApprovalProgress steps={d.approvals} />
              )}
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
      {ordering && <CreatePoDialog pr={d} open onClose={() => setOrdering(false)} />}
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

function LinesTable({ lines }: { lines: RequisitionLine[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-4 py-2 text-right font-medium">Qty</th>
            <th className="px-4 py-2 text-right font-medium">Est. rate</th>
            <th className="px-4 py-2 text-right font-medium">Amount</th>
            <th className="px-4 py-2 font-medium">Needed by</th>
            <th className="px-4 py-2 text-right font-medium">Ordered</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((l) => (
            <tr key={l.id ?? l.lineNo}>
              <td className="px-4 py-2.5 text-muted">{l.lineNo}</td>
              <td className="px-4 py-2.5">
                <p>{l.description}</p>
                {l.remarks && <p className="text-xs text-muted">{l.remarks}</p>}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                {formatQty(l.quantity)} {l.uom}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{l.estimatedRate ? formatMoney(l.estimatedRate) : "—"}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatMoney(l.estimatedAmount)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatDate(l.requiredBy)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                {Number(l.orderedQty ?? 0) > 0 ? formatQty(l.orderedQty) : <span className="text-muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
