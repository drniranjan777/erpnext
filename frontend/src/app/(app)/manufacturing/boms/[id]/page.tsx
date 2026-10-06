"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, CopyPlus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { MFG, type Bom } from "@/lib/manufacturing";

const B = `${MFG}/boms`;

interface Explosion { rows: { level: number; itemId: string; qty: string; viaPhantom: boolean; hasBom: boolean; item?: { code: string; name: string; uom: string } }[]; requirements: { itemId: string; qty: string; item?: { code: string; name: string; uom: string } }[] }
interface Cost { material: string; labour: string; machine: string; overhead: string; operation: string; subcontract: string; byproductCredit: string; unitCost: string; lines: { itemId: string; qtyPerUnit: string; unitCost: string; amount: string; source: string; item?: { code: string; name: string } }[]; missing: { id: string; code?: string; name?: string }[] }

export default function BomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const key = [B, id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Bom>(`${B}/${id}`) });
  const [qty, setQty] = useState("1");
  const [levels, setLevels] = useState<"single" | "all">("single");
  const exp = useQuery({ queryKey: [B, id, "explode", qty, levels], queryFn: () => api<Explosion>(`${B}/${id}/explode`, { query: { qty: qty || "1", levels } }), enabled: !!q.data });
  const [cost, setCost] = useState<Cost | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  async function runCost(apply: boolean) {
    setMsg(null);
    try {
      const c = await api<Cost>(`${B}/${d.id}/cost`, { body: { apply } });
      setCost(c);
      if (apply) setMsg({ tone: "success", text: `Standard cost of ${d.item.code} set to ${formatMoney(c.unitCost)}.` });
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }
  async function newVersion() {
    try {
      const v = await api<Bom>(`${B}/${d.id}/new-version`, { method: "POST" });
      router.push(`${B}/${v.id}/edit`);
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: B, label: "Bills of materials" }}
        badges={<><Badge>v{d.bomVersion}</Badge>{d.isDefault && d.status === "approved" && <Badge tone="success">Default</Badge>}</>}
        subtitle={`${d.item.code} ${d.item.name} · per ${formatQty(d.quantity)} ${d.item.uom}`}
        actions={
          <>
            {d.canNewVersion && <Button variant="secondary" onClick={newVersion}><CopyPlus className="size-4" aria-hidden /> New version</Button>}
            <DocumentActions doc={d} apiBase={B} routeBase={B} queryKey={key} />
          </>
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <DocStatusAlerts doc={d} approvedNote="Approved and frozen. Production and costing use the default version." />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Effective" value={d.effectiveFrom ? `${formatDate(d.effectiveFrom)}${d.effectiveTo ? ` – ${formatDate(d.effectiveTo)}` : " onwards"}` : "On approval"} />
          <Info label="Drawing" value={d.drawingNo ? `${d.drawingNo}${d.drawingRevision ? ` rev ${d.drawingRevision}` : ""}` : null} />
          <Info label="Unit cost (rolled up)" value={Number(d.unitCost) ? formatMoney(d.unitCost) : "—"} />
          <Info label="Versions" value={d.versions.map((v) => <Link key={v.id} href={`${B}/${v.id}`} className={`mr-2 ${v.id === d.id ? "font-semibold" : "text-primary hover:underline"}`}>v{v.version}{v.isDefault ? "*" : ""}</Link>)} />
        </dl>
      </Card>
      <Card>
        <CardHeader title="Materials" />
        <table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">#</th><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 text-right font-medium">Qty</th><th className="px-4 py-2 text-right font-medium">Scrap</th><th className="px-4 py-2 font-medium">Notes</th></tr></thead>
          <tbody className="divide-y divide-border">
            {d.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2 text-muted">{l.lineNo}</td>
                <td className="px-4 py-2"><span className="font-mono text-xs text-muted">{l.code}</span> {l.name}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.qty)} {l.uom}</td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(l.scrapPct) ? `${Number(l.scrapPct)}%` : "—"}</td>
                <td className="px-4 py-2">
                  {l.kind !== "component" && <Badge className="mr-1">{l.kind === "byproduct" ? "By-product" : "Scrap"}{l.recoveryRate && ` ₹${Number(l.recoveryRate)}`}</Badge>}
                  {l.isPhantom && <Badge className="mr-1">Phantom</Badge>}
                  {l.alternateGroup && <Badge className="mr-1">Alt {l.alternateGroup} #{l.priority}</Badge>}
                  {l.operationSeq && <span className="text-xs text-muted">at op {l.operationSeq}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {d.operations.length > 0 && (
        <Card>
          <CardHeader title="Routing" />
          <table className="w-full border-t border-border text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Op</th><th className="px-4 py-2 font-medium">Operation</th><th className="px-4 py-2 font-medium">Work centre</th><th className="px-4 py-2 text-right font-medium">Setup</th><th className="px-4 py-2 text-right font-medium">Run / unit</th><th className="px-4 py-2 font-medium" /></tr></thead>
            <tbody className="divide-y divide-border">
              {d.operations.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2 font-mono">{o.seq}</td>
                  <td className="px-4 py-2">{o.name}{o.tool && <span className="block text-xs text-muted">Tool {o.tool}</span>}</td>
                  <td className="px-4 py-2">{o.workCenter} <span className="text-muted">{o.workCenterName}</span></td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(o.setupMinutes)} min</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(o.runMinutes)} min</td>
                  <td className="px-4 py-2">{o.isSubcontract && <Badge className="mr-1">Job work: {o.vendor} ₹{Number(o.subcontractRate)}</Badge>}{o.inspection && <Badge>QC</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Requirements" action={<div className="flex gap-2"><Input className="h-9 w-24" inputMode="decimal" aria-label="Quantity to make" value={qty} onChange={(e) => setQty(e.target.value)} /><Select className="h-9 w-32" aria-label="Levels" value={levels} onChange={(e) => setLevels(e.target.value as "single" | "all")}><option value="single">To issue</option><option value="all">All levels</option></Select></div>} />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {(levels === "all" ? exp.data?.rows : exp.data?.requirements)?.map((r, i) => (
              <li key={i} className="flex justify-between gap-3 px-5 py-1.5" style={levels === "all" ? { paddingLeft: `${20 + ((r as Explosion["rows"][number]).level - 1) * 20}px` } : undefined}>
                <span>{r.item?.code} <span className="text-muted">{r.item?.name}</span>{levels === "all" && (r as Explosion["rows"][number]).hasBom && <Badge className="ml-1">BOM</Badge>}</span>
                <span className="tabular-nums">{formatQty(r.qty)} {r.item?.uom}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Cost roll-up" action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => runCost(false)}><Calculator className="size-4" aria-hidden /> Calculate</Button>{cost && !cost.missing.length && <Button size="sm" onClick={() => runCost(true)}>Set as standard cost</Button>}</div>} />
          {cost ? (
            <div className="border-t border-border px-5 py-3 text-sm">
              {cost.missing.length > 0 && <Alert tone="warning">No cost for: {cost.missing.map((m) => m.code ?? m.id).join(", ")}</Alert>}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
                <dt className="text-muted">Materials</dt><dd className="text-right tabular-nums">{formatMoney(cost.material)}</dd>
                <dt className="text-muted">Labour</dt><dd className="text-right tabular-nums">{formatMoney(cost.labour)}</dd>
                <dt className="text-muted">Machine</dt><dd className="text-right tabular-nums">{formatMoney(cost.machine)}</dd>
                <dt className="text-muted">Overheads</dt><dd className="text-right tabular-nums">{formatMoney(cost.overhead)}</dd>
                <dt className="text-muted">Job work</dt><dd className="text-right tabular-nums">{formatMoney(cost.subcontract)}</dd>
                <dt className="text-muted">Less by-products</dt><dd className="text-right tabular-nums">({formatMoney(cost.byproductCredit)})</dd>
                <dt className="font-semibold">Cost per {d.item.uom}</dt><dd className="text-right font-semibold tabular-nums">{formatMoney(cost.unitCost)}</dd>
              </dl>
            </div>
          ) : (
            <p className="border-t border-border px-5 py-3 text-sm text-muted">Materials at standard / average cost, operations at work-centre rates.</p>
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
