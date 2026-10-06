"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import type { Catalogue } from "@/lib/reports";

export default function ReportsPage() {
  const q = useQuery({ queryKey: ["reports", "catalogue"], queryFn: () => api<Catalogue>("/reports") });
  const [term, setTerm] = useState("");
  const t = term.trim().toLowerCase();
  const list = q.data?.reports.filter((r) => !t || r.title.toLowerCase().includes(t) || r.description.toLowerCase().includes(t)) ?? [];
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Reports"
        description="Standard reports across sales, purchase, stock, production, quality, finance and GST. Every report exports to Excel."
        actions={
          <div className="relative w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9" placeholder="Find a report" aria-label="Find a report" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
        }
      />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data &&
        Object.entries(q.data.categories).map(([cat, label]) => {
          const rs = list.filter((r) => r.category === cat);
          if (!rs.length) return null;
          return (
            <section key={cat} className="space-y-3">
              <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{label}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rs.map((r) => (
                  <Link key={r.key} href={r.kind === "link" ? r.href : `/reports/${r.key}`} className="group">
                    <Card className="h-full p-4 transition group-hover:border-primary">
                      <p className="flex items-center justify-between gap-2 font-medium">
                        {r.title}
                        {r.kind === "link" && <ArrowUpRight className="size-4 text-muted" aria-label="Opens its own screen" />}
                      </p>
                      <p className="mt-1 text-sm text-muted">{r.description}</p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      {q.data && !list.length && <p className="text-sm text-muted">No report matches “{term}”.</p>}
    </div>
  );
}
