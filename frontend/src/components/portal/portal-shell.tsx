"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FileText, Headset, Home, LogOut, Megaphone, PackageCheck, ScrollText, ShoppingCart, Truck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { ApiError } from "@/lib/api";
import { portalApi, portalToken, setPortalToken, usePortalMe } from "@/lib/portal";

const OPEN = ["/portal/login", "/portal/accept"];

export function PortalShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const open = OPEN.some((p) => path.startsWith(p));
  return open ? <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-10"><div className="w-full max-w-md">{children}</div></div> : <SignedIn path={path}>{children}</SignedIn>;
}

function SignedIn({ path, children }: { path: string; children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const me = usePortalMe();
  const lost = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (lost || !portalToken()) router.replace("/portal/login");
  }, [router, lost, path]);
  if (me.error && !lost) return <div className="p-6"><ErrorBlock error={me.error} /></div>;
  if (me.isLoading || !me.data) return <LoadingBlock />;
  const nav = [
    { href: "/portal", label: "Home", icon: Home },
    { href: "/portal/orders", label: "Orders", icon: ShoppingCart },
    { href: "/portal/invoices", label: "Invoices & payments", icon: FileText },
    { href: "/portal/statement", label: "Statement", icon: ScrollText },
    { href: "/portal/deliveries", label: "Schedules & ASN", icon: Truck },
    { href: "/portal/tickets", label: "Service", icon: Headset },
    ...(me.data.kind === "dealer" ? [{ href: "/portal/dealer", label: "Schemes & claims", icon: Megaphone }] : []),
  ];
  async function signOut() {
    await portalApi("/portal/logout", { body: {} }).catch(() => null);
    setPortalToken(null);
    qc.removeQueries({ queryKey: ["portal"] });
    router.replace("/portal/login");
  }
  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold"><PackageCheck className="size-5 text-primary" aria-hidden />{me.data.company}</div>
          <nav className="flex flex-wrap gap-1 text-sm">
            {nav.map((n) => {
              const active = n.href === "/portal" ? path === "/portal" : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 ${active ? "bg-primary/10 font-medium text-primary" : "text-muted hover:bg-surface-muted"}`}>
                  <n.icon className="size-4" aria-hidden />
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted">{me.data.name} · {me.data.party.name}</span>
            <button type="button" onClick={signOut} className="flex items-center gap-1 text-muted hover:text-foreground"><LogOut className="size-4" aria-hidden /> Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
