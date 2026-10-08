"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Row { id: string; styleNo: string; description: string; season: string | null; version: number; status: string; buyer: string | null; updatedAt: string; pendingSamples: number; openOrders: number }

/** Tech packs by style. */
export default function TechPacksPage() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["/textile/tech-packs"], queryFn: () => api<Row[]>("/textile/tech-packs") });
  const [creating, setCreating] = useState(false);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Tech packs" description="The buyer's specification of each style: materials, the measurement chart with tolerances, construction and the certificates required; samples go through approval rounds against it." actions={can("textile.orders.manage") && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New style</Button>} />
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((r) => (
            <li key={r.id}>
              <Link href={`/textile/tech-packs/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-surface-muted">
                <Badge tone={r.status === "approved" ? "success" : "warning"}>v{r.version} {r.status}</Badge>
                <span className="font-medium">{r.styleNo}</span>
                <span>{r.description}</span>
                <span className="text-xs text-muted">{r.buyer ?? ""}{r.season ? ` · ${r.season}` : ""} · {r.openOrders} open order(s) · {timeAgo(r.updatedAt)}</span>
                {r.pendingSamples > 0 && <Badge tone="primary" className="ml-auto">{r.pendingSamples} sample(s) with the buyer</Badge>}
              </Link>
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-4 py-8 text-center text-muted">No tech packs.</li>}
        </ul>
      </Card>
      {creating && <NewStyle onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewStyle({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [buyer, setBuyer] = useState<PickedParty | null>(null);
  const [f, setF] = useState({ styleNo: "", description: "", season: "", sizes: "S, M, L, XL", colours: "" });
  const [error, setError] = useState<string | null>(null);
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  async function save() {
    setError(null);
    try {
      const r = await api<{ id: string }>("/textile/tech-packs", { body: { styleNo: f.styleNo, description: f.description, season: f.season || null, buyerId: buyer?.id ?? null, sizes: list(f.sizes), colours: list(f.colours) } });
      router.push(`/textile/tech-packs/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New style" footer={<Button disabled={!f.styleNo || f.description.length < 2} onClick={save}>Create</Button>}>
      <div className="space-y-2 text-sm">
        {error && <Alert>{error}</Alert>}
        <PartyPicker role="customer" value={buyer} onChange={setBuyer} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Style" placeholder="Style number" value={f.styleNo} onChange={(e) => setF({ ...f, styleNo: e.target.value })} />
          <Input aria-label="Season" placeholder="Season (SS27)" value={f.season} onChange={(e) => setF({ ...f, season: e.target.value })} />
        </div>
        <Input aria-label="Description" placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Input aria-label="Sizes" placeholder="Sizes, comma separated" value={f.sizes} onChange={(e) => setF({ ...f, sizes: e.target.value })} />
        <Input aria-label="Colours" placeholder="Colours, comma separated" value={f.colours} onChange={(e) => setF({ ...f, colours: e.target.value })} />
      </div>
    </Dialog>
  );
}
