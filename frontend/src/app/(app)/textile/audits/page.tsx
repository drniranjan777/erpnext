"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";

interface Audit { id: string; party: string | null; standard: string; auditedOn: string; auditor: string | null; rating: string | null; criticalFindings: number; majorFindings: number; minorFindings: number; validUntil: string | null; capDueOn: string | null; capStatus: string; state: string; capOverdue: boolean; critical: boolean }

const STANDARDS = ["BSCI", "SMETA", "WRAP", "SA8000", "Higg FEM", "Higg FSLM", "GOTS", "buyer COC", "other"];
const TONE = { valid: "success", expiring: "warning", expired: "danger" } as const;

/** Social and environmental compliance audits of our factory and suppliers. */
export default function SocialAuditsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["/textile/audits"], queryFn: () => api<Audit[]>("/textile/audits") });
  const [party, setParty] = useState<PickedParty | null>(null);
  const [f, setF] = useState({ standard: "BSCI", auditedOn: "", auditor: "", rating: "", critical: "0", major: "0", minor: "0", validUntil: "", capDueOn: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/textile/audits"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Social and environmental audits" description="BSCI, SMETA, WRAP, SA8000, Higg and buyer code-of-conduct audits of our factory and of suppliers, with findings, validity and the corrective action plan." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <Badge tone={TONE[a.state as keyof typeof TONE]}>{a.state}</Badge>
              <span className="font-medium">{a.standard}</span>
              <span>{a.party ?? "Our factory"}</span>
              <span className="text-xs text-muted">{formatDate(a.auditedOn)}{a.auditor ? ` · ${a.auditor}` : ""}{a.rating ? ` · rating ${a.rating}` : ""} · findings {a.criticalFindings}/{a.majorFindings}/{a.minorFindings}{a.validUntil ? ` · valid until ${formatDate(a.validUntil)}` : ""}</span>
              {a.critical && <Badge tone="danger">critical finding</Badge>}
              {a.capStatus === "open" && <Badge tone={a.capOverdue ? "danger" : "warning"}>CAP {a.capOverdue ? "overdue" : "open"}{a.capDueOn ? ` · ${formatDate(a.capDueOn)}` : ""}</Badge>}
              {a.capStatus === "open" && can("textile.orders.manage") && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => run(() => api(`/textile/audits/${a.id}/close-cap`, { body: {} }), "Corrective action plan closed.")}>Close CAP</Button>}
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-4 py-6 text-center text-muted">No audits recorded.</li>}
        </ul>
      </Card>
      {can("textile.orders.manage") && (
        <Card>
          <CardHeader title="Record an audit" description="Leave the supplier empty for an audit of our own factory." />
          <div className="space-y-2 border-t border-border p-4 text-sm">
            <PartyPicker role="vendor" value={party} onChange={setParty} />
            <div className="grid gap-2 sm:grid-cols-4">
              <Select aria-label="Standard" value={f.standard} onChange={(e) => setF({ ...f, standard: e.target.value })}>{STANDARDS.map((s) => <option key={s}>{s}</option>)}</Select>
              <label className="text-xs text-muted">Audited on<Input type="date" value={f.auditedOn} onChange={(e) => setF({ ...f, auditedOn: e.target.value })} /></label>
              <Input aria-label="Auditor" placeholder="Audit firm" value={f.auditor} onChange={(e) => setF({ ...f, auditor: e.target.value })} />
              <Input aria-label="Rating" placeholder="Rating / score" value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })} />
              <label className="text-xs text-muted">Critical<Input type="number" min={0} value={f.critical} onChange={(e) => setF({ ...f, critical: e.target.value })} /></label>
              <label className="text-xs text-muted">Major<Input type="number" min={0} value={f.major} onChange={(e) => setF({ ...f, major: e.target.value })} /></label>
              <label className="text-xs text-muted">Minor<Input type="number" min={0} value={f.minor} onChange={(e) => setF({ ...f, minor: e.target.value })} /></label>
              <label className="text-xs text-muted">Valid until<Input type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} /></label>
              <label className="text-xs text-muted">CAP due<Input type="date" value={f.capDueOn} onChange={(e) => setF({ ...f, capDueOn: e.target.value })} /></label>
            </div>
            <Button disabled={!f.auditedOn} onClick={() => run(() => api("/textile/audits", { body: { partyId: party?.id ?? null, standard: f.standard, auditedOn: f.auditedOn, auditor: f.auditor || null, rating: f.rating || null, criticalFindings: Number(f.critical), majorFindings: Number(f.major), minorFindings: Number(f.minor), validUntil: f.validUntil || null, capDueOn: f.capDueOn || null } }), "Audit recorded.")}>Record</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
