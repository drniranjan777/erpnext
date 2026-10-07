"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { CHANGE_KIND, DISPOSITION, ENG, type Change, type ChangeKind } from "@/lib/engineering";

interface Line { itemId: string; label: string; toDocId: string; remarks: string }

/** Versions of an item's BOM / formula / drawing to pick the new one from. */
function VersionSelect({ kind, itemId, value, onChange }: { kind: ChangeKind; itemId: string; value: string; onChange: (v: string) => void }) {
  const path = kind === "bom" ? "/manufacturing/boms" : kind === "formula" ? "/process/formulas" : kind === "drawing" ? `${ENG}/drawings` : null;
  const q = useQuery({
    queryKey: ["eng-versions", kind, itemId],
    queryFn: () => api<{ items: { id: string; number: string | null; status: string; bomVersion?: number; formulaVersion?: number; revision?: string }[] }>(path!, { query: { itemId, limit: 50 } }),
    enabled: !!path,
  });
  if (!path) return <span className="text-xs text-muted">–</span>;
  return (
    <Select className="h-9 w-56" aria-label="New version" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not yet created</option>
      {q.data?.items.map((d) => (
        <option key={d.id} value={d.id}>
          {d.revision ? `Rev ${d.revision}` : `v${d.bomVersion ?? d.formulaVersion ?? "?"}`} · {d.number ?? "draft"} ({d.status.replace("_", " ")})
        </option>
      ))}
    </Select>
  );
}

export function ChangeForm({ change }: { change?: Change }) {
  const router = useRouter();
  const [f, setF] = useState({
    kind: (change?.kind ?? "bom") as ChangeKind,
    reason: change?.reason ?? "",
    description: change?.description ?? "",
    priority: change?.priority ?? "normal",
    effectiveDate: change?.effectiveDate ?? "",
    disposition: change?.disposition ?? "use_as_is",
  });
  const [lines, setLines] = useState<Line[]>(change?.items.map((l) => ({ itemId: l.item.id, label: `${l.item.code} ${l.item.name}`, toDocId: l.to?.id ?? "", remarks: l.remarks ?? "" })) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { ...f, description: f.description || null, effectiveDate: f.effectiveDate || null, items: lines.map((l) => ({ itemId: l.itemId, toDocId: l.toDocId || null, remarks: l.remarks || null })) };
      const r = await api<Change>(change ? `${ENG}/changes/${change.id}` : `${ENG}/changes`, { method: change ? "PUT" : "POST", body: change ? { ...body, version: change.version } : body });
      router.push(`${ENG}/changes/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <Field label="What changes">{(p) => <Select {...p} value={f.kind} onChange={(e) => { setF({ ...f, kind: e.target.value as ChangeKind }); setLines(lines.map((l) => ({ ...l, toDocId: "" }))); }}>{Object.entries(CHANGE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Priority">{(p) => <Select {...p} value={f.priority} onChange={set("priority")}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select>}</Field>
        <Field label="Effective from">{(p) => <Input {...p} type="date" value={f.effectiveDate} onChange={set("effectiveDate")} />}</Field>
        <Field label="Reason" required className="sm:col-span-3">{(p) => <Input {...p} placeholder="Customer complaint, cost reduction, supplier change…" value={f.reason} onChange={set("reason")} />}</Field>
        <Field label="Description of the change" className="sm:col-span-2">{(p) => <textarea {...p} rows={3} value={f.description} onChange={set("description")} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />}</Field>
        <Field label="Existing stock and open orders">{(p) => <Select {...p} value={f.disposition} onChange={set("disposition")}>{Object.entries(DISPOSITION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
      </Card>
      <Card>
        <CardHeader title="Affected items" description="The version in use now is filled in for you. Point at the new BOM, formula or drawing version once it is drafted; the change can only be implemented when that is approved." />
        <div className="space-y-2 border-t border-border p-4">
          {lines.map((l, i) => (
            <div key={l.itemId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-64 truncate">{l.label}</span>
              <VersionSelect kind={f.kind} itemId={l.itemId} value={l.toDocId} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, toDocId: v } : x)))} />
              <Input className="h-9 flex-1" aria-label="Remarks" placeholder="Remarks" value={l.remarks} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, remarks: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-2">
            <Plus className="size-4 text-muted" aria-hidden />
            <div className="w-80"><ItemPicker placeholder="Add an item…" onPick={(it) => !lines.some((l) => l.itemId === it.id) && setLines([...lines, { itemId: it.id, label: `${it.code} ${it.name}`, toDocId: "", remarks: "" }])} /></div>
          </div>
        </div>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={save} loading={busy} disabled={!lines.length}>{change ? "Save" : "Raise change request"}</Button>
      </div>
    </div>
  );
}
