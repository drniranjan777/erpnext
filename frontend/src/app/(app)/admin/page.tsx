"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Search } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, timeAgo } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/documents";

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: "trial" | "active" | "suspended" | "archived";
  plan_code: string;
  industry: string | null;
  created_at: string;
  trial_ends_at: string | null;
  settings: { featureOverrides?: Record<string, boolean> };
  subscription_status: string | null;
  current_period_end: string | null;
  active_users: string;
  documents: string;
  storage_bytes: string;
  last_login_at: string | null;
}

interface AdminData {
  tenants: TenantRow[];
  stats: { total: number; trialing: number; paying: number; suspended: number; mrr: number };
  plans: { code: string; name: string }[];
  features: { code: string; label: string }[];
}

/** Platform operator console: every workspace, plans, trials, suspension and feature overrides. */
export default function AdminPage() {
  const { me } = useAuth();
  const data = useQuery({ queryKey: ["admin", "tenants"], queryFn: () => api<AdminData>("/admin/tenants"), enabled: !!me?.isPlatformAdmin });
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<TenantRow | null>(null);

  if (!me?.isPlatformAdmin) return <Alert>Platform administrators only.</Alert>;
  const rows = data.data?.tenants.filter((t) => !q || `${t.name} ${t.slug}`.toLowerCase().includes(q.toLowerCase())) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Platform admin" description="All customer workspaces. Changes are recorded in each workspace's audit trail." />
      {data.isLoading && <LoadingBlock />}
      {data.error && <ErrorBlock error={data.error} />}
      {data.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-5">
            <Stat label="Workspaces" value={data.data.stats.total} />
            <Stat label="On trial" value={data.data.stats.trialing} />
            <Stat label="Paying" value={data.data.stats.paying} />
            <Stat label="Suspended" value={data.data.stats.suspended} />
            <Stat label="MRR (ex-GST)" value={formatMoney(data.data.stats.mrr).replace(".00", "")} />
          </div>
          <Card>
            <div className="border-b border-border p-3">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input className="pl-9" placeholder="Search workspaces" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search workspaces" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Workspace</th>
                    <th className="px-4 py-2.5 font-medium">Plan</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Users</th>
                    <th className="px-4 py-2.5 text-right font-medium">Docs</th>
                    <th className="px-4 py-2.5 text-right font-medium">Storage</th>
                    <th className="px-4 py-2.5 font-medium">Last sign-in</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{t.name}</p>
                        <p className="text-xs text-muted">
                          {t.slug} · since {formatDate(t.created_at)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="capitalize">{t.plan_code}</p>
                        <p className="text-xs text-muted">
                          {t.subscription_status === "trialing" && t.trial_ends_at
                            ? `trial ends ${formatDate(t.trial_ends_at)}`
                            : t.current_period_end
                              ? `${t.subscription_status} · until ${formatDate(t.current_period_end)}`
                              : t.subscription_status}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={t.status === "suspended" ? "danger" : t.status === "active" ? "success" : "primary"}>{t.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{t.active_users}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{t.documents}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{(Number(t.storage_bytes) / 1_048_576).toFixed(1)} MB</td>
                      <td className="px-4 py-3 text-muted">{timeAgo(t.last_login_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(t)} aria-label={`Manage ${t.name}`}>
                          <Pencil className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      {editing && data.data && <EditTenant tenant={editing} data={data.data} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

function EditTenant({ tenant, data, onClose }: { tenant: TenantRow; data: AdminData; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(tenant.status);
  const [planCode, setPlanCode] = useState(tenant.plan_code);
  const [trialEnds, setTrialEnds] = useState(tenant.trial_ends_at?.slice(0, 10) ?? "");
  const [overrides, setOverrides] = useState<Record<string, boolean>>(tenant.settings.featureOverrides ?? {});
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api(`/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        body: {
          status: status !== tenant.status ? status : undefined,
          planCode: planCode !== tenant.plan_code ? planCode : undefined,
          trialEndsAt: trialEnds && trialEnds !== tenant.trial_ends_at?.slice(0, 10) ? new Date(`${trialEnds}T23:59:59+05:30`).toISOString() : undefined,
          featureOverrides: JSON.stringify(overrides) !== JSON.stringify(tenant.settings.featureOverrides ?? {}) ? overrides : undefined,
          reason,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
    },
  });

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={tenant.name}
      description={tenant.slug}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={reason.trim().length < 3} onClick={() => save.mutate()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{(save.error as Error).message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Status">
            {(p) => (
              <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as TenantRow["status"])}>
                <option value="trial">Trial</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="archived">Archived</option>
              </Select>
            )}
          </Field>
          <Field label="Plan">
            {(p) => (
              <Select {...p} value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                {data.plans.map((pl) => (
                  <option key={pl.code} value={pl.code}>
                    {pl.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Trial ends">
            {(p) => <Input {...p} type="date" value={trialEnds} onChange={(e) => setTrialEnds(e.target.value)} />}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Feature overrides</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.features.map((f) => (
              <div key={f.code} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span>{f.label}</span>
                <select
                  aria-label={f.label}
                  className="rounded border border-border bg-surface px-2 py-1 text-xs"
                  value={f.code in overrides ? String(overrides[f.code]) : ""}
                  onChange={(e) =>
                    setOverrides((o) => {
                      const next = { ...o };
                      if (e.target.value === "") delete next[f.code];
                      else next[f.code] = e.target.value === "true";
                      return next;
                    })
                  }
                >
                  <option value="">Plan default</option>
                  <option value="true">Force on</option>
                  <option value="false">Force off</option>
                </select>
              </div>
            ))}
          </div>
        </fieldset>
        <Field label="Reason (recorded in the customer's audit trail)" required>
          {(p) => <Input {...p} placeholder="e.g. Extended trial for pilot" value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {status === "suspended" && <Alert tone="warning">Suspended workspaces can still sign in and view data, but can&apos;t make changes.</Alert>}
      </div>
    </Dialog>
  );
}
