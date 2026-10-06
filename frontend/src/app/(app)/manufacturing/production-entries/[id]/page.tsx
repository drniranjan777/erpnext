"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DocPageHeader, Info } from "@/components/documents/doc-page";
import { ActivityFeed } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatMoney, formatQty, type DocumentHeader } from "@/lib/documents";
import { ENTRY_LABEL, MFG } from "@/lib/manufacturing";

interface Entry extends DocumentHeader {
  kind: keyof typeof ENTRY_LABEL;
  workOrder: { id: string; number: string | null };
  goodQty: string;
  rejectQty: string;
  materialValue: string;
  conversionValue: string;
  subcontractValue: string;
  outputValue: string;
  varianceValue: string;
  notes: string | null;
  lines: { id: string; lineNo: number; kind: string; code: string; name: string; uom: string; warehouse: string; qty: string; rate: string; amount: string; batchNo: string | null; backflushed: boolean }[];
}

const KIND: Record<string, string> = { material: "Material", output: "Output", reject: "Rejects", byproduct: "By-product", scrap: "Scrap" };

export default function ProductionEntryPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: [MFG, "production-entries", id], queryFn: () => api<Entry>(`${MFG}/production-entries/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const e = q.data!;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DocPageHeader doc={e} back={{ href: `${MFG}/work-orders/${e.workOrder.id}`, label: e.workOrder.number ?? "Work order" }} badges={<Badge>{ENTRY_LABEL[e.kind]}</Badge>} />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Work order" value={<Link className="text-primary hover:underline" href={`${MFG}/work-orders/${e.workOrder.id}`}>{e.workOrder.number}</Link>} />
          {e.kind === "receipt" && <Info label="Good / rejected" value={`${formatQty(e.goodQty)} / ${formatQty(e.rejectQty)}`} />}
          {Number(e.materialValue) !== 0 && <Info label="Materials into WIP" value={formatMoney(e.materialValue)} />}
          {Number(e.conversionValue) !== 0 && <Info label="Time absorbed" value={formatMoney(e.conversionValue)} />}
          {Number(e.subcontractValue) !== 0 && <Info label="Job work absorbed" value={formatMoney(e.subcontractValue)} />}
          {Number(e.outputValue) !== 0 && <Info label="Output out of WIP" value={formatMoney(e.outputValue)} />}
          {e.kind === "close" && <Info label="Variance written off" value={formatMoney(e.varianceValue)} />}
        </dl>
      </Card>
      {e.lines.length > 0 && (
        <Card>
          <CardHeader title="Stock movements" />
          <table className="w-full border-t border-border text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 font-medium">Store</th><th className="px-4 py-2 text-right font-medium">Qty</th><th className="px-4 py-2 text-right font-medium">Rate</th><th className="px-4 py-2 text-right font-medium">Value</th></tr></thead>
            <tbody className="divide-y divide-border">
              {e.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs text-muted">{l.code}</span> {l.name} <Badge className="ml-1">{KIND[l.kind] ?? l.kind}</Badge>
                    {l.backflushed && <Badge className="ml-1">Backflushed</Badge>}
                    {l.batchNo && <span className="block text-xs text-muted">Batch {l.batchNo}</span>}
                  </td>
                  <td className="px-4 py-2">{l.warehouse}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.qty)} {l.uom}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.rate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4"><ActivityFeed documentId={e.id} /></div>
      </Card>
    </div>
  );
}
