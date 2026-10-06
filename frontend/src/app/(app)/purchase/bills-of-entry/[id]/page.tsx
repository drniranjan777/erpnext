"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed } from "@/components/documents/document-parts";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatQty, type DocumentHeader } from "@/lib/documents";

const BOE = "/purchase/bills-of-entry";

interface Boe extends DocumentHeader {
  vendor: { id: string; code: string; name: string };
  boeNo: string;
  boeDate: string;
  portCode: string;
  boeType: string;
  exchangeRate: string;
  assessableTotal: string;
  bcdTotal: string;
  swsTotal: string;
  igstTotal: string;
  cessTotal: string;
  dutyTotal: string;
  capitalised: string;
  customsDuty: string;
  itcAvailable: string;
  goodsReceipt: { id: string; number: string | null } | null;
  purchaseInvoice: { id: string; number: string | null } | null;
  lines: { id: string; lineNo: number; itemCode: string; description: string; hsnCode: string | null; qty: string; uomCode: string; foreignValue: string; assessableValue: string; bcdRate: string; bcdAmount: string; swsAmount: string; igstRate: string; igstAmount: string; cessAmount: string }[];
}

export default function BoePage() {
  const { id } = useParams<{ id: string }>();
  const key = [BOE, id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Boe>(`${BOE}/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DocPageHeader doc={d} back={{ href: BOE, label: "Bills of Entry" }} subtitle={`BE ${d.boeNo} · ${d.portCode} · ${formatDate(d.boeDate)} · ${d.vendor.name}`} actions={<DocumentActions doc={d} apiBase={BOE} routeBase={BOE} queryKey={key} hideEdit />} />
      <DocStatusAlerts
        doc={d}
        approvedNote={d.goodsReceipt ? `Posted. ${formatMoney(d.capitalised)} of customs duty was added to the stock value of ${d.goodsReceipt.number}.` : "Posted. Link a goods receipt to add the duty to stock value."}
      />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Assessable value" value={formatMoney(d.assessableTotal)} />
          <Info label="Customs duty (cost)" value={`${formatMoney(d.customsDuty)} (BCD ${formatMoney(d.bcdTotal)} + SWS ${formatMoney(d.swsTotal)})`} />
          <Info label="Import IGST + cess (ITC)" value={formatMoney(d.itcAvailable)} />
          <Info label="Total duty paid" value={formatMoney(d.dutyTotal)} />
          <Info label="Exchange rate" value={`₹${Number(d.exchangeRate)}`} />
          <Info label="Goods receipt" value={d.goodsReceipt ? <Link href={`/purchase/receipts/${d.goodsReceipt.id}`} className="text-primary hover:underline">{d.goodsReceipt.number}</Link> : null} />
          <Info label="Purchase invoice" value={d.purchaseInvoice ? <Link href={`/purchase/invoices/${d.purchaseInvoice.id}`} className="text-primary hover:underline">{d.purchaseInvoice.number}</Link> : null} />
        </dl>
      </Card>
      <Card>
        <CardHeader title="Items" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 text-right font-medium">Assessable</th>
                <th className="px-4 py-2 text-right font-medium">BCD</th>
                <th className="px-4 py-2 text-right font-medium">SWS</th>
                <th className="px-4 py-2 text-right font-medium">IGST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5">{l.description}<p className="font-mono text-xs text-muted">{l.itemCode} · HSN {l.hsnCode ?? "—"}</p></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(l.qty)} {l.uomCode}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.assessableValue)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.bcdAmount)}<span className="block text-xs text-muted">{Number(l.bcdRate)}%</span></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.swsAmount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.igstAmount)}<span className="block text-xs text-muted">{Number(l.igstRate)}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4"><ActivityFeed documentId={d.id} /></div>
      </Card>
    </div>
  );
}
