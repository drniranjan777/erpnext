"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { HR } from "@/lib/hr";

interface Letter { id: string; title: string; body: string; issuedOn: string; company: { name: string; address: Record<string, string> | null; gstin: string | null } | null }

/** An issued HR letter on the company letterhead. */
export default function PrintLetterPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const q = useQuery({ queryKey: [HR, "letters", id], queryFn: () => api<Letter>(`${HR}/letters/${id}`), enabled: status === "authenticated" });
  const d = q.data;
  const address = d?.company?.address ? [d.company.address.line1, d.company.address.line2, d.company.address.city, d.company.address.pincode].filter(Boolean).join(", ") : "";
  return (
    <PrintShell title={d?.title ?? "Letter"} ready={!!d}>
      {d && (
        <div className="mx-auto max-w-[210mm] bg-white p-12 text-[13px] leading-relaxed text-black shadow print:max-w-none print:p-0 print:shadow-none">
          <style>{"@page { size: A4; margin: 20mm; }"}</style>
          <div className="mb-8 border-b-2 border-black pb-3">
            <p className="text-lg font-bold">{d.company?.name}</p>
            {address && <p className="text-xs">{address}</p>}
          </div>
          <p className="mb-6 text-right">Date: {formatDate(d.issuedOn)}</p>
          <div className="whitespace-pre-wrap">{d.body}</div>
        </div>
      )}
    </PrintShell>
  );
}
