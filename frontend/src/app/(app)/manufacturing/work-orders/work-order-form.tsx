"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { useWarehouses } from "@/lib/masters";
import { MFG, type WorkOrder } from "@/lib/manufacturing";

const W = `${MFG}/work-orders`;

interface BomRow {
  id: string;
  number: string | null;
  bomVersion: number;
  isDefault: boolean;
  status: string;
}

export function WorkOrderForm({ existing, initial }: { existing?: WorkOrder; initial?: { kind?: WorkOrder["kind"]; item?: { id: string; label: string } } }) {
  const router = useRouter();
  const qc = useQueryClient();
  const whs = useWarehouses();
  const [item, setItem] = useState<{ id: string; label: string } | null>(
    existing
      ? {
          id: existing.item.id,
          label: `${existing.item.code} ${existing.item.name}`,
        }
      : (initial?.item ?? null),
  );
  const [h, setH] = useState({
    kind: existing?.kind ?? initial?.kind ?? ("mts" as WorkOrder["kind"]),
    bomId: existing?.bom?.id ?? "",
    formulaId: existing?.formulaId ?? "",
    batchNo: existing?.batchNo ?? "",
    qty: existing ? String(Number(existing.qty)) : "",
    sourceWarehouseId: existing?.sourceWarehouseId ?? "",
    targetWarehouseId: existing?.targetWarehouseId ?? "",
    plannedStart: existing?.plannedStart ?? "",
    plannedEnd: existing?.plannedEnd ?? "",
    priority: String(existing?.priority ?? 3),
    backflush: existing?.backflush ?? false,
    notes: existing?.notes ?? "",
  });
  const boms = useQuery({
    queryKey: [MFG, "boms", "for", item?.id],
    queryFn: () =>
      api<{ items: BomRow[] }>(`${MFG}/boms`, {
        query: { itemId: item!.id, status: "approved", limit: 20 },
      }),
    enabled: !!item && h.kind !== "batch",
  });
  const formulaList = useQuery({
    queryKey: ["/process/formulas", "for", item?.id],
    queryFn: () => api<{ items: { id: string; number: string | null; formulaVersion: number; isDefault: boolean }[] }>("/process/formulas", { query: { itemId: item!.id, status: "approved", limit: 20 } }),
    enabled: !!item && h.kind === "batch",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof h>) => setH((x) => ({ ...x, ...p }));
  const stores = whs.data ?? [];

  async function save() {
    if (!item) return setErrors({ itemId: "Choose what to make" });
    setBusy(true);
    setError(null);
    setErrors({});
    const body = {
      kind: h.kind,
      itemId: item.id,
      bomId: h.kind === "batch" ? null : h.bomId || null,
      formulaId: h.kind === "batch" ? h.formulaId || null : null,
      batchNo: h.kind === "batch" ? h.batchNo || null : null,
      qty: h.qty,
      salesOrderLineId: existing?.salesOrderLineId ?? null,
      parentWorkOrderId: existing?.parent?.id ?? null,
      sourceWarehouseId: h.sourceWarehouseId,
      targetWarehouseId: h.targetWarehouseId,
      plannedStart: h.plannedStart || null,
      plannedEnd: h.plannedEnd || null,
      priority: Number(h.priority),
      backflush: h.backflush,
      notes: h.notes || null,
    };
    try {
      const w = existing
        ? await api<WorkOrder>(`${W}/${existing.id}`, {
            method: "PUT",
            body: { ...body, version: existing.version },
          })
        : await api<WorkOrder>(W, { body });
      qc.invalidateQueries({ queryKey: [W] });
      router.push(`${W}/${w.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-5 p-5">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Item to make" error={errors.itemId} required className="md:col-span-2">
          {() => (
            <>
              {item ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm">{item.label}</span>
                  {!existing && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setItem(null);
                        set({ bomId: "" });
                      }}
                    >
                      Change
                    </Button>
                  )}
                </div>
              ) : (
                <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} stockOnly />
              )}
            </>
          )}
        </Field>
        <Field label="Type" error={errors.kind}>
          {(p) => (
            <Select {...p} value={h.kind} onChange={(e) => set({ kind: e.target.value as WorkOrder["kind"] })} disabled={!!existing?.salesOrderLineId}>
              <option value="mts">Make to stock</option>
              <option value="rework">Rework</option>
              <option value="batch">Process batch (formula)</option>
              {existing?.kind === "mto" && <option value="mto">Make to order</option>}
            </Select>
          )}
        </Field>
        {h.kind === "batch" ? (
          <>
            <Field label="Formula" error={errors.formulaId} hint="Blank = the default version">
              {(p) => (
                <Select {...p} value={h.formulaId} onChange={(e) => set({ formulaId: e.target.value })} disabled={!item}>
                  <option value="">Default formula</option>
                  {formulaList.data?.items.map((f) => <option key={f.id} value={f.id}>{f.number} v{f.formulaVersion}{f.isDefault ? " (default)" : ""}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Batch number" error={errors.batchNo} hint="The lot number the output will carry">
              {(p) => <Input {...p} value={h.batchNo} onChange={(e) => set({ batchNo: e.target.value })} />}
            </Field>
          </>
        ) : (
        <Field label="BOM" error={errors.bomId} hint={h.kind === "rework" ? "Optional: its routing is used for the rework" : "Blank = the default version"}>
          {(p) => (
            <Select {...p} value={h.bomId} onChange={(e) => set({ bomId: e.target.value })} disabled={!item}>
              <option value="">{h.kind === "rework" ? "No routing" : "Default BOM"}</option>
              {boms.data?.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.number} v{b.bomVersion}
                  {b.isDefault ? " (default)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        )}
        <Field label="Quantity" error={errors.qty} required>
          {(p) => <Input {...p} inputMode="decimal" value={h.qty} onChange={(e) => set({ qty: e.target.value })} />}
        </Field>
        <Field label="Priority" error={errors.priority} hint="1 = most urgent">
          {(p) => (
            <Select {...p} value={h.priority} onChange={(e) => set({ priority: e.target.value })}>
              {[1, 2, 3, 4, 5].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Materials from" error={errors.sourceWarehouseId} required hint={h.kind === "rework" ? "Usually the rejected-goods store" : undefined}>
          {(p) => (
            <Select {...p} value={h.sourceWarehouseId} onChange={(e) => set({ sourceWarehouseId: e.target.value })}>
              <option value="">Choose…</option>
              {stores.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Output to" error={errors.targetWarehouseId} required>
          {(p) => (
            <Select {...p} value={h.targetWarehouseId} onChange={(e) => set({ targetWarehouseId: e.target.value })}>
              <option value="">Choose…</option>
              {stores.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div />
        <Field label="Planned start" error={errors.plannedStart}>
          {(p) => <Input {...p} type="date" value={h.plannedStart} onChange={(e) => set({ plannedStart: e.target.value })} />}
        </Field>
        <Field label="Planned end" error={errors.plannedEnd}>
          {(p) => <Input {...p} type="date" value={h.plannedEnd} onChange={(e) => set({ plannedEnd: e.target.value })} />}
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox label="Backflush materials" description="Issue at standard quantities when output is received" checked={h.backflush} onChange={(e) => set({ backflush: e.target.checked })} />
        </div>
        <Field label="Notes" className="md:col-span-3">
          {(p) => <Input {...p} value={h.notes} onChange={(e) => set({ notes: e.target.value })} />}
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button onClick={save} loading={busy}>
          {existing ? "Save" : "Create draft"}
        </Button>
      </div>
    </Card>
  );
}
