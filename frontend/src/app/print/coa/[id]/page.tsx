"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { QA, type Inspection, type Parameter } from "@/lib/quality";

const spec = (p: Parameter) => (p.kind === "attribute" ? "Conforms" : `${p.lowerLimit !== null ? Number(p.lowerLimit) : "—"} to ${p.upperLimit !== null ? Number(p.upperLimit) : "—"}${p.unit ? ` ${p.unit}` : ""}`);

/** Certificate of analysis for a released lot: the specification and what was found, per characteristic. */
export default function PrintCoaPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const q = useQuery({ queryKey: [QA, "inspections", id, "coa"], queryFn: () => api<Inspection>(`${QA}/inspections/${id}`), enabled: status === "authenticated" });
  const d = q.data;
  const result = (p: Parameter) => {
    const rs = d!.readings.filter((r) => r.parameterId === p.id);
    if (!rs.length) return { text: "Not tested", ok: true };
    if (p.kind === "attribute") {
      const fails = rs.filter((r) => r.passed === false).length;
      return { text: fails ? `${fails} of ${rs.length} failed` : `Conforms (${rs.length} samples)`, ok: !fails };
    }
    const vals = rs.map((r) => Number(r.value)).filter((v) => !Number.isNaN(v));
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const ok = (p.lowerLimit === null || min >= Number(p.lowerLimit)) && (p.upperLimit === null || max <= Number(p.upperLimit));
    return { text: vals.length > 1 ? `${+avg.toFixed(4)} (${min} – ${max}, n = ${vals.length})` : String(vals[0]), ok };
  };
  return (
    <PrintShell title={d ? `CoA ${d.item.code} ${d.batchNo ?? ""}` : "Certificate of analysis"} ready={!!d}>
      {d && (
        <div className="mx-auto max-w-[210mm] bg-white p-10 text-[12px] text-black shadow print:max-w-none print:p-0 print:shadow-none">
          <style>{"@page { size: A4; margin: 15mm; }"}</style>
          <div className="mb-6 flex items-start justify-between border-b-2 border-black pb-3">
            <div>
              <p className="text-base font-bold">{d.company.name}</p>
              <h1 className="mt-1 text-xl font-bold">Certificate of Analysis</h1>
            </div>
            <div className="text-right">
              <p>Certificate no. {d.number}</p>
              <p>Date {formatDate(d.approvedAt?.slice(0, 10) ?? d.docDate)}</p>
            </div>
          </div>
          <table className="mb-6 w-full">
            <tbody>
              <tr><td className="w-40 py-0.5 font-semibold">Product</td><td>{d.item.code} {d.item.name}</td></tr>
              <tr><td className="py-0.5 font-semibold">Batch / lot</td><td className="font-mono">{d.batchNo ?? "—"}</td></tr>
              <tr><td className="py-0.5 font-semibold">Quantity</td><td>{formatQty(d.acceptedQty)} {d.item.uom}</td></tr>
              <tr><td className="py-0.5 font-semibold">Specification</td><td>{d.plan ? `${d.plan.code} ${d.plan.name}` : "—"}{d.party ? ` (for ${d.party.name})` : ""}</td></tr>
              <tr><td className="py-0.5 font-semibold">Sampling</td><td>{d.sampleSize} samples{d.plan?.sampling === "aql" ? `, AQL ${d.plan.aql} level ${d.plan.inspectionLevel}` : ""}</td></tr>
            </tbody>
          </table>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-black text-left">
                <th className="py-1 pr-2">Test</th>
                <th className="py-1 pr-2">Method</th>
                <th className="py-1 pr-2">Specification</th>
                <th className="py-1 pr-2">Result</th>
                <th className="py-1">Conforms</th>
              </tr>
            </thead>
            <tbody>
              {d.parameters.map((p) => {
                const r = result(p);
                return (
                  <tr key={p.id} className="border-b border-gray-300">
                    <td className="py-1 pr-2">{p.name}{p.isCritical ? " *" : ""}</td>
                    <td className="py-1 pr-2">{p.method ?? "—"}</td>
                    <td className="py-1 pr-2">{spec(p)}</td>
                    <td className="py-1 pr-2">{r.text}</td>
                    <td className="py-1">{r.ok ? "Yes" : "No"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-6">Conclusion: the lot {d.result === "accepted" ? "conforms to the specification and is released" : `is ${d.result === "partial" ? "partly released" : d.result}`}.</p>
          <div className="mt-16 flex justify-between">
            <div><div className="w-56 border-t border-black pt-1">Tested by</div></div>
            <div className="text-right"><div className="w-56 border-t border-black pt-1">Approved by (QA)</div></div>
          </div>
        </div>
      )}
    </PrintShell>
  );
}
