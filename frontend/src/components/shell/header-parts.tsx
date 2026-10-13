"use client";

import { ChevronDown, ChevronRight, House, LogOut, Plus, Smartphone, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { findNav } from "@/lib/navigation";

/** Home / Module / Screen / Details, from the menu entry the page belongs to. */
export function Breadcrumbs({ pathname }: { pathname: string }) {
  if (pathname === "/dashboard") return null;
  const hit = findNav(pathname);
  const crumbs: { label: string; href?: string }[] = [];
  if (hit) {
    if (hit.group) crumbs.push({ label: hit.group });
    const deeper = pathname !== hit.item.href;
    crumbs.push({ label: hit.item.label, href: deeper ? hit.item.href : undefined });
    if (deeper) {
      const tail = pathname.slice(hit.item.href.length).split("/").filter(Boolean);
      const last = tail.at(-1);
      crumbs.push({ label: last === "new" ? "New" : last === "edit" ? "Edit" : "Details" });
    }
  } else {
    const parts = pathname.split("/").filter(Boolean);
    parts.forEach((p, i) => crumbs.push({ label: titleCase(p), href: i < parts.length - 1 ? `/${parts.slice(0, i + 1).join("/")}` : undefined }));
  }
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted">
        <li className="hidden shrink-0 sm:block">
          <Link href="/dashboard" className="flex items-center gap-1 hover:text-foreground">
            <House className="size-3.5" aria-hidden /> Home
          </Link>
        </li>
        {crumbs.map((c, i) => (
          <li key={i} className={cn("flex min-w-0 items-center gap-1", i < crumbs.length - 2 && "hidden md:flex")}>
            <ChevronRight className={cn("size-3.5 shrink-0 opacity-60", i === crumbs.length - 1 && "hidden sm:block")} aria-hidden />
            {c.href ? (
              <Link href={c.href} className="truncate hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span className={cn("truncate", i === crumbs.length - 1 && "font-medium text-foreground")} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const titleCase = (s: string) => (/^[0-9a-f-]{20,}$/i.test(s) ? "Details" : s.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()));

/** Closes a popover on outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const CREATE: { group: string; items: { label: string; href: string; permission: string; module?: string }[] }[] = [
  {
    group: "Sales",
    items: [
      { label: "Quotation", href: "/sales/quotations/new", permission: "sales.quotations.manage" },
      { label: "Sales order", href: "/sales/orders/new", permission: "sales.orders.manage" },
      { label: "Delivery", href: "/sales/deliveries/new", permission: "sales.deliveries.manage" },
      { label: "Sales invoice", href: "/sales/invoices/new", permission: "sales.invoices.manage" },
    ],
  },
  {
    group: "Purchase",
    items: [
      { label: "Purchase requisition", href: "/purchase/requisitions/new", permission: "purchase.requisitions.manage" },
      { label: "Purchase order", href: "/purchase/orders/new", permission: "purchase.orders.manage" },
      { label: "Goods receipt", href: "/purchase/receipts/new", permission: "purchase.receipts.manage" },
      { label: "Purchase invoice", href: "/purchase/invoices/new", permission: "purchase.invoices.manage" },
    ],
  },
  {
    group: "Stock & production",
    items: [
      { label: "Stock entry", href: "/inventory/stock-entries/new", permission: "inventory.entries.manage" },
      { label: "Work order", href: "/manufacturing/work-orders/new", permission: "manufacturing.production.manage", module: "manufacturing" },
    ],
  },
  {
    group: "Finance",
    items: [
      { label: "Receipt", href: "/accounting/receipts/new", permission: "accounting.money.manage" },
      { label: "Payment", href: "/accounting/payments/new", permission: "accounting.money.manage" },
      { label: "Journal voucher", href: "/accounting/journals/new", permission: "accounting.journals.manage" },
    ],
  },
  {
    group: "Master data",
    items: [
      { label: "Item", href: "/masters/items/new", permission: "masters.items.manage" },
      { label: "Customer or vendor", href: "/masters/parties/new", permission: "masters.parties.manage" },
    ],
  },
];

/** "Create" button: new documents and records the user may create. */
export function CreateMenu({ can, hasModule }: { can: (p: string) => boolean; hasModule: (m: string | null | undefined) => boolean }) {
  const { open, setOpen, ref } = usePopover();
  const groups = CREATE.map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission) && hasModule(i.module)) })).filter((g) => g.items.length);
  if (!groups.length) return null;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
      >
        <Plus className="size-4" aria-hidden />
        <span className="hidden sm:inline">Create</span>
        <ChevronDown className="hidden size-3.5 opacity-80 sm:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-3 shadow-xl">
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g.group}>
                <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{g.group}</p>
                {g.items.map((i) => (
                  <Link key={i.href} role="menuitem" href={i.href} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-muted">
                    <Plus className="size-3.5 text-muted" aria-hidden /> {i.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Avatar with name; opens account links and sign out. */
export function UserMenu({ name, email, tenant, onSignOut }: { name: string; email: string; tenant: string; onSignOut: () => void }) {
  const { open, setOpen, ref } = usePopover();
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label="Account menu" className="flex items-center gap-2 rounded-lg py-1 pr-1.5 pl-1 hover:bg-surface-muted">
        <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{initials}</span>
        <span className="hidden min-w-0 text-left leading-tight xl:block">
          <span className="block max-w-36 truncate text-sm font-medium">{name}</span>
          <span className="block max-w-36 truncate text-xs text-muted">{tenant}</span>
        </span>
        <ChevronDown className="hidden size-3.5 text-muted xl:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-border bg-surface p-1 shadow-xl">
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
          </div>
          <Link role="menuitem" href="/account" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
            <UserRound className="size-4 text-muted" aria-hidden /> My account
          </Link>
          <Link role="menuitem" href="/m" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
            <Smartphone className="size-4 text-muted" aria-hidden /> Owner&apos;s phone view
          </Link>
          <button role="menuitem" onClick={onSignOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
