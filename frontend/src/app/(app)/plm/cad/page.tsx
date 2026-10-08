"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Row { id: string; number: string; title: string; format: string; revision: string; status: string; item: string | null; checkedOutBy: string | null; checkedOutAt: string | null; version: number | null }

/** The CAD vault. */
export default function CadVaultPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["/plm/cad", q], queryFn: () => api<Row[]>("/plm/cad", { query: q ? { q } : {} }) });
  const [creating, setCreating] = useState(false);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="CAD vault" description="SolidWorks, AutoCAD, STEP and PDF drawings with versions and metadata. Check a file out to work on it (no one else can check in meanwhile), check the new version in, and release it under signature; working on a released file starts the next revision." actions={can("plm.cad.manage") && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New file</Button>} />
      <Input aria-label="Search" placeholder="Search number, title or metadata" value={q} onChange={(e) => setQ(e.target.value)} />
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((r) => (
            <li key={r.id}>
              <Link href={`/plm/cad/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2 hover:bg-surface-muted">
                <Badge tone={r.status === "released" ? "success" : r.status === "obsolete" ? "danger" : "warning"}>rev {r.revision} {r.status.replace("_", " ")}</Badge>
                <span className="font-medium">{r.number}</span>
                <span>{r.title}</span>
                <span className="text-xs text-muted">{r.format.toUpperCase()}{r.version ? ` · v${r.version}` : " · no version yet"}{r.item ? ` · ${r.item}` : ""}</span>
                {r.checkedOutBy && <Badge tone="primary" className="ml-auto">checked out by {r.checkedOutBy} {timeAgo(r.checkedOutAt)}</Badge>}
              </Link>
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-4 py-8 text-center text-muted">The vault is empty.</li>}
        </ul>
      </Card>
      {creating && <NewCad onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewCad({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ number: "", title: "", material: "" });
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      const r = await api<{ id: string }>("/plm/cad", { body: { number: f.number, title: f.title, itemId: item?.id ?? null, metadata: f.material ? { material: f.material } : {} } });
      router.push(`/plm/cad/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New vault file" footer={<Button disabled={!f.number || f.title.length < 2} onClick={save}>Create and check out</Button>}>
      <div className="space-y-2 text-sm">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Number" placeholder="Drawing / model number" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
          <Input aria-label="Material" placeholder="Material" value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} />
        </div>
        <Input aria-label="Title" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        {item ? <p>{item.label}</p> : <ItemPicker placeholder="Item (optional)" onPick={(i) => setItem({ id: i.id, label: `${i.code} · ${i.name}` })} />}
      </div>
    </Dialog>
  );
}
