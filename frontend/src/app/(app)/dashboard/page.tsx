"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowLeftRight, CalendarDays, ChevronRight, Compass, Contact, Factory, FilePlus2, Inbox, LifeBuoy, Monitor, Package, ReceiptText, ShoppingCart, SlidersHorizontal, Truck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { WidgetGrid, type DashboardView } from "@/components/dashboard/widgets";
import { SetupSteps, type Progress } from "@/components/onboarding/setup-steps";
import { Tour } from "@/components/onboarding/tour";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page";
import { Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { documentKeys, formatMoney, type InboxItem } from "@/lib/documents";
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

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <section className="relative overflow-hidden rounded-xl border border-border bg-surface px-5 py-5 shadow-sm sm:px-6">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-primary-soft to-transparent" aria-hidden />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Good {greeting()}, {firstName}</h1>
            <p className="mt-1 text-sm text-muted">
              Here&apos;s what&apos;s happening at {me.tenant.name}
              {me.tenant.industry && <> · {industryLabel(me.tenant.industry)}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
              <CalendarDays className="size-4 text-muted" aria-hidden /> {today}
            </span>
            <button onClick={() => setTouring(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-muted"><Compass className="size-4" aria-hidden /> Tour</button>
            <Link href="/help" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-muted"><LifeBuoy className="size-4" aria-hidden /> Help</Link>
          </div>
        </div>
      </section>

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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <HomeDashboard />
        <aside className="space-y-6">
          <QuickActions />
          <PendingApprovals />
        </aside>
      </div>
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
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{view.data?.name ?? "Dashboard"}</h2>
          {view.data && <span className="text-xs text-muted">as of {new Date(view.data.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Select className="h-9 w-48 sm:w-56" aria-label="Choose a dashboard" value={sel} onChange={(e) => setSel(e.target.value)}>
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

const ACTIONS: { label: string; href: string; icon: LucideIcon; permission: string; module?: string }[] = [
  { label: "New invoice", href: "/sales/invoices/new", icon: ReceiptText, permission: "sales.invoices.manage" },
  { label: "Sales order", href: "/sales/orders/new", icon: ShoppingCart, permission: "sales.orders.manage" },
  { label: "Purchase order", href: "/purchase/orders/new", icon: Truck, permission: "purchase.orders.manage" },
  { label: "Goods receipt", href: "/purchase/receipts/new", icon: FilePlus2, permission: "purchase.receipts.manage" },
  { label: "Stock entry", href: "/inventory/stock-entries/new", icon: ArrowLeftRight, permission: "inventory.entries.manage" },
  { label: "Work order", href: "/manufacturing/work-orders/new", icon: Factory, permission: "manufacturing.production.manage", module: "manufacturing" },
  { label: "Receipt", href: "/accounting/receipts/new", icon: ArrowDownToLine, permission: "accounting.money.manage" },
  { label: "Add item", href: "/masters/items/new", icon: Package, permission: "masters.items.manage" },
  { label: "Add party", href: "/masters/parties/new", icon: Contact, permission: "masters.parties.manage" },
];

/** One-click shortcuts to the documents this user creates most. */
function QuickActions() {
  const { can, hasModule } = useAuth();
  const actions = ACTIONS.filter((a) => can(a.permission) && hasModule(a.module));
  if (!actions.length) return null;
  return (
    <Card>
      <CardHeader title="Quick actions" />
      <div className="grid grid-cols-3 gap-2 p-3">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.href} href={a.href} className="flex flex-col items-center gap-1.5 rounded-lg border border-border px-1 py-3 text-center text-xs font-medium transition-colors hover:border-primary/40 hover:bg-primary-soft hover:text-primary">
              <Icon className="size-5 text-primary" aria-hidden />
              <span className="leading-tight">{a.label}</span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

/** What is waiting for the user's decision, grouped by document type. */
function PendingApprovals() {
  const inbox = useQuery({ queryKey: documentKeys.inbox, queryFn: () => api<InboxItem[]>("/documents/approvals/inbox") });
  const items = inbox.data ?? [];
  const byType = [...items.reduce((m, d) => m.set(d.docTypeLabel, [...(m.get(d.docTypeLabel) ?? []), d]), new Map<string, InboxItem[]>())];
  return (
    <Card>
      <CardHeader title="Pending approvals" action={<Link href="/approvals" className="text-sm font-medium text-primary hover:underline">View all</Link>} />
      {inbox.isLoading ? (
        <LoadingBlock />
      ) : !items.length ? (
        <EmptyState title="You're all caught up" description="Documents sent to you for approval appear here." />
      ) : (
        <ul className="divide-y divide-border">
          {byType.map(([label, docs]) => {
            const total = docs.reduce((t, d) => t + Number(d.amount ?? 0), 0);
            return (
              <li key={label}>
                <Link href={docs.length === 1 && docs[0].path ? docs[0].path : "/approvals"} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-muted/60">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <Inbox className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{label}</span>
                    <span className="block truncate text-xs text-muted">{total > 0 ? formatMoney(String(total)) : "Waiting for you"}</span>
                  </span>
                  <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-white tabular-nums">{docs.length}</span>
                  <ChevronRight className="size-4 text-muted" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
