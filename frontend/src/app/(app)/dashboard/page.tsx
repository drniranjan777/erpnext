"use client";

import { useQuery } from "@tanstack/react-query";
import { Compass, LifeBuoy, Monitor, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { WidgetGrid, type DashboardView } from "@/components/dashboard/widgets";
import { SetupSteps, type Progress } from "@/components/onboarding/setup-steps";
import { Tour } from "@/components/onboarding/tour";
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
  const progress = useQuery({ queryKey: ["onboarding", "progress"], queryFn: () => api<Progress>("/onboarding/progress") });
  const [touring, setTouring] = useState(false);

  if (!me) return null;
  const firstName = me.user.fullName.split(" ")[0];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Good {greeting()}, {firstName}</h1>
          <p className="mt-1 text-sm text-muted">
            {me.tenant.name}
            {me.tenant.industry && <> · {industryLabel(me.tenant.industry)}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setTouring(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-surface-muted"><Compass className="size-4" aria-hidden /> Take the tour</button>
          <Link href="/help" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-surface-muted"><LifeBuoy className="size-4" aria-hidden /> Help</Link>
        </div>
      </div>

      {progress.data && !progress.data.complete && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title={`Get set up · ${progress.data.done} of ${progress.data.total}`} description="The next steps, based on what is in your workspace." action={<Link href="/setup" className="text-sm font-medium text-primary hover:underline">All steps</Link>} />
            <div className="mx-5 mb-1 h-1.5 rounded-full bg-surface-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(progress.data.done / progress.data.total) * 100}%` }} /></div>
            <SetupSteps p={progress.data} compact />
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
      {touring && <Tour onClose={() => setTouring(false)} />}
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
          <Link data-tour="dashboard" href="/dashboards" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-surface-muted"><SlidersHorizontal className="size-4" aria-hidden /> Customise</Link>
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
