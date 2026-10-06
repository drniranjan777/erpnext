"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import type { CustomFieldDef } from "@/components/custom-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";

const TYPE_LABEL: Record<CustomFieldDef["type"], string> = {
  text: "Text",
  textarea: "Long text",
  number: "Number",
  date: "Date",
  select: "Dropdown",
  checkbox: "Yes / No",
};

export default function CustomFieldsPage() {
  const entities = useQuery({ queryKey: ["custom-fields", "entities"], queryFn: () => api<{ value: string; label: string }[]>("/platform/custom-fields/entities") });
  const fields = useQuery({ queryKey: ["custom-fields", "all"], queryFn: () => api<CustomFieldDef[]>("/platform/custom-fields") });
  const [editing, setEditing] = useState<CustomFieldDef | { entity: string } | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Custom fields"
        description="Capture extra information your business needs (cost centre, machine number, project code…) without waiting for a product change."
      />
      {(entities.isLoading || fields.isLoading) && <LoadingBlock />}
      {fields.error && <ErrorBlock error={fields.error} />}
      {entities.data?.map((e) => {
        const list = fields.data?.filter((f) => f.entity === e.value) ?? [];
        return (
          <Card key={e.value}>
            <CardHeader
              title={e.label}
              action={
                <Button size="sm" onClick={() => setEditing({ entity: e.value })}>
                  <Plus className="size-3.5" aria-hidden /> Add field
                </Button>
              }
            />
            {!list.length && <EmptyState title="No custom fields" />}
            {!!list.length && (
              <ul className="divide-y divide-border">
                {list.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {f.label}
                        {f.required && <Badge tone="warning">Required</Badge>}
                        {!f.isActive && <Badge>Inactive</Badge>}
                      </p>
                      <p className="text-xs text-muted">
                        {TYPE_LABEL[f.type]}
                        {f.options?.length ? `: ${f.options.join(", ")}` : ""} · key <code>{f.key}</code>
                        {f.showInPrint ? " · shown on print" : ""}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(f)} aria-label={`Edit ${f.label}`}>
                      <Pencil className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
      {editing && <FieldDialog field={"id" in editing ? editing : null} entity={editing.entity} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FieldDialog({ field, entity, onClose }: { field: CustomFieldDef | null; entity: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    label: field?.label ?? "",
    type: field?.type ?? ("text" as CustomFieldDef["type"]),
    options: field?.options?.join("\n") ?? "",
    required: field?.required ?? false,
    helpText: field?.helpText ?? "",
    showInPrint: field?.showInPrint ?? true,
    sortOrder: field?.sortOrder ?? 0,
    isActive: field?.isActive ?? true,
  });
  const options = form.options
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        label: form.label,
        required: form.required,
        helpText: form.helpText || null,
        showInPrint: form.showInPrint,
        sortOrder: form.sortOrder,
        isActive: form.isActive,
        options: form.type === "select" ? options : null,
      };
      return field
        ? api(`/platform/custom-fields/${field.id}`, { method: "PATCH", body: { ...body, version: field.version } })
        : api("/platform/custom-fields", { body: { ...body, entity, type: form.type } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-fields"] });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};

  return (
    <Dialog
      open
      onClose={onClose}
      title={field ? `Edit field: ${field.label}` : "New custom field"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={form.label.trim().length < 2 || (form.type === "select" && !options.length)} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && !Object.keys(errors).length && <Alert>{(save.error as Error).message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Label" required error={errors.label}>
            {(p) => <Input {...p} placeholder="e.g. Cost centre" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />}
          </Field>
          <Field label="Type" hint={field ? "Type can't be changed after creation" : undefined}>
            {(p) => (
              <Select {...p} disabled={!!field} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CustomFieldDef["type"] })}>
                {Object.entries(TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {form.type === "select" && (
            <Field label="Options (one per line)" required className="sm:col-span-2" error={errors.options}>
              {(p) => (
                <textarea
                  {...p}
                  rows={4}
                  value={form.options}
                  onChange={(e) => setForm({ ...form, options: e.target.value })}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </Field>
          )}
          <Field label="Help text" className="sm:col-span-2">
            {(p) => <Input {...p} value={form.helpText} onChange={(e) => setForm({ ...form, helpText: e.target.value })} />}
          </Field>
          <Field label="Display order">
            {(p) => <Input {...p} type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />}
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          {form.type !== "checkbox" && <Checkbox label="Required" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />}
          <Checkbox label="Show on printouts" checked={form.showInPrint} onChange={(e) => setForm({ ...form, showInPrint: e.target.checked })} />
          {field && <Checkbox label="Active" description="Inactive fields are hidden; saved values are kept" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />}
        </div>
      </div>
    </Dialog>
  );
}
