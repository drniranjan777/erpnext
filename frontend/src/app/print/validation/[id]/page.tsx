"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Project {
  name: string; systemVersion: string; status: string; gampCategory: number; intendedUse: string | null; modules: string[];
  requirements: { id: string; title: string; text: string; fs: string; gxp: string; part11: boolean; risk: { severity: number; probability: number; detectability: number; note?: string | null }; priority: string; testing: string }[];
  tests: { protocol: string; ref: string; title: string; requirementIds: string[]; steps: string[]; expected: string; actual: string | null; result: string; evidence: string | null; executedAt: string | null }[];
  approvals: { document: string; role: string; signedBy: string; signedAt: string; meaning: string }[];
  trace: { requirementId: string; title: string; priority: string; tests: { ref: string; result: string }[]; status: string }[];
  summary: { IQ: Record<string, number>; OQ: Record<string, number>; PQ: Record<string, number>; fitForUse: boolean };
  documents: Record<string, string>;
}

const dt = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "–");
const lvl = (n: number) => (n === 1 ? "L" : n === 2 ? "M" : "H");

/** The validation package as one printable document set. */
export default function ValidationPrintPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const q = useQuery({ queryKey: ["/validation/projects", id], queryFn: () => api<Project>(`/validation/projects/${id}`), enabled: status === "authenticated" });
  const p = q.data;
  const sigs = (doc: string) => p?.approvals.filter((a) => a.document === doc) ?? [];
  const sig = (doc: string) => <p className="mt-1 italic">{sigs(doc).length ? sigs(doc).map((s) => `${s.meaning} — ${s.signedBy}, ${dt(s.signedAt)}`).join("; ") : "Not yet signed"}</p>;
  return (
    <PrintShell title={p ? `Validation package — ${p.name}` : "Validation package"} ready={!!p}>
      {p && (
        <div className="mx-auto max-w-[190mm] space-y-6 bg-white p-6 text-[10px] text-black">
          <header className="border-b border-black pb-2"><h1 className="text-lg font-bold">Computer system validation package</h1><p>{p.name} · NextGen ERP release {p.systemVersion} · GAMP category {p.gampCategory} · status {p.status}</p>{p.intendedUse && <p>Intended use: {p.intendedUse}</p>}</header>
          <section style={{ breakInside: "avoid-page" }}>
            <h2 className="mb-1 text-[12px] font-bold">1. {p.documents.URS}</h2>
            <table className="w-full border border-black"><thead><tr className="border-b border-black text-left"><th className="px-1">ID</th><th className="px-1">Requirement</th><th className="px-1">How the system meets it</th><th className="px-1">GxP / Part 11</th></tr></thead>
              <tbody>{p.requirements.map((r) => <tr key={r.id} className="border-b border-black/30 align-top"><td className="px-1">{r.id}</td><td className="px-1"><strong>{r.title}.</strong> {r.text}</td><td className="px-1">{r.fs}</td><td className="px-1">{r.gxp}{r.part11 ? " / yes" : ""}</td></tr>)}</tbody></table>
            {sig("URS")}
          </section>
          <section>
            <h2 className="mb-1 text-[12px] font-bold">2. {p.documents.RA}</h2>
            <p>Ratings: severity, probability, detectability (L / M / H); priority from GAMP 5 risk class and detectability.</p>
            <table className="w-full border border-black"><tbody>{p.requirements.map((r) => <tr key={r.id} className="border-b border-black/30"><td className="px-1">{r.id}</td><td className="px-1">S {lvl(r.risk.severity)} · P {lvl(r.risk.probability)} · D {lvl(r.risk.detectability)}</td><td className="px-1 font-semibold">{r.priority}</td><td className="px-1">{r.testing}{r.risk.note ? ` — ${r.risk.note}` : ""}</td></tr>)}</tbody></table>
            {sig("RA")}
          </section>
          {(["IQ", "OQ", "PQ"] as const).map((proto, i) => (
            <section key={proto}>
              <h2 className="mb-1 text-[12px] font-bold">{i + 3}. {p.documents[proto]} — protocol and execution</h2>
              <table className="w-full border border-black"><thead><tr className="border-b border-black text-left"><th className="px-1">Ref</th><th className="px-1">Test and steps</th><th className="px-1">Expected</th><th className="px-1">Actual / evidence</th><th className="px-1">Result</th></tr></thead>
                <tbody>{p.tests.filter((t) => t.protocol === proto).map((t) => <tr key={t.ref} className="border-b border-black/30 align-top"><td className="px-1">{t.ref}<br />{t.requirementIds.join(", ")}</td><td className="px-1"><strong>{t.title}</strong><ol className="list-decimal pl-4">{t.steps.map((s, j) => <li key={j}>{s}</li>)}</ol></td><td className="px-1">{t.expected}</td><td className="px-1">{t.actual ?? ""}{t.evidence ? ` (${t.evidence})` : ""}{t.executedAt ? ` — ${dt(t.executedAt)}` : ""}</td><td className="px-1 font-semibold uppercase">{t.result}</td></tr>)}</tbody></table>
              {sig(proto)}
            </section>
          ))}
          <section>
            <h2 className="mb-1 text-[12px] font-bold">6. Traceability matrix</h2>
            <table className="w-full border border-black"><tbody>{p.trace.map((r) => <tr key={r.requirementId} className="border-b border-black/30"><td className="px-1">{r.requirementId}</td><td className="px-1">{r.title}</td><td className="px-1">{r.priority}</td><td className="px-1">{r.tests.map((t) => `${t.ref} (${t.result})`).join(", ") || "–"}</td><td className="px-1 font-semibold">{r.status}</td></tr>)}</tbody></table>
          </section>
          <section>
            <h2 className="mb-1 text-[12px] font-bold">7. {p.documents.VSR}</h2>
            <p>IQ {p.summary.IQ.pass}/{p.summary.IQ.total} passed, OQ {p.summary.OQ.pass}/{p.summary.OQ.total}, PQ {p.summary.PQ.pass}/{p.summary.PQ.total}. Failed: {p.summary.IQ.fail + p.summary.OQ.fail + p.summary.PQ.fail}; not applicable: {p.summary.IQ.na + p.summary.OQ.na + p.summary.PQ.na}.</p>
            <p className="font-semibold">Conclusion: {p.summary.fitForUse ? "the system is fit for its intended use within the scope above." : "validation is not complete."}</p>
            {sig("VSR")}
          </section>
        </div>
      )}
    </PrintShell>
  );
}
