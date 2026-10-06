"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { voucherHref, type LedgerRow } from "@/lib/inventory";

/** Stock ledger rows, newest first. "Balance" is the item + warehouse position after each movement. */
export function LedgerTable({ rows, hideItem }: { rows: LedgerRow[]; hideItem?: boolean }) {
  if (!rows.length) return <p className="px-5 py-4 text-sm text-muted">No movements.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Voucher</th>
            {!hideItem && <th className="px-4 py-2 font-medium">Item</th>}
            <th className="px-4 py-2 font-medium">Warehouse</th>
            <th className="px-4 py-2 text-right font-medium">In / out</th>
            <th className="px-4 py-2 text-right font-medium">Rate</th>
            <th className="px-4 py-2 text-right font-medium">Value</th>
            <th className="px-4 py-2 text-right font-medium">Balance qty</th>
            <th className="px-4 py-2 text-right font-medium">Balance value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const href = voucherHref(r.voucherType, r.voucherId);
            const qty = Number(r.qty);
            return (
              <tr key={r.id} className={r.isReversal ? "bg-surface-muted/50" : undefined}>
                <td className="whitespace-nowrap px-4 py-2 text-muted">{formatDate(r.postingDate)}</td>
                <td className="whitespace-nowrap px-4 py-2">
                  {href ? (
                    <Link href={href} className="text-primary hover:underline">
                      {r.voucherNumber ?? "—"}
                    </Link>
                  ) : (
                    (r.voucherNumber ?? "—")
                  )}
                  {r.isReversal && (
                    <Badge tone="warning" className="ml-2">
                      Cancelled
                    </Badge>
                  )}
                </td>
                {!hideItem && (
                  <td className="px-4 py-2">
                    <Link href={`/inventory/stock/${r.itemId}`} className="hover:underline">
                      <span className="font-mono text-xs text-muted">{r.itemCode}</span> {r.itemName}
                    </Link>
                  </td>
                )}
                <td className="px-4 py-2">
                  {r.warehouseCode}
                  {r.batchNo && <span className="block font-mono text-xs text-muted">{r.batchNo}</span>}
                  {r.serialNos?.length ? <span className="block font-mono text-xs text-muted">{r.serialNos.join(", ")}</span> : null}
                </td>
                <td className={`whitespace-nowrap px-4 py-2 text-right tabular-nums ${qty < 0 ? "text-danger" : "text-success"}`}>
                  {qty > 0 ? "+" : ""}
                  {formatQty(r.qty)} <span className="text-xs text-muted">{r.uom}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-muted">{formatMoney(r.rate)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatMoney(r.value)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatQty(r.balanceQty)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatMoney(r.balanceValue)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
