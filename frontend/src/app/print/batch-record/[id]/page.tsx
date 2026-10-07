"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FIRST_OFF, type Execution } from "@/lib/mes";

const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "–");

/** Batch / job record: who ran what, how, with which checks, set-points and measured parameters. */
export default function BatchRecordPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const q = useQuery({ queryKey: ["/mes/executions", id], queryFn: () => api<Execution>(`/mes/executions/${id}`), enabled: status === "authenticated" });
  const e = q.data;
  return (
    <PrintShell title={e ? `Batch record ${e.jobCard.workOrderNumber} op ${e.jobCard.seq}` : "Batch record"} ready={!!e}>
      {e && (
        <div className="mx-auto max-w-[190mm] space-y-4 bg-white p-6 text-[11px] text-black">
          <header className="border-b border-black pb-2">
            <h1 className="text-lg font-bold">Batch / job record</h1>
            <p>{e.jobCard.workOrderNumber} · {e.jobCard.itemCode} {e.jobCard.itemName} · operation {e.jobCard.seq} {e.jobCard.operation}</p>
          </header>
          <table className="w-full">
            <tbody>
              <tr><td className="w-40 font-semibold">Machine / tool</td><td>{e.jobCard.machineCode ?? "–"} / {e.jobCard.toolCode ?? "–"}</td><td className="w-32 font-semibold">Operator</td><td>{e.operatorName ?? "–"}</td></tr>
              <tr><td className="font-semibold">Started</td><td>{dt(e.jobCard.startedAt)}</td><td className="font-semibold">Ended</td><td>{dt(e.jobCard.endedAt)}</td></tr>
              <tr><td className="font-semibold">Good / rejected</td><td>{e.jobCard.goodQty} / {e.jobCard.rejectQty}</td><td className="font-semibold">Shots</td><td>{e.jobCard.shots}</td></tr>
              <tr><td className="font-semibold">Instructions</td><td colSpan={3}>{e.instruction ? `${e.instruction.title}, version ${e.instruction.version}; steps confirmed: ${e.stepsAcked.map((i) => i + 1).join(", ") || "none"}` : "none"}</td></tr>
            </tbody>
          </table>
          <section>
            <h2 className="mb-1 font-bold">Checks before the start</h2>
            <table className="w-full border border-black">
              <tbody>{e.checks.map((c, i) => <tr key={i} className="border-b border-black/30"><td className="px-1">{c.label}</td><td className="px-1">{c.ok ? "OK" : c.blocking ? "FAILED" : "Warning"}</td><td className="px-1">{c.detail ?? ""}</td></tr>)}</tbody>
            </table>
            {e.scans.materials && e.scans.materials.length > 0 && <p className="mt-1">Materials scanned: {e.scans.materials.map((m) => `${m.code}${m.batchNo ? ` / ${m.batchNo}` : ""}`).join(", ")}</p>}
          </section>
          <section>
            <h2 className="mb-1 font-bold">First-off: {FIRST_OFF[e.firstOff.status][0]}</h2>
            {e.firstOff.at && <p>{e.firstOff.by} · {dt(e.firstOff.at)}{e.firstOff.note ? ` · ${e.firstOff.note}` : ""}</p>}
            {e.firstOff.readings?.length ? <p>{e.firstOff.readings.map((r) => `${r.name} ${r.value} ${r.ok ? "OK" : "OUT"}`).join(" · ")}</p> : null}
          </section>
          {e.inlineChecks.length > 0 && (
            <section>
              <h2 className="mb-1 font-bold">In-line checks</h2>
              <table className="w-full border border-black">
                <tbody>{e.inlineChecks.map((c, i) => <tr key={i} className="border-b border-black/30"><td className="w-36 px-1">{dt(c.at)}</td><td className="px-1">{c.readings.map((r) => `${r.name} ${r.value}${r.ok ? "" : " (OUT)"}`).join(" · ")}</td><td className="w-24 px-1">{c.by ?? ""}</td></tr>)}</tbody>
              </table>
            </section>
          )}
          {e.recipe && (
            <section>
              <h2 className="mb-1 font-bold">Recipe version {e.recipe.version}{e.recipe.download ? ` · sent to the machine: ${e.recipe.download.status}${e.recipe.download.doneAt ? ` (${dt(e.recipe.download.doneAt)})` : ""}` : " · set by hand"}</h2>
              <table className="w-full border border-black">
                <thead><tr className="border-b border-black text-left"><th className="px-1">Parameter</th><th className="px-1">Set-point</th><th className="px-1">Limits</th><th className="px-1">Measured min / avg / max</th><th className="px-1">In spec</th></tr></thead>
                <tbody>{e.recipe.parameters.map((p) => <tr key={p.name} className="border-b border-black/30"><td className="px-1">{p.name}</td><td className="px-1">{p.setPoint} {p.unit ?? ""}</td><td className="px-1">{p.min ?? "–"} to {p.max ?? "–"}</td><td className="px-1">{p.measured ? `${p.measured.min} / ${p.measured.avg} / ${p.measured.max} (${p.measured.n})` : "–"}</td><td className="px-1">{p.inSpec === null ? "–" : p.inSpec ? "Yes" : "NO"}</td></tr>)}</tbody>
              </table>
            </section>
          )}
          {e.parameters.length > 0 && (
            <section>
              <h2 className="mb-1 font-bold">Process parameters recorded</h2>
              <table className="w-full border border-black">
                <tbody>{e.parameters.map((p) => <tr key={p.code} className="border-b border-black/30"><td className="px-1">{p.name} ({p.code})</td><td className="px-1">{p.n ? `${p.min} / ${p.avg} / ${p.max} ${p.unit ?? ""}` : "no readings"}</td><td className="px-1">{p.n} readings</td></tr>)}</tbody>
              </table>
            </section>
          )}
          <footer className="flex justify-between pt-8"><span>Production: ____________________</span><span>Quality: ____________________</span></footer>
        </div>
      )}
    </PrintShell>
  );
}
