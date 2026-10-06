"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { timeAgo } from "@/components/ui/page";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

interface Notification {
  id: string;
  event: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationKeys = {
  count: ["notifications", "count"] as const,
  list: ["notifications", "list"] as const,
};

export function NotificationsBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const count = useQuery({
    queryKey: notificationKeys.count,
    queryFn: () => api<{ unread: number }>("/notifications/unread-count"),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const list = useQuery({
    queryKey: notificationKeys.list,
    queryFn: () => api<{ items: Notification[] }>("/notifications", { query: { limit: 15 } }),
    enabled: open,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: notificationKeys.count });
    qc.invalidateQueries({ queryKey: notificationKeys.list });
  };
  const markOne = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: "POST" }), onSuccess: refresh });
  const markAll = useMutation({ mutationFn: () => api("/notifications/read-all", { method: "POST" }), onSuccess: refresh });

  // New notifications usually mean the approvals inbox changed too.
  const unread = count.data?.unread ?? 0;
  const last = useRef(unread);
  useEffect(() => {
    if (unread > last.current) qc.invalidateQueries({ queryKey: ["documents", "inbox"] });
    last.current = unread;
  }, [unread, qc]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={panel}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
        aria-label={unread ? `Notifications (${unread} unread)` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-2 top-14 z-50 max-h-[70vh] overflow-hidden rounded-xl border border-border bg-surface shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-96">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="font-semibold">Notifications</p>
            {unread > 0 && (
              <button onClick={() => markAll.mutate()} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <CheckCheck className="size-3.5" aria-hidden /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[calc(70vh-3rem)] divide-y divide-border overflow-y-auto">
            {list.isLoading && <li className="px-4 py-6 text-center text-sm text-muted">Loading…</li>}
            {list.data?.items.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">You&apos;re all caught up.</li>}
            {list.data?.items.map((n) => {
              const content = (
                <>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", !n.readAt && "font-medium")}>{n.title}</span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-muted">{timeAgo(n.createdAt)}</span>
                  </span>
                </>
              );
              const onClick = () => {
                if (!n.readAt) markOne.mutate(n.id);
                setOpen(false);
              };
              return (
                <li key={n.id}>
                  {n.link ? (
                    <Link href={n.link} onClick={onClick} className="flex gap-3 px-4 py-3 hover:bg-surface-muted/60">
                      {content}
                    </Link>
                  ) : (
                    <button onClick={onClick} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-muted/60">
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
