"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";

interface Cert { id: string; subjectType: string; subject: string | null; type: string; number: string; issuer: string | null; scope: string | null; validUntil: string | null; url: string | null; state: "valid" | "expiring" | "expired" }

const TYPES: Record<string, string> = { fssc22000: "FSSC 22000", brcgs: "BRCGS", iso22000: "ISO 22000", fssai: "FSSAI licence", halal: "Halal", organic: "Organic", gots: "GOTS", oekotex: "OEKO-TEX", bis: "BIS registration", iso9001: "ISO 9001", iso14001: "ISO 14001", iatf16949: "IATF 16949", other: "Other" };
const TONE = { valid: "success", expiring: "warning", expired: "danger" } as const;

/** Certificates of suppliers, products and the company, with their expiry. */
export default function CertificatesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["/compliance/certificates"], queryFn: () => api<Cert[]>("/compliance/certificates") });
  const [kind, setKind] = useState<"party" | "item" | "company">("party");
  const [party, setParty] = useState<PickedParty | null>(null);
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [f, setF] = useState({ type: "fssc22000", number: "", issuer: "", scope: "", validUntil: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function add() {
    setMsg(null);
    try {
      await api("/compliance/certificates", { body: { subjectType: kind, subjectId: kind === "party" ? party?.id : kind === "item" ? item?.id : null, type: f.type, number: f.number, issuer: f.issuer || null, scope: f.scope || null, validUntil: f.validUntil || null } });
      setMsg({ tone: "success", text: "Certificate added." });
      setF({ ...f, number: "", issuer: "", scope: "", validUntil: "" });
      qc.invalidateQueries({ queryKey: ["/compliance/certificates"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Certificates" description="Supplier food-safety and quality certificates, product certifications (GOTS, OEKO-TEX, BIS) and the company's own, flagged 60 days before they expire." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2"><Badge tone={TONE[c.state]}>{c.state}</Badge><span className="font-medium">{TYPES[c.type] ?? c.type}</span><span>{c.number}</span><span className="text-xs text-muted">{c.subject ?? ""}{c.issuer ? ` · ${c.issuer}` : ""}{c.scope ? ` · ${c.scope}` : ""}</span><span className="ml-auto text-xs">{c.validUntil ? `until ${formatDate(c.validUntil)}` : "no expiry"}</span></li>)}
          {list.data && !list.data.length && <li className="px-4 py-6 text-center text-muted">No certificates.</li>}
        </ul>
      </Card>
      {can("compliance.certificates.manage") && (
        <Card>
          <CardHeader title="Add a certificate" />
          <div className="space-y-2 border-t border-border p-4 text-sm">
            <Select className="h-9 w-48" aria-label="Whose" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="party">A supplier or customer</option><option value="item">A product</option><option value="company">Our company</option></Select>
            {kind === "party" && <PartyPicker role="vendor" value={party} onChange={setParty} />}
            {kind === "item" && (item ? <p>{item.label}</p> : <ItemPicker placeholder="Product" onPick={(i) => setItem({ id: i.id, label: `${i.code} · ${i.name}` })} />)}
            <div className="grid gap-2 sm:grid-cols-4">
              <Select aria-label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              <Input aria-label="Number" placeholder="Certificate number" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
              <Input aria-label="Issuer" placeholder="Issued by" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} />
              <Input type="date" aria-label="Valid until" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />
            </div>
            <Input aria-label="Scope" placeholder="Scope" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} />
            <Button disabled={!f.number || (kind === "party" && !party) || (kind === "item" && !item)} onClick={add}>Add</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
