"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatQty } from "@/lib/documents";
import { QA, type TraceNode } from "@/lib/quality";

const DOC: Record<string, { label: string; path?: string }> = {
  goods_receipt: { label: "Goods receipt", path: "/purchase/receipts" },
  production_entry: { label: "Production" },
  delivery_note: { label: "Delivery", path: "/sales/deliveries" },
  sales_invoice: { label: "Invoice", path: "/sales/invoices" },
  credit_note: { label: "Customer return", path: "/sales/credit-notes" },
  debit_note: { label: "Return to vendor", path: "/purchase/debit-notes" },
  job_work_challan: { label: "To job worker", path: "/job-work/challans" },
  job_work_receipt: { label: "From job worker", path: "/job-work/receipts" },
  stock_entry: { label: "Stock entry", path: "/inventory/stock-entries" },
  stock_count: { label: "Stock count", path: "/inventory/stock-counts" },
};

export default function TraceabilityPage() {
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [f, setF] = useState({ lot: "", by: "batchNo" as "batchNo" | "serialNo", direction: "backward" as "backward" | "forward" });
  const [query, setQuery] = useState<{ itemId: string; lot: string; by: string; direction: string } | null>(null);
  const t = useQuery({
    queryKey: [QA, "trace", query],
    queryFn: () => api<TraceNode>(`${QA}/trace/${query!.direction}`, { query: { itemId: query!.itemId, [query!.by]: query!.lot } }),
    enabled: !!query,
    retry: false,
  });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Traceability" description="Backward: where a lot or serial came from, down to the vendor lots in it. Forward: what it went into and which customers received it." />
      <Card className="grid items-end gap-4 p-5 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <Field label="Item">{() => (item ? <div className="flex items-center gap-2 text-sm">{item.label}<Button size="sm" variant="ghost" onClick={() => setItem(null)}>Change</Button></div> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} stockOnly />)}</Field>
        <Field label="Look up by">{(p) => <Select {...p} value={f.by} onChange={(e) => setF({ ...f, by: e.target.value as typeof f.by })}><option value="batchNo">Batch</option><option value="serialNo">Serial</option></Select>}</Field>
        <Field label={f.by === "batchNo" ? "Batch number" : "Serial number"}>{(p) => <Input {...p} value={f.lot} onChange={(e) => setF({ ...f, lot: e.target.value })} />}</Field>
        <Field label="Direction">{(p) => <Select {...p} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as typeof f.direction })}><option value="backward">Backward (where from)</option><option value="forward">Forward (where to)</option></Select>}</Field>
        <Button disabled={!item || !f.lot.trim()} onClick={() => setQuery({ itemId: item!.id, lot: f.lot.trim(), by: f.by, direction: f.direction })}>Trace</Button>
      </Card>
      {t.isFetching && <LoadingBlock />}
      {t.error && <ErrorBlock error={t.error} />}
      {t.data && !t.isFetching && (
        <Card className="p-5">
          <Node n={t.data} direction={query!.direction} depth={0} />
        </Card>
      )}
    </div>
  );
}

function Node({ n, direction, depth }: { n: TraceNode; direction: string; depth: number }) {
  return (
    <div className={depth ? "border-l-2 border-border pl-4" : undefined}>
      <p className="text-sm">
        <span className="font-mono text-xs text-muted">{n.item.code}</span> <span className="font-medium">{n.item.name}</span>
        {n.batchNo && <Badge className="ml-2">Batch {n.batchNo}</Badge>}
        {n.serialNo && <Badge className="ml-2">Serial {n.serialNo}</Badge>}
        <span className="ml-2 tabular-nums text-muted">{formatQty(n.qty)} {n.item.uom}</span>
      </p>
      {n.onHand && n.onHand.length > 0 && <p className="mt-0.5 text-xs text-muted">In stock: {n.onHand.map((h) => `${h.warehouse} ${formatQty(h.qty)}`).join(", ")}</p>}
      <ul className="mt-2 space-y-3">
        {n.links.map((l) => {
          const doc = DOC[l.docType] ?? { label: l.docType };
          return (
            <li key={l.docId} className="space-y-2">
              <p className="text-sm">
                <span className="text-muted">{direction === "backward" ? "From" : "To"}</span> {doc.label}{" "}
                {l.workOrder ? (
                  <Link className="text-primary hover:underline" href={`/manufacturing/work-orders/${l.workOrder.id}`}>{l.workOrder.number}</Link>
                ) : doc.path ? (
                  <Link className="text-primary hover:underline" href={`${doc.path}/${l.docId}`}>{l.number}</Link>
                ) : (
                  l.number
                )}
                <span className="text-muted"> · {formatDate(l.date)} · {formatQty(l.qty)}</span>
                {l.party && <span> · {l.party}</span>}
              </p>
              {l.lots && l.lots.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wide text-muted">{direction === "backward" ? "Made from" : "Went into"}</p>
                  {l.lots.map((c, i) => <Node key={`${c.item.id}-${c.batchNo ?? c.serialNo ?? i}`} n={c} direction={direction} depth={depth + 1} />)}
                </div>
              )}
            </li>
          );
        })}
        {!n.links.length && <li className="text-sm text-muted">{direction === "backward" ? "No receipt or production found for this lot." : "Not used or shipped yet."}</li>}
      </ul>
    </div>
  );
}
