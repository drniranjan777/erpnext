"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { HR } from "@/lib/hr";

interface Register { title: string; law: string; period: string; company: { name: string; address: Record<string, string> | null } | null; columns: { key: string; label: string; align?: "right" }[]; rows: Record<string, unknown>[] }

const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(v));

/** A statutory register laid out landscape for printing and signing. */
export default function PrintRegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterSheet />
    </Suspense>
  );
}

function RegisterSheet() {
  const { key } = useParams<{ key: string }>();
  const sp = useSearchParams();
  const { status } = useAuth();
  const month = sp.get("month") ?? undefined;
  const year = sp.get("year") ?? undefined;
  const q = useQuery({ queryKey: [HR, "registers", key, month, year], queryFn: () => api<Register>(`${HR}/registers/${key}`, { query: { month, year } }), enabled: status === "authenticated" });
  const r = q.data;
  const addr = r?.company?.address ? [r.company.address.line1, r.company.address.city, r.company.address.pincode].filter(Boolean).join(", ") : "";
  const dense = (r?.columns.length ?? 0) > 20;
  return (
    <PrintShell title={r ? `${r.title} ${r.period}` : "Register"} ready={!!r}>
      {r && (
        <div className={`mx-auto bg-white p-8 text-black shadow print:p-0 print:shadow-none ${dense ? "text-[8px]" : "text-[10px]"}`}>
          <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
          <div className="mb-3 text-center">
            <p className="text-sm font-bold">{r.title}{r.period && ` · ${r.period}`}</p>
            <p>{r.law}</p>
            <p className="mt-1 font-semibold">{r.company?.name}{addr && ` · ${addr}`}</p>
          </div>
          <table className="w-full border-collapse border border-black">
            <thead><tr>{r.columns.map((c) => <th key={c.key} className="border border-black px-1 py-0.5 text-left font-semibold">{c.label}</th>)}</tr></thead>
            <tbody>
              {r.rows.map((row, i) => (
                <tr key={i}>{r.columns.map((c) => <td key={c.key} className={`border border-black px-1 py-0.5 ${c.align === "right" ? "text-right tabular-nums" : ""}`}>{cell(row[c.key])}</td>)}</tr>
              ))}
              {!r.rows.length && <tr><td colSpan={r.columns.length} className="px-2 py-3 text-center">No entries for this period.</td></tr>}
            </tbody>
          </table>
          <p className="mt-6 text-right">Signature of the occupier / manager ______________________</p>
        </div>
      )}
    </PrintShell>
  );
}
