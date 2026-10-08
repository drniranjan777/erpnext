"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, CopyPlus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { BASIS_LABEL, PROC, type Formula } from "@/lib/process";

const F = `${PROC}/formulas`;
interface Cost { material: string; conversion: string; byproductCredit: string; batchCost: string; unitCost: string; missing: string[]; coproducts: { itemId: string; qty: string; share: string; unitCost: string }[] }
interface Scaled { lines: { itemId: string; kind: string; basis: string; required: string; item?: { code: string; name: string; uom: string } }[] }

export default function FormulaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const key = [F, id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Formula>(`${F}/${id}`) });
  const [qty, setQty] = useState("");
  const size = qty || q.data?.batchSize || "1";
  const scaled = useQuery({ queryKey: [F, id, "scale", size], queryFn: () => api<Scaled>(`${F}/${id}/scale`, { query: { qty: size } }), enabled: !!q.data });
  const [cost, setCost] = useState<Cost | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  async function runCost(apply: boolean) {
    setMsg(null);
    try {
      const c = await api<Cost>(`${F}/${d.id}/cost`, { body: { apply } });
      setCost(c);
      if (apply) setMsg({ tone: "success", text: `Standard cost of ${d.item.code} set to ${formatMoney(c.unitCost)} per ${d.item.uom}.` });
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }
  async function newVersion() {
    try {
      const v = await api<Formula>(`${F}/${d.id}/new-version`, { method: "POST" });
      router.push(`${F}/${v.id}/edit`);
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: F, label: "Formulas" }}
        badges={<><Badge>v{d.formulaVersion}</Badge>{d.isDefault && d.status === "approved" && <Badge tone="success">Default</Badge>}{d.kind === "packing" && <Badge>Packing</Badge>}</>}
        subtitle={`${d.item.code} ${d.item.name} · batch of ${formatQty(d.batchSize)} ${d.item.uom} · yield ${Number(d.yieldPct)}%`}
        actions={
          <>
            {d.status === "approved" && <Link href={`/manufacturing/work-orders/new?kind=batch&item=${d.item.id}`} className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Make a batch</Link>}
            {d.canNewVersion && <Button variant="secondary" onClick={newVersion}><CopyPlus className="size-4" aria-hidden /> New version</Button>}
            <DocumentActions doc={d} apiBase={F} routeBase={F} queryKey={key} />
          </>
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <DocStatusAlerts doc={d} approvedNote="Approved and frozen. Batches use the default version." />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Effective" value={d.effectiveFrom ? `${formatDate(d.effectiveFrom)}${d.effectiveTo ? ` – ${formatDate(d.effectiveTo)}` : " onwards"}` : "On approval"} />
          <Info label="Batch multiple" value={d.batchMultiple ? `${formatQty(d.batchMultiple)} ${d.item.uom}` : "Any size"} />
          <Info label="Unit cost" value={Number(d.unitCost) ? formatMoney(d.unitCost) : "—"} />
          <Info label="Versions" value={d.versions.map((v) => <Link key={v.id} href={`${F}/${v.id}`} className={`mr-2 ${v.id === d.id ? "font-semibold" : "text-primary hover:underline"}`}>v{v.version}{v.isDefault ? "*" : ""}</Link>)} />
        </dl>
        {d.declaration && <p className="border-t border-border px-5 py-3 text-sm"><span className="text-muted">Declaration: </span>{d.declaration}</p>}
      </Card>
      <Card>
        <CardHeader title="Ingredients and outputs" />
        <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 font-medium">Basis</th><th className="px-4 py-2 text-right font-medium">Per standard batch</th><th className="px-4 py-2 text-right font-medium">Tolerance</th><th className="px-4 py-2 font-medium">Stage</th></tr></thead>
          <tbody className="divide-y divide-border">
            {d.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2"><span className="font-mono text-xs text-muted">{l.code}</span> {l.name}{l.kind !== "ingredient" && <Badge className="ml-1">{l.kind === "coproduct" ? `Co-product · ${Number(l.costSharePct)}% of cost` : `By-product${l.recoveryRate ? ` · ₹${Number(l.recoveryRate)}` : ""}`}</Badge>}</td>
                <td className="px-4 py-2">{BASIS_LABEL[l.basis]}{l.basis === "potency" && <span className="text-xs text-muted"> at {Number(l.stdPotency)}%</span>}</td>
                <td className="px-4 py-2 text-right tabular-nums">{l.basis === "percent" ? `${Number(l.qty)}%` : `${formatQty(l.qty)} ${l.uom}`}</td>
                <td className="px-4 py-2 text-right tabular-nums">{l.tolerancePct ? `±${Number(l.tolerancePct)}%` : "—"}</td>
                <td className="px-4 py-2 text-muted">{l.stageSeq ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      {d.stages.length > 0 && (
        <Card>
          <CardHeader title="Process" />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {d.stages.map((s) => (
              <li key={s.id} className="px-5 py-2.5">
                <p><span className="font-mono">{s.seq}</span> {s.name} <span className="text-muted">· {s.workCenter} · {Number(s.minutes)} min per batch</span></p>
                {s.parameters.length > 0 && <p className="text-xs text-muted">Check: {s.parameters.map((p) => `${p.name} ${p.min ?? "…"}–${p.max ?? "…"}${p.unit ? ` ${p.unit}` : ""}`).join(" · ")}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Quantities for a batch" action={<Input className="h-9 w-28" inputMode="decimal" aria-label="Batch size" placeholder={formatQty(d.batchSize)} value={qty} onChange={(e) => setQty(e.target.value)} />} />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {scaled.data?.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 px-5 py-1.5">
                <span>{l.item?.code} <span className="text-muted">{l.item?.name}</span>{l.basis === "potency" && <span className="text-xs text-muted"> (at standard potency)</span>}</span>
                <span className="tabular-nums">{formatQty(l.required)} {l.item?.uom}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Cost" action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => runCost(false)}><Calculator className="size-4" aria-hidden /> Calculate</Button>{cost && !cost.missing.length && <Button size="sm" onClick={() => runCost(true)}>Set as standard cost</Button>}</div>} />
          {cost ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-border px-5 py-3 text-sm">
              {cost.missing.length > 0 && <dd className="col-span-2"><Alert tone="warning">Some ingredients have no cost yet.</Alert></dd>}
              <dt className="text-muted">Ingredients (per batch)</dt><dd className="text-right tabular-nums">{formatMoney(cost.material)}</dd>
              <dt className="text-muted">Process time</dt><dd className="text-right tabular-nums">{formatMoney(cost.conversion)}</dd>
              <dt className="text-muted">Less by-products</dt><dd className="text-right tabular-nums">({formatMoney(cost.byproductCredit)})</dd>
              <dt className="font-medium">Batch cost</dt><dd className="text-right font-medium tabular-nums">{formatMoney(cost.batchCost)}</dd>
              {cost.coproducts.map((c) => <Fragment key={c.itemId}><dt className="text-muted">Co-product share</dt><dd className="text-right tabular-nums">{formatMoney(c.share)}</dd></Fragment>)}
              <dt className="font-semibold">Cost per {d.item.uom}</dt><dd className="text-right font-semibold tabular-nums">{formatMoney(cost.unitCost)}</dd>
            </dl>
          ) : (
            <p className="border-t border-border px-5 py-3 text-sm text-muted">Ingredients at standard / average cost, stages at work-centre rates, spread over the expected yield.</p>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4"><ActivityFeed documentId={d.id} /></div>
      </Card>
    </div>
  );
}
