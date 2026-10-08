"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { ItemVendors } from "./item-vendors";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CustomFieldInputs, useCustomFields } from "@/components/custom-fields";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { toast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  ITEM_TYPES,
  useItemGroups,
  useReference,
  useUoms,
  type Item,
  type ItemType,
} from "@/lib/masters";

type Form = {
  code: string;
  name: string;
  description: string;
  type: ItemType;
  groupId: string;
  baseUomId: string;
  purchaseUomId: string;
  salesUomId: string;
  hsnCode: string;
  gstRate: string;
  cessRate: string;
  isNilRatedOrExempt: boolean;
  isStockItem: boolean;
  trackBatch: boolean;
  trackSerial: boolean;
  hasExpiry: boolean;
  shelfLifeDays: string;
  minRemainingShelfLifeDays: string;
  valuationMethod: "weighted_average" | "fifo";
  reorderLevel: string;
  reorderQty: string;
  safetyStock: string;
  minOrderQty: string;
  leadTimeDays: string;
  standardCost: string;
  sellingRate: string;
  mrp: string;
  brand: string;
  netWeightKg: string;
  grossWeightKg: string;
  abcClass: string;
  isActive: boolean;
  conversions: { uomId: string; factor: string }[];
  barcodes: { barcode: string; uomId: string; isPrimary: boolean }[];
  attributes: { key: string; value: string }[];
};

const s = (v: string | number | null | undefined) =>
  v === null || v === undefined
    ? ""
    : String(Number.isNaN(Number(v)) ? v : Number(v));

function initial(item?: Item, defaultUom?: string): Form {
  return {
    code: item?.code ?? "",
    name: item?.name ?? "",
    description: item?.description ?? "",
    type: item?.type ?? "raw_material",
    groupId: item?.groupId ?? "",
    baseUomId: item?.baseUomId ?? defaultUom ?? "",
    purchaseUomId: item?.purchaseUomId ?? "",
    salesUomId: item?.salesUomId ?? "",
    hsnCode: item?.hsnCode ?? "",
    gstRate:
      item?.gstRate !== null && item?.gstRate !== undefined
        ? s(item.gstRate)
        : "18",
    cessRate: item ? s(item.cessRate) : "",
    isNilRatedOrExempt: item?.isNilRatedOrExempt ?? false,
    isStockItem: item?.isStockItem ?? true,
    trackBatch: item?.trackBatch ?? false,
    trackSerial: item?.trackSerial ?? false,
    hasExpiry: item?.hasExpiry ?? false,
    shelfLifeDays: s(item?.shelfLifeDays),
    minRemainingShelfLifeDays: s(item?.minRemainingShelfLifeDays),
    valuationMethod: item?.valuationMethod ?? "weighted_average",
    reorderLevel: s(item?.reorderLevel),
    reorderQty: s(item?.reorderQty),
    safetyStock: s(item?.safetyStock),
    minOrderQty: s(item?.minOrderQty),
    leadTimeDays: s(item?.leadTimeDays),
    standardCost: s(item?.standardCost),
    sellingRate: s(item?.sellingRate),
    mrp: s(item?.mrp),
    brand: item?.brand ?? "",
    netWeightKg: s(item?.netWeightKg),
    grossWeightKg: s(item?.grossWeightKg),
    abcClass: item?.abcClass ?? "",
    isActive: item?.isActive ?? true,
    conversions:
      item?.conversions.map((c) => ({ uomId: c.uomId, factor: s(c.factor) })) ??
      [],
    barcodes:
      item?.barcodes.map((b) => ({
        barcode: b.barcode,
        uomId: b.uomId ?? "",
        isPrimary: b.isPrimary,
      })) ?? [],
    attributes: Object.entries(item?.attributes ?? {}).map(([key, value]) => ({
      key,
      value: value === null ? "" : String(value),
    })),
  };
}

const n = (v: string) => (v.trim() === "" ? null : v.trim());
const int = (v: string) => (v.trim() === "" ? null : Number(v));

