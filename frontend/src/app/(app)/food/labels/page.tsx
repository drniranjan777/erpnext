"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Row { itemId: string; code: string; name: string; vegMark: string }
interface Fssai { itemId: string; code: string; name: string; uom: string; made: number; sold: number }

const NUTRIENTS: [string, string][] = [["energyKcal", "Energy (kcal)"], ["protein", "Protein (g)"], ["carbohydrate", "Carbohydrate (g)"], ["totalSugars", "Total sugars (g)"], ["addedSugars", "Added sugars (g)"], ["totalFat", "Total fat (g)"], ["saturatedFat", "Saturated fat (g)"], ["transFat", "Trans fat (g)"], ["sodiumMg", "Sodium (mg)"]];

/** Label content of pre-packaged food, and the FSSAI annual return figures. */
export default function LabelsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const labels = useQuery({ queryKey: ["/food/labels"], queryFn: () => api<Row[]>("/food/labels") });
  const year = new Date().getFullYear();
  const [period, setPeriod] = useState({ from: `${year - 1}-04-01`, to: `${year}-03-31` });
  const fssai = useQuery({ queryKey: ["/food/fssai-return", period], queryFn: () => api<Fssai[]>("/food/fssai-return", { query: period }) });
  const [f, setF] = useState({ itemId: "", itemLabel: "", vegMark: "veg", ingredients: "", servingSizeG: "", netQuantity: "", storage: "", fssaiLicenceNo: "", n: {} as Record<string, string> });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function save() {
    setMsg(null);
    try {
      await api("/food/labels", { body: { itemId: f.itemId, vegMark: f.vegMark, ingredients: f.ingredients, nutrition: Object.fromEntries(NUTRIENTS.map(([k]) => [k, Number(f.n[k] ?? 0)])), servingSizeG: f.servingSizeG ? Number(f.servingSizeG) : null, netQuantity: f.netQuantity || null, storage: f.storage || null, fssaiLicenceNo: f.fssaiLicenceNo || null } });
      setMsg({ tone: "success", text: "Label saved." });
      qc.invalidateQueries({ queryKey: ["/food/labels"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Food labels and FSSAI return" description="What the FSS Labelling and Display Regulations require on the pack: veg / non-veg mark, ingredients, nutrition per 100 g and per serve with %RDA, the allergen statement (from the allergen matrix), net quantity, storage and the FSSAI licence number." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {labels.data?.map((l) => <li key={l.itemId} className="flex items-center gap-3 px-4 py-1.5"><span className={`inline-block size-3 border-2 ${l.vegMark === "veg" ? "border-success" : "border-danger"}`} aria-label={l.vegMark} /><span>{l.code} · {l.name}</span><Link className="ml-auto text-xs text-primary hover:underline" href={`/print/food-label/${l.itemId}`}>Print label</Link></li>)}
          {labels.data && !labels.data.length && <li className="px-4 py-4 text-center text-muted">No labels yet.</li>}
        </ul>
      </Card>
      {can("food.labels.manage") && (
        <Card>
          <CardHeader title="Label content" />
          <div className="space-y-2 border-t border-border p-4 text-sm">
            {f.itemLabel ? <p>{f.itemLabel}</p> : <ItemPicker placeholder="Product" onPick={(i) => setF({ ...f, itemId: i.id, itemLabel: `${i.code} · ${i.name}` })} />}
            <div className="grid gap-2 sm:grid-cols-4">
              <Select aria-label="Veg mark" value={f.vegMark} onChange={(e) => setF({ ...f, vegMark: e.target.value })}><option value="veg">Vegetarian (green)</option><option value="non_veg">Non-vegetarian (brown)</option></Select>
              <Input aria-label="Serving size (g)" type="number" placeholder="Serving size, g" value={f.servingSizeG} onChange={(e) => setF({ ...f, servingSizeG: e.target.value })} />
              <Input aria-label="Net quantity" placeholder="Net quantity" value={f.netQuantity} onChange={(e) => setF({ ...f, netQuantity: e.target.value })} />
              <Input aria-label="FSSAI licence" placeholder="FSSAI licence (14 digits)" value={f.fssaiLicenceNo} onChange={(e) => setF({ ...f, fssaiLicenceNo: e.target.value })} />
            </div>
            <textarea aria-label="Ingredients" rows={2} className="w-full rounded-lg border border-border bg-surface px-3 py-2" placeholder="Ingredients in descending order of weight" value={f.ingredients} onChange={(e) => setF({ ...f, ingredients: e.target.value })} />
            <Input aria-label="Storage" placeholder="Storage instructions" value={f.storage} onChange={(e) => setF({ ...f, storage: e.target.value })} />
            <p className="font-medium">Nutrition per 100 g</p>
            <div className="grid gap-2 sm:grid-cols-3">{NUTRIENTS.map(([k, l]) => <label key={k} className="flex items-center justify-between gap-2">{l}<Input className="h-8 w-24" type="number" step="any" min={0} value={f.n[k] ?? ""} onChange={(e) => setF({ ...f, n: { ...f.n, [k]: e.target.value } })} /></label>)}</div>
            <Button disabled={!f.itemId || f.ingredients.length < 2} onClick={save}>Save label</Button>
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="FSSAI annual return" description="Quantities of each finished product made and sold in the period." action={<span className="flex gap-1"><Input className="h-8 w-36" type="date" aria-label="From" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /><Input className="h-8 w-36" type="date" aria-label="To" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></span>} />
        <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm"><tbody className="divide-y divide-border">{fssai.data?.map((r) => <tr key={r.itemId}><td className="px-4 py-1.5">{r.code} · {r.name}</td><td className="px-4 py-1.5 text-right tabular-nums">{r.made} {r.uom} made</td><td className="px-4 py-1.5 text-right tabular-nums">{r.sold} {r.uom} sold</td></tr>)}</tbody></table></div>
        {fssai.data && !fssai.data.length && <p className="p-4 text-center text-muted"><Badge>no finished products</Badge></p>}
      </Card>
    </div>
  );
}
