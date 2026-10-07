"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
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

interface Row { id: string; code: string; title: string; version: number; status: string; updatedAt: string; item: string | null; ccps: number; hazards: number; deviations30d: number }

/** HACCP plans. */
export default function HaccpPage() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["/food/haccp"], queryFn: () => api<Row[]>("/food/haccp") });
  const [creating, setCreating] = useState(false);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="HACCP plans" description="Hazard analysis per process step, critical control points decided with the Codex decision tree, critical limits and monitoring, approved under signature. CCPs measured by a sensor raise a critical alarm when outside their limits." actions={can("food.haccp.manage") && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New plan</Button>} />
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((r) => (
            <li key={r.id}>
              <Link href={`/food/haccp/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-surface-muted">
                <Badge tone={r.status === "approved" ? "success" : "warning"}>v{r.version} {r.status}</Badge>
                <span className="font-medium">{r.code}</span>
                <span>{r.title}</span>
                <span className="text-xs text-muted">{r.item ?? ""} · {r.hazards} hazards · {r.ccps} CCPs · {timeAgo(r.updatedAt)}</span>
                {r.deviations30d > 0 && <Badge tone="danger" className="ml-auto">{r.deviations30d} CCP deviation(s) in 30 days</Badge>}
              </Link>
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-4 py-8 text-center text-muted">No HACCP plans.</li>}
        </ul>
      </Card>
      {creating && <NewPlan onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewPlan({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [f, setF] = useState({ code: "", title: "", itemId: "", itemLabel: "", team: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      const r = await api<{ id: string }>("/food/haccp", { body: { code: f.code, title: f.title, itemId: f.itemId || null, team: f.team || null } });
      qc.invalidateQueries({ queryKey: ["/food/haccp"] });
      router.push(`/food/haccp/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New HACCP plan" footer={<Button disabled={!f.code || f.title.length < 2} onClick={save}>Create</Button>}>
      <div className="space-y-3 text-sm">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Code" placeholder="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <Input aria-label="Title" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        {f.itemLabel ? <p>{f.itemLabel}</p> : <ItemPicker placeholder="Product (optional)" onPick={(i) => setF({ ...f, itemId: i.id, itemLabel: `${i.code} · ${i.name}` })} />}
        <Input aria-label="Team" placeholder="HACCP team" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} />
      </div>
    </Dialog>
  );
}
