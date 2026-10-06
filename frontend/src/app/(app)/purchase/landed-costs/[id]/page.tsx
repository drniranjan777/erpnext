"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts } from "@/components/documents/doc-page";
import { ActivityFeed } from "@/components/documents/document-parts";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatMoney, formatQty } from "@/lib/documents";
import { GRN_ROUTE, LC_API, LC_ROUTE, lcKeys, type LandedCost } from "@/lib/purchase";

export default function LandedCostPage() {
  const { id } = useParams<{ id: string }>();
  const lc = useQuery({ queryKey: lcKeys.detail(id), queryFn: () => api<LandedCost>(`${LC_API}/${id}`) });
  if (lc.isLoading) return <LoadingBlock />;
  if (lc.error) return <ErrorBlock error={lc.error} />;
  const d = lc.data!;
  const posted = d.status === "approved";
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: LC_ROUTE, label: "Landed costs" }}
        subtitle={
          <>
            {formatMoney(d.totalCharges)} split by {d.method} over{" "}
            {d.receipts.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ", "}
                <Link href={`${GRN_ROUTE}/${r.id}`} className="text-primary hover:underline">
                  {r.number}
                </Link>
              </span>
            ))}
          </>
        }
        actions={<DocumentActions doc={d} apiBase={LC_API} routeBase={LC_ROUTE} queryKey={lcKeys.detail(id)} hideEdit />}
      />
      <DocStatusAlerts
        doc={d}
        approvedNote={Number(d.unabsorbed) ? `Posted. ${formatMoney(d.unabsorbed)} relates to stock already issued, so it was not added to stock (it goes to the cost of goods consumed).` : "Posted. The full amount was added to stock value."}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Charges" />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {d.charges.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 capitalize">{c.chargeType.replace("_", " ")}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {c.vendor?.name}
                    {c.billRef && ` · ${c.billRef}`}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <CardHeader title="Allocation" />
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 text-right font-medium">Basis</th>
                <th className="px-4 py-2 text-right font-medium">Share</th>
                {posted && <th className="px-4 py-2 text-right font-medium">Into stock</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.allocations.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2.5">
                    {a.itemName}
                    <p className="font-mono text-xs text-muted">
                      {a.itemCode} · {a.warehouseCode}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{d.method === "value" ? formatMoney(a.basis) : formatQty(a.basis)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(a.amount)}</td>
                  {posted && <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(a.absorbed)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4">
          <ActivityFeed documentId={d.id} />
        </div>
      </Card>
    </div>
  );
}
