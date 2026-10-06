"use client";

import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, FileText, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/documents/document-parts";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { DocumentStatus } from "@/lib/documents";
import { NAVIGATION } from "@/lib/navigation";

interface DocHit {
  id: string;
  docTypeLabel: string;
  number: string | null;
  title: string | null;
  status: DocumentStatus;
  path: string | null;
}

interface Item {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: React.ReactNode;
  status?: DocumentStatus;
}

/** Ctrl/Cmd+K: jump to any page, create things, or find documents by number or title. Mount only while open. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { can, me } = useAuth();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const docs = useQuery({
    queryKey: ["palette", debounced],
    queryFn: () => api<DocHit[]>("/documents", { query: { q: debounced, limit: 8 } }),
    enabled: debounced.length >= 2,
  });

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const pages: Item[] = NAVIGATION.flatMap((s) => s.items)
      .filter((i) => !i.comingInPhase && (!i.permissions || i.permissions.some(can)))
      .map((i) => {
        const Icon = i.icon;
        return { id: `nav:${i.href}`, label: i.label, hint: "Go to", href: i.href, icon: <Icon className="size-4" /> };
      });
    pages.push({ id: "nav:/account", label: "My account", hint: "Go to", href: "/account", icon: <Search className="size-4" /> });
    if (me?.isPlatformAdmin) pages.push({ id: "nav:/admin", label: "Platform admin", hint: "Go to", href: "/admin", icon: <Search className="size-4" /> });
    const actions: Item[] = can("purchase.requisitions.manage")
      ? [{ id: "new:pr", label: "New purchase requisition", hint: "Create", href: "/purchase/requisitions/new", icon: <Plus className="size-4" /> }]
      : [];
    const matches = [...actions, ...pages].filter((i) => !term || i.label.toLowerCase().includes(term));
    const hits: Item[] = (docs.data ?? [])
      .filter((d) => d.path)
      .map((d) => ({
        id: `doc:${d.id}`,
        label: `${d.number ?? "Draft"} · ${d.title ?? ""}`,
        hint: d.docTypeLabel,
        href: d.path!,
        icon: <FileText className="size-4" />,
        status: d.status,
      }));
    return [...hits, ...matches].slice(0, 14);
  }, [q, docs.data, can, me?.isPlatformAdmin]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div role="dialog" aria-label="Command palette" className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 text-muted" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") go(items[active]);
            }}
            placeholder="Search pages, actions, or documents (e.g. PR/HO/26-27/0001)…"
            aria-label="Search"
            className="h-12 w-full bg-transparent text-sm focus:outline-none"
          />
          <kbd className="rounded border border-border px-1.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <ul role="listbox" className="max-h-[50vh] overflow-y-auto py-2">
          {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">{docs.isFetching ? "Searching…" : "No results"}</li>}
          {items.map((item, i) => (
            <li key={item.id} role="option" aria-selected={i === active}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item)}
                className={cn("flex w-full items-center gap-3 px-4 py-2 text-left text-sm", i === active && "bg-primary-soft text-primary")}
              >
                <span className="text-muted">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.status && <StatusBadge status={item.status} />}
                <span className="text-xs text-muted">{item.hint}</span>
                {i === active && <CornerDownLeft className="size-3.5" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
