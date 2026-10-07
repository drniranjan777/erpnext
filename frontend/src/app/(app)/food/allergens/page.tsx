"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Matrix { allergens: Record<string, string>; items: { id: string; code: string; name: string; type: string; declared: { contains: string[]; mayContain: string[] }; contains: string[]; mayContain: string[]; statement: string }[] }

/** Allergen matrix: declared allergens of materials, rolled up through BOMs to products; changeover check. */
export default function AllergensPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("food.haccp.manage");
  const m = useQuery({ queryKey: ["/food/allergens"], queryFn: () => api<Matrix>("/food/allergens") });
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const co = useQuery({ queryKey: ["/food/allergens/changeover", from, to], queryFn: () => api<{ cleanRequired: boolean; allergensToRemove: string[] }>("/food/allergens/changeover", { query: { from, to } }), enabled: !!from && !!to && from !== to });
  const codes = Object.keys(m.data?.allergens ?? {});
  async function toggle(itemId: string, declared: { contains: string[]; mayContain: string[] }, a: string) {
    // Cycle: none → contains → may contain → none.
    const c = declared.contains.includes(a);
    const mc = declared.mayContain.includes(a);
    const next = c ? { contains: declared.contains.filter((x) => x !== a), mayContain: [...declared.mayContain, a] } : mc ? { contains: declared.contains, mayContain: declared.mayContain.filter((x) => x !== a) } : { contains: [...declared.contains, a], mayContain: declared.mayContain };
    setError(null);
    try {
      await api("/food/allergens", { body: { itemId, ...next } });
      qc.invalidateQueries({ queryKey: ["/food/allergens"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Allergen matrix" description="Declare what each material contains (●) or may contain through cross-contact (○); products inherit from their bills of materials. Click a cell to change a declared value." />
      {error && <Alert>{error}</Alert>}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-surface-muted text-muted"><tr><th className="px-2 py-2 text-left font-medium">Item</th>{codes.map((c) => <th key={c} className="px-1 py-2 font-medium" title={m.data?.allergens[c]}>{m.data?.allergens[c].split(" ")[0]}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {m.data?.items.map((i) => (
              <tr key={i.id}>
                <td className="px-2 py-1">{i.code} · {i.name}{i.statement && <span className="block text-muted">{i.statement}</span>}</td>
                {codes.map((c) => {
                  const own = i.declared.contains.includes(c) ? "●" : i.declared.mayContain.includes(c) ? "○" : "";
                  const inherited = !own && i.contains.includes(c) ? "●" : !own && i.mayContain.includes(c) ? "○" : "";
                  return <td key={c} className="px-1 py-1 text-center">{manage ? <button type="button" className={`h-6 w-6 rounded ${own ? "bg-danger-soft" : "hover:bg-surface-muted"}`} onClick={() => toggle(i.id, i.declared, c)} title={own ? "declared" : inherited ? "from the BOM" : ""}>{own || <span className="text-muted">{inherited}</span>}</button> : own || inherited}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {m.data && !m.data.items.length && <p className="p-6 text-center text-muted">Declare allergens on a material to start.</p>}
        {manage && <div className="border-t border-border p-3"><ItemPicker placeholder="Declare allergens for another item…" onPick={(it) => toggle(it.id, { contains: [], mayContain: [] }, "gluten")} /></div>}
      </Card>
      <Card>
        <CardHeader title="Changeover check" description="Moving a line from one product to another: the allergens to remove call for a validated allergen clean." />
        <div className="flex flex-wrap items-center gap-2 border-t border-border p-4 text-sm">
          <Select className="h-9 w-64" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">From product…</option>{m.data?.items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</Select>
          <span>→</span>
          <Select className="h-9 w-64" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)}><option value="">To product…</option>{m.data?.items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</Select>
          {co.data && (co.data.cleanRequired ? <Badge tone="danger">Allergen clean needed: remove {co.data.allergensToRemove.map((a) => m.data?.allergens[a]).join(", ")}</Badge> : <Badge tone="success">No allergen clean needed</Badge>)}
        </div>
      </Card>
    </div>
  );
}
