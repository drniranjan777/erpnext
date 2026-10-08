"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useItemGroups, useReference, useUoms, type ItemGroup, type Uom } from "@/lib/masters";
import { DataTable } from "@/components/ui/data-table";

export default function MastersSetupPage() {
  const { can } = useAuth();
  const canManage = can("masters.setup.manage");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Units & item groups" description="Units of measure (with GST unit codes) and the item group tree used in reports." />
      <div className="grid gap-6 lg:grid-cols-2">
        <UnitsCard canManage={canManage} />
        <GroupsCard canManage={canManage} />
      </div>
    </div>
  );
}

function UnitsCard({ canManage }: { canManage: boolean }) {
  const uoms = useUoms();
  const [editing, setEditing] = useState<Uom | "new" | null>(null);
  return (
    <Card>
      <CardHeader
        title="Units of measure"
        action={
          canManage && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-3.5" aria-hidden /> New unit
            </Button>
          )
        }
      />
      {uoms.isLoading && <LoadingBlock />}
      <DataTable
        rows={uoms.data ?? []}
        rowKey={(u) => String(u.id)}
        rowClassName={(u) => u.isActive ? undefined : "text-muted"}
        exportName="masters-setup"
        storageKey="masters-setup-0"
        columns={[
          { key: "code", label: "Code", locked: true, className: "font-mono font-medium whitespace-normal", render: (u) => <>{u.code}</> },
          { key: "name", label: "Name", className: "whitespace-normal", render: (u) => <>{u.name}</> },
          { key: "decimals", label: "Decimals", className: "whitespace-normal", render: (u) => <>{u.decimals}</> },
          { key: "gst-uqc", label: "GST UQC", className: "font-mono text-xs whitespace-normal", render: (u) => <>{u.uqc}</> },
          { key: "col4", label: "", align: "right", noSort: true, render: (u) => <>{canManage && (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(u)} aria-label={`Edit ${u.code}`}>
                            <Pencil className="size-3.5" />
                          </Button>
                        )}</> },
        ]}
      />
      {editing && <UomDialog uom={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function UomDialog({ uom, onClose }: { uom: Uom | null; onClose: () => void }) {
  const qc = useQueryClient();
  const ref = useReference();
  const [f, setF] = useState({ code: uom?.code ?? "", name: uom?.name ?? "", decimals: uom?.decimals ?? 3, uqc: uom?.uqc ?? "OTH", isActive: uom?.isActive ?? true });
  const save = useMutation({
    mutationFn: () => api(uom ? `/masters/uoms/${uom.id}` : "/masters/uoms", { method: uom ? "PUT" : "POST", body: f }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", "uoms"] });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  return (
    <Dialog
      open
      onClose={onClose}
      title={uom ? `Edit unit ${uom.code}` : "New unit"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!f.code || !f.name} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {save.error && !Object.keys(errors).length && <div className="sm:col-span-2"><Alert>{(save.error as Error).message}</Alert></div>}
        <Field label="Code" required error={errors.code}>
          {(p) => <Input {...p} className="font-mono uppercase" maxLength={10} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />}
        </Field>
        <Field label="Name" required error={errors.name}>
          {(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
        </Field>
        <Field label="Decimal places" hint="0 for countable units (NOS, PCS)">
          {(p) => <Input {...p} type="number" min={0} max={6} value={f.decimals} onChange={(e) => setF({ ...f, decimals: Number(e.target.value) })} />}
        </Field>
        <Field label="GST unit (UQC)" error={errors.uqc}>
          {(p) => (
            <Select {...p} value={f.uqc} onChange={(e) => setF({ ...f, uqc: e.target.value })}>
              {ref.data?.uqc.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code} · {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
      </div>
    </Dialog>
  );
}

function GroupsCard({ canManage }: { canManage: boolean }) {
  const groups = useItemGroups();
  const [editing, setEditing] = useState<ItemGroup | "new" | null>(null);
  const byParent = (parentId: string | null): ItemGroup[] => (groups.data ?? []).filter((g) => g.parentId === parentId);
  const render = (parentId: string | null, depth: number): React.ReactNode =>
    byParent(parentId).map((g) => (
      <li key={g.id}>
        <div className="flex items-center gap-2 py-1.5 text-sm" style={{ paddingLeft: depth * 20 }}>
          <span className="font-mono text-xs text-muted">{g.code}</span>
          <span className={g.isActive ? "font-medium" : "text-muted line-through"}>{g.name}</span>
          <Badge>{g.itemCount} items</Badge>
          {canManage && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing(g)} aria-label={`Edit ${g.name}`}>
              <Pencil className="size-3.5" />
            </Button>
          )}
        </div>
        <ul>{render(g.id, depth + 1)}</ul>
      </li>
    ));
  return (
    <Card>
      <CardHeader
        title="Item groups"
        description="Up to 3 levels, e.g. Raw materials › Polymers › Polypropylene."
        action={
          canManage && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-3.5" aria-hidden /> New group
            </Button>
          )
        }
      />
      {groups.isLoading && <LoadingBlock />}
      <ul className="px-5 py-3">{render(null, 0)}</ul>
      {editing && <GroupDialog group={editing === "new" ? null : editing} groups={groups.data ?? []} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function GroupDialog({ group, groups, onClose }: { group: ItemGroup | null; groups: ItemGroup[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: group?.code ?? "", name: group?.name ?? "", parentId: group?.parentId ?? "", isActive: group?.isActive ?? true });
  const save = useMutation({
    mutationFn: () => api(group ? `/masters/item-groups/${group.id}` : "/masters/item-groups", { method: group ? "PUT" : "POST", body: { ...f, parentId: f.parentId || null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", "item-groups"] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={group ? `Edit ${group.name}` : "New item group"}
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
      <div className="grid gap-4 sm:grid-cols-2">
        {save.error && <div className="sm:col-span-2"><Alert>{(save.error as Error).message}</Alert></div>}
        <Field label="Code" required>
          {(p) => <Input {...p} className="font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />}
        </Field>
        <Field label="Name" required>
          {(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
        </Field>
        <Field label="Parent group">
          {(p) => (
            <Select {...p} value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
              <option value="">— Top level —</option>
              {groups
                .filter((g) => g.id !== group?.id)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        </div>
      </div>
    </Dialog>
  );
}
