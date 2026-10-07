"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { HR } from "@/lib/hr";
import { textarea } from "@/lib/qms";

interface Template { id: string; code: string; name: string; kind: string; body: string; isActive: boolean }
const KINDS = ["offer", "appointment", "confirmation", "promotion", "transfer", "increment", "experience", "relieving", "warning", "other"];
const PLACEHOLDERS = "{{employee.name}} {{employee.first_name}} {{employee.code}} {{designation}} {{department}} {{grade}} {{location}} {{manager}} {{doj}} {{confirmed_on}} {{exit_date}} {{company}} {{today}}";

export default function LetterTemplatesPage() {
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const q = useQuery({ queryKey: [HR, "templates"], queryFn: () => api<Template[]>(`${HR}/letter-templates`) });
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Letter templates" description="Offer, appointment, confirmation and other letters, filled in from the employee record." actions={<Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> New template</Button>} />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-2">
                <span className="w-24 font-mono text-xs text-muted">{t.code}</span>
                <span className="font-medium">{t.name}</span>
                <Badge>{t.kind}</Badge>
                {!t.isActive && <Badge>inactive</Badge>}
                <Button className="ml-auto" size="sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil className="size-3.5" aria-hidden /></Button>
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-6 text-center text-muted">No templates yet.</li>}
          </ul>
        </Card>
      )}
      {editing && <TemplateDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TemplateDialog({ row, onClose }: { row: Template | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: row?.code ?? "", name: row?.name ?? "", kind: row?.kind ?? "offer", body: row?.body ?? "", isActive: row?.isActive ?? true });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(row ? `${HR}/letter-templates/${row.id}` : `${HR}/letter-templates`, { method: row ? "PUT" : "POST", body: f });
      await qc.invalidateQueries({ queryKey: [HR, "templates"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={row ? `Edit ${row.name}` : "New letter template"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select>}</Field>
        <Field label="Letter text" className="sm:col-span-3" hint={`Placeholders: ${PLACEHOLDERS}. Any other {{name}} is asked for when the letter is issued.`}>{(p) => <textarea {...p} rows={14} className={textarea} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>
      </div>
    </Dialog>
  );
}
