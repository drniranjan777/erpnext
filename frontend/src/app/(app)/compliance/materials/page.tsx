"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Decl { rohs: string; rohsExemptions: string[]; svhc: { substance: string; cas: string; pct: number }[]; uses3tg: boolean; smelters: { metal: string; name: string; smelterId: string | null; conformant: boolean }[]; bisRequired: boolean; declaredOn: string | null; validUntil: string | null }
interface Row { itemId: string; code: string; name: string; isAssembly: boolean; declaration: Decl | null; rohs: string; svhc: { part: string; substance: string; cas: string; pct: number }[]; reachArticle33: boolean; uses3tg: boolean; nonConformantSmelters: { part: string; metal: string; name: string }[]; unknownParts: string[]; declarationExpired: boolean; bisRequired: boolean; bisRegistration: string | null; bisMissing: boolean }

const ROHS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { compliant: "success", exempt: "warning", non_compliant: "danger", unknown: "neutral" };

/** RoHS / REACH / conflict minerals by part and product, and BIS registrations. */
export default function MaterialsCompliancePage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["/compliance/materials"], queryFn: () => api<Row[]>("/compliance/materials") });
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [f, setF] = useState({ rohs: "compliant", exemptions: "", svhc: "", smelters: "", uses3tg: false, bisRequired: false, validUntil: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function save() {
    setMsg(null);
    try {
      // One per line: substance | CAS | % w/w ; metal | smelter | RMI id | yes/no
      const svhc = f.svhc.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((x) => x[0]).map(([substance, cas, pct]) => ({ substance, cas, pct: Number(pct) }));
      const smelters = f.smelters.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((x) => x[0]).map(([metal, name, smelterId, ok]) => ({ metal: metal.toLowerCase(), name, smelterId: smelterId || null, conformant: /^(y|yes|true|conformant)$/i.test(ok ?? "") }));
      await api("/compliance/materials", { body: { itemId: item?.id, rohs: f.rohs, rohsExemptions: f.exemptions.split(",").map((x) => x.trim()).filter(Boolean), svhc, uses3tg: f.uses3tg || smelters.length > 0, smelters, bisRequired: f.bisRequired, declaredOn: new Date().toISOString().slice(0, 10), validUntil: f.validUntil || null } });
      setMsg({ tone: "success", text: "Declaration saved." });
      setItem(null);
      qc.invalidateQueries({ queryKey: ["/compliance/materials"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Materials compliance" description="Supplier declarations per part — RoHS (with exemptions), REACH substances of very high concern, conflict minerals smelters (CMRT) — rolled up through bills of materials to each product; BIS registration where the Compulsory Registration Scheme applies." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((r) => (
            <li key={r.itemId} className="space-y-1 px-4 py-2">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.code} · {r.name}</span>
                {r.isAssembly && <Badge>assembly</Badge>}
                <Badge tone={ROHS_TONE[r.rohs]}>RoHS {r.rohs.replace("_", " ")}</Badge>
                {r.reachArticle33 && <Badge tone="warning">REACH Art. 33</Badge>}
                {r.nonConformantSmelters.length > 0 && <Badge tone="danger">{r.nonConformantSmelters.length} smelter(s) not conformant</Badge>}
                {r.bisRequired && <Badge tone={r.bisMissing ? "danger" : "success"}>{r.bisMissing ? "BIS registration missing" : `BIS ${r.bisRegistration}`}</Badge>}
                {r.declarationExpired && <Badge tone="warning">declaration expired</Badge>}
              </p>
              {r.svhc.length > 0 && <p className="text-xs text-muted">SVHC: {r.svhc.map((s) => `${s.substance} (${s.cas}) ${s.pct} % in ${s.part}`).join("; ")}</p>}
              {r.nonConformantSmelters.length > 0 && <p className="text-xs text-muted">Smelters: {r.nonConformantSmelters.map((s) => `${s.metal} — ${s.name} (${s.part})`).join("; ")}</p>}
              {r.isAssembly && r.unknownParts.length > 0 && <p className="text-xs text-muted">No declaration: {r.unknownParts.join(", ")}</p>}
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-4 py-6 text-center text-muted">No declarations yet.</li>}
        </ul>
      </Card>
      {can("compliance.materials.manage") && (
        <Card>
          <CardHeader title="Record a supplier declaration" />
          <div className="space-y-2 border-t border-border p-4 text-sm">
            {item ? <p>{item.label}</p> : <ItemPicker placeholder="Part or product" onPick={(i) => setItem({ id: i.id, label: `${i.code} · ${i.name}` })} />}
            <div className="grid gap-2 sm:grid-cols-3">
              <Select aria-label="RoHS" value={f.rohs} onChange={(e) => setF({ ...f, rohs: e.target.value })}><option value="compliant">RoHS compliant</option><option value="exempt">Compliant with exemptions</option><option value="non_compliant">Not compliant</option><option value="unknown">Unknown</option></Select>
              <Input aria-label="Exemptions" placeholder="Exemptions, e.g. 6(c), 7(a)" value={f.exemptions} onChange={(e) => setF({ ...f, exemptions: e.target.value })} />
              <label className="text-xs text-muted">Declaration valid until<Input type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} /></label>
            </div>
            <textarea aria-label="SVHC" rows={2} className="w-full rounded-lg border border-border bg-surface px-3 py-2" placeholder="SVHCs, one per line: substance | CAS | % w/w" value={f.svhc} onChange={(e) => setF({ ...f, svhc: e.target.value })} />
            <textarea aria-label="Smelters" rows={2} className="w-full rounded-lg border border-border bg-surface px-3 py-2" placeholder="3TG smelters, one per line: metal | smelter | RMI id | conformant (yes / no)" value={f.smelters} onChange={(e) => setF({ ...f, smelters: e.target.value })} />
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1"><input type="checkbox" checked={f.uses3tg} onChange={(e) => setF({ ...f, uses3tg: e.target.checked })} /> contains tin, tantalum, tungsten or gold</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={f.bisRequired} onChange={(e) => setF({ ...f, bisRequired: e.target.checked })} /> needs BIS registration (CRS)</label>
            </div>
            <Button disabled={!item} onClick={save}>Save declaration</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
