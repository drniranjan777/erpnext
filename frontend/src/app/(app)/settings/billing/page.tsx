"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { formatDate, formatMoney } from "@/lib/documents";

type Cycle = "monthly" | "yearly";

interface Plan {
  code: string;
  name: string;
  tagline: string;
  priceMonthly: number;
  priceYearly: number;
  priceMonthlyWithGst: string;
  priceYearlyWithGst: string;
  yearlySavingsPercent: number;
  limits: { users: number; companies: number; storageMb: number; apiKeys: number; webhooks: number };
  features: string[];
}

interface Summary {
  entitlements: { planCode: string; planName: string; state: string; readOnly: boolean; trialEndsAt: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean; features: string[]; limits: Plan["limits"] };
  usage: Plan["limits"];
  subscription: { status: string; planCode: string; cycle: Cycle; provider: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  provider: "mock" | "razorpay";
}

interface Invoice {
  id: string;
  number: string;
  invoiceDate: string;
  description: string;
  total: string;
  status: string;
}

const FEATURE_LABEL: Record<string, string> = {
  multi_level_approvals: "Multi-level approvals",
  custom_fields: "Custom fields",
  print_designer: "Custom print formats",
  api_access: "API keys",
  webhooks: "Webhooks",
  whatsapp: "WhatsApp notifications",
  priority_support: "Priority support",
};

const STATE_LABEL: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "primary" }> = {
  trialing: { label: "Free trial", tone: "primary" },
  active: { label: "Active", tone: "success" },
  past_due: { label: "Payment overdue", tone: "danger" },
  cancelled: { label: "Cancels at period end", tone: "warning" },
  expired: { label: "Expired", tone: "danger" },
  suspended: { label: "Suspended", tone: "danger" },
};

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the payment window"));
    document.body.appendChild(s);
  });
}

