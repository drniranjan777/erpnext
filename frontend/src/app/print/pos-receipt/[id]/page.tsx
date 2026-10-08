"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { PrintShell } from "@/components/print-shell";
import { formatDateTime } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Receipt {
  number: string; kind: string; soldAt: string; buyerName: string | null; buyerMobile: string | null; buyerGstin: string | null;
  lines: { code: string; name: string; qty: number; price: number; discountPct: number; gstRate: number; taxable: number; tax: number; total: number }[];
  taxable: number; tax: number; total: number; roundOff: number; change: number; tenders: { mode: string; amount: number; ref?: string | null }[];
  terminal: { code: string; name: string; receiptFooter: string | null }; company: { name: string; gstin: string | null; address: string | null } | null;
}

const n2 = (v: number) => v.toFixed(2);

/** 80 mm thermal receipt: a tax invoice for B2C sales (CGST + SGST split by rate). */
export default function PosReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const q = useQuery({ queryKey: ["/pos/sales", id, "receipt"], queryFn: () => api<Receipt>(`/pos/sales/${id}/receipt`), enabled: status === "authenticated" });
  const r = q.data;
  const rates = r ? [...new Set(r.lines.map((l) => l.gstRate))] : [];
  return (
    <PrintShell title={r ? `Receipt ${r.number}` : "Receipt"} ready={!!r}>
      {r && (
        <div className="mx-auto w-[76mm] bg-white p-2 font-mono text-[10px] leading-snug text-black">
          <p className="text-center text-[12px] font-bold">{r.company?.name}</p>
          {r.company?.address && <p className="text-center">{r.company.address}</p>}
          {r.company?.gstin && <p className="text-center">GSTIN {r.company.gstin}</p>}
          <p className="mt-1 text-center font-bold">{r.kind === "return" ? "CREDIT NOTE" : "TAX INVOICE"}</p>
          <p>No. {r.number}</p>
          <p>{formatDateTime(r.soldAt)} · Till {r.terminal.code}</p>
          {(r.buyerName || r.buyerMobile) && <p>{[r.buyerName, r.buyerMobile].filter(Boolean).join(" · ")}</p>}
          {r.buyerGstin && <p>Buyer GSTIN {r.buyerGstin}</p>}
          <div className="my-1 border-t border-dashed border-black" />
          {r.lines.map((l, i) => (
            <div key={i}>
              <p>{l.name}</p>
              <p className="flex justify-between"><span>{l.qty} × {n2(l.price)}{l.discountPct ? ` −${l.discountPct}%` : ""} @{l.gstRate}%</span><span>{n2(l.total)}</span></p>
            </div>
          ))}
          <div className="my-1 border-t border-dashed border-black" />
          {rates.map((rate) => {
            const ls = r.lines.filter((l) => l.gstRate === rate);
            const taxable = ls.reduce((a, l) => a + l.taxable, 0);
            const tax = ls.reduce((a, l) => a + l.tax, 0);
            return <p key={rate} className="flex justify-between"><span>GST {rate}%: taxable {n2(taxable)}</span><span>CGST {n2(tax / 2)} SGST {n2(tax / 2)}</span></p>;
          })}
          {r.roundOff !== 0 && <p className="flex justify-between"><span>Round off</span><span>{n2(r.roundOff)}</span></p>}
          <p className="flex justify-between text-[12px] font-bold"><span>TOTAL</span><span>₹{n2(r.total)}</span></p>
          {r.tenders.map((t, i) => <p key={i} className="flex justify-between uppercase"><span>{t.mode}{t.ref ? ` ${t.ref}` : ""}</span><span>{n2(t.amount)}</span></p>)}
          {r.change > 0 && <p className="flex justify-between"><span>CHANGE</span><span>{n2(r.change)}</span></p>}
          <div className="my-1 border-t border-dashed border-black" />
          <p className="text-center">Prices include GST.{r.terminal.receiptFooter ? ` ${r.terminal.receiptFooter}` : ""}</p>
        </div>
      )}
    </PrintShell>
  );
}
