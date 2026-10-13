"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronsLeft, ChevronsRight, Factory, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { openCopilot } from "@/components/copilot";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { FOOTER, NAV_GROUPS, PINNED, findNav, type NavGroup, type NavItem } from "@/lib/navigation";

interface SidebarProps {
  pathname: string;
  can: (permission: string) => boolean;
  /** Whether an optional module is switched on for the workspace. */
  hasModule: (module: string | null | undefined) => boolean;
  badges: Record<string, number>;
  /** Icon-only rail (desktop). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Called after a destination is chosen (closes the mobile drawer). */
  onNavigate?: () => void;
  /** Extra control at the top right (the drawer's close button). */
  closeButton?: React.ReactNode;
}

const visible = (can: SidebarProps["can"]) => (i: NavItem) => !i.permissions || i.permissions.some(can);

/** Groups and sections trimmed to what the user may open; empty groups disappear. */
function allowedGroups(can: SidebarProps["can"], hasModule: SidebarProps["hasModule"]): NavGroup[] {
  return NAV_GROUPS.filter((g) => hasModule(g.module))
    .map((g) => ({ ...g, sections: g.sections.filter((s) => hasModule(s.module)).map((s) => ({ ...s, items: s.items.filter((i) => hasModule(i.module) && visible(can)(i)) })).filter((s) => s.items.length) }))
    .filter((g) => g.sections.length);
}

/**
 * The main navigation: pinned destinations, then one heading per module that expands to its
 * screens. One module is open at a time; the module holding the current page opens itself.
 */
export function Sidebar({ pathname, can, hasModule, badges, collapsed = false, onToggleCollapsed, onNavigate, closeButton }: SidebarProps) {
  const groups = useMemo(() => allowedGroups(can, hasModule), [can, hasModule]);
  const current = findNav(pathname);
  const activeHref = current?.item.href;
  const activeGroup = current?.group ?? null;
  const [open, setOpen] = useState<string | null>(activeGroup);
  const [q, setQ] = useState("");
  const navRef = useRef<HTMLElement>(null);

  // Follow the user into another module.
  const [lastGroup, setLastGroup] = useState(activeGroup);
  if (activeGroup !== lastGroup) {
    setLastGroup(activeGroup);
    if (activeGroup) setOpen(activeGroup);
  }

  const term = q.trim().toLowerCase();
  const matches = term
    ? [...PINNED.filter(visible(can)).map((item) => ({ item, where: "" })), ...groups.flatMap((g) => g.sections.flatMap((s) => s.items.map((item) => ({ item, where: s.title ? `${g.title} · ${s.title}` : g.title }))))].filter(
        ({ item, where }) => item.label.toLowerCase().includes(term) || where.toLowerCase().includes(term),
      )
    : [];

  return (
    <div className={cn("flex h-full flex-col bg-sidebar text-sidebar-foreground", collapsed ? "w-16" : "w-64")}>
      <div className={cn("flex h-14 shrink-0 items-center gap-2", collapsed ? "justify-center" : "pr-3")}>
        <Brand collapsed={collapsed} />
        {closeButton}
      </div>

      {!collapsed && (
        <div className="px-3 pb-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-sidebar-muted" aria-hidden />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                navRef.current?.scrollTo({ top: 0 });
              }}
              onKeyDown={(e) => e.key === "Escape" && setQ("")}
              placeholder="Search menu…"
              aria-label="Search the menu"
              className="h-9 w-full rounded-md border border-sidebar-border bg-white/5 pr-8 pl-8 text-sm text-white placeholder:text-sidebar-muted focus:border-primary focus:outline-none"
            />
            {q && (
              <button onClick={() => setQ("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-sidebar-muted hover:text-white" aria-label="Clear menu search">
                <X className="size-3.5" />
              </button>
            )}
          </label>
        </div>
      )}

      <nav ref={navRef} className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3" aria-label="Main">
        {term ? (
          <ul className="space-y-0.5 pt-1">
            {matches.map(({ item, where }) => (
              <li key={item.href}>
                <MenuItem item={item} active={item.href === activeHref} onNavigate={onNavigate} hint={where} />
              </li>
            ))}
            {!matches.length && <li className="px-3 py-6 text-center text-sm text-sidebar-muted">Nothing in the menu matches “{q.trim()}”.</li>}
          </ul>
        ) : (
          <>
            <ul className="space-y-0.5 pt-1">
              {PINNED.filter(visible(can)).map((item) => (
                <li key={item.href}>
                  {collapsed ? (
                    <RailLink item={item} active={item.href === activeHref} badge={item.badge ? badges[item.badge] : 0} />
                  ) : (
                    <MenuItem item={item} active={item.href === activeHref} badge={item.badge ? badges[item.badge] : 0} onNavigate={onNavigate} strong />
                  )}
                </li>
              ))}
            </ul>
            <div className="mx-2 my-3 border-t border-sidebar-border" />
            <ul className="space-y-0.5">
              {groups.map((g) =>
                collapsed ? (
                  <li key={g.title}>
                    <RailGroup group={g} active={g.title === activeGroup} activeHref={activeHref} />
                  </li>
                ) : (
                  <li key={g.title}>
                    <SidebarGroup group={g} open={open === g.title} containsActive={g.title === activeGroup} activeHref={activeHref} onToggle={() => setOpen(open === g.title ? null : g.title)} onNavigate={onNavigate} />
                  </li>
                ),
              )}
            </ul>
          </>
        )}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-2 py-2">
        <ul className="space-y-0.5">
          {FOOTER.map((item) => (
            <li key={item.href}>{collapsed ? <RailLink item={item} active={item.href === activeHref} /> : <MenuItem item={item} active={item.href === activeHref} onNavigate={onNavigate} />}</li>
          ))}
        </ul>
        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            className={cn("mt-1 flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm text-sidebar-muted hover:bg-sidebar-hover hover:text-white", collapsed && "justify-center px-0")}
            aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
            title={collapsed ? "Expand the menu" : "Collapse the menu"}
          >
            {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
            {!collapsed && <span>Collapse</span>}
          </button>
        )}
      </div>
    </div>
  );
}

