"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { currentFy, fyOptions } from "@/lib/esg";

interface Factor { id: string; key: string; name: string; scope: number; category: string; unit: string; kgCo2ePerUnit: number; source: string | null }
interface Entry { id: string; period: string; key: string; name: string; scope: number; unit: string; quantity: number; kgCo2ePerUnit: number; source: string; site: string | null; note: string | null }
interface Footprint { scope1: number; scope2: number; scope3: number; total: number; categories: { scope: number; category: string; t: number }[]; months: { period: string; scope1: number; scope2: number; scope3: number }[]; energy: { totalGj: number; electricityGj: number; fuelGj: number }; turnover: number; intensityPerCrore: number | null }

/** Carbon footprint: Scope 1, 2 and 3 from monthly activities. */
export default function CarbonPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("esg.data.manage");
  const [fy, setFy] = useState(currentFy);
  const fp = useQuery({ queryKey: ["/esg/footprint", fy], queryFn: () => api<Footprint>("/esg/footprint", { query: { fiscalYear: fy } }) });
  const entries = useQuery({ queryKey: ["/esg/entries", fy], queryFn: () => api<Entry[]>("/esg/entries", { query: { fiscalYear: fy } }) });
  const factors = useQuery({ queryKey: ["/esg/factors"], queryFn: () => api<Factor[]>("/esg/factors") });
  const [f, setF] = useState({ period: new Date().toISOString().slice(0, 7), factorKey: "diesel_l", quantity: "", site: "", note: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/esg/footprint"] });
      qc.invalidateQueries({ queryKey: ["/esg/entries"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const d = fp.data;
  const max = Math.max(1, ...(d?.months.map((m) => m.scope1 + m.scope2 + m.scope3) ?? []));
  const factor = factors.data?.find((x) => x.key === f.factorKey);
  return (
    <div className="space-y-4">
      <PageHeader title="Carbon footprint" description="Greenhouse gas emissions (GHG Protocol) from fuel, refrigerants, electricity, freight, purchases and travel. Electricity from energy meters, freight from completed trips and purchase spend are pulled in by Sync." actions={<Select className="h-9 w-32" aria-label="Financial year" value={fy} onChange={(e) => setFy(e.target.value)}>{fyOptions().map((y) => <option key={y}>{y}</option>)}</Select>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {d && (
        <div className="grid gap-3 sm:grid-cols-5">
          {[["Scope 1", d.scope1], ["Scope 2", d.scope2], ["Scope 3", d.scope3], ["Total", d.total]].map(([l, v]) => <Card key={l} className="p-4"><p className="text-xs text-muted">{l}</p><p className="text-2xl font-semibold tabular-nums">{Number(v).toLocaleString("en-IN")}</p><p className="text-xs text-muted">t CO2e</p></Card>)}
          <Card className="p-4"><p className="text-xs text-muted">Intensity (Scope 1 + 2)</p><p className="text-2xl font-semibold tabular-nums">{d.intensityPerCrore ?? "–"}</p><p className="text-xs text-muted">t CO2e per ₹ crore · energy {d.energy.totalGj} GJ</p></Card>
        </div>
      )}
      {d && d.months.length > 0 && (
        <Card>
          <CardHeader title="By month" />
          <div className="flex h-40 items-end gap-2 border-t border-border p-4">
            {d.months.map((m) => (
              <div key={m.period} className="flex flex-1 flex-col items-center gap-1" title={`Scope 1 ${m.scope1} · Scope 2 ${m.scope2} · Scope 3 ${m.scope3} t`}>
                <div className="flex w-full flex-col-reverse">
                  <div className="bg-primary" style={{ height: `${(m.scope1 / max) * 110}px` }} />
                  <div className="bg-warning" style={{ height: `${(m.scope2 / max) * 110}px` }} />
                  <div className="bg-success" style={{ height: `${(m.scope3 / max) * 110}px` }} />
                </div>
                <span className="text-[10px] text-muted">{m.period.slice(5)}</span>
              </div>
            ))}
          </div>
          <p className="px-4 pb-3 text-xs text-muted"><span className="text-primary">■</span> Scope 1 <span className="text-warning">■</span> Scope 2 <span className="text-success">■</span> Scope 3</p>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Activities" action={manage && <Button size="sm" variant="secondary" onClick={() => run(() => api("/esg/sync", { body: { period: f.period } }), `Synced ${f.period}.`)}>Sync {f.period}</Button>} />
          <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto border-t border-border text-sm">
            {entries.data?.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-1.5">
                <span className="w-16 text-xs text-muted">{e.period}</span>
                <span>{e.name}</span>
                <span className="tabular-nums">{e.quantity.toLocaleString("en-IN")} {e.unit}</span>
                <span className="text-xs text-muted">= {((e.quantity * e.kgCo2ePerUnit) / 1000).toFixed(3)} t · scope {e.scope}{e.source !== "manual" ? ` · from ${e.source.replace("_", " ")}` : ""}{e.site ? ` · ${e.site}` : ""}</span>
                {manage && e.source === "manual" && <button type="button" className="ml-auto text-xs text-danger hover:underline" onClick={() => run(() => api(`/esg/entries/${e.id}`, { method: "DELETE" }), "Removed.")}>Remove</button>}
              </li>
            ))}
            {entries.data && !entries.data.length && <li className="px-4 py-6 text-center text-muted">No activities in {fy}.</li>}
          </ul>
          {manage && (
            <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
              <Input className="h-9 w-36" type="month" aria-label="Month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} />
              <Select className="h-9 w-64" aria-label="Activity" value={f.factorKey} onChange={(e) => setF({ ...f, factorKey: e.target.value })}>{factors.data?.map((x) => <option key={x.key} value={x.key}>Scope {x.scope} · {x.name}</option>)}</Select>
              <Input className="h-9 w-32" type="number" min={0} step="any" aria-label="Quantity" placeholder={factor?.unit ?? "Quantity"} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
              <Input className="h-9 w-32" aria-label="Site" placeholder="Site" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} />
              <Button disabled={!f.quantity} onClick={() => run(() => api("/esg/entries", { body: { period: f.period, factorKey: f.factorKey, quantity: Number(f.quantity), site: f.site || null, note: f.note || null } }), "Added.").then(() => setF({ ...f, quantity: "" }))}>Add</Button>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="By category" />
          <ul className="divide-y divide-border border-t border-border text-sm">{d?.categories.map((c) => <li key={c.category} className="flex justify-between px-4 py-1.5"><span>Scope {c.scope} · {c.category.replaceAll("_", " ")}</span><span className="tabular-nums">{c.t} t</span></li>)}</ul>
          <CardHeader title="Emission factors" description="Defaults from IPCC, CEA and DEFRA; set your own (supplier data) where you have it." />
          <ul className="max-h-72 divide-y divide-border overflow-y-auto border-t border-border text-xs">{factors.data?.map((x) => <li key={x.id} className="px-4 py-1.5"><span className="font-medium">{x.name}</span>: {x.kgCo2ePerUnit} kg CO2e / {x.unit}<span className="block text-muted">{x.source}</span></li>)}</ul>
        </Card>
      </div>
    </div>
  );
}
