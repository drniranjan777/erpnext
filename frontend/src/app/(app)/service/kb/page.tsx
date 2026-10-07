"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Row { id: string; title: string; category: string | null; tags: string[]; isPublic: boolean; views: number; excerpt: string }
interface Article { id: string; title: string; body: string; category: string | null; tags: string[]; isPublic: boolean }

export default function KbPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Kb />
    </Suspense>
  );
}

function Kb() {
  const { can } = useAuth();
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(sp.get("article"));
  const [editing, setEditing] = useState<Article | "new" | null>(null);
  const list = useQuery({ queryKey: ["/service", "articles", q], queryFn: () => api<Row[]>("/service/articles", { query: { q: q || undefined } }) });
  const art = useQuery({ queryKey: ["/service", "article", open], queryFn: () => api<Article>(`/service/articles/${open}`), enabled: !!open });
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Knowledge base" description="Fixes and answers; matching articles are suggested on each ticket, and public ones show on the customer portal." actions={can("service.tickets.manage") && <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Article</Button>} />
      <Input className="h-10 w-80" placeholder="Search problems, parts, models" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <Card>
          <ul className="divide-y divide-border text-sm">
            {list.data?.map((a) => (
              <li key={a.id} className={`cursor-pointer px-4 py-2 hover:bg-surface-muted ${open === a.id ? "bg-surface-muted" : ""}`} onClick={() => setOpen(a.id)}>
                <p className="font-medium">{a.title}</p>
                <p className="text-xs text-muted">{a.excerpt}</p>
                <p className="mt-1 flex flex-wrap gap-1">{a.isPublic && <Badge tone="primary">public</Badge>}{a.tags.map((t) => <Badge key={t}>{t}</Badge>)}<span className="text-xs text-muted">{a.views} views</span></p>
              </li>
            ))}
            {list.data && !list.data.length && <li className="px-4 py-6 text-center text-muted">Nothing found.</li>}
          </ul>
        </Card>
        {art.data && (
          <Card>
            <CardHeader title={art.data.title} description={art.data.category ?? undefined} action={can("service.tickets.manage") && <Button size="sm" variant="ghost" onClick={() => setEditing(art.data!)}>Edit</Button>} />
            <p className="whitespace-pre-wrap border-t border-border px-5 py-4 text-sm">{art.data.body}</p>
          </Card>
        )}
      </div>
      {editing && <ArticleDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ArticleDialog({ row, onClose }: { row: Article | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: row?.title ?? "", body: row?.body ?? "", category: row?.category ?? "", tags: row?.tags.join(", ") ?? "", isPublic: row?.isPublic ?? false });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(row ? `/service/articles/${row.id}` : "/service/articles", { method: row ? "PUT" : "POST", body: { ...f, category: f.category || null, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean) } });
      await qc.invalidateQueries({ queryKey: ["/service"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={row ? "Edit article" : "New article"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        <Field label="Title">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Answer">{(p) => <textarea {...p} rows={8} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <Field label="Category">{(p) => <Input {...p} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />}</Field>
        <Field label="Tags" hint="Comma separated: model, part, symptom">{(p) => <Input {...p} value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} /> Show to customers on the portal</label>
      </div>
    </Dialog>
  );
}
