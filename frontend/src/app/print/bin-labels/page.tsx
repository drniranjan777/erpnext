"use client";

import { useQuery } from "@tanstack/react-query";
import { toSVG } from "bwip-js/browser";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { WMS, type Bin } from "@/lib/wms";

export default function BinLabelsPage() {
  return (
    <Suspense fallback={null}>
      <BinLabels />
    </Suspense>
  );
}

/** 75 × 50 mm labels, one per bin: the code in large type and as a QR code for scanning. */
function BinLabels() {
  const sp = useSearchParams();
  const { status } = useAuth();
  const wh = sp.get("wh");
  const zone = sp.get("zone");
  const q = useQuery({ queryKey: [WMS, "bins", wh, zone, "labels"], queryFn: () => api<Bin[]>(`${WMS}/warehouses/${wh}/bins`, { query: { zoneId: zone ?? undefined } }), enabled: status === "authenticated" && !!wh });
  const svgs = useMemo(() => new Map((q.data ?? []).map((b) => [b.id, toSVG({ bcid: "qrcode", text: b.code, scale: 3, eclevel: "M" } as Parameters<typeof toSVG>[0])])), [q.data]);
  const bins = (q.data ?? []).filter((b) => b.isActive);
  return (
    <PrintShell title={`Bin labels (${bins.length})`} ready={!!q.data}>
      <style>{"@page { size: 75mm 50mm; margin: 0 } @media print { .bin-label { break-after: page } }"}</style>
      <div className="flex flex-wrap justify-center gap-4 p-6 print:block print:p-0">
        {bins.map((b) => (
          <div key={b.id} className="bin-label flex items-center gap-3 border border-border bg-white px-3 text-black print:border-0" style={{ width: "75mm", height: "50mm" }}>
            <div className="w-[28mm] shrink-0" dangerouslySetInnerHTML={{ __html: svgs.get(b.id) ?? "" }} />
            <div className="min-w-0">
              <p className="font-mono text-2xl font-bold leading-tight">{b.code}</p>
              <p className="text-xs">{b.zone} · {b.condition}{b.fixedItem ? ` · ${b.fixedItem}` : ""}</p>
            </div>
          </div>
        ))}
      </div>
    </PrintShell>
  );
}