/** A module heading that expands to its sections. */
function SidebarGroup({ group, open, containsActive, activeHref, onToggle, onNavigate }: { group: NavGroup; open: boolean; containsActive: boolean; activeHref?: string; onToggle: () => void; onNavigate?: () => void }) {
  const Icon = group.icon;
  const id = `nav-${group.title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <>
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className={cn(
          "flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-[13px] font-semibold tracking-wide uppercase transition-colors hover:bg-sidebar-hover hover:text-white",
          containsActive || open ? "text-white" : "text-sidebar-muted",
        )}
      >
        <Icon className={cn("size-4 shrink-0", containsActive && "text-primary")} aria-hidden />
        <span className="flex-1 truncate">{group.title}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      <div id={id} className={cn("grid transition-[grid-template-rows] duration-200 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")} inert={!open}>
        <div className="overflow-hidden">
          <div className="ml-5 border-l border-sidebar-border py-1 pl-2">
            {group.sections.map((s, i) => (
              <div key={s.title ?? i} className={cn(i > 0 && "mt-2")}>
                {s.title && <p className="px-2 pt-1 pb-1 text-[11px] font-medium text-sidebar-muted">{s.title}</p>}
                <ul className="space-y-px">
                  {s.items.map((item) => (
                    <li key={item.href}>
                      <MenuItem item={item} active={item.href === activeHref} onNavigate={onNavigate} small />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/** One destination. */
function MenuItem({ item, active, badge = 0, onNavigate, small, strong, hint }: { item: NavItem; active: boolean; badge?: number; onNavigate?: () => void; small?: boolean; strong?: boolean; hint?: string }) {
  const Icon = item.icon;
  const className = cn(
    "flex w-full items-center gap-2.5 rounded-md text-left transition-colors",
    small ? "px-2 py-1.5 text-[13px]" : "h-9 px-3 text-sm",
    strong && "font-medium",
    active ? "bg-primary text-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-white",
  );
  const body = (
    <>
      <Icon className={cn("shrink-0", small ? "size-3.5" : "size-4", !active && "opacity-80")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {hint && <span className={cn("block truncate text-[11px]", active ? "text-primary-foreground/80" : "text-sidebar-muted")}>{hint}</span>}
      </span>
      {badge > 0 && <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] leading-none font-semibold text-white tabular-nums">{badge}</span>}
    </>
  );
  if (item.opensCopilot) {
    return (
      <button
        type="button"
        className={className}
        title="Ask the copilot (Ctrl+J)"
        onClick={() => {
          onNavigate?.();
          openCopilot();
        }}
      >
        {body}
      </button>
    );
  }
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={className} onClick={onNavigate}>
      {body}
    </Link>
  );
}

/** Collapsed rail: an icon with its name on hover. */
function RailLink({ item, active, badge = 0 }: { item: NavItem; active: boolean; badge?: number }) {
  const Icon = item.icon;
  return (
    <Flyout label={item.label}>
      <Link
        href={item.href}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn("relative mx-auto flex size-10 items-center justify-center rounded-md transition-colors", active ? "bg-primary text-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-white")}
      >
        <Icon className="size-[18px]" aria-hidden />
        {badge > 0 && <span className="absolute top-1 right-1 size-2 rounded-full bg-danger" aria-hidden />}
      </Link>
    </Flyout>
  );
}

/** Collapsed rail: a module icon whose screens open beside it. */
function RailGroup({ group, active, activeHref }: { group: NavGroup; active: boolean; activeHref?: string }) {
  const Icon = group.icon;
  return (
    <Flyout
      label={group.title}
      menu={group.sections.map((s, i) => (
        <div key={s.title ?? i} className={cn(i > 0 && "mt-1 border-t border-border pt-1")}>
          {s.title && <p className="px-3 pt-1.5 pb-0.5 text-[11px] font-medium text-muted">{s.title}</p>}
          {s.items.map((item) => {
            const ItemIcon = item.icon;
            const cls = cn("flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm", item.href === activeHref ? "bg-primary-soft font-medium text-primary" : "hover:bg-surface-muted");
            return item.opensCopilot ? (
              <button key={item.href} className={cls} onClick={openCopilot}>
                <ItemIcon className="size-3.5 text-muted" aria-hidden /> {item.label}
              </button>
            ) : (
              <Link key={item.href} href={item.href} className={cls}>
                <ItemIcon className="size-3.5 text-muted" aria-hidden /> {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    >
      <button aria-label={group.title} className={cn("mx-auto flex size-10 items-center justify-center rounded-md transition-colors", active ? "bg-sidebar-hover text-primary" : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-white")}>
        <Icon className="size-[18px]" aria-hidden />
      </button>
    </Flyout>
  );
}

/**
 * A panel beside the rail on hover or focus. Positioned against the viewport because the rail
 * scrolls (and would clip anything sticking out of it).
 */
function Flyout({ label, menu, children }: { label: string; menu?: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = () => {
    clearTimeout(timer.current);
    const r = ref.current?.getBoundingClientRect();
    if (r) setTop(r.top);
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setTop(null), 120);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div ref={ref} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onKeyDown={(e) => e.key === "Escape" && setTop(null)}>
      {children}
      {top !== null && (
        <div
          className="fixed left-16 z-50 pl-2"
          style={menu ? { top: Math.max(8, Math.min(top, window.innerHeight - 420)) } : { top: top + 4 }}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {menu ? (
            <div className="scrollbar-thin max-h-[min(410px,calc(100vh-16px))] w-60 overflow-y-auto rounded-lg border border-border bg-surface p-1 text-foreground shadow-xl">
              <p className="px-3 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
              {menu}
            </div>
          ) : (
            <span className="rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background shadow-lg">{label}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** The product name, logo and colour: the workspace's white-label brand when it has one. */
function Brand({ collapsed }: { collapsed: boolean }) {
  const b = useQuery({ queryKey: ["/branding"], queryFn: () => api<{ productName: string | null; logo: string | null; primaryColor: string | null }>("/branding"), staleTime: 300_000 });
  const color = b.data?.primaryColor;
  useEffect(() => {
    if (!color) return;
    const root = document.documentElement.style;
    root.setProperty("--primary", color);
    root.setProperty("--primary-hover", color);
    return () => {
      root.removeProperty("--primary");
      root.removeProperty("--primary-hover");
    };
  }, [color]);
  const name = b.data?.productName || "NextGen ERP";
  return (
    <Link href="/dashboard" className={cn("flex min-w-0 flex-1 items-center gap-2.5 font-semibold text-white", collapsed ? "justify-center" : "px-4")} title={name}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        {b.data?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a small data: URL logo, nothing to optimise
          <img src={b.data.logo} alt="" className="size-6 rounded-sm bg-white object-contain p-0.5" />
        ) : (
          <Factory className="size-[18px]" aria-hidden />
        )}
      </span>
      {!collapsed && <span className="truncate">{name}</span>}
    </Link>
  );
}