export default function BillingPage() {
  const qc = useQueryClient();
  const { me, refreshMe } = useAuth();
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [testCheckout, setTestCheckout] = useState<{ checkoutId: string; plan: Plan } | null>(null);
  const plans = useQuery({ queryKey: ["billing", "plans"], queryFn: () => api<Plan[]>("/billing/plans") });
  const summary = useQuery({ queryKey: ["billing", "summary"], queryFn: () => api<Summary>("/billing/summary") });
  const invoices = useQuery({ queryKey: ["billing", "invoices"], queryFn: () => api<Invoice[]>("/billing/invoices") });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["billing"] });
    await refreshMe();
  };

  const checkout = useMutation({
    mutationFn: (plan: Plan) =>
      api<{ provider: "mock" | "razorpay"; checkoutId: string; razorpay?: { keyId: string; subscriptionId: string } }>("/billing/checkout", {
        body: { planCode: plan.code, cycle },
      }).then((r) => ({ ...r, plan })),
    onSuccess: async (r) => {
      if (r.provider === "mock") return setTestCheckout({ checkoutId: r.checkoutId, plan: r.plan });
      await loadRazorpay();
      new window.Razorpay!({
        key: r.razorpay!.keyId,
        subscription_id: r.razorpay!.subscriptionId,
        name: "NextGen ERP",
        description: `${r.plan.name} plan (${cycle})`,
        prefill: { name: me?.user.fullName, email: me?.user.email, contact: me?.user.mobile ?? undefined },
        theme: { color: "#1d4ed8" },
        // Activation arrives via the signed webhook; poll briefly so the page updates.
        handler: () => setTimeout(refresh, 3000),
      }).open();
    },
  });
  const confirmTest = useMutation({
    mutationFn: (checkoutId: string) => api(`/billing/checkout/${checkoutId}/confirm-test`, { method: "POST" }),
    onSuccess: async () => {
      setTestCheckout(null);
      await refresh();
    },
  });
  const cancel = useMutation({ mutationFn: () => api("/billing/cancel", { method: "POST" }), onSuccess: refresh });
  const resume = useMutation({ mutationFn: () => api("/billing/resume", { method: "POST" }), onSuccess: refresh });

  const s = summary.data;
  const e = s?.entitlements;
  const state = e ? STATE_LABEL[e.state] : undefined;
  const actionError = checkout.error ?? cancel.error ?? resume.error;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Billing & plan" description="Your subscription, usage and GST invoices. Prices exclude 18% GST." />
      {(summary.isLoading || plans.isLoading) && <LoadingBlock />}
      {summary.error && <ErrorBlock error={summary.error} />}
      {actionError && <Alert>{(actionError as Error).message}</Alert>}

      {e && s && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader title="Current plan" />
            <div className="space-y-3 px-5 py-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xl font-semibold">{e.planName}</span>
                {state && <Badge tone={state.tone}>{state.label}</Badge>}
              </div>
              {e.state === "trialing" && e.trialEndsAt && <p className="text-muted">Trial ends on {formatDate(e.trialEndsAt)}.</p>}
              {e.periodEnd && e.state !== "trialing" && (
                <p className="text-muted">
                  {e.cancelAtPeriodEnd ? "Access until" : "Renews on"} {formatDate(e.periodEnd)}
                  {s.subscription && ` · billed ${s.subscription.cycle}`}
                </p>
              )}
              {e.readOnly && <Alert>The workspace is read-only. Choose a plan below to continue making changes.</Alert>}
              <div className="flex flex-wrap gap-2 pt-1">
                {s.subscription?.status === "active" && (
                  <Button variant="ghost" size="sm" loading={cancel.isPending} onClick={() => confirm("Cancel the subscription at the end of the current period?") && cancel.mutate()}>
                    Cancel subscription
                  </Button>
                )}
                {s.subscription?.status === "cancelled" && !e.readOnly && s.provider === "mock" && (
                  <Button variant="secondary" size="sm" loading={resume.isPending} onClick={() => resume.mutate()}>
                    Resume subscription
                  </Button>
                )}
              </div>
            </div>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Usage" />
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
              <Meter label="Users (incl. pending invites)" used={s.usage.users} limit={e.limits.users} />
              <Meter label="Companies" used={s.usage.companies} limit={e.limits.companies} />
              <Meter label="File storage" used={s.usage.storageMb} limit={e.limits.storageMb} unit="MB" />
              <Meter label="API keys" used={s.usage.apiKeys} limit={e.limits.apiKeys} />
              <Meter label="Webhooks" used={s.usage.webhooks} limit={e.limits.webhooks} />
            </div>
          </Card>
        </div>
      )}

      {plans.data && e && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Plans</h2>
            <div role="radiogroup" aria-label="Billing cycle" className="inline-flex rounded-lg border border-border bg-surface p-1 text-sm">
              {(["monthly", "yearly"] as Cycle[]).map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={cycle === c}
                  onClick={() => setCycle(c)}
                  className={cn("rounded-md px-3 py-1.5", cycle === c ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground")}
                >
                  {c === "monthly" ? "Monthly" : `Yearly (save ${plans.data[0]?.yearlySavingsPercent ?? 17}%)`}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {plans.data.map((p) => {
              const current = e.planCode === p.code && (e.state === "active" || e.state === "cancelled");
              const price = cycle === "monthly" ? p.priceMonthly : p.priceYearly;
              return (
                <Card key={p.code} className={cn("flex flex-col p-5", p.code === "growth" && "border-primary ring-1 ring-primary")}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    {p.code === "growth" && <Badge tone="primary">Most popular</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted">{p.tagline}</p>
                  <p className="mt-4">
                    <span className="text-3xl font-semibold tabular-nums">{formatMoney(price).replace(".00", "")}</span>
                    <span className="text-sm text-muted"> / {cycle === "monthly" ? "month" : "year"} + GST</span>
                  </p>
                  <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                    <li>{p.limits.users} users · {p.limits.companies} {p.limits.companies === 1 ? "company" : "companies"}</li>
                    <li>{p.limits.storageMb >= 1024 ? `${Math.round(p.limits.storageMb / 1024)} GB` : `${p.limits.storageMb} MB`} file storage</li>
                    {Object.entries(FEATURE_LABEL).map(([f, label]) => (
                      <li key={f} className={cn("flex items-center gap-2", !p.features.includes(f) && "text-muted line-through")}>
                        <Check className={cn("size-3.5", p.features.includes(f) ? "text-success" : "opacity-0")} aria-hidden />
                        {label}
                      </li>
                    ))}
                  </ul>
                  <Button className="mt-5 w-full" variant={current ? "secondary" : "primary"} disabled={current} loading={checkout.isPending && checkout.variables?.code === p.code} onClick={() => checkout.mutate(p)}>
                    {current ? "Current plan" : e.state === "active" ? `Switch to ${p.name}` : `Choose ${p.name}`}
                  </Button>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <Card>
        <CardHeader title="Invoices" description="GST tax invoices for your subscription (SAC 998314)." />
        {invoices.data?.length === 0 && <EmptyState title="No invoices yet" />}
        <ul className="divide-y divide-border">
          {invoices.data?.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <FileText className="size-4 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{i.number}</p>
                <p className="text-xs text-muted">
                  {formatDate(i.invoiceDate)} · {i.description}
                </p>
              </div>
              <span className="tabular-nums">{formatMoney(i.total)}</span>
              <Badge tone="success">{i.status}</Badge>
              <Link href={`/print/invoices/${i.id}`} target="_blank" className="text-sm font-medium text-primary hover:underline">
                View / print
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {testCheckout && (
        <Dialog
          open
          onClose={() => setTestCheckout(null)}
          title="Test checkout"
          description="Billing is in test mode: no real payment is taken. Connect Razorpay keys to accept payments."
          footer={
            <>
              <Button variant="secondary" onClick={() => setTestCheckout(null)}>
                Cancel
              </Button>
              <Button loading={confirmTest.isPending} onClick={() => confirmTest.mutate(testCheckout.checkoutId)}>
                Simulate successful payment
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-sm">
            <p>
              <strong>{testCheckout.plan.name}</strong> plan, billed {cycle}
            </p>
            <p className="text-muted">
              {formatMoney(cycle === "monthly" ? testCheckout.plan.priceMonthly : testCheckout.plan.priceYearly)} + 18% GST ={" "}
              <strong className="text-foreground">{formatMoney(cycle === "monthly" ? testCheckout.plan.priceMonthlyWithGst : testCheckout.plan.priceYearlyWithGst)}</strong>
            </p>
            {confirmTest.error && <Alert>{(confirmTest.error as Error).message}</Alert>}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Meter({ label, used, limit, unit }: { label: string; used: number; limit: number; unit?: string }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : used > 0 ? 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted">
          {used}
          {unit ? ` ${unit}` : ""} / {limit === 0 ? "not included" : `${limit}${unit ? ` ${unit}` : ""}`}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cn("h-full rounded-full", pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
