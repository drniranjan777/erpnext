"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Row { id: string; number: string; type: string; location: string; description: string; status: string; validFrom: string; validTo: string; workers: number; contractor: string | null; requestedBy: string | null }

const PERMIT_LABELS: Record<string, string> = { hot_work: "Hot work", cold_work: "Cold work", confined_space: "Confined space", height: "Work at height", electrical: "Electrical", excavation: "Excavation", line_break: "Line break" };
const TONE: Record<string, "neutral" | "warning" | "success" | "danger" | "primary"> = { requested: "warning", approved: "primary", active: "danger", closed: "success", cancelled: "neutral" };

/** Permits to work. */
export default function PermitsPage() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["/hse/permits"], queryFn: () => api<Row[]>("/hse/permits"), refetchInterval: 60_000 });
  const [creating, setCreating] = useState(false);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Permits to work" description="Hot work, confined space, height, electrical, excavation and line-break permits: checklist, isolations, gas tests, signed approval, and work that must not run at the same place and time." actions={can("hse.permits.request") && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> Request</Button>} />
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((r) => (
            <li key={r.id}>
              <Link href={`/hse/permits/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-surface-muted">
                <Badge tone={TONE[r.status]}>{r.status}</Badge>
                <span className="font-medium">{r.number}</span>
                <span>{PERMIT_LABELS[r.type]} · {r.location}</span>
                <span className="text-xs text-muted">{formatDateTime(r.validFrom)} → {formatDateTime(r.validTo)} · {r.workers} worker(s){r.contractor ? ` · ${r.contractor}` : ""}</span>
              </Link>
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-4 py-8 text-center text-muted">No permits.</li>}
        </ul>
      </Card>
      {creating && <RequestPermit onClose={() => setCreating(false)} />}
    </div>
  );
}

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function RequestPermit({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState(() => {
    const now = new Date();
    return { type: "hot_work", location: "", equipment: "", description: "", contractor: "", workers: "1", validFrom: local(now), validTo: local(new Date(now.getTime() + 8 * 3600_000)), isolations: "" };
  });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      const isolations = f.isolations.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((x) => x[0]).map(([point, lockNo]) => ({ point, lockNo: lockNo || "–" }));
      const r = await api<{ id: string }>("/hse/permits", { body: { type: f.type, location: f.location, equipment: f.equipment || null, description: f.description, contractor: f.contractor || null, workers: Number(f.workers), validFrom: new Date(f.validFrom).toISOString(), validTo: new Date(f.validTo).toISOString(), isolations } });
      router.push(`/hse/permits/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Request a permit to work" footer={<Button disabled={f.location.length < 2 || f.description.length < 3} onClick={save}>Request</Button>}>
      <div className="space-y-2 text-sm">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-2 sm:grid-cols-2">
          <Select aria-label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(PERMIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Input aria-label="Location" placeholder="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
          <Input aria-label="Equipment" placeholder="Equipment" value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })} />
          <Input aria-label="Contractor" placeholder="Contractor (if any)" value={f.contractor} onChange={(e) => setF({ ...f, contractor: e.target.value })} />
          <Input aria-label="From" type="datetime-local" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
          <Input aria-label="To" type="datetime-local" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />
          <Input aria-label="Workers" type="number" min={1} value={f.workers} onChange={(e) => setF({ ...f, workers: e.target.value })} />
        </div>
        <textarea aria-label="Work" rows={2} className="w-full rounded-lg border border-border bg-surface px-3 py-2" placeholder="Work to be done" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <textarea aria-label="Isolations" rows={2} className="w-full rounded-lg border border-border bg-surface px-3 py-2" placeholder="Isolations, one per line: point | lock number" value={f.isolations} onChange={(e) => setF({ ...f, isolations: e.target.value })} />
      </div>
    </Dialog>
  );
}
