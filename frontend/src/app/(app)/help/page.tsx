"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { HELP_ARTICLES } from "@/lib/help";

export default function HelpPage() {
  const [q, setQ] = useState("");
  const t = q.trim().toLowerCase();
  const hits = HELP_ARTICLES.filter((a) => !t || [a.title, a.summary, ...a.sections.flatMap((s) => [s.heading ?? "", s.text ?? "", ...(s.steps ?? [])])].join(" ").toLowerCase().includes(t));
  const areas = [...new Set(HELP_ARTICLES.map((a) => a.area))];
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Help centre"
        description="How things work, step by step. You can also press Ask (Ctrl+J) and ask the copilot."
        actions={
          <div className="relative w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9" placeholder="Search help" aria-label="Search help" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      />
      {areas.map((area) => {
        const list = hits.filter((a) => a.area === area);
        if (!list.length) return null;
        return (
          <section key={area} className="space-y-3">
            <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{area}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {list.map((a) => (
                <Link key={a.slug} href={`/help/${a.slug}`} className="group">
                  <Card className="h-full p-4 transition group-hover:border-primary">
                    <p className="font-medium">{a.title}</p>
                    <p className="mt-1 text-sm text-muted">{a.summary}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
      {!hits.length && <p className="text-sm text-muted">Nothing matches “{q}”. Try the copilot: it can look into your data.</p>}
    </div>
  );
}
