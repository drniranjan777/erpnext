"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, PageHeader } from "@/components/ui/page";
import { ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty, todayIST } from "@/lib/documents";
import { portalApi } from "@/lib/portal";
import { DataTable } from "@/components/ui/data-table";

interface Scheme { id: string; code: string; name: string; kind: string; level: string; slabs: { min: number; discountPct?: number; perUnit?: number; freeQty?: number }[]; fromDate: string; toDate: string; items: string[] }
interface Claim { id: string; number: string; kind: string; fromDate: string; toDate: string; claimedAmount: string; computedAmount: string | null; approvedAmount: string | null; status: string; decisionNote: string | null; schemeCode: string | null }
interface Stock { itemId: string; code: string; name: string; onHand: number; sold30: number; daysCover: number | null }
const CLAIM_TONE = { submitted: "primary", approved: "warning", settled: "success", rejected: "danger" } as const;

function slabText(s: Scheme) {
  return s.slabs
    .map((x) => (s.kind === "free_goods" ? `buy ${x.min} get ${x.freeQty} free` : s.kind === "value_slab" ? `${x.discountPct} % off above ${formatMoney(x.min)}` : `${x.discountPct ? `${x.discountPct} %` : formatMoney(x.perUnit ?? 0)} off from ${x.min} units`))
    .join("; ");
}

export default function DealerPage() {
  const [raising, setRaising] = useState(false);
  const schemes = useQuery({ queryKey: ["portal", "schemes"], queryFn: () => portalApi<Scheme[]>("/portal/schemes") });
  const claims = useQuery({ queryKey: ["portal", "claims"], queryFn: () => portalApi<Claim[]>("/portal/claims") });
  const stock = useQuery({ queryKey: ["portal", "stock"], queryFn: () => portalApi<Stock[]>("/portal/stock") });
  if (schemes.error) return <ErrorBlock error={schemes.error} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Schemes & claims" description="Running schemes, your claims and the stock we show at your end." actions={<Button onClick={() => setRaising(true)}><Plus className="size-4" aria-hidden /> Raise a claim</Button>} />
      <Card>
        <CardHeader title="Schemes" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {schemes.data?.map((s) => (
            <li key={s.id} className="px-5 py-3">
              <p><span className="font-mono text-xs text-muted">{s.code}</span> <span className="font-medium">{s.name}</span> <Badge>{s.level === "primary" ? "on our invoices" : "on your sales"}</Badge></p>
              <p className="text-xs text-muted">{slabText(s)} · {formatDate(s.fromDate)} to {formatDate(s.toDate)}{s.items.length ? ` · ${s.items.join(", ")}` : " · all items"}</p>
            </li>
          ))}
          {schemes.data && !schemes.data.length && <li className="px-5 py-6 text-center text-muted">No schemes running.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Claims" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {claims.data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <span className="font-mono text-xs">{c.number}</span>
              <span className="capitalize">{c.kind.replace("_", " ")}{c.schemeCode && ` · ${c.schemeCode}`}</span>
              <span className="text-xs text-muted">{formatDate(c.fromDate)} to {formatDate(c.toDate)}</span>
              <span className="tabular-nums">{formatMoney(c.claimedAmount)}</span>
              {c.approvedAmount && <span className="text-xs text-muted">approved {formatMoney(c.approvedAmount)}</span>}
              {c.decisionNote && <span className="text-xs text-muted">{c.decisionNote}</span>}
              <Badge tone={CLAIM_TONE[c.status as keyof typeof CLAIM_TONE]} className="ml-auto">{c.status}</Badge>
            </li>
          ))}
          {claims.data && !claims.data.length && <li className="px-5 py-6 text-center text-muted">No claims yet.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Your stock" description="Our invoices to you, less the secondary sales reported, plus any stock counts." />
        <DataTable
          rows={stock.data ?? []}
          rowKey={(s) => String(s.itemId)}
          exportName="app-portal-dealer"
          storageKey="app-portal-dealer-0"
          empty={<p className="px-4 py-6 text-center text-sm text-muted">No stock recorded.</p>}
          columns={[
            { key: "item", label: "Item", locked: true, className: "whitespace-normal", render: (s) => <>{s.code} · {s.name}</> },
            { key: "on-hand", label: "On hand", align: "right", render: (s) => <>{formatQty(s.onHand)}</> },
            { key: "sold-last-30-days", label: "Sold, last 30 days", align: "right", render: (s) => <>{formatQty(s.sold30)}</> },
            { key: "days-of-cover", label: "Days of cover", align: "right", render: (s) => <>{s.daysCover ?? "–"}</> },
          ]}
        />
      </Card>
      {raising && <ClaimDialog schemes={schemes.data ?? []} onClose={() => setRaising(false)} />}
    </div>
  );
}

function ClaimDialog({ schemes, onClose }: { schemes: Scheme[]; onClose: () => void }) {
  const qc = useQueryClient();
  const today = todayIST();
  const [f, setF] = useState({ kind: "scheme", schemeId: "", fromDate: `${today.slice(0, 8)}01`, toDate: today, claimedAmount: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ number: string; computedAmount: string | null } | null>(null);
  async function save() {
    setError(null);
    try {
      const c = await portalApi<{ number: string; computedAmount: string | null }>("/portal/claims", { body: { kind: f.kind, schemeId: f.kind === "scheme" ? f.schemeId : null, fromDate: f.fromDate, toDate: f.toDate, claimedAmount: Number(f.claimedAmount), notes: f.notes || null } });
      setDone(c);
      qc.invalidateQueries({ queryKey: ["portal"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  if (done) {
    return (
      <Dialog open onClose={onClose} title="Claim sent" footer={<Button onClick={onClose}>Done</Button>}>
        <p className="text-sm">Claim {done.number} is with our team for review.{done.computedAmount && ` By our records the scheme gives ${formatMoney(done.computedAmount)} for this period.`}</p>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title="Raise a claim" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!(Number(f.claimedAmount) > 0) || (f.kind === "scheme" && !f.schemeId)}>Send claim</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="scheme">Scheme</option><option value="damage">Damage</option><option value="price_difference">Price difference</option><option value="other">Other</option></Select>}</Field>
        {f.kind === "scheme" && <Field label="Scheme">{(p) => <Select {...p} value={f.schemeId} onChange={(e) => setF({ ...f, schemeId: e.target.value })}><option value="">Choose…</option>{schemes.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select>}</Field>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From">{(p) => <Input {...p} type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} />}</Field>
          <Field label="To">{(p) => <Input {...p} type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} />}</Field>
        </div>
        <Field label="Amount claimed (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.claimedAmount} onChange={(e) => setF({ ...f, claimedAmount: e.target.value })} />}</Field>
        <Field label="Details">{(p) => <Input {...p} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
