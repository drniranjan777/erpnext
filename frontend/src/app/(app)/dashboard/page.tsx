"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Monitor, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { WidgetGrid, type DashboardView } from "@/components/dashboard/widgets";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { industryLabel } from "@/lib/industries";
import type { Company } from "@/lib/types";

export default function DashboardPage() {
  const { me, can } = useAuth();
  const companies = useQuery({
    queryKey: ["org", "companies"],
    queryFn: () => api<Company[]>("/org/companies"),
    enabled: can("org.companies.read"),
  });

  const members = useQuery({
    queryKey: ["iam", "users"],
    queryFn: () => api<{ userId: string }[]>("/iam/users"),
    enabled: can("iam.users.read"),
  });
  const requisitions = useQuery({
    queryKey: ["/purchase/requisitions", "list", { limit: 1 }],
    queryFn: () => api<{ items: unknown[] }>("/purchase/requisitions", { query: { limit: 1 } }),
    enabled: can("purchase.requisitions.read"),
  });

  if (!me) return null;
  const firstName = me.user.fullName.split(" ")[0];
  const company = companies.data?.[0];

  // Honest setup checklist: only items we can verify are marked done.
  const checklist = [
    { label: "Create your workspace", done: true },
    { label: "Add company GSTIN", done: !!company?.gstin, href: "/settings/companies" },
    { label: "Invite your team", done: (members.data?.length ?? 0) > 1, href: "/settings/users" },
    { label: "Set up approval workflows (optional)", done: false, href: "/settings/approval-workflows" },
    { label: "Raise your first purchase requisition", done: (requisitions.data?.items.length ?? 0) > 0, href: "/purchase/requisitions/new" },
    { label: "Import items, customers and vendors from Tally or Excel", done: false, phase: 2 },
  ];

  // Required steps still open (optional ones and future features don't keep the checklist up).
  const setupLeft = checklist.filter((i) => !i.done && !i.phase && !i.label.includes("optional")).length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Good {greeting()}, {firstName}</h1>
        <p className="mt-1 text-sm text-muted">
          {me.tenant.name}
          {me.tenant.industry && <> · {industryLabel(me.tenant.industry)}</>}
        </p>
      </div>

      {setupLeft > 0 && (
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Get set up" description="Complete these steps to start running your operations here." />
          <ul className="divide-y divide-border">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-center gap-3 px-5 py-3.5">
                {item.done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success" aria-label="Done" />
                ) : (
                  <Circle className="size-5 shrink-0 text-border" aria-label="Not done" />
                )}
                <span className={item.done ? "flex-1 text-sm text-muted line-through" : "flex-1 text-sm"}>{item.label}</span>
                {!item.done && item.href && (
                  <Link href={item.href} className="text-sm font-medium text-primary hover:underline">
                    Set up
                  </Link>
                )}
                {!item.done && !item.href && item.phase && (
                  <span className="text-xs text-muted">Available soon</span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Workspace" />
          <dl className="space-y-3 px-5 py-4 text-sm">
            <Row label="Workspace URL" value={`${me.tenant.slug}.nextgenerp.in`} />
            <Row label="Plan" value={me.tenant.status === "trial" ? "Free trial" : me.tenant.status.replace(/^\w/, (c) => c.toUpperCase())} />
            <Row label="Companies" value={companies.isLoading ? "…" : String(companies.data?.length ?? 0)} />
            <Row label="Your access" value={`${me.permissions.length} permissions`} />
          </dl>
        </Card>
      </div>
      )}

      <HomeDashboard />
    </div>
  );
}

interface DashboardList { presets: { key: string; name: string }[]; saved: { id: string; name: string; shared: boolean; isDefault: boolean }[] }

/** The user's home dashboard, or any preset / saved dashboard they pick. */
function HomeDashboard() {
  const [sel, setSel] = useState("");
  const list = useQuery({ queryKey: ["dashboards", "list"], queryFn: () => api<DashboardList>("/dashboards") });
  const query = sel.startsWith("preset:") ? { preset: sel.slice(7) } : sel ? { id: sel } : {};
  const view = useQuery({ queryKey: ["dashboards", "view", sel], queryFn: () => api<DashboardView>("/dashboards/view", { query }), refetchInterval: 300_000 });
  const tv = view.data?.id ? `id=${view.data.id}` : `preset=${view.data?.preset ?? "tv"}`;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{view.data?.name ?? "Dashboard"}</h2>
          {view.data && <span className="text-xs text-muted">as of {new Date(view.data.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Select className="h-9 w-56" aria-label="Choose a dashboard" value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">My home dashboard</option>
            {list.data?.saved.length ? <optgroup label="Saved">{list.data.saved.map((d) => <option key={d.id} value={d.id}>{d.name}{d.shared ? " (shared)" : ""}</option>)}</optgroup> : null}
            <optgroup label="By role">{list.data?.presets.map((p) => <option key={p.key} value={`preset:${p.key}`}>{p.name}</option>)}</optgroup>
          </Select>
          <Link href="/dashboards" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-surface-muted"><SlidersHorizontal className="size-4" aria-hidden /> Customise</Link>
          <Link href={`/dashboards/tv?${tv}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-surface-muted"><Monitor className="size-4" aria-hidden /> TV</Link>
        </div>
      </div>
      {view.isLoading && <LoadingBlock />}
      {view.error && <ErrorBlock error={view.error} />}
      {view.data && <WidgetGrid widgets={view.data.widgets} />}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words font-medium">{value}</dd>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
