"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Label { item: { code: string; name: string }; supplier: { name: string; address: string | null } | null; signalWord: string | null; pictograms: string[]; hazard: { code: string; text: string }[]; precautionary: { code: string; text: string }[]; unNumber: string | null; hazardClass: string | null; packingGroup: string | null; sdsVersion: number }

const SYMBOL: Record<string, string> = { GHS01: "💥", GHS02: "🔥", GHS03: "⭕", GHS04: "🧯", GHS05: "🧪", GHS06: "☠", GHS07: "❗", GHS08: "⚕", GHS09: "🐟" };

/** GHS container label from the issued SDS. */
export default function GhsLabelPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const q = useQuery({ queryKey: ["/hse/labels", id], queryFn: () => api<Label>(`/hse/labels/${id}`), enabled: status === "authenticated" });
  const l = q.data;
  return (
    <PrintShell title={l ? `GHS label — ${l.item.name}` : "GHS label"} ready={!!l}>
      {l && (
        <div className="mx-auto w-[150mm] space-y-2 border-2 border-black bg-white p-4 text-[10px] leading-snug text-black">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[16px] font-bold">{l.item.name}</p>
              <p>{l.item.code}</p>
            </div>
            {l.unNumber && <p className="border border-black px-2 py-1 text-center font-bold">{l.unNumber}<br />Class {l.hazardClass}{l.packingGroup ? ` · PG ${l.packingGroup}` : ""}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {l.pictograms.map((p) => (
              <span key={p} className="flex size-14 rotate-45 items-center justify-center border-[3px] border-red-600 bg-white" title={p}>
                <span className="-rotate-45 text-center text-[20px] leading-none">{SYMBOL[p]}<span className="block text-[6px]">{p}</span></span>
              </span>
            ))}
          </div>
          {l.signalWord && <p className="text-[18px] font-extrabold uppercase">{l.signalWord}</p>}
          <div><p className="font-bold">Hazard statements</p>{l.hazard.map((h) => <p key={h.code}>{h.code} {h.text}</p>)}</div>
          {l.precautionary.length > 0 && <div><p className="font-bold">Precautionary statements</p>{l.precautionary.map((p) => <p key={p.code}>{p.code} {p.text}</p>)}</div>}
          <p className="border-t border-black pt-1">{l.supplier?.name}{l.supplier?.address ? `, ${l.supplier.address}` : ""} · Read the safety data sheet (version {l.sdsVersion}) before use.</p>
        </div>
      )}
    </PrintShell>
  );
}
