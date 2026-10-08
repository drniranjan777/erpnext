"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { currentFy } from "@/lib/esg";

interface Status { category: string; fiscalYear: string; targetKg: number; certifiedKg: number; byKind: Record<string, number>; shortfallKg: number; pct: number | null }
interface Cert { id: string; category: string; fiscalYear: string; subCategory: string | null; kind: string; number: string; issuer: string | null; qtyKg: number; issuedOn: string; amount: number | null }
interface Epr { status: Status[]; certificates: Cert[] }

const CATS: Record<string, string> = { plastic_packaging: "Plastic packaging", e_waste: "E-waste", battery: "Batteries", tyre: "Tyres", used_oil: "Used oil" };

/** EPR obligations against the certificates bought or generated. */
export default function EprPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["/esg/epr"], queryFn: () => api<Epr>("/esg/epr") });
  const [f, setF] = useState(() => ({ category: "plastic_packaging", fiscalYear: currentFy(), subCategory: "", kind: "recycling", number: "", issuerName: "", qtyKg: "", issuedOn: "", amount: "" }));
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function add() {
    setMsg(null);
    try {
      await api("/esg/epr/certificates", { body: { category: f.category, fiscalYear: f.fiscalYear, subCategory: f.subCategory || null, kind: f.kind, number: f.number, issuerName: f.issuerName || null, qtyKg: Number(f.qtyKg), issuedOn: f.issuedOn, amount: f.amount ? Number(f.amount) : null } });
      setMsg({ tone: "success", text: "Certificate added; the obligation is updated." });
      setF({ ...f, number: "", qtyKg: "", amount: "" });
      qc.invalidateQueries({ queryKey: ["/esg/epr"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="EPR certificates" description="Extended producer responsibility under the Plastic Waste, E-Waste and Battery Waste Management Rules: certificates from registered recyclers and processors against each year's target (targets are kept with the HSE registers)." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {q.data?.status.map((s) => (
          <Card key={`${s.category}-${s.fiscalYear}`} className="space-y-2 p-4">
            <p className="flex items-center justify-between font-medium">{CATS[s.category]} · {s.fiscalYear}<Badge tone={s.pct === null ? "neutral" : s.pct >= 100 ? "success" : s.pct >= 60 ? "warning" : "danger"}>{s.pct === null ? "no target" : `${s.pct} %`}</Badge></p>
            <div className="h-2 rounded bg-surface-muted"><div className="h-2 rounded bg-primary" style={{ width: `${Math.min(100, s.pct ?? 0)}%` }} /></div>
            <p className="text-xs text-muted">{s.certifiedKg.toLocaleString("en-IN")} of {s.targetKg.toLocaleString("en-IN")} kg · shortfall {s.shortfallKg.toLocaleString("en-IN")} kg · {Object.entries(s.byKind).map(([k, x]) => `${k.replaceAll("_", " ")} ${x}`).join(", ")}</p>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title="Certificates" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {q.data?.certificates.map((c) => <li key={c.id} className="flex flex-wrap gap-3 px-4 py-1.5"><span className="font-medium">{c.number}</span><span>{CATS[c.category]}{c.subCategory ? ` · ${c.subCategory}` : ""} · {c.kind.replaceAll("_", " ")}</span><span className="tabular-nums">{c.qtyKg.toLocaleString("en-IN")} kg</span><span className="text-xs text-muted">{c.issuer ?? ""} · {formatDate(c.issuedOn)} · FY {c.fiscalYear}{c.amount ? ` · ₹${c.amount.toLocaleString("en-IN")}` : ""}</span></li>)}
          {q.data && !q.data.certificates.length && <li className="px-4 py-6 text-center text-muted">No certificates yet.</li>}
        </ul>
        {can("esg.data.manage") && (
          <div className="grid gap-2 border-t border-border p-4 text-sm sm:grid-cols-4">
            <Select aria-label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(CATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            <Input aria-label="Financial year" placeholder="2026-27" value={f.fiscalYear} onChange={(e) => setF({ ...f, fiscalYear: e.target.value })} />
            <Input aria-label="Sub-category" placeholder="Category I–IV / EEE code" value={f.subCategory} onChange={(e) => setF({ ...f, subCategory: e.target.value })} />
            <Select aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="recycling">Recycling</option><option value="end_of_life">End of life</option><option value="reuse">Reuse</option><option value="refurbishment">Refurbishment</option></Select>
            <Input aria-label="Certificate" placeholder="Certificate number" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
            <Input aria-label="Issuer" placeholder="Recycler / PWP" value={f.issuerName} onChange={(e) => setF({ ...f, issuerName: e.target.value })} />
            <Input aria-label="Quantity" type="number" min={0} placeholder="Quantity, kg" value={f.qtyKg} onChange={(e) => setF({ ...f, qtyKg: e.target.value })} />
            <Input aria-label="Issued on" type="date" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} />
            <Input aria-label="Amount" type="number" min={0} placeholder="Price paid ₹" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <Button disabled={!f.number || !Number(f.qtyKg) || !f.issuedOn} onClick={add}>Add certificate</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
