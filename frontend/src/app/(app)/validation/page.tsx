"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";

interface Row { id: string; name: string; systemVersion: string; modules: string[]; status: string; createdAt: string; tests: number; passed: number; failed: number }

const TONE: Record<string, "warning" | "success" | "neutral"> = { draft: "neutral", executing: "warning", approved: "success" };

/** Computer system validation projects. */
export default function ValidationPage() {
  const list = useQuery({ queryKey: ["/validation/projects"], queryFn: () => api<Row[]>("/validation/projects") });
  const [creating, setCreating] = useState(false);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Computer system validation" description="The validation package for this system (GAMP 5): user requirements and how the system meets them, risk assessment, IQ / OQ / PQ protocols with their execution and evidence, the traceability matrix and the summary report, each signed." actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New validation</Button>} />
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((p) => (
            <li key={p.id}>
              <Link href={`/validation/${p.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                <Badge tone={TONE[p.status]}>{p.status}</Badge>
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted">release {p.systemVersion} · {p.modules.length} module(s) · {formatDateTime(p.createdAt)}</span>
                <span className="ml-auto text-xs">{p.passed} of {p.tests} passed{p.failed ? <span className="text-danger"> · {p.failed} failed</span> : null}</span>
              </Link>
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-4 py-8 text-center text-muted">No validation yet.</li>}
        </ul>
      </Card>
      {creating && <NewProject onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProject({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const cat = useQuery({ queryKey: ["/validation/catalogue"], queryFn: () => api<{ modules: Record<string, string> }>("/validation/catalogue") });
  const [f, setF] = useState({ name: "", intendedUse: "", gampCategory: "4", modules: ["platform"] as string[] });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api("/validation/projects", { body: { name: f.name, intendedUse: f.intendedUse || null, gampCategory: Number(f.gampCategory), modules: f.modules } });
      qc.invalidateQueries({ queryKey: ["/validation/projects"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New validation" description="Choose the modules your site uses; their requirements and tests are taken from the catalogue." footer={<Button disabled={f.name.length < 3 || !f.modules.length} onClick={save}>Create</Button>}>
      <div className="space-y-3 text-sm">
        {error && <Alert>{error}</Alert>}
        <Input aria-label="Name" placeholder="e.g. NextGen ERP for the tablets plant" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <textarea aria-label="Intended use" rows={2} className="w-full rounded-lg border border-border bg-surface px-3 py-2" placeholder="Intended use" value={f.intendedUse} onChange={(e) => setF({ ...f, intendedUse: e.target.value })} />
        <label className="flex items-center gap-2">GAMP category <select className="rounded border border-border bg-surface px-2 py-1" value={f.gampCategory} onChange={(e) => setF({ ...f, gampCategory: e.target.value })}><option value="4">4 — configured product</option><option value="5">5 — custom</option></select></label>
        <fieldset className="space-y-1">{Object.entries(cat.data?.modules ?? {}).map(([k, v]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={f.modules.includes(k)} onChange={(e) => setF({ ...f, modules: e.target.checked ? [...f.modules, k] : f.modules.filter((x) => x !== k) })} /> {v}</label>)}</fieldset>
      </div>
    </Dialog>
  );
}
