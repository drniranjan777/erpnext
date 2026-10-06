"use client";

import { useQuery } from "@tanstack/react-query";
import { toSVG } from "bwip-js/browser";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { MFG, type WorkOrder } from "@/lib/manufacturing";

function Code({ text, qr }: { text: string; qr?: boolean }) {
  const svg = useMemo(() => {
    try {
      return qr ? toSVG({ bcid: "qrcode", text, scale: 2, eclevel: "M" } as Parameters<typeof toSVG>[0]) : toSVG({ bcid: "code128", text, scale: 2, height: 8, includetext: true, textxalign: "center", textsize: 8 });
    } catch {
      return null;
    }
  }, [text, qr]);
  // bwip-js renders the SVG itself from our own text.
  return svg ? <span className={qr ? "inline-block w-24" : "inline-block w-56"} dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="font-mono">{text}</span>;
}

/**
 * Job-card traveller: travels with the batch. Each operation carries a QR code the shop-floor
 * kiosk scans to open that operation.
 */
export default function PrintTravellerPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const q = useQuery({ queryKey: [`${MFG}/work-orders`, id], queryFn: () => api<WorkOrder>(`${MFG}/work-orders/${id}`), enabled: status === "authenticated" });
  const d = q.data;
  return (
    <PrintShell title={d ? `Traveller ${d.displayNumber}` : "Traveller"} ready={!!d}>
      {d && (
        <div className="mx-auto max-w-[210mm] bg-white p-8 text-[11px] text-black shadow print:max-w-none print:p-0 print:shadow-none">
          <style>{"@page { size: A4; margin: 12mm; } tr { break-inside: avoid; }"}</style>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold">Job card traveller</h1>
              <p className="text-sm font-semibold">{d.item.code} {d.item.name}</p>
              <p>Quantity {formatQty(d.qty)} {d.item.uom} · priority {d.priority}{d.plannedEnd ? ` · due ${formatDate(d.plannedEnd)}` : ""}</p>
              <p>Materials from {d.source.code} · output to {d.target.code}{d.salesOrder ? ` · for ${d.salesOrder.number}` : ""}</p>
            </div>
            <div className="text-right">
              <Code text={d.number ?? d.displayNumber} />
            </div>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-black text-left">
                <th className="py-1 pr-2">Op</th>
                <th className="py-1 pr-2">Operation</th>
                <th className="py-1 pr-2">Scan</th>
                <th className="py-1 pr-2 text-right">Plan (min)</th>
                <th className="w-20 py-1 pr-2 text-right">Good</th>
                <th className="w-20 py-1 pr-2 text-right">Rejected</th>
                <th className="w-28 py-1">Operator / sign</th>
              </tr>
            </thead>
            <tbody>
              {d.operations.map((o) => (
                <tr key={o.id} className="border-b border-gray-400 align-top">
                  <td className="py-2 pr-2 font-mono text-sm">{o.seq}</td>
                  <td className="py-2 pr-2">
                    <p className="font-semibold">{o.name}</p>
                    <p>{o.workCenter} {o.workCenterName}{o.tool ? ` · tool ${o.tool}` : ""}</p>
                    {o.isSubcontract && <p>Job work: {o.vendor}</p>}
                    {o.inspection && <p className="font-semibold">Inspect after this operation</p>}
                  </td>
                  <td className="py-2 pr-2"><Code qr text={`JC:${o.id}`} /></td>
                  <td className="py-2 pr-2 text-right">{o.isSubcontract ? "—" : Number(o.plannedMinutes)}</td>
                  <td className="py-2 pr-2" />
                  <td className="py-2 pr-2" />
                  <td className="py-2" />
                </tr>
              ))}
            </tbody>
          </table>
          {d.materials.some((m) => m.kind === "component") && (
            <>
              <h2 className="mt-5 mb-1 font-bold">Materials</h2>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-y border-black text-left"><th className="py-1 pr-2">Item</th><th className="py-1 pr-2">At op</th><th className="py-1 pr-2 text-right">Required</th><th className="w-32 py-1">Batch issued</th></tr>
                </thead>
                <tbody>
                  {d.materials.filter((m) => m.kind === "component").map((m) => (
                    <tr key={m.id} className="border-b border-gray-300"><td className="py-1 pr-2">{m.code} {m.name}</td><td className="py-1 pr-2">{m.operationSeq ?? "—"}</td><td className="py-1 pr-2 text-right">{formatQty(m.requiredQty)} {m.uom}</td><td className="py-1" /></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </PrintShell>
  );
}
