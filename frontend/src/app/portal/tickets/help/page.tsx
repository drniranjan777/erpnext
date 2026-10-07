"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { portalApi } from "@/lib/portal";

interface Row { id: string; title: string; excerpt: string }
interface Article { id: string; title: string; body: string; category: string | null }

export default function PortalHelpPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Help />
    </Suspense>
  );
}

function Help() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(useSearchParams().get("article"));
  const list = useQuery({ queryKey: ["portal", "articles", q], queryFn: () => portalApi<Row[]>("/portal/articles", { query: { q } }) });
  const art = useQuery({ queryKey: ["portal", "article", open], queryFn: () => portalApi<Article>(`/portal/articles/${open}`), enabled: !!open });
  return (
    <div className="space-y-6">
      <Link href="/portal/tickets" className="text-sm text-primary hover:underline">← Service requests</Link>
      <PageHeader title="Help articles" description="Answers to common questions and quick fixes you can try." />
      <Input className="h-10 w-80" placeholder="Search" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <Card>
          <ul className="divide-y divide-border text-sm">
            {list.data?.map((a) => (
              <li key={a.id}>
                <button type="button" className={`w-full px-4 py-2 text-left hover:bg-surface-muted ${open === a.id ? "bg-surface-muted" : ""}`} onClick={() => setOpen(a.id)}>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted">{a.excerpt}</p>
                </button>
              </li>
            ))}
            {list.data && !list.data.length && <li className="px-4 py-6 text-center text-muted">Nothing found.</li>}
          </ul>
        </Card>
        {art.data && (
          <Card>
            <CardHeader title={art.data.title} description={art.data.category ?? undefined} />
            <p className="whitespace-pre-wrap border-t border-border px-5 py-4 text-sm">{art.data.body}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
