"use client";

import { useQuery } from "@tanstack/react-query";
import { toSVG } from "bwip-js/browser";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatQty } from "@/lib/documents";
import { PLAN } from "@/lib/planning";

interface Loop { id: string; kind: string; item: { code: string; name: string; uom: string }; warehouse: { code: string }; sourceWarehouse: { code: string } | null; containerQty: string; cards: { id: string; cardNo: number }[] }
const KIND: Record<string, string> = { production: "Make", purchase: "Buy", transfer: "Move" };

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    try {
      return toSVG({ bcid: "qrcode", text, scale: 2, eclevel: "M" } as Parameters<typeof toSVG>[0]);
    } catch {
      return null;
    }
  }, [text]);
  // bwip-js renders the SVG itself from our own text.
  return svg ? <span className="inline-block w-24" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="font-mono">{text}</span>;
}

/** Kanban cards to print, cut out and put on the containers. The QR code is `KB:<card id>`. */
export default function PrintKanbanPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const q = useQuery({ queryKey: [PLAN, "kanban"], queryFn: () => api<Loop[]>(`${PLAN}/kanban`), enabled: status === "authenticated" });
  const l = q.data?.find((x) => x.id === id);
  return (
    <PrintShell title={l ? `Kanban cards ${l.item.code}` : "Kanban cards"} ready={!!l}>
      {l && (
        <div className="mx-auto grid max-w-[210mm] grid-cols-2 gap-4 bg-white p-8 text-black print:max-w-none print:p-0">
          <style>{"@page { size: A4; margin: 10mm; } .kb { break-inside: avoid; }"}</style>
          {l.cards.map((c) => (
            <div key={c.id} className="kb flex items-center gap-3 rounded border-2 border-black p-3">
              <Qr text={`KB:${c.id}`} />
              <div className="text-[11px] leading-snug">
                <p className="text-lg font-bold">{l.item.code}</p>
                <p className="font-semibold">{l.item.name}</p>
                <p>{formatQty(l.containerQty)} {l.item.uom} per container</p>
                <p>{KIND[l.kind] ?? l.kind}: {l.sourceWarehouse ? `${l.sourceWarehouse.code} → ` : ""}{l.warehouse.code}</p>
                <p className="mt-1 font-semibold">Card {c.cardNo} of {l.cards.length}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </PrintShell>
  );
}
