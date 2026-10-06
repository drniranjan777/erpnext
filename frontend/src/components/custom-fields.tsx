"use client";

import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/documents";

export interface CustomFieldDef {
  id: string;
  entity: string;
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "checkbox";
  options: string[] | null;
  required: boolean;
  helpText: string | null;
  showInPrint: boolean;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

export type CustomValues = Record<string, unknown>;

export function useCustomFields(entity: string) {
  return useQuery({
    queryKey: ["custom-fields", entity, "active"],
    queryFn: () => api<CustomFieldDef[]>("/platform/custom-fields", { query: { entity, activeOnly: "true" } }),
    staleTime: 5 * 60_000,
  });
}

/** Inputs for each active custom field. Errors are keyed by field key. */
export function CustomFieldInputs({
  defs,
  values,
  onChange,
  errors = {},
}: {
  defs: CustomFieldDef[];
  values: CustomValues;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string | undefined>;
}) {
  if (!defs.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {defs.map((f) => {
        const v = values[f.key];
        if (f.type === "checkbox") {
          return (
            <div key={f.key} className="flex items-end pb-2">
              <Checkbox label={f.label} description={f.helpText ?? undefined} checked={v === true} onChange={(e) => onChange(f.key, e.target.checked)} />
            </div>
          );
        }
        return (
          <Field key={f.key} label={f.label} required={f.required} hint={f.helpText ?? undefined} error={errors[f.key]} className={f.type === "textarea" ? "sm:col-span-2" : undefined}>
            {(p) =>
              f.type === "select" ? (
                <Select {...p} value={(v as string) ?? ""} onChange={(e) => onChange(f.key, e.target.value || null)}>
                  <option value="">Select…</option>
                  {f.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : f.type === "textarea" ? (
                <textarea
                  {...p}
                  rows={2}
                  value={(v as string) ?? ""}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              ) : (
                <Input
                  {...p}
                  type={f.type === "date" ? "date" : "text"}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  value={(v as string) ?? ""}
                  onChange={(e) => onChange(f.key, e.target.value)}
                />
              )
            }
          </Field>
        );
      })}
    </div>
  );
}

/** Read-only display of custom field values (definitions decide labels and order). */
export function CustomFieldValues({ defs, values }: { defs: CustomFieldDef[]; values: CustomValues }) {
  const shown = defs.filter((f) => values[f.key] !== undefined);
  if (!shown.length) return null;
  return (
    <>
      {shown.map((f) => {
        const v = values[f.key];
        const text = f.type === "checkbox" ? (v ? "Yes" : "No") : f.type === "date" ? formatDate(v as string) : v === null || v === "" ? "—" : String(v);
        return (
          <div key={f.key}>
            <dt className="text-xs text-muted">{f.label}</dt>
            <dd className="mt-0.5">{text}</dd>
          </div>
        );
      })}
    </>
  );
}
