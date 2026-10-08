"use client";

import { Loader2, Menu, Search, Shield, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { documentKeys, type InboxItem } from "@/lib/documents";
import { CommandPalette } from "@/components/command-palette";
import { Copilot } from "@/components/copilot";
import { NotificationsBell } from "@/components/notifications-bell";
import { Breadcrumbs, CreateMenu, UserMenu } from "@/components/shell/header-parts";
import { Sidebar } from "@/components/shell/sidebar";
import { VoiceButton } from "@/components/voice-button";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import { industryLabel } from "@/lib/industries";

const COLLAPSED_KEY = "nav-collapsed";

export default function AppLayout({ children }: LayoutProps<"/">) {
  const { status, me, logout, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        // Storage unavailable: the choice lasts until the page reloads.
      }
      return !c;
    });
  };
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

  const sidebarProps = { pathname, can, badges };

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside data-tour="nav" className="sticky top-0 hidden h-screen shrink-0 lg:block">
        <Sidebar {...sidebarProps} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </aside>

      {/* Mobile and tablet drawer */}
      <div className={cn("fixed inset-0 z-40 lg:hidden", !menuOpen && "pointer-events-none")} aria-hidden={!menuOpen}>
        <div className={cn("absolute inset-0 bg-black/50 transition-opacity duration-200", menuOpen ? "opacity-100" : "opacity-0")} onClick={() => setMenuOpen(false)} />
        <aside className={cn("absolute inset-y-0 left-0 shadow-2xl transition-transform duration-200", menuOpen ? "translate-x-0" : "-translate-x-full")} inert={!menuOpen}>
          <Sidebar
            {...sidebarProps}
            onNavigate={() => setMenuOpen(false)}
            closeButton={
              <button className="rounded-lg p-2 text-sidebar-muted hover:bg-sidebar-hover hover:text-white" onClick={() => setMenuOpen(false)} aria-label="Close menu">
                <X className="size-5" />
              </button>
            }
          />
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur sm:gap-3 sm:px-6">
          <button className="rounded-lg p-2 hover:bg-surface-muted lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            {pathname === "/dashboard" ? (
              <p className="truncate text-sm">
                <span className="font-medium">{me.tenant.name}</span>
                {me.tenant.industry && <span className="hidden text-muted sm:inline"> · {industryLabel(me.tenant.industry)}</span>}
              </p>
            ) : (
              <Breadcrumbs pathname={pathname} />
            )}
          </div>
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden h-9 w-64 items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 text-sm text-muted hover:border-primary/40 hover:text-foreground md:flex xl:w-80"
            aria-label="Search (Ctrl+K)"
            data-tour="search"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 truncate text-left">Search items, parties, documents…</span>
            <kbd className="rounded border border-border bg-surface px-1.5 text-[10px]">Ctrl K</kbd>
          </button>
          <button onClick={() => setPaletteOpen(true)} className="rounded-lg p-2 text-muted hover:bg-surface-muted md:hidden" aria-label="Search">
            <Search className="size-5" />
          </button>
          <CreateMenu can={can} />
          {me.isPlatformAdmin && (
            <Link href="/admin" className="hidden rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground sm:block" title="Platform admin" aria-label="Platform admin">
              <Shield className="size-5" />
            </Link>
          )}
          {me.plan.state === "trialing" && me.plan.trialEndsAt && (
            <Link
              href={can("platform.billing.manage") ? "/settings/billing" : "#"}
              className="hidden rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium whitespace-nowrap text-warning 2xl:inline"
            >
              Trial · {daysLeft(me.plan.trialEndsAt)} days left
            </Link>
          )}
          <NotificationsBell />
          <UserMenu name={me.user.fullName} email={me.user.email} tenant={me.tenant.name} onSignOut={() => logout().then(() => router.replace("/login"))} />
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
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">{children}</main>
        {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
        <Copilot />
        <VoiceButton />
      </div>
    </div>
  );
}

function daysLeft(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}
