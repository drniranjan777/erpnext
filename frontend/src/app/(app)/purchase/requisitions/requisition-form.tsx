"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Link2Off, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  CustomFieldInputs,
  useCustomFields,
  type CustomValues,
} from "@/components/custom-fields";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { formatMoney, todayIST } from "@/lib/documents";
import { useUoms, type Item } from "@/lib/masters";
import {
  COMMON_UOMS,
  PR_API,
  PR_ROUTE,
  type Requisition,
} from "@/lib/purchase";

const decimal = (dp: number) => new RegExp(`^\\d{1,14}(\\.\\d{1,${dp}})?$`);

const lineSchema = z.object({
  /** Item master link ("" = free-text line). */
  itemId: z.string(),
  uomId: z.string(),
  itemCode: z.string().max(50),
  description: z.string().trim().min(2, "Describe the item"),
  uom: z.string().trim().min(1, "Unit"),
  quantity: z
    .string()
    .trim()
    .regex(decimal(4), "Number, up to 4 decimals")
    .refine((v) => Number(v) > 0, "Must be > 0"),
  estimatedRate: z
    .string()
    .trim()
    .refine((v) => v === "" || decimal(4).test(v), "Number, up to 4 decimals"),
  requiredBy: z.string(),
  remarks: z.string().max(300),
});

