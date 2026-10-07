"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { QMS, textarea, type Sop } from "@/lib/qms";

export function SopForm({ sop }: { sop?: Sop }) {
  const router = useRouter();
  const [f, setF] = useState({ sopCode: sop?.sopCode ?? "", title: sop?.title ?? "", department: sop?.department ?? "", purpose: sop?.purpose ?? "", body: sop?.body ?? "", effectiveDate: sop?.effectiveDate ?? "", reviewDue: sop?.reviewDue ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    setError(null);
    const body = { ...f, department: f.department || null, purpose: f.purpose || null, body: f.body || null, effectiveDate: f.effectiveDate || null, reviewDue: f.reviewDue || null };
    try {
      const r = await api<Sop>(sop ? `${QMS}/sops/${sop.id}` : `${QMS}/sops`, { method: sop ? "PUT" : "POST", body: sop ? { ...body, version: sop.version } : body });
      router.push(`/quality/sops/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-4 p-5 sm:grid-cols-4">
        <Field label="SOP code" required>{(p) => <Input {...p} className="font-mono uppercase" disabled={!!sop} value={f.sopCode} onChange={set("sopCode")} />}</Field>
        <Field label="Title" required className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={set("title")} />}</Field>
        <Field label="Department">{(p) => <Input {...p} value={f.department} onChange={set("department")} />}</Field>
        <Field label="Effective from" hint="Blank = on release">{(p) => <Input {...p} type="date" value={f.effectiveDate} onChange={set("effectiveDate")} />}</Field>
        <Field label="Review by">{(p) => <Input {...p} type="date" value={f.reviewDue} onChange={set("reviewDue")} />}</Field>
        <Field label="Purpose and scope" className="sm:col-span-4">{(p) => <textarea {...p} rows={2} className={textarea} value={f.purpose} onChange={set("purpose")} />}</Field>
        <Field label="Procedure" hint="Or attach the controlled copy after saving" className="sm:col-span-4">{(p) => <textarea {...p} rows={14} className={`${textarea} font-mono`} value={f.body} onChange={set("body")} />}</Field>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={save} loading={busy}>Save</Button>
      </div>
    </div>
  );
}
