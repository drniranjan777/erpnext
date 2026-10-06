"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/documents";
import { iamKeys, type Member, type Role } from "@/lib/iam";
import type { Branch } from "@/lib/types";

interface Step {
  name: string;
  approverRoleId: string | null;
  approverUserId: string | null;
  approverLabel?: string;
}

interface Rule {
  id: string;
  docType: string;
  docTypeLabel: string;
  name: string;
  companyId: string | null;
  branchId: string | null;
  branchName: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  priority: number;
  isActive: boolean;
  steps: Step[];
}

const KEY = ["platform", "approval-rules"];

function slab(r: Pick<Rule, "minAmount" | "maxAmount">) {
  if (!r.minAmount && !r.maxAmount) return "Any amount";
  if (r.minAmount && r.maxAmount) return `${formatMoney(r.minAmount)} – ${formatMoney(r.maxAmount)}`;
  return r.minAmount ? `${formatMoney(r.minAmount)} and above` : `Up to ${formatMoney(r.maxAmount)}`;
}

export default function ApprovalWorkflowsPage() {
  const rules = useQuery({ queryKey: KEY, queryFn: () => api<Rule[]>("/platform/approval-rules") });
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) => api<void>(`/platform/approval-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Approval workflows"
        description="Which documents need approval, and by whom. The first matching rule (lowest priority number) applies. Documents with no matching rule are approved on submit."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden /> New rule
          </Button>
        }
      />
      {rules.isLoading && <LoadingBlock />}
      {rules.error && <ErrorBlock error={rules.error} />}
      {rules.data?.length === 0 && (
        <Card>
          <EmptyState
            title="No approval rules"
            description="Everything is approved as soon as it's submitted. Add a rule, e.g. requisitions above ₹50,000 need the Plant Head."
          />
        </Card>
      )}
      <div className="space-y-4">
        {rules.data?.map((r) => (
          <Card key={r.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted">
                  {r.docTypeLabel} · priority {r.priority}
                </p>
                <h2 className="flex items-center gap-2 font-semibold">
                  {r.name} {!r.isActive && <Badge>Inactive</Badge>}
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  {slab(r)}
                  {r.branchName ? ` · ${r.branchName} only` : ""}
                </p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => confirm(`Delete rule "${r.name}"?`) && del.mutate(r.id)} aria-label={`Delete ${r.name}`}>
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </div>
            </div>
            <ol className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              {r.steps.map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  {i > 0 && <span className="text-muted">→</span>}
                  <span className="rounded-lg border border-border px-3 py-1.5">
                    <span className="text-xs text-muted">L{i + 1}</span> {s.name} <span className="text-muted">({s.approverLabel})</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
      {editing && <RuleDialog rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RuleDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const docTypes = useQuery({ queryKey: ["platform", "doc-types"], queryFn: () => api<{ value: string; label: string }[]>("/platform/document-types") });
  const roles = useQuery({ queryKey: iamKeys.roles, queryFn: () => api<Role[]>("/iam/roles") });
  const users = useQuery({ queryKey: iamKeys.users, queryFn: () => api<Member[]>("/iam/users") });
  const branches = useQuery({ queryKey: ["org", "branches"], queryFn: () => api<Branch[]>("/org/branches") });
  const [form, setForm] = useState({
    docType: rule?.docType ?? "purchase_requisition",
    name: rule?.name ?? "",
    branchId: rule?.branchId ?? "",
    minAmount: rule?.minAmount ?? "",
    maxAmount: rule?.maxAmount ?? "",
    priority: rule?.priority ?? 100,
    isActive: rule?.isActive ?? true,
    steps: rule?.steps.map((s) => ({ name: s.name, approverRoleId: s.approverRoleId, approverUserId: s.approverUserId })) ?? [
      { name: "Manager approval", approverRoleId: null as string | null, approverUserId: null as string | null },
    ],
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        branchId: form.branchId || null,
        minAmount: form.minAmount || null,
        maxAmount: form.maxAmount || null,
      };
      return rule ? api(`/platform/approval-rules/${rule.id}`, { method: "PUT", body }) : api("/platform/approval-rules", { body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const setStep = (i: number, patch: Partial<(typeof form.steps)[number]>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const activeUsers = users.data?.filter((u) => u.status === "active") ?? [];

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={rule ? `Edit rule: ${rule.name}` : "New approval rule"}
      description="Changes apply to documents submitted from now on. Documents already in approval keep their original levels."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!form.name || form.steps.some((s) => !s.approverRoleId && !s.approverUserId)} onClick={() => save.mutate()}>
            Save rule
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {save.error && <Alert>{(save.error as Error).message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Document type" required>
            {(p) => (
              <Select {...p} value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>
                {docTypes.data?.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Rule name" required error={errors.name}>
            {(p) => <Input {...p} placeholder="e.g. Above ₹50,000" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label="Minimum amount (₹)" error={errors.minAmount} hint="Leave empty for no lower limit">
            {(p) => <Input {...p} inputMode="decimal" value={form.minAmount} onChange={(e) => setForm({ ...form, minAmount: e.target.value })} />}
          </Field>
          <Field label="Maximum amount (₹)" error={errors.maxAmount} hint="Leave empty for no upper limit">
            {(p) => <Input {...p} inputMode="decimal" value={form.maxAmount} onChange={(e) => setForm({ ...form, maxAmount: e.target.value })} />}
          </Field>
          <Field label="Branch">
            {(p) => (
              <Select {...p} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                <option value="">All branches</option>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Priority" hint="Lower numbers are checked first">
            {(p) => <Input {...p} type="number" min={0} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />}
          </Field>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Approval levels</legend>
          <ol className="space-y-2">
            {form.steps.map((s, i) => (
              <li key={i}>
                {i > 0 && <ArrowDown className="mx-auto mb-2 size-4 text-muted" aria-hidden />}
                <div className="grid items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_auto]">
                  <Field label={`Level ${i + 1} name`}>
                    {(p) => <Input {...p} value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} />}
                  </Field>
                  <Field label="Approved by">
                    {(p) => (
                      <Select
                        {...p}
                        value={s.approverRoleId ? `role:${s.approverRoleId}` : s.approverUserId ? `user:${s.approverUserId}` : ""}
                        onChange={(e) => {
                          const [kind, id] = e.target.value.split(":");
                          setStep(i, { approverRoleId: kind === "role" ? id : null, approverUserId: kind === "user" ? id : null });
                        }}
                      >
                        <option value="">Select…</option>
                        <optgroup label="Anyone with role">
                          {roles.data?.map((r) => (
                            <option key={r.id} value={`role:${r.id}`}>
                              {r.name}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Specific person">
                          {activeUsers.map((u) => (
                            <option key={u.userId} value={`user:${u.userId}`}>
                              {u.fullName}
                            </option>
                          ))}
                        </optgroup>
                      </Select>
                    )}
                  </Field>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mb-1"
                    disabled={form.steps.length === 1}
                    onClick={() => setForm((f) => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))}
                    aria-label={`Remove level ${i + 1}`}
                  >
                    <Trash2 className="size-4 text-danger" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={form.steps.length >= 6}
            onClick={() => setForm((f) => ({ ...f, steps: [...f.steps, { name: `Level ${f.steps.length + 1}`, approverRoleId: null, approverUserId: null }] }))}
          >
            <Plus className="size-3.5" aria-hidden /> Add level
          </Button>
          <p className="mt-2 text-xs text-muted">The person who submits a document can never approve it, even if they hold the role.</p>
        </fieldset>
        <Checkbox label="Rule is active" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
      </div>
    </Dialog>
  );
}