const schema = z.object({
  docDate: z.string().min(1),
  requiredBy: z.string(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  department: z.string().max(80),
  purpose: z.string().max(300),
  notes: z.string().max(2000),
  lines: z.array(lineSchema).min(1, "Add at least one item"),
});
type Values = z.infer<typeof schema>;

const emptyLine = {
  itemId: "",
  uomId: "",
  itemCode: "",
  description: "",
  uom: "NOS",
  quantity: "",
  estimatedRate: "",
  requiredBy: "",
  remarks: "",
};

function toValues(pr?: Requisition): Values {
  if (!pr)
    return {
      docDate: todayIST(),
      requiredBy: "",
      priority: "normal",
      department: "",
      purpose: "",
      notes: "",
      lines: [{ ...emptyLine }],
    };
  return {
    docDate: pr.docDate,
    requiredBy: pr.requiredBy ?? "",
    priority: pr.priority,
    department: pr.department ?? "",
    purpose: pr.purpose ?? "",
    notes: pr.notes ?? "",
    lines: pr.lines.map((l) => ({
      itemId: l.itemId ?? "",
      uomId: l.uomId ?? "",
      itemCode: l.itemCode ?? "",
      description: l.description,
      uom: l.uom,
      quantity: String(Number(l.quantity)),
      estimatedRate: l.estimatedRate ? String(Number(l.estimatedRate)) : "",
      requiredBy: l.requiredBy ?? "",
      remarks: l.remarks ?? "",
    })),
  };
}

function toPayload(v: Values) {
  return {
    docDate: v.docDate,
    requiredBy: v.requiredBy || null,
    priority: v.priority,
    department: v.department || null,
    purpose: v.purpose || null,
    notes: v.notes || null,
    lines: v.lines.map((l) => ({
      itemId: l.itemId || null,
      uomId: l.itemId ? l.uomId || null : null,
      itemCode: l.itemCode || null,
      description: l.description,
      uom: l.uom.toUpperCase(),
      quantity: l.quantity,
      estimatedRate: l.estimatedRate || null,
      requiredBy: l.requiredBy || null,
      remarks: l.remarks || null,
    })),
  };
}

/** Preview only; the server recomputes amounts with exact decimals. */
function lineAmount(qty: string, rate: string) {
  const q = Number(qty);
  const r = Number(rate);
  return Number.isFinite(q) && Number.isFinite(r) && rate !== ""
    ? Math.round(q * r * 100) / 100
    : null;
}

export function RequisitionForm({ existing }: { existing?: Requisition }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const customDefs = useCustomFields("purchase_requisition");
  const [custom, setCustom] = useState<CustomValues>(
    existing?.customFields ?? {},
  );
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: toValues(existing),
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });
  const lines = useWatch({ control: form.control, name: "lines" });
  const { errors, isSubmitting } = form.formState;
  const total = lines.reduce(
    (sum, l) => sum + (lineAmount(l.quantity, l.estimatedRate) ?? 0),
    0,
  );
  // Units each linked item can be bought in (base unit + conversions).
  const linkedIds = [...new Set(lines.map((l) => l.itemId).filter(Boolean))];
  const linked = useQueries({
    queries: linkedIds.map((id) => ({
      queryKey: ["masters", "items", id],
      queryFn: () => api<Item>(`/masters/items/${id}`),
      staleTime: 60_000,
    })),
  });
  const itemById = new Map(
    linked.flatMap((q) => (q.data ? [[q.data.id, q.data] as const] : [])),
  );
  const uoms = useUoms();
  const uomCode = (id: string) =>
    uoms.data?.find((u) => u.id === id)?.code ?? "";
  const unitsFor = (it: Item) => [
    { uomId: it.baseUomId, uom: uomCode(it.baseUomId), factor: "1" },
    ...it.conversions,
  ];

  async function addFromMaster(picked: PickedItem) {
    const it = await api<Item>(`/masters/items/${picked.id}`);
    const units = unitsFor(it).map((u) =>
      u.factor === "1" ? { ...u, uom: picked.baseUom } : u,
    );
    const unit =
      units.find((u) => u.uomId === (it.purchaseUomId ?? it.baseUomId)) ??
      units[0];
    const baseRate = it.lastPurchaseRate ?? it.standardCost;
    const rate = baseRate
      ? String(
          Math.round(Number(baseRate) * Number(unit.factor) * 10000) / 10000,
        )
      : "";
    const blank =
      lines.length === 1 && !lines[0].description && !lines[0].quantity;
    const line = {
      ...emptyLine,
      itemId: it.id,
      uomId: unit.uomId,
      itemCode: it.code,
      description: it.name,
      uom: unit.uom,
      estimatedRate: rate,
    };
    if (blank) form.setValue("lines.0", line);
    else append(line);
  }
  const isEdit = !!existing;

  async function save(values: Values, andSubmit: boolean) {
    setError(null);
    setCustomErrors({});
    try {
      const payload = { ...toPayload(values), customFields: custom };
      const saved = isEdit
        ? await api<Requisition>(`${PR_API}/${existing.id}`, {
            method: "PUT",
            body: { ...payload, version: existing.version },
          })
        : await api<Requisition>(PR_API, { body: payload });
      if (andSubmit)
        await api(`${PR_API}/${saved.id}/submit`, {
          body: { version: saved.version },
        });
      qc.invalidateQueries({ queryKey: [PR_ROUTE] });
      router.push(`${PR_ROUTE}/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const ce: Record<string, string> = {};
        for (const [path, message] of Object.entries(err.fieldErrors)) {
          if (path.startsWith("customFields."))
            ce[path.slice("customFields.".length)] = message;
          else form.setError(path as keyof Values, { message });
        }
        setCustomErrors(ce);
        setError(
          err.status === 409
            ? `${err.message} Your changes were not saved.`
            : err.message,
        );
      } else setError("Could not reach the server. Please try again.");
    }
  }

  const lineError = (i: number, f: keyof Values["lines"][number]) =>
    errors.lines?.[i]?.[f]?.message;

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={form.handleSubmit((v) => save(v, false))}
    >
      {error && <Alert>{error}</Alert>}

      <Card>
        <CardHeader title="Details" />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Date"
            required
            error={errors.docDate?.message}
            hint={existing?.number ? "Fixed once numbered" : undefined}
          >
            {(p) => (
              <Input
                {...p}
                type="date"
                disabled={!!existing?.number}
                {...form.register("docDate")}
              />
            )}
          </Field>
          <Field label="Required by" error={errors.requiredBy?.message}>
            {(p) => (
              <Input
                {...p}
                type="date"
                min={todayIST()}
                {...form.register("requiredBy")}
              />
            )}
          </Field>
          <Field label="Priority">
            {(p) => (
              <Select {...p} {...form.register("priority")}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            )}
          </Field>
          <Field label="Department" error={errors.department?.message}>
            {(p) => (
              <Input
                {...p}
                placeholder="e.g. Production"
                {...form.register("department")}
              />
            )}
          </Field>
          <Field
            label="Purpose"
            className="sm:col-span-2 lg:col-span-4"
            error={errors.purpose?.message}
          >
            {(p) => (
              <Input
                {...p}
                placeholder="Why is this needed? Shown as the title."
                {...form.register("purpose")}
              />
            )}
          </Field>
        </div>
        {!!customDefs.data?.length && (
          <div className="border-t border-border px-5 py-4">
            <CustomFieldInputs
              defs={customDefs.data}
              values={custom}
              errors={customErrors}
              onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))}
            />
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Items"
          description="Pick items from the item master, or describe one-off purchases in a free-text line."
          action={
            <span className="text-sm text-muted">
              Estimated total{" "}
              <strong className="ml-1 text-foreground tabular-nums">
                {formatMoney(total)}
              </strong>
            </span>
          }
        />
        <datalist id="uoms">
          {COMMON_UOMS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="w-10 px-3 py-2 font-medium">#</th>
                <th className="min-w-72 px-2 py-2 font-medium">
                  Item / description *
                </th>
                <th className="w-24 px-2 py-2 font-medium">Unit *</th>
                <th className="w-28 px-2 py-2 text-right font-medium">Qty *</th>
                <th className="w-32 px-2 py-2 text-right font-medium">
                  Est. rate (₹)
                </th>
                <th className="w-32 px-2 py-2 text-right font-medium">
                  Amount
                </th>
                <th className="w-36 px-2 py-2 font-medium">Needed by</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border align-top">
              {fields.map((f, i) => {
                const amt = lineAmount(
                  lines[i]?.quantity ?? "",
                  lines[i]?.estimatedRate ?? "",
                );
                return (
                  <tr key={f.id}>
                    <td className="px-3 py-2.5 text-muted">{i + 1}</td>
                    <td className="px-2 py-2">
                      {lines[i]?.itemId && (
                        <p className="mb-1 flex items-center gap-1.5 text-xs text-muted">
                          <span className="font-mono">{lines[i].itemCode}</span>
                          <button
                            type="button"
                            className="inline-flex items-center gap-0.5 text-primary hover:underline"
                            onClick={() => {
                              form.setValue(`lines.${i}.itemId`, "");
                              form.setValue(`lines.${i}.uomId`, "");
                            }}
                          >
                            <Link2Off className="size-3" aria-hidden /> unlink
                          </button>
                        </p>
                      )}
                      <Input
                        aria-label={`Line ${i + 1} description`}
                        aria-invalid={!!lineError(i, "description")}
                        placeholder="e.g. MS sheet 2mm, IS 2062"
                        {...form.register(`lines.${i}.description`)}
                      />
                      <Input
                        className="mt-1.5 h-8 text-xs"
                        aria-label={`Line ${i + 1} remarks`}
                        placeholder="Remarks / specification (optional)"
                        {...form.register(`lines.${i}.remarks`)}
                      />
                      {lineError(i, "description") && (
                        <p className="mt-1 text-xs text-danger">
                          {lineError(i, "description")}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {lines[i]?.itemId && itemById.get(lines[i].itemId) ? (
                        <select
                          className="h-10 w-full rounded-lg border border-border bg-surface px-2 text-sm"
                          aria-label={`Line ${i + 1} unit`}
                          value={lines[i].uomId}
                          onChange={(e) => {
                            const u = unitsFor(
                              itemById.get(lines[i].itemId)!,
                            ).find((x) => x.uomId === e.target.value);
                            form.setValue(`lines.${i}.uomId`, e.target.value);
                            if (u?.uom) form.setValue(`lines.${i}.uom`, u.uom);
                          }}
                        >
                          {unitsFor(itemById.get(lines[i].itemId)!).map((u) => (
                            <option key={u.uomId} value={u.uomId}>
                              {u.uom}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          list="uoms"
                          className="uppercase"
                          aria-label={`Line ${i + 1} unit`}
                          aria-invalid={!!lineError(i, "uom")}
                          {...form.register(`lines.${i}.uom`)}
                        />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        aria-label={`Line ${i + 1} quantity`}
                        aria-invalid={!!lineError(i, "quantity")}
                        {...form.register(`lines.${i}.quantity`)}
                      />
                      {lineError(i, "quantity") && (
                        <p className="mt-1 text-xs text-danger">
                          {lineError(i, "quantity")}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        aria-label={`Line ${i + 1} estimated rate`}
                        aria-invalid={!!lineError(i, "estimatedRate")}
                        {...form.register(`lines.${i}.estimatedRate`)}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-muted">
                      {amt === null ? "—" : formatMoney(amt)}
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        type="date"
                        aria-label={`Line ${i + 1} needed by`}
                        {...form.register(`lines.${i}.requiredBy`)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={fields.length === 1}
                        onClick={() => remove(i)}
                        aria-label={`Remove line ${i + 1}`}
                      >
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
          <div className="w-full sm:w-96">
            <ItemPicker
              onPick={addFromMaster}
              placeholder="Add from item master: search or scan"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => append({ ...emptyLine })}
            disabled={fields.length >= 200}
          >
            <Plus className="size-3.5" aria-hidden /> Free-text line
          </Button>
          {errors.lines?.root?.message && (
            <p className="mt-2 text-xs text-danger">
              {errors.lines.root.message}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Notes" />
        <div className="px-5 py-4">
          <textarea
            rows={3}
            aria-label="Notes"
            placeholder="Anything the purchase team should know: preferred vendors, delivery location, quality requirements…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            {...form.register("notes")}
          />
        </div>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="secondary" loading={isSubmitting}>
          Save draft
        </Button>
        <Button
          type="button"
          loading={isSubmitting}
          onClick={form.handleSubmit((v) => save(v, true))}
        >
          Save & submit
        </Button>
      </div>
    </form>
  );
}
