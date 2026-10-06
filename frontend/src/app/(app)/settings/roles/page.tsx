"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { iamKeys, type PermissionGroup, type Role } from "@/lib/iam";

type Draft = { id?: string; name: string; description: string; permissions: string[] };

export default function RolesPage() {
  const { can } = useAuth();
  const canManage = can("iam.roles.manage");
  const roles = useQuery({ queryKey: iamKeys.roles, queryFn: () => api<Role[]>("/iam/roles") });
  const catalog = useQuery({ queryKey: iamKeys.permissions, queryFn: () => api<PermissionGroup[]>("/iam/permissions") });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewing, setViewing] = useState<Role | null>(null);

  const total = catalog.data?.reduce((n, g) => n + g.permissions.length, 0) ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Roles & permissions"
        description="A role is a set of permissions. Give people one or more roles."
        actions={
          canManage && (
            <Button onClick={() => setDraft({ name: "", description: "", permissions: [] })}>
              <Plus className="size-4" aria-hidden /> New role
            </Button>
          )
        }
      />

      {(roles.isLoading || catalog.isLoading) && <LoadingBlock />}
      {roles.error && <ErrorBlock error={roles.error} />}

      {roles.data && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.data.map((role) => (
            <Card key={role.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 font-semibold">
                    {role.name}
                    {role.isSystem && (
                      <Badge>
                        <Lock className="mr-1 size-3" aria-hidden />
                        System
                      </Badge>
                    )}
                  </h2>
                  {role.description && <p className="mt-1 text-sm text-muted">{role.description}</p>}
                </div>
              </div>
              <div className="mt-4 flex gap-4 text-sm text-muted">
                <span>
                  <strong className="text-foreground">{role.permissions.length}</strong>/{total} permissions
                </span>
                <span>
                  <strong className="text-foreground">{role.memberCount}</strong> {role.memberCount === 1 ? "user" : "users"}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                {role.isSystem || !canManage ? (
                  <Button variant="secondary" size="sm" onClick={() => setViewing(role)}>
                    View
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setDraft({ id: role.id, name: role.name, description: role.description ?? "", permissions: role.permissions })
                    }
                  >
                    <Pencil className="size-3.5" aria-hidden /> Edit
                  </Button>
                )}
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setDraft({ name: `${role.name} (copy)`, description: role.description ?? "", permissions: role.permissions })
                    }
                  >
                    <Copy className="size-3.5" aria-hidden /> Duplicate
                  </Button>
                )}
                {canManage && !role.isSystem && <DeleteRoleButton role={role} />}
              </div>
            </Card>
          ))}
        </div>
      )}

      {draft && catalog.data && <RoleEditor draft={draft} catalog={catalog.data} onClose={() => setDraft(null)} />}
      {viewing && catalog.data && (
        <Dialog open onClose={() => setViewing(null)} title={viewing.name} description="System roles are read-only. Duplicate to customise." size="lg">
          <PermissionMatrix catalog={catalog.data} value={viewing.permissions} readOnly />
        </Dialog>
      )}
    </div>
  );
}

function DeleteRoleButton({ role }: { role: Role }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api<void>(`/iam/roles/${role.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: iamKeys.roles }),
    onError: (err) => alert((err as Error).message),
  });
  return (
    <Button
      variant="ghost"
      size="sm"
      className="ml-auto"
      loading={del.isPending}
      disabled={role.memberCount > 0}
      title={role.memberCount > 0 ? "Reassign its users before deleting" : undefined}
      onClick={() => confirm(`Delete the role "${role.name}"?`) && del.mutate()}
      aria-label={`Delete ${role.name}`}
    >
      <Trash2 className="size-4 text-danger" />
    </Button>
  );
}

function RoleEditor({ draft, catalog, onClose }: { draft: Draft; catalog: PermissionGroup[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(draft);
  const save = useMutation({
    mutationFn: () =>
      api<Role>(form.id ? `/iam/roles/${form.id}` : "/iam/roles", {
        method: form.id ? "PATCH" : "POST",
        body: { name: form.name, description: form.description, permissions: form.permissions },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: iamKeys.roles });
      qc.invalidateQueries({ queryKey: iamKeys.users });
      onClose();
    },
  });
  const fieldErrors = save.error instanceof ApiError ? save.error.fieldErrors : {};

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={form.id ? `Edit role` : "New role"}
      description="Changes apply immediately to everyone with this role."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={form.name.trim().length < 2} onClick={() => save.mutate()}>
            {form.id ? "Save changes" : "Create role"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {save.error && !Object.keys(fieldErrors).length && <Alert>{(save.error as Error).message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role name" required error={fieldErrors.name}>
            {(p) => <Input {...p} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label="Description" error={fieldErrors.description}>
            {(p) => <Input {...p} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
          </Field>
        </div>
        <PermissionMatrix catalog={catalog} value={form.permissions} onChange={(permissions) => setForm({ ...form, permissions })} />
      </div>
    </Dialog>
  );
}

const ACTION_LABELS: Record<string, string> = { read: "View", manage: "Manage", create: "Create", approve: "Approve", delete: "Delete" };

function PermissionMatrix({
  catalog,
  value,
  onChange,
  readOnly,
}: {
  catalog: PermissionGroup[];
  value: string[];
  onChange?: (codes: string[]) => void;
  readOnly?: boolean;
}) {
  const set = new Set(value);
  const toggle = (codes: string[], on: boolean) => {
    const next = new Set(set);
    for (const c of codes) {
      if (on) next.add(c);
      else next.delete(c);
    }
    onChange?.([...next].sort());
  };

  return (
    <div className="space-y-4">
      {catalog.map((group) => {
        const codes = group.permissions.map((p) => p.code);
        const on = codes.filter((c) => set.has(c)).length;
        return (
          <fieldset key={group.module} className="rounded-lg border border-border">
            <legend className="sr-only">{group.label}</legend>
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-muted px-4 py-2.5">
              <Checkbox
                label={<span className="font-medium">{group.label}</span>}
                checked={on === codes.length}
                indeterminate={on > 0 && on < codes.length}
                disabled={readOnly}
                onChange={(e) => toggle(codes, e.target.checked)}
              />
              <span className="text-xs text-muted">
                {on}/{codes.length}
              </span>
            </div>
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
              {group.permissions.map((p) => (
                <Checkbox
                  key={p.code}
                  label={p.description}
                  description={`${ACTION_LABELS[p.action] ?? p.action} · ${p.resource}`}
                  checked={set.has(p.code)}
                  disabled={readOnly}
                  onChange={(e) => toggle([p.code], e.target.checked)}
                />
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
