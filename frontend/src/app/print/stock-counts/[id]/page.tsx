"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { PrintShell } from "@/components/print-shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatDate, formatQty } from "@/lib/documents";
import { SC_API, scKeys, type StockCount } from "@/lib/inventory";

/** Paper count sheet: book quantities are left out on blind counts. */
export default function PrintCountSheetPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const sc = useQuery({
    queryKey: scKeys.detail(id),
    queryFn: () => api<StockCount>(`${SC_API}/${id}`),
    enabled: status === "authenticated",
  });
  const d = sc.data;

  return (
    <PrintShell
      title={d ? `Count sheet ${d.displayNumber}` : "Count sheet"}
      ready={!!d}
    >
      {d && (
        <div className="mx-auto max-w-[210mm] bg-white p-8 text-[11px] text-black shadow print:max-w-none print:p-0 print:shadow-none">
          <style>
            {
              "@page { size: A4; margin: 12mm; } thead { display: table-header-group; } tr { break-inside: avoid; }"
            }
          </style>
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h1 className="text-lg font-bold">Physical stock count</h1>
              <p>
                {d.company.name} · {d.warehouse.code} {d.warehouse.name}
                {d.itemGroup && ` · ${d.itemGroup.name}`}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold">{d.displayNumber}</p>
              <p>Count date {formatDate(d.docDate)}</p>
              <p>{d.lines.length} lines</p>
            </div>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-black text-left">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Code</th>
                <th className="py-1 pr-2">Item</th>
                <th className="py-1 pr-2">Batch / expiry</th>
                <th className="py-1 pr-2">Unit</th>
                {!d.bookHidden && (
                  <th className="py-1 pr-2 text-right">Book</th>
                )}
                <th className="w-24 py-1 pr-2 text-right">Counted</th>
                <th className="w-32 py-1">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id} className="border-b border-gray-400">
                  <td className="py-2 pr-2">{l.lineNo}</td>
                  <td className="py-2 pr-2 font-mono">{l.itemCode}</td>
                  <td className="py-2 pr-2">{l.itemName}</td>
                  <td className="py-2 pr-2 font-mono">
                    {l.batchNo ?? ""}
                    {l.expiryDate && ` · ${formatDate(l.expiryDate)}`}
                  </td>
                  <td className="py-2 pr-2">{l.uom}</td>
                  {!d.bookHidden && (
                    <td className="py-2 pr-2 text-right">
                      {l.systemQty === null ? "" : formatQty(l.systemQty)}
                    </td>
                  )}
                  <td className="py-2 pr-2 text-right">
                    {l.countedQty === null ? "" : formatQty(l.countedQty)}
                  </td>
                  <td className="py-2">{l.remarks ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-10 grid grid-cols-3 gap-8">
            {["Counted by", "Checked by", "Store in-charge"].map((s) => (
              <div key={s} className="border-t border-black pt-1">
                {s}
              </div>
            ))}
          </div>
        </div>
      )}
    </PrintShell>
  );
}
