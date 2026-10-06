"use client";

import { Factory, Loader2, LogOut, Menu, Search, Shield, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { documentKeys, type InboxItem } from "@/lib/documents";
import { CommandPalette } from "@/components/command-palette";
import { NotificationsBell } from "@/components/notifications-bell";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import { NAVIGATION } from "@/lib/navigation";

export default function AppLayout({ children }: LayoutProps<"/">) {
  const { status, me, logout, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const inbox = useQuery({
    queryKey: documentKeys.inbox,
    queryFn: () => api<InboxItem[]>("/documents/approvals/inbox"),
    enabled: status === "authenticated",
    refetchInterval: 60_000,
  });
  const badges: Record<string, number> = { approvals: inbox.data?.length ?? 0 };

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  // Ctrl/Cmd+K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the mobile drawer whenever the route changes.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  if (status !== "authenticated" || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        <Loader2 className="size-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  const initials = me.user.fullName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4" aria-label="Main">
      {NAVIGATION.map((section, i) => {
        const items = section.items.filter((item) => !item.permissions || item.permissions.some(can));
        if (!items.length) return null;
        return (
          <div key={section.title ?? i}>
            {section.title && (
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{section.title}</p>
            )}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                const content = (
                  <>
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge && badges[item.badge] > 0 && (
                      <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                        {badges[item.badge]}
                      </span>
                    )}
                    {item.comingInPhase && (
                      <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        Soon
                      </span>
                    )}
                  </>
                );
                return (
                  <li key={item.href}>
                    {item.comingInPhase ? (
                      <span
                        className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted/70"
                        title={`Arrives in Phase ${item.comingInPhase}`}
                      >
                        {content}
                      </span>
                    ) : (
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                          active ? "bg-primary-soft font-medium text-primary" : "text-foreground hover:bg-surface-muted",
                        )}
                      >
                        {content}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <Brand />
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button className="rounded-lg p-2 hover:bg-surface-muted" onClick={() => setMenuOpen(false)} aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6">
          <button className="-ml-2 rounded-lg p-2 hover:bg-surface-muted lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me.tenant.name}</p>
          </div>
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden h-9 items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 text-sm text-muted hover:text-foreground md:flex"
            aria-label="Search (Ctrl+K)"
          >
            <Search className="size-4" aria-hidden />
            <span>Search…</span>
            <kbd className="ml-4 rounded border border-border bg-surface px-1.5 text-[10px]">Ctrl K</kbd>
          </button>
          <button onClick={() => setPaletteOpen(true)} className="rounded-lg p-2 text-muted hover:bg-surface-muted md:hidden" aria-label="Search">
            <Search className="size-5" />
          </button>
          {me.isPlatformAdmin && (
            <Link href="/admin" className="hidden rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground sm:block" title="Platform admin" aria-label="Platform admin">
              <Shield className="size-5" />
            </Link>
          )}
          {me.plan.state === "trialing" && me.plan.trialEndsAt && (
            <Link
              href={can("platform.billing.manage") ? "/settings/billing" : "#"}
              className="hidden rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning sm:inline"
            >
              Trial · {daysLeft(me.plan.trialEndsAt)} days left
            </Link>
          )}
          <div className="flex items-center gap-1">
            <NotificationsBell />
            <Link
              href="/account"
              className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary hover:ring-2 hover:ring-ring"
              title={`${me.user.fullName} (${me.user.email}) · My account`}
              aria-label="My account"
            >
              {initials}
            </Link>
            <button
              onClick={() => logout().then(() => router.replace("/login"))}
              className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        {me.plan.readOnly && (
          <div role="alert" className="border-b border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger sm:px-6 lg:px-8">
            {me.plan.state === "suspended"
              ? "This workspace is suspended. You can view data but not make changes. Contact support."
              : "Your trial or subscription has ended. The workspace is read-only until a plan is chosen."}{" "}
            {can("platform.billing.manage") && me.plan.state !== "suspended" && (
              <Link href="/settings/billing" className="font-semibold underline">
                Choose a plan
              </Link>
            )}
          </div>
        )}
        {me.plan.state === "past_due" && (
          <div role="alert" className="border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning sm:px-6 lg:px-8">
            We couldn&apos;t collect your last subscription payment. Please update your payment method to avoid interruption.
          </div>
        )}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex h-14 items-center gap-2 px-6 font-semibold">
      <Factory className="size-5 text-primary" aria-hidden />
      NextGen ERP
    </Link>
  );
}

function daysLeft(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}
