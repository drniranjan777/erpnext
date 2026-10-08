"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import type { Asset } from "@/lib/assets";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";

interface Register { items: Asset[]; totals: { cost: string; accumulated: string; netBookValue: string } }
interface ItSchedule { fy: string; blocks: { ratePct: string; assets: number; year: { opening: string; additionsFull: string; additionsHalf: string; deletions: string; depreciation: string; closing: string } | null }[] }

const fyNow = () => {
  const [y, m] = todayIST().split("-").map(Number);
  return m >= 4 ? y : y - 1;
};

export default function AssetsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("active");
  const [to, setTo] = useState(todayIST());
  const [fy, setFy] = useState(fyNow());
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: React.ReactNode } | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["assets", status], queryFn: () => api<Register>("/assets", { query: { status } }) });
  const it = useQuery({ queryKey: ["assets", "it", fy], queryFn: () => api<ItSchedule>("/assets/it-schedule", { query: { fy } }) });
  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ journalId: string | null; number: string | null; assets: number; amount: string }>("/assets/depreciation", { body: { to } });
      setMsg({ tone: "success", text: r.journalId ? <>Depreciation of {formatMoney(r.amount)} on {r.assets} asset(s) posted in <Link href={`/accounting/journals/${r.journalId}`} className="underline">{r.number}</Link>.</> : "Nothing to charge: depreciation is up to date." });
      qc.invalidateQueries({ queryKey: ["assets"] });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Fixed assets"
        description="Asset register with Companies Act depreciation (posted to the ledger) and the Income-tax block schedule."
        actions={can("assets.register.manage") ? <Link href="/assets/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="size-4" aria-hidden /> Add asset</Link> : undefined}
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <div className="flex flex-wrap items-end gap-4 px-5 py-4">
          <Field label="Show">{(f) => <Select {...f} value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">In use</option><option value="disposed">Disposed</option></Select>}</Field>
          {can("assets.register.manage") && (
            <>
              <Field label="Depreciate up to">{(f) => <Input {...f} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
              <Button variant="secondary" loading={busy} onClick={run}>Run depreciation</Button>
            </>
          )}
        </div>
        {q.isLoading && <LoadingBlock />}
        {q.error && <div className="p-5"><ErrorBlock error={q.error} /></div>}
        {q.data && !q.data.items.length && <EmptyState title="No assets" description="Add machines, vehicles, computers… to start depreciating them." />}
        {!!q.data?.items.length && (
          <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Asset</th><th className="px-4 py-2 font-medium">Category</th><th className="px-4 py-2 font-medium">In use from</th><th className="px-4 py-2 text-right font-medium">Cost</th><th className="px-4 py-2 text-right font-medium">Depreciation</th><th className="px-4 py-2 text-right font-medium">Book value</th><th className="px-4 py-2 font-medium">Up to</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2"><Link href={`/assets/${a.id}`} className="font-medium hover:underline">{a.name}</Link><span className="block font-mono text-xs text-muted">{a.code}{a.location && ` · ${a.location}`}</span></td>
                  <td className="px-4 py-2">{typeof a.category === "string" ? a.category : a.category.name}<span className="block text-xs text-muted">{a.method.toUpperCase()} · {Number(a.usefulLifeYears)} yrs</span></td>
                  <td className="px-4 py-2">{formatDate(a.capitalisedOn)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(a.cost)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(a.accumulatedDepreciation)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(a.netBookValue)}</td>
                  <td className="px-4 py-2">{a.status === "disposed" ? <Badge>Disposed {formatDate(a.disposedOn)}</Badge> : formatDate(a.depreciatedUntil)}</td>
                </tr>
              ))}
            </tbody>
            {status === "active" && (
              <tfoot className="border-t-2 border-border font-semibold"><tr><td className="px-4 py-2" colSpan={3}>Total</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(q.data.totals.cost)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(q.data.totals.accumulated)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(q.data.totals.netBookValue)}</td><td /></tr></tfoot>
            )}
          </table></div>
        )}
      </Card>
      <Card>
        <CardHeader title="Income-tax depreciation (s.32)" description="Block-wise WDV; half rate on additions used under 180 days in the year. For the tax computation only; not posted." action={<Select className="h-9 w-32" aria-label="Financial year" value={fy} onChange={(e) => setFy(Number(e.target.value))}>{[0, 1, 2].map((i) => <option key={i} value={fyNow() - i}>{fyNow() - i}-{String((fyNow() - i + 1) % 100).padStart(2, "0")}</option>)}</Select>} />
        {!!it.data?.blocks.length && (
          <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Block</th><th className="px-4 py-2 text-right font-medium">Opening WDV</th><th className="px-4 py-2 text-right font-medium">Additions (≥180 days)</th><th className="px-4 py-2 text-right font-medium">Additions (&lt;180 days)</th><th className="px-4 py-2 text-right font-medium">Sales</th><th className="px-4 py-2 text-right font-medium">Depreciation</th><th className="px-4 py-2 text-right font-medium">Closing WDV</th></tr></thead>
            <tbody className="divide-y divide-border">
              {it.data.blocks.map((b) => (
                <tr key={b.ratePct}>
                  <td className="px-4 py-2">{Number(b.ratePct)}% block <span className="text-xs text-muted">({b.assets} assets)</span></td>
                  {b.year ? (["opening", "additionsFull", "additionsHalf", "deletions", "depreciation", "closing"] as const).map((k) => <td key={k} className="px-4 py-2 text-right tabular-nums">{formatMoney(b.year![k])}</td>) : <td colSpan={6} className="px-4 py-2 text-muted">No assets yet in this year</td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {it.data && !it.data.blocks.length && <p className="px-5 pb-4 text-sm text-muted">No assets.</p>}
      </Card>
    </div>
  );
}
