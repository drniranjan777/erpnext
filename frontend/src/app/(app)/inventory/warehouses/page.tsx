"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Warehouse as WarehouseIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useReference, useWarehouses, WAREHOUSE_TYPES, type Warehouse } from "@/lib/masters";
import type { Branch, Company } from "@/lib/types";

export default function WarehousesPage() {
  const { can } = useAuth();
  const list = useWarehouses();
  const [editing, setEditing] = useState<Warehouse | "new" | null>(null);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Warehouses"
        description="Stores, production floors, QC hold, transit and job-work locations. Stock in non-nettable locations isn't available for issue or sale."
        actions={
          can("inventory.warehouses.manage") && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden /> New warehouse
            </Button>
          )
        }
      />
      {list.isLoading && <LoadingBlock />}
      {list.error && <ErrorBlock error={list.error} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.map((w) => (
          <Card key={w.id} className="flex items-start gap-3 p-4">
            <WarehouseIcon className="mt-0.5 size-5 text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {w.name} <span className="font-mono text-xs text-muted">{w.code}</span>
              </p>
              <p className="text-xs text-muted">
                {WAREHOUSE_TYPES[w.type]} · {w.branch ?? w.company}
                {w.address.city ? ` · ${w.address.city}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {!w.isNettable && <Badge tone="warning">Not available for issue</Badge>}
                {w.allowNegativeStock && <Badge tone="danger">Negative stock allowed</Badge>}
                {!w.isActive && <Badge>Inactive</Badge>}
              </div>
            </div>
            {can("inventory.warehouses.manage") && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(w)} aria-label={`Edit ${w.name}`}>
                <Pencil className="size-3.5" />
              </Button>
            )}
          </Card>
        ))}
      </div>
      {editing && <WarehouseDialog warehouse={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function WarehouseDialog({ warehouse, onClose }: { warehouse: Warehouse | null; onClose: () => void }) {
  const qc = useQueryClient();
  const ref = useReference();
  const companies = useQuery({ queryKey: ["org", "companies"], queryFn: () => api<Company[]>("/org/companies") });
  const branches = useQuery({ queryKey: ["org", "branches"], queryFn: () => api<Branch[]>("/org/branches") });
  const [f, setF] = useState({
    code: warehouse?.code ?? "",
    name: warehouse?.name ?? "",
    type: warehouse?.type ?? ("store" as Warehouse["type"]),
    companyId: warehouse?.companyId ?? "",
    branchId: warehouse?.branchId ?? "",
    line1: warehouse?.address.line1 ?? "",
    city: warehouse?.address.city ?? "",
    stateCode: warehouse?.address.stateCode ?? "",
    pincode: warehouse?.address.pincode ?? "",
    allowNegativeStock: warehouse?.allowNegativeStock ?? false,
    isActive: warehouse?.isActive ?? true,
  });
  const companyId = f.companyId || companies.data?.[0]?.id || "";
  const save = useMutation({
    mutationFn: () =>
      api(warehouse ? `/inventory/warehouses/${warehouse.id}` : "/inventory/warehouses", {
        method: warehouse ? "PUT" : "POST",
        body: {
          code: f.code,
          name: f.name,
          type: f.type,
          companyId,
          branchId: f.branchId || null,
          address: { line1: f.line1 || undefined, city: f.city || undefined, stateCode: f.stateCode || undefined, pincode: f.pincode || undefined },
          allowNegativeStock: f.allowNegativeStock,
          isActive: f.isActive,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory", "warehouses"] });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={warehouse ? `Edit ${warehouse.name}` : "New warehouse"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!f.code || f.name.length < 2} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {save.error && !Object.keys(errors).length && <div className="sm:col-span-3"><Alert>{(save.error as Error).message}</Alert></div>}
        <Field label="Code" required error={errors.code}>
          {(p) => <Input {...p} className="font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />}
        </Field>
        <Field label="Name" required error={errors.name} className="sm:col-span-2">
          {(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
        </Field>
        <Field label="Type">
          {(p) => (
            <Select {...p} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Warehouse["type"] })}>
              {Object.entries(WAREHOUSE_TYPES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Company">
          {(p) => (
            <Select {...p} value={companyId} onChange={(e) => setF({ ...f, companyId: e.target.value, branchId: "" })}>
              {companies.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Branch / plant">
          {(p) => (
            <Select {...p} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
              <option value="">—</option>
              {branches.data
                ?.filter((b) => b.companyId === companyId)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Address" className="sm:col-span-3">
          {(p) => <Input {...p} value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} />}
        </Field>
        <Field label="City">
          {(p) => <Input {...p} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />}
        </Field>
        <Field label="State">
          {(p) => (
            <Select {...p} value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value })}>
              <option value="">—</option>
              {ref.data?.states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="PIN code" error={errors["address.pincode"]}>
          {(p) => <Input {...p} inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value })} />}
        </Field>
        <div className="flex flex-wrap gap-6 sm:col-span-3">
          <Checkbox label="Allow negative stock" description="Not recommended. Issues can exceed what is on record." checked={f.allowNegativeStock} onChange={(e) => setF({ ...f, allowNegativeStock: e.target.checked })} />
          <Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        </div>
      </div>
    </Dialog>
  );
}