/** `onCreateAnother` adds "Save & new": after a create the page starts a fresh form. */
export function ItemEditor({ item, onCreateAnother }: { item?: Item; onCreateAnother?: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const uoms = useUoms();
  const groups = useItemGroups();
  const ref = useReference();
  const customDefs = useCustomFields("item");
  const [form, setForm] = useState<Form>(() => initial(item));
  const [custom, setCustom] = useState<Record<string, unknown>>(
    item?.customFields ?? {},
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const readOnly = !can("masters.items.manage");
  const baseUomId =
    form.baseUomId || uoms.data?.find((u) => u.code === "NOS")?.id || "";

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const uomCode = (id: string) =>
    uoms.data?.find((u) => u.id === id)?.code ?? "";
  const altUoms = [baseUomId, ...form.conversions.map((c) => c.uomId)].filter(
    Boolean,
  );

  async function save(another = false) {
    setSaving(true);
    setError(null);
    setErrors({});
    const body = {
      code: form.code || undefined,
      name: form.name,
      description: n(form.description),
      type: form.type,
      groupId: form.groupId || null,
      baseUomId,
      purchaseUomId: form.purchaseUomId || null,
      salesUomId: form.salesUomId || null,
      hsnCode: n(form.hsnCode),
      gstRate: form.isNilRatedOrExempt ? null : n(form.gstRate),
      cessRate: n(form.cessRate),
      isNilRatedOrExempt: form.isNilRatedOrExempt,
      isStockItem: form.isStockItem,
      trackBatch: form.trackBatch,
      trackSerial: form.trackSerial,
      hasExpiry: form.hasExpiry,
      shelfLifeDays: int(form.shelfLifeDays),
      minRemainingShelfLifeDays: int(form.minRemainingShelfLifeDays),
      valuationMethod: form.valuationMethod,
      reorderLevel: n(form.reorderLevel),
      reorderQty: n(form.reorderQty),
      safetyStock: n(form.safetyStock),
      minOrderQty: n(form.minOrderQty),
      leadTimeDays: int(form.leadTimeDays),
      standardCost: n(form.standardCost),
      sellingRate: n(form.sellingRate),
      mrp: n(form.mrp),
      brand: n(form.brand),
      netWeightKg: n(form.netWeightKg),
      grossWeightKg: n(form.grossWeightKg),
      abcClass: form.abcClass || null,
      isActive: form.isActive,
      conversions: form.conversions.filter((c) => c.uomId),
      barcodes: form.barcodes
        .filter((b) => b.barcode.trim())
        .map((b) => ({
          barcode: b.barcode.trim(),
          uomId: b.uomId || null,
          isPrimary: b.isPrimary,
        })),
      attributes: Object.fromEntries(
        form.attributes
          .filter((a) => a.key.trim())
          .map((a) => [a.key.trim(), a.value]),
      ),
      customFields: custom,
      ...(item ? { version: item.version } : {}),
    };
    try {
      const saved = await api<Item>(
        item ? `/masters/items/${item.id}` : "/masters/items",
        { method: item ? "PUT" : "POST", body },
      );
      qc.invalidateQueries({ queryKey: ["masters", "items"] });
      if (!item && another && onCreateAnother) {
        toast(`${saved.code} · ${saved.name} created.`);
        window.scrollTo({ top: 0 });
        onCreateAnother();
        return;
      }
      router.push(`/masters/items/${saved.id}`);
      if (item) {
        qc.setQueryData(["masters", "item", item.id], saved);
        setForm(initial(saved));
        setSaving(false);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server. Please try again.");
      setSaving(false);
    }
  }

  const err = (k: string) => errors[k];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={item ? `${item.code} · ${item.name}` : "New item"}
        description={
          item
            ? undefined
            : "Code is generated automatically if you leave it blank."
        }
        actions={
          <>
            {item && (
              <Link
                href={`/print/labels?items=${item.id}`}
                target="_blank"
                className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-primary hover:bg-surface-muted"
              >
                Print labels
              </Link>
            )}
            {!readOnly && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => router.push("/masters/items")}
                >
                  Cancel
                </Button>
                {!item && onCreateAnother && (
                  <Button variant="secondary" disabled={saving} onClick={() => save(true)}>
                    Save &amp; new
                  </Button>
                )}
                <Button loading={saving} onClick={() => save()}>
                  {item ? "Save changes" : "Create item"}
                </Button>
              </>
            )}
          </>
        }
      />
      {error && <Alert>{error}</Alert>}
      <fieldset disabled={readOnly} className="space-y-6">
        <Card>
          <CardHeader title="Basics" />
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field
              label="Item name"
              required
              error={err("name")}
              className="sm:col-span-2"
            >
              {(p) => (
                <Input
                  {...p}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. MS sheet 2 mm IS 2062"
                  autoFocus={!item}
                />
              )}
            </Field>
            <Field
              label="Code"
              error={err("code")}
              hint={item ? undefined : "Auto: ITM00001…"}
            >
              {(p) => (
                <Input
                  {...p}
                  className="font-mono uppercase"
                  value={form.code}
                  onChange={(e) => set("code", e.target.value)}
                />
              )}
            </Field>
            <Field label="Type" required>
              {(p) => (
                <Select
                  {...p}
                  value={form.type}
                  onChange={(e) => {
                    const t = e.target.value as ItemType;
                    setForm((f) => ({
                      ...f,
                      type: t,
                      isStockItem: t === "service" ? false : f.isStockItem,
                    }));
                  }}
                >
                  {Object.entries(ITEM_TYPES).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Item group" error={err("groupId")}>
              {(p) => (
                <Select
                  {...p}
                  value={form.groupId}
                  onChange={(e) => set("groupId", e.target.value)}
                >
                  <option value="">None</option>
                  {groups.data?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Brand / make">
              {(p) => (
                <Input
                  {...p}
                  value={form.brand}
                  onChange={(e) => set("brand", e.target.value)}
                />
              )}
            </Field>
            <Field label="ABC class">
              {(p) => (
                <Select
                  {...p}
                  value={form.abcClass}
                  onChange={(e) => set("abcClass", e.target.value)}
                >
                  <option value="">—</option>
                  <option>A</option>
                  <option>B</option>
                  <option>C</option>
                </Select>
              )}
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox
                label="Active"
                checked={form.isActive}
                onChange={(e) => set("isActive", e.target.checked)}
              />
            </div>
            <Field
              label="Description / specification"
              className="sm:col-span-2 lg:col-span-4"
            >
              {(p) => (
                <Input
                  {...p}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              )}
            </Field>
          </div>
          {!!customDefs.data?.length && (
            <div className="border-t border-border px-5 py-4">
              <CustomFieldInputs
                defs={customDefs.data}
                values={custom}
                errors={Object.fromEntries(
                  Object.entries(errors)
                    .filter(([k]) => k.startsWith("customFields."))
                    .map(([k, v]) => [k.slice(13), v]),
                )}
                onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))}
              />
            </div>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="GST" />
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
              <Field
                label="HSN / SAC"
                error={err("hsnCode")}
                hint="4, 6 or 8 digits"
              >
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    className="font-mono"
                    value={form.hsnCode}
                    onChange={(e) =>
                      set("hsnCode", e.target.value.replace(/\D/g, ""))
                    }
                    maxLength={8}
                  />
                )}
              </Field>
              <Field label="GST rate" error={err("gstRate")}>
                {(p) => (
                  <Select
                    {...p}
                    disabled={form.isNilRatedOrExempt}
                    value={form.isNilRatedOrExempt ? "0" : form.gstRate}
                    onChange={(e) => set("gstRate", e.target.value)}
                  >
                    {(
                      ref.data?.gstRates ?? ["0", "5", "12", "18", "28", "40"]
                    ).map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Cess %" error={err("cessRate")}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    value={form.cessRate}
                    onChange={(e) => set("cessRate", e.target.value)}
                  />
                )}
              </Field>
              <div className="sm:col-span-3">
                <Checkbox
                  label="Nil-rated / exempt supply"
                  checked={form.isNilRatedOrExempt}
                  onChange={(e) => set("isNilRatedOrExempt", e.target.checked)}
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Units"
              description="Stock is always kept in the base unit."
            />
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
              <Field label="Base unit" required error={err("baseUomId")}>
                {(p) => (
                  <Select
                    {...p}
                    value={baseUomId}
                    onChange={(e) => set("baseUomId", e.target.value)}
                  >
                    {uoms.data
                      ?.filter((u) => u.isActive)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code} · {u.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              <Field label="Purchase unit" error={err("purchaseUomId")}>
                {(p) => (
                  <Select
                    {...p}
                    value={form.purchaseUomId}
                    onChange={(e) => set("purchaseUomId", e.target.value)}
                  >
                    <option value="">Same as base</option>
                    {altUoms.map((id) => (
                      <option key={id} value={id}>
                        {uomCode(id)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Sales unit" error={err("salesUomId")}>
                {(p) => (
                  <Select
                    {...p}
                    value={form.salesUomId}
                    onChange={(e) => set("salesUomId", e.target.value)}
                  >
                    <option value="">Same as base</option>
                    {altUoms.map((id) => (
                      <option key={id} value={id}>
                        {uomCode(id)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="space-y-2 sm:col-span-3">
                {form.conversions.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span>1</span>
                    <Select
                      aria-label={`Conversion ${i + 1} unit`}
                      className="w-28"
                      value={c.uomId}
                      onChange={(e) =>
                        set(
                          "conversions",
                          form.conversions.map((x, j) =>
                            j === i ? { ...x, uomId: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      <option value="">Unit…</option>
                      {uoms.data
                        ?.filter((u) => u.id !== baseUomId)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code}
                          </option>
                        ))}
                    </Select>
                    <span>=</span>
                    <Input
                      aria-label={`Conversion ${i + 1} factor`}
                      aria-invalid={!!err(`conversions.${i}.factor`)}
                      inputMode="decimal"
                      className="w-28 text-right"
                      value={c.factor}
                      onChange={(e) =>
                        set(
                          "conversions",
                          form.conversions.map((x, j) =>
                            j === i ? { ...x, factor: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <span className="text-muted">{uomCode(baseUomId)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        set(
                          "conversions",
                          form.conversions.filter((_, j) => j !== i),
                        )
                      }
                      aria-label="Remove conversion"
                    >
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                    {(err(`conversions.${i}.factor`) ||
                      err(`conversions.${i}.uomId`)) && (
                      <span className="text-xs text-danger">
                        {err(`conversions.${i}.factor`) ??
                          err(`conversions.${i}.uomId`)}
                      </span>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    set("conversions", [
                      ...form.conversions,
                      { uomId: "", factor: "" },
                    ])
                  }
                >
                  <Plus className="size-3.5" aria-hidden /> Add unit conversion
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Inventory" />
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2.5 sm:col-span-2 lg:col-span-4">
              <div className="flex flex-wrap gap-6">
                <Checkbox
                  label="Maintain stock"
                  disabled={form.type === "service"}
                  checked={form.isStockItem}
                  onChange={(e) => set("isStockItem", e.target.checked)}
                />
                <Checkbox
                  label="Track batches / lots"
                  disabled={!form.isStockItem}
                  checked={form.trackBatch}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      trackBatch: e.target.checked,
                      trackSerial: e.target.checked ? false : f.trackSerial,
                      hasExpiry: e.target.checked ? f.hasExpiry : false,
                    }))
                  }
                />
                <Checkbox
                  label="Track serial numbers"
                  disabled={!form.isStockItem}
                  checked={form.trackSerial}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      trackSerial: e.target.checked,
                      trackBatch: e.target.checked ? false : f.trackBatch,
                      hasExpiry: e.target.checked ? false : f.hasExpiry,
                    }))
                  }
                />
                <Checkbox
                  label="Has expiry date"
                  disabled={!form.trackBatch}
                  checked={form.hasExpiry}
                  onChange={(e) => set("hasExpiry", e.target.checked)}
                />
              </div>
              {["trackBatch", "trackSerial", "hasExpiry", "type"].map(
                (k) =>
                  err(k) && (
                    <p key={k} className="text-xs text-danger">
                      {err(k)}
                    </p>
                  ),
              )}
            </div>
            {form.hasExpiry && (
              <>
                <Field label="Shelf life (days)" error={err("shelfLifeDays")}>
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="numeric"
                      value={form.shelfLifeDays}
                      onChange={(e) => set("shelfLifeDays", e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label="Min. remaining life to dispatch (days)"
                  error={err("minRemainingShelfLifeDays")}
                >
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="numeric"
                      value={form.minRemainingShelfLifeDays}
                      onChange={(e) =>
                        set("minRemainingShelfLifeDays", e.target.value)
                      }
                    />
                  )}
                </Field>
              </>
            )}
            <Field label="Valuation">
              {(p) => (
                <Select
                  {...p}
                  value={form.valuationMethod}
                  onChange={(e) =>
                    set(
                      "valuationMethod",
                      e.target.value as Form["valuationMethod"],
                    )
                  }
                >
                  <option value="weighted_average">Weighted average</option>
                  <option value="fifo">FIFO</option>
                </Select>
              )}
            </Field>
            <Field
              label={`Reorder level (${uomCode(baseUomId)})`}
              error={err("reorderLevel")}
            >
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={form.reorderLevel}
                  onChange={(e) => set("reorderLevel", e.target.value)}
                />
              )}
            </Field>
            <Field label="Reorder quantity" error={err("reorderQty")}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={form.reorderQty}
                  onChange={(e) => set("reorderQty", e.target.value)}
                />
              )}
            </Field>
            <Field label="Safety stock" error={err("safetyStock")}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={form.safetyStock}
                  onChange={(e) => set("safetyStock", e.target.value)}
                />
              )}
            </Field>
            <Field label="Min. order quantity" error={err("minOrderQty")}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={form.minOrderQty}
                  onChange={(e) => set("minOrderQty", e.target.value)}
                />
              )}
            </Field>
            <Field label="Lead time (days)" error={err("leadTimeDays")}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={form.leadTimeDays}
                  onChange={(e) => set("leadTimeDays", e.target.value)}
                />
              )}
            </Field>
            <Field label="Net weight (kg)" error={err("netWeightKg")}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={form.netWeightKg}
                  onChange={(e) => set("netWeightKg", e.target.value)}
                />
              )}
            </Field>
            <Field label="Gross weight (kg)" error={err("grossWeightKg")}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={form.grossWeightKg}
                  onChange={(e) => set("grossWeightKg", e.target.value)}
                />
              )}
            </Field>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Pricing"
              description="Rates per base unit, excluding GST."
            />
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
              <Field label="Standard cost (₹)" error={err("standardCost")}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    value={form.standardCost}
                    onChange={(e) => set("standardCost", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Selling rate (₹)" error={err("sellingRate")}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    value={form.sellingRate}
                    onChange={(e) => set("sellingRate", e.target.value)}
                  />
                )}
              </Field>
              <Field label="MRP (₹)" error={err("mrp")}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    value={form.mrp}
                    onChange={(e) => set("mrp", e.target.value)}
                  />
                )}
              </Field>
              {item?.lastPurchaseRate && (
                <p className="text-xs text-muted sm:col-span-3">
                  Last purchase rate: ₹{Number(item.lastPurchaseRate)}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Barcodes"
              description="Scan to pick this item. Pack barcodes count as 1 of their unit."
            />
            <div className="space-y-2 px-5 py-4">
              {form.barcodes.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label={`Barcode ${i + 1}`}
                    aria-invalid={!!err(`barcodes.${i}.barcode`)}
                    className="font-mono"
                    value={b.barcode}
                    onChange={(e) =>
                      set(
                        "barcodes",
                        form.barcodes.map((x, j) =>
                          j === i ? { ...x, barcode: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <Select
                    aria-label={`Barcode ${i + 1} unit`}
                    className="w-28"
                    value={b.uomId}
                    onChange={(e) =>
                      set(
                        "barcodes",
                        form.barcodes.map((x, j) =>
                          j === i ? { ...x, uomId: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    <option value="">Base</option>
                    {form.conversions
                      .filter((c) => c.uomId)
                      .map((c) => (
                        <option key={c.uomId} value={c.uomId}>
                          {uomCode(c.uomId)}
                        </option>
                      ))}
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      set(
                        "barcodes",
                        form.barcodes.filter((_, j) => j !== i),
                      )
                    }
                    aria-label="Remove barcode"
                  >
                    <Trash2 className="size-4 text-danger" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  set("barcodes", [
                    ...form.barcodes,
                    {
                      barcode: "",
                      uomId: "",
                      isPrimary: !form.barcodes.length,
                    },
                  ])
                }
              >
                <Plus className="size-3.5" aria-hidden /> Add barcode
              </Button>
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Technical attributes"
            description="Grade, GSM, count, density, colour, potency… whatever your industry needs."
          />
          <div className="space-y-2 px-5 py-4">
            {form.attributes.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`Attribute ${i + 1} name`}
                  className="w-48"
                  placeholder="e.g. Grade"
                  value={a.key}
                  onChange={(e) =>
                    set(
                      "attributes",
                      form.attributes.map((x, j) =>
                        j === i ? { ...x, key: e.target.value } : x,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Attribute ${i + 1} value`}
                  placeholder="e.g. IS 2062 E250"
                  value={a.value}
                  onChange={(e) =>
                    set(
                      "attributes",
                      form.attributes.map((x, j) =>
                        j === i ? { ...x, value: e.target.value } : x,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    set(
                      "attributes",
                      form.attributes.filter((_, j) => j !== i),
                    )
                  }
                  aria-label="Remove attribute"
                >
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                set("attributes", [...form.attributes, { key: "", value: "" }])
              }
            >
              <Plus className="size-3.5" aria-hidden /> Add attribute
            </Button>
          </div>
        </Card>
      </fieldset>
      {item && <ItemVendors itemId={item.id} readOnly={readOnly} />}
    </div>
  );
}
