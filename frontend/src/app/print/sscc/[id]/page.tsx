"use client";

import { useQuery } from "@tanstack/react-query";
import { toSVG } from "bwip-js/browser";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { WMS } from "@/lib/wms";

interface Label {
  sscc: string;
  kind: string;
  grossWeightKg: string | null;
  orderNumber: string;
  customerPoNo: string | null;
  customer: string;
  shipTo: { line1?: string; line2?: string; city?: string; pincode?: string } | null;
  shipper: string;
  deliveryNumber: string | null;
  seq: number;
  of: number;
  contents: { code: string; name: string; qty: string; batch: { batchNo: string; expiryDate: string | null } | null }[];
}

/** GS1 logistic label, 100 × 150 mm: ship from / to, order references, contents and the SSCC as GS1-128. */
export default function SsccLabelPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const q = useQuery({ queryKey: [WMS, "label", id], queryFn: () => api<Label>(`${WMS}/packages/${id}/label`), enabled: status === "authenticated" });
  const svg = useMemo(() => (q.data ? toSVG({ bcid: "gs1-128", text: `(00)${q.data.sscc}`, scale: 3, height: 18, includetext: true, textxalign: "center" } as Parameters<typeof toSVG>[0]) : ""), [q.data]);
  const l = q.data;
  return (
    <PrintShell title={l ? `SSCC ${l.sscc}` : "Carton label"} ready={!!l}>
      <style>{"@page { size: 100mm 150mm; margin: 0 }"}</style>
      {l && (
        <div className="mx-auto my-6 flex flex-col border border-black bg-white text-black print:my-0 print:border-0" style={{ width: "100mm", height: "150mm" }}>
          <div className="grid grid-cols-2 border-b border-black text-[9pt]">
            <div className="border-r border-black p-2"><p className="text-[7pt] uppercase">From</p><p className="font-semibold">{l.shipper}</p></div>
            <div className="p-2"><p className="text-[7pt] uppercase">To</p><p className="font-semibold">{l.customer}</p><p>{[l.shipTo?.line1, l.shipTo?.city, l.shipTo?.pincode].filter(Boolean).join(", ")}</p></div>
          </div>
          <div className="grid grid-cols-3 border-b border-black text-[9pt]">
            <div className="border-r border-black p-2"><p className="text-[7pt] uppercase">Order</p><p className="font-mono">{l.orderNumber}</p></div>
            <div className="border-r border-black p-2"><p className="text-[7pt] uppercase">Your PO</p><p className="font-mono">{l.customerPoNo ?? "–"}</p></div>
            <div className="p-2"><p className="text-[7pt] uppercase">{l.kind}</p><p className="font-semibold">{l.seq} of {l.of}{l.grossWeightKg && ` · ${Number(l.grossWeightKg)} kg`}</p></div>
          </div>
          <div className="flex-1 overflow-hidden p-2 text-[8pt]">
            <p className="text-[7pt] uppercase">Contents{l.deliveryNumber && ` · delivery ${l.deliveryNumber}`}</p>
            {l.contents.map((c, i) => (
              <p key={i}>{formatQty(c.qty)} × {c.code} {c.name}{c.batch && ` · batch ${c.batch.batchNo}${c.batch.expiryDate ? ` exp ${formatDate(c.batch.expiryDate)}` : ""}`}</p>
            ))}
          </div>
          <div className="border-t border-black p-2">
            <p className="text-[7pt] uppercase">SSCC</p>
            <div className="flex justify-center [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        </div>
      )}
    </PrintShell>
  );
}
