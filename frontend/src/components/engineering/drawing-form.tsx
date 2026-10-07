"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { ENG, type Drawing } from "@/lib/engineering";

export function DrawingForm({ drawing }: { drawing?: Drawing }) {
  const router = useRouter();
  const [f, setF] = useState({ drawingNo: drawing?.drawingNo ?? "", revision: drawing?.drawingRevision ?? "A", title: drawing?.title ?? "", sheetSize: drawing?.sheetSize ?? "", notes: drawing?.notes ?? "" });
  const [item, setItem] = useState<{ id: string; label: string } | null>(drawing?.item ? { id: drawing.item.id, label: `${drawing.item.code} ${drawing.item.name}` } : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { ...f, itemId: item?.id ?? null, sheetSize: f.sheetSize || null, notes: f.notes || null, changeId: drawing?.changeId ?? null };
      const r = await api<Drawing>(drawing ? `${ENG}/drawings/${drawing.id}` : `${ENG}/drawings`, { method: drawing ? "PUT" : "POST", body: drawing ? { ...body, version: drawing.version } : body });
      router.push(`${ENG}/drawings/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <Field label="Drawing number" required>{(p) => <Input {...p} className="font-mono uppercase" value={f.drawingNo} onChange={(e) => setF({ ...f, drawingNo: e.target.value.toUpperCase() })} />}</Field>
        <Field label="Revision" required>{(p) => <Input {...p} className="font-mono uppercase" value={f.revision} onChange={(e) => setF({ ...f, revision: e.target.value.toUpperCase() })} />}</Field>
        <Field label="Sheet size">{(p) => <Input {...p} placeholder="A3" value={f.sheetSize} onChange={set("sheetSize")} />}</Field>
        <Field label="Title" required className="sm:col-span-3">{(p) => <Input {...p} value={f.title} onChange={set("title")} />}</Field>
        <Field label="Item" className="sm:col-span-2">{() => (item ? <div className="flex items-center gap-2 text-sm">{item.label}<Button size="sm" variant="ghost" onClick={() => setItem(null)}>Change</Button></div> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} />)}</Field>
        <Field label="Notes">{(p) => <Input {...p} value={f.notes} onChange={set("notes")} />}</Field>
      </Card>
      <p className="text-sm text-muted">Attach the drawing files (PDF, DWG, STEP) on the drawing page after saving. Approving the revision releases it.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={save} loading={busy}>Save</Button>
      </div>
    </div>
  );
}
