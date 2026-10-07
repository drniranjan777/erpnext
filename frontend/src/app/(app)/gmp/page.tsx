"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Settings { requireLineClearance: boolean; lineClearanceHours: number; lineClearanceChecklist: string[] }
interface Verify { total: number; checked: number; broken: { id: string; problem: string }[]; intact: boolean }

/** GMP controls: line clearance rule and checklist, and a check of the electronic signature chain. */
export default function GmpPage() {
  const { can } = useAuth();
  const s = useQuery({ queryKey: ["/gmp/settings"], queryFn: () => api<Settings>("/gmp/settings") });
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="GMP controls" description="21 CFR Part 11 / EU GMP Annex 11 controls of the system, and the GMP rules applied on the shop floor." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/gmp/line-clearance" className="rounded-xl border border-border p-4 hover:bg-surface-muted"><p className="font-medium">Line clearance</p><p className="text-xs text-muted">Production clears, QA verifies; both sign.</p></Link>
        <Link href="/gmp/batch-reviews" className="rounded-xl border border-border p-4 hover:bg-surface-muted"><p className="font-medium">Batch record review</p><p className="text-xs text-muted">Review by exception, signed decision.</p></Link>
        <Link href="/gmp/environment" className="rounded-xl border border-border p-4 hover:bg-surface-muted"><p className="font-medium">Environmental monitoring</p><p className="text-xs text-muted">Clean rooms against Annex 1 limits.</p></Link>
      </div>
      {s.data && <SettingsCard key={JSON.stringify(s.data)} settings={s.data} manage={can("gmp.settings.manage")} />}
      {can("gmp.settings.manage") && <ChainCard />}
      <Card>
        <CardHeader title="How the system meets Part 11 / Annex 11" />
        <ul className="list-disc space-y-1 border-t border-border p-4 pl-8 text-sm">
          <li>Every person has their own account; access is by role and permission; sessions end on sign-out or expiry.</li>
          <li>The audit trail records who changed what and when (old and new values); it cannot be edited or deleted by anyone using the application.</li>
          <li>Electronic signatures need the signer’s password every time, record the meaning, reason, date and time and the signer’s name, and are shown on the record and its printouts.</li>
          <li>Each signature is linked to the exact content signed (a hash) and chained to the signature before it; signatures cannot be edited or deleted, and the check below shows any change made outside the application.</li>
          <li>Records are kept in the database with daily backups; reports and printouts give accurate copies.</li>
        </ul>
      </Card>
    </div>
  );
}

function SettingsCard({ settings, manage }: { settings: Settings; manage: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ ...settings, checklist: settings.lineClearanceChecklist.join("\n") });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function save() {
    setMsg(null);
    try {
      await api("/gmp/settings", { method: "PUT", body: { requireLineClearance: f.requireLineClearance, lineClearanceHours: Number(f.lineClearanceHours), lineClearanceChecklist: f.checklist.split("\n").map((x) => x.trim()).filter(Boolean) } });
      qc.invalidateQueries({ queryKey: ["/gmp/settings"] });
      setMsg({ tone: "success", text: "Saved." });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <Card>
      <CardHeader title="Line clearance rule" description="When required, a job cannot be started at the machine terminal without a line clearance for the work order verified by QA within the set hours." />
      <div className="space-y-3 border-t border-border p-4 text-sm">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <label className="flex items-center gap-2"><input type="checkbox" disabled={!manage} checked={f.requireLineClearance} onChange={(e) => setF({ ...f, requireLineClearance: e.target.checked })} /> Require line clearance before a batch starts</label>
        <label className="flex items-center gap-2">Valid for <Input className="h-8 w-20" type="number" min={1} disabled={!manage} value={f.lineClearanceHours} onChange={(e) => setF({ ...f, lineClearanceHours: Number(e.target.value) })} /> hours</label>
        <label className="block">Checklist (one item per line)<textarea rows={6} disabled={!manage} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2" value={f.checklist} onChange={(e) => setF({ ...f, checklist: e.target.value })} /></label>
        {manage && <Button onClick={save}>Save</Button>}
      </div>
    </Card>
  );
}

function ChainCard() {
  const [r, setR] = useState<Verify | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Signature chain" description="Recomputes every signature's content hash and chain. A break means a signature was changed or removed outside the application." action={<Button size="sm" variant="secondary" loading={busy} onClick={async () => { setBusy(true); try { setR(await api<Verify>("/gmp/signatures/verify")); } finally { setBusy(false); } }}><ShieldCheck className="size-4" aria-hidden /> Check now</Button>} />
      {r && (
        <div className="border-t border-border p-4 text-sm">
          {r.intact ? <Badge tone="success">Intact</Badge> : <Badge tone="danger">Broken</Badge>} <span className="ml-2">{r.checked} of {r.total} signatures checked{r.total > r.checked ? " (older ones were signed before the chain)" : ""}.</span>
          {r.broken.length > 0 && <ul className="mt-2 list-disc pl-6 text-danger">{r.broken.map((b) => <li key={b.id}><code className="text-xs">{b.id}</code>: {b.problem}</li>)}</ul>}
        </div>
      )}
    </Card>
  );
}
