"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Good {greeting()}, {firstName}</h1>
        <p className="mt-1 text-sm text-muted">
          {me.tenant.name}
          {me.tenant.industry && <> · {industryLabel(me.tenant.industry)}</>}
        </p>
      </div>

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
    </div>
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
