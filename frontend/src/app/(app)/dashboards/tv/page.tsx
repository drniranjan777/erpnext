"use client";

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { WidgetGrid, type DashboardView } from "@/components/dashboard/widgets";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function TvPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Tv />
    </Suspense>
  );
}

/** Full-screen dashboard for a shop-floor TV: large type, its own refresh, a clock. */
function Tv() {
  const search = useSearchParams();
  const { me } = useAuth();
  const id = search.get("id");
  const preset = search.get("preset") ?? (id ? null : "tv");
  const [refresh, setRefresh] = useState(60);
  const q = useQuery({
    queryKey: ["dashboards", "tv", id, preset],
    queryFn: async () => {
      const d = await api<DashboardView>("/dashboards/view", { query: id ? { id } : { preset: preset ?? "tv" } });
      setRefresh(Math.max(15, d.refreshSeconds));
      return d;
    },
    refetchInterval: refresh * 1000,
    refetchIntervalInBackground: true,
  });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-background p-6 text-foreground">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold">{q.data?.name ?? "Dashboard"}</h1>
          <p className="text-xl text-muted">{me?.tenant.name}</p>
        </div>
        <div className="flex items-center gap-6">
          <p className="text-5xl font-semibold tabular-nums">{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
          <Link href="/dashboard" aria-label="Leave TV mode" className="rounded-full p-3 text-muted hover:bg-surface-muted"><X className="size-8" aria-hidden /></Link>
        </div>
      </header>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && <WidgetGrid widgets={q.data.widgets} big />}
      {q.data && <p className="mt-6 text-right text-base text-muted">Updated {new Date(q.data.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · every {refresh} s</p>}
    </div>
  );
}
