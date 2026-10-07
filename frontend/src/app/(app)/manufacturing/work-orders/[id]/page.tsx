"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, PackageMinus, PackagePlus, Printer, Timer, Undo2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";
import { ENTRY_LABEL, KIND_LABEL, MFG, STAGE_LABEL, STAGE_TONE, type WoOperation, type WorkOrder } from "@/lib/manufacturing";
import type { TraceNode } from "@/lib/quality";
import { BatchPanel } from "./batch";

const W = `${MFG}/work-orders`;

interface Availability {
  lines: {
    itemId: string;
    code: string;
    name: string;
    uom: string;
    required: string;
    onHand: string;
    reserved: string;
    available: string;
    short: string;
  }[];
}
interface Costing {
  wip: string;
  unabsorbed: string;
  actual: {
    material: string;
    conversion: string;
    subcontract: string;
    byproduct: string;
    output: string;
    variancePosted: string;
  };
  variances: {
    standard: { total: string };
    actualTotal: string;
    actualUnitCost: string | null;
    materialUsage: string;
    materialPrice: string;
    conversion: string;
    subcontract: string;
    byproduct: string;
    other: string;
    total: string;
  };
}
type DialogKind = "issue" | "return" | "receive" | "close" | { op: WoOperation } | null;

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Could not reach the server.");
const signed = (v: string) => (Number(v) < 0 ? `(${formatMoney(String(-Number(v)))})` : formatMoney(v));

export default function WorkOrderPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const key = [W, id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<WorkOrder>(`${W}/${id}`),
  });
  const d = q.data;
  const planning = !!d && ["draft", "rejected"].includes(d.status);
  const avail = useQuery({
    queryKey: [...key, "availability"],
    queryFn: () => api<Availability>(`${W}/${id}/availability`),
    enabled: planning,
  });
  const costing = useQuery({
    queryKey: [...key, "costing"],
    queryFn: () => api<Costing>(`${W}/${id}/costing`),
    enabled: !!d && d.status !== "draft",
  });
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [msg, setMsg] = useState<{
    tone: "success" | "danger" | "warning";
    text: string;
  } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const w = d!;
  const short = avail.data?.lines.filter((l) => Number(l.short) > 0) ?? [];

  async function releaseAnyway() {
    try {
      await api(`${W}/${w.id}/submit`, {
        body: { version: w.version, force: true },
      });
      setMsg({
        tone: "warning",
        text: "Released with shortages. Issue what is in stock and follow up on the rest.",
      });
      refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: errText(e) });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DocPageHeader
        doc={w}
        back={{ href: W, label: "Work orders" }}
        badges={
          <>
            <Badge tone={STAGE_TONE[w.stage]}>{STAGE_LABEL[w.stage]}</Badge>
            <Badge>{KIND_LABEL[w.kind]}</Badge>
          </>
        }
        subtitle={`${w.item.code} ${w.item.name} · ${formatQty(w.qty)} ${w.item.uom}`}
        actions={
          <>
            {w.canProduce && w.kind !== "batch" && (
              <Button variant="secondary" onClick={() => setDialog("issue")}>
                <PackageMinus className="size-4" aria-hidden /> Issue
              </Button>
            )}
            {w.canProduce && (
              <Button variant="secondary" onClick={() => setDialog("receive")}>
                <PackagePlus className="size-4" aria-hidden /> Receive output
              </Button>
            )}
            {w.status === "approved" && w.operations.length > 0 && (
              <Link href={`/print/work-orders/${w.id}`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted">
                <Printer className="size-4" aria-hidden /> Traveller
              </Link>
            )}
            {w.canClose && (
              <Button variant="secondary" onClick={() => setDialog("close")}>
                <CheckCheck className="size-4" aria-hidden /> Close
              </Button>
            )}
            <DocumentActions doc={w} apiBase={W} routeBase={W} queryKey={key} />
          </>
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <DocStatusAlerts doc={w} />
      {w.releaseCheck && w.stage !== "closed" && <Alert tone="warning">Released short of {w.releaseCheck.map((s) => `${s.code} (${formatQty(s.short)})`).join(", ")}.</Alert>}

      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info
            label="Made / ordered"
            value={
              <>
                {formatQty(w.producedQty)} / {formatQty(w.qty)} {w.item.uom}
                {Number(w.rejectedQty) > 0 && <span className="text-danger"> · {formatQty(w.rejectedQty)} rejected</span>}
              </>
            }
          />
          <Info label="Materials from → output to" value={`${w.source.code} → ${w.target.code}`} />
          <Info label="Planned" value={w.plannedStart || w.plannedEnd ? `${w.plannedStart ? formatDate(w.plannedStart) : "…"} – ${w.plannedEnd ? formatDate(w.plannedEnd) : "…"}` : null} />
          <Info label="Priority" value={w.priority} />
          <Info
            label="BOM"
            value={
              w.bom ? (
                <Link className="text-primary hover:underline" href={`${MFG}/boms/${w.bom.id}`}>
                  {w.bom.number} v{w.bom.version}
                </Link>
              ) : null
            }
          />
          <Info
            label="Sales order"
            value={
              w.salesOrder ? (
                <Link className="text-primary hover:underline" href={`/sales/orders/${w.salesOrder.id}`}>
                  {w.salesOrder.number}
                </Link>
              ) : null
            }
          />
          <Info label="Standard cost / unit" value={Number(w.stdUnitCost) ? formatMoney(w.stdUnitCost) : w.kind === "rework" ? "Actual" : "—"} />
          <Info label="Work in progress" value={formatMoney(w.wip)} />
          {w.parent && (
            <Info
              label="Rework of"
              value={
                <Link className="text-primary hover:underline" href={`${W}/${w.parent.id}`}>
                  {w.parent.number}
                </Link>
              }
            />
          )}
          {w.reworks.length > 0 && (
            <Info
              label="Rework orders"
              value={w.reworks.map((r) => (
                <Link key={r.id} className="mr-2 text-primary hover:underline" href={`${W}/${r.id}`}>
                  {r.number ?? "Draft"}
                </Link>
              ))}
            />
          )}
          {w.backflush && <Info label="Materials" value="Backflushed at receipt" />}
        </dl>
      </Card>

      {w.kind === "batch" && <BatchPanel w={w} onChanged={(t) => { setMsg({ tone: "success", text: t }); refresh(); }} />}

      {planning && (
        <Card>
          <CardHeader
            title="Availability"
            description={`In ${w.source.code}, less what other released orders have reserved.`}
            action={
              short.length > 0 && w.can.submit ? (
                <Button size="sm" variant="secondary" onClick={releaseAnyway}>
                  Release anyway
                </Button>
              ) : undefined
            }
          />
          <table className="w-full border-t border-border text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 text-right font-medium">Needed</th>
                <th className="px-4 py-2 text-right font-medium">On hand</th>
                <th className="px-4 py-2 text-right font-medium">Reserved</th>
                <th className="px-4 py-2 text-right font-medium">Short</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {avail.data?.lines.map((l) => (
                <tr key={l.itemId}>
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs text-muted">{l.code}</span> {l.name}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatQty(l.required)} {l.uom}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.onHand)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.reserved)}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${Number(l.short) > 0 ? "font-semibold text-danger" : "text-muted"}`}>{Number(l.short) > 0 ? formatQty(l.short) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Materials"
          action={
            w.canProduce && w.materials.some((m) => Number(m.issuedQty) > 0) ? (
              <Button size="sm" variant="ghost" onClick={() => setDialog("return")}>
                <Undo2 className="size-4" aria-hidden /> Return
              </Button>
            ) : undefined
          }
        />
        <table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-4 py-2 font-medium">At op</th>
              <th className="px-4 py-2 text-right font-medium">Required</th>
              <th className="px-4 py-2 text-right font-medium">Issued / received</th>
              <th className="px-4 py-2 text-right font-medium">Std rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {w.materials.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2">
                  <span className="font-mono text-xs text-muted">{m.code}</span> {m.name}
                  {m.kind !== "component" && <Badge className="ml-1">{m.kind === "byproduct" ? "By-product" : "Scrap"}</Badge>}
                </td>
                <td className="px-4 py-2 text-muted">{m.operationSeq ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatQty(m.requiredQty)} {m.uom}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatQty(m.kind === "component" ? m.issuedQty : m.receivedQty)}
                  {m.kind === "component" && Number(m.outstanding) > 0 && <span className="block text-xs text-muted">{formatQty(m.outstanding!)} to issue</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(m.stdRate) ? formatMoney(m.stdRate) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {w.operations.length > 0 && (
        <Card>
          <CardHeader title="Operations" description="Book time and quantities here, or start and stop job cards on the shop-floor board." />
          <table className="w-full border-t border-border text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Op</th>
                <th className="px-4 py-2 font-medium">Operation</th>
                <th className="px-4 py-2 text-right font-medium">Good / rejected</th>
                <th className="px-4 py-2 text-right font-medium">Minutes (plan / actual)</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {w.operations.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2 font-mono">{o.seq}</td>
                  <td className="px-4 py-2">
                    {o.name}{" "}
                    <span className="text-xs text-muted">
                      {o.workCenter}
                      {o.tool && ` · ${o.tool}`}
                    </span>
                    {o.isSubcontract && <Badge className="ml-1">Job work: {o.vendor}</Badge>}
                    {o.inspection && <Badge className="ml-1">QC</Badge>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatQty(o.goodQty)}
                    {Number(o.rejectQty) > 0 && <span className="text-danger"> / {formatQty(o.rejectQty)}</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{o.isSubcontract ? "—" : `${Number(o.plannedMinutes)} / ${Number(o.actualMinutes)}`}</td>
                  <td className="px-4 py-2 text-right">
                    {o.status === "done" ? (
                      <Badge tone="success">Done</Badge>
                    ) : w.canRecord ? (
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ op: o })}>
                        <Timer className="size-4" aria-hidden /> Book
                      </Button>
                    ) : (
                      <Badge>{o.status === "in_progress" ? "In progress" : "Pending"}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {costing.data && (
        <Card>
          <CardHeader title="Cost" description="Actual against standard for what has been made. Brackets are favourable." />
          <div className="grid gap-6 border-t border-border px-5 py-4 text-sm md:grid-cols-2">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
              <dt className="text-muted">Materials (net)</dt>
              <dd className="text-right tabular-nums">{formatMoney(costing.data.actual.material)}</dd>
              <dt className="text-muted">Labour, machine, overheads</dt>
              <dd className="text-right tabular-nums">{formatMoney(costing.data.actual.conversion)}</dd>
              <dt className="text-muted">Job work</dt>
              <dd className="text-right tabular-nums">{formatMoney(costing.data.actual.subcontract)}</dd>
              <dt className="text-muted">Less by-products / scrap</dt>
              <dd className="text-right tabular-nums">({formatMoney(costing.data.actual.byproduct)})</dd>
              <dt className="font-medium">Actual cost</dt>
              <dd className="text-right font-medium tabular-nums">{formatMoney(costing.data.variances.actualTotal)}</dd>
              <dt className="text-muted">Output taken to stock</dt>
              <dd className="text-right tabular-nums">{formatMoney(costing.data.actual.output)}</dd>
              <dt className="text-muted">Left in WIP</dt>
              <dd className="text-right tabular-nums">{signed(costing.data.wip)}</dd>
              {Number(costing.data.unabsorbed) > 0 && (
                <>
                  <dt className="text-muted">Time booked, not yet absorbed</dt>
                  <dd className="text-right tabular-nums">{formatMoney(costing.data.unabsorbed)}</dd>
                </>
              )}
            </dl>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
              <dt className="text-muted">Standard for output</dt>
              <dd className="text-right tabular-nums">{formatMoney(costing.data.variances.standard.total)}</dd>
              <dt className="text-muted">Material usage</dt>
              <dd className="text-right tabular-nums">{signed(costing.data.variances.materialUsage)}</dd>
              <dt className="text-muted">Material price</dt>
              <dd className="text-right tabular-nums">{signed(costing.data.variances.materialPrice)}</dd>
              <dt className="text-muted">Conversion</dt>
              <dd className="text-right tabular-nums">{signed(costing.data.variances.conversion)}</dd>
              <dt className="text-muted">Job work</dt>
              <dd className="text-right tabular-nums">{signed(costing.data.variances.subcontract)}</dd>
              <dt className="text-muted">By-products</dt>
              <dd className="text-right tabular-nums">{signed(costing.data.variances.byproduct)}</dd>
              {Number(costing.data.variances.other) !== 0 && (
                <>
                  <dt className="text-muted">Other</dt>
                  <dd className="text-right tabular-nums">{signed(costing.data.variances.other)}</dd>
                </>
              )}
              <dt className="font-medium">Total variance</dt>
              <dd className="text-right font-medium tabular-nums">{signed(costing.data.variances.total)}</dd>
              {costing.data.variances.actualUnitCost && (
                <>
                  <dt className="text-muted">Actual cost / unit</dt>
                  <dd className="text-right tabular-nums">{formatMoney(costing.data.variances.actualUnitCost)}</dd>
                </>
              )}
            </dl>
          </div>
        </Card>
      )}

      {w.entries.length > 0 && <AsBuilt id={w.id} />}

      {w.entries.length > 0 && (
        <Card>
          <CardHeader title="Production entries" />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {w.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2">
                <span>
                  <Link className="font-medium text-primary hover:underline" href={`${MFG}/production-entries/${e.id}`}>
                    {e.number}
                  </Link>{" "}
                  <span className="text-muted">
                    {ENTRY_LABEL[e.kind]} · {formatDate(e.docDate)}
                  </span>
                  {e.kind === "receipt" && (
                    <span className="text-muted">
                      {" "}
                      · {formatQty(e.goodQty)} good
                      {Number(e.rejectQty) > 0 ? `, ${formatQty(e.rejectQty)} rejected` : ""}
                    </span>
                  )}
                </span>
                <span className="tabular-nums">{e.kind === "receipt" ? formatMoney(e.outputValue) : e.kind === "close" ? signed(e.varianceValue) : signed(e.materialValue)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4">
          <ActivityFeed documentId={w.id} />
        </div>
      </Card>

      {(dialog === "issue" || dialog === "return") && (
        <MaterialsDialog
          w={w}
          mode={dialog}
          onClose={() => setDialog(null)}
          onDone={(t) => {
            setMsg({ tone: "success", text: t });
            refresh();
          }}
        />
      )}
      {dialog === "receive" && (
        <ReceiveDialog
          w={w}
          onClose={() => setDialog(null)}
          onDone={(t) => {
            setMsg({ tone: "success", text: t });
            refresh();
          }}
        />
      )}
      {dialog === "close" && (
        <CloseDialog
          w={w}
          wip={costing.data?.wip ?? w.wip}
          onClose={() => setDialog(null)}
          onDone={(t) => {
            setMsg({ tone: "success", text: t });
            refresh();
          }}
        />
      )}
      {dialog && typeof dialog === "object" && (
        <BookDialog
          op={dialog.op}
          onClose={() => setDialog(null)}
          onDone={(t) => {
            setMsg({ tone: "success", text: t });
            refresh();
          }}
        />
      )}
    </div>
  );
}

function MaterialsDialog({ w, mode, onClose, onDone }: { w: WorkOrder; mode: "issue" | "return"; onClose: () => void; onDone: (text: string) => void }) {
  const comps = w.materials.filter((m) => m.kind === "component" && m.isStockItem && (mode === "issue" || Number(m.issuedQty) > 0));
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(comps.map((m) => [m.id, mode === "issue" && Number(m.outstanding) > 0 ? String(Number(m.outstanding)) : ""])));
  const [batch, setBatch] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    const lines = comps
      .filter((m) => Number(qty[m.id]) > 0)
      .map((m) => ({
        materialId: m.id,
        qty: qty[m.id],
        batchNo: batch[m.id] || null,
      }));
    try {
      const e = await api<{ number: string }>(`${W}/${w.id}/${mode}`, {
        body: { lines },
      });
      onDone(`${e.number}: materials ${mode === "issue" ? "issued" : "returned"}.`);
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={mode === "issue" ? "Issue materials" : "Return unused materials"}
      description={`${mode === "issue" ? "From" : "Back to"} ${w.source.code}. Batch items without a batch number are taken earliest expiry first.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={go} loading={busy}>
            {mode === "issue" ? "Issue" : "Return"}
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="py-1 font-medium">Item</th>
            <th className="py-1 text-right font-medium">{mode === "issue" ? "To issue" : "Issued"}</th>
            <th className="py-1 font-medium">Qty</th>
            <th className="py-1 font-medium">Batch</th>
          </tr>
        </thead>
        <tbody>
          {comps.map((m) => (
            <tr key={m.id}>
              <td className="py-1 pr-2">
                {m.code} <span className="text-muted">{m.name}</span>
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {formatQty(mode === "issue" ? (m.outstanding ?? "0") : m.issuedQty)} {m.uom}
              </td>
              <td className="py-1 pr-2">
                <Input className="h-9 w-28" inputMode="decimal" aria-label={`Quantity of ${m.code}`} value={qty[m.id] ?? ""} onChange={(e) => setQty({ ...qty, [m.id]: e.target.value })} />
              </td>
              <td className="py-1">
                {m.trackBatch ? (
                  <Input className="h-9 w-28" aria-label={`Batch of ${m.code}`} value={batch[m.id] ?? ""} onChange={(e) => setBatch({ ...batch, [m.id]: e.target.value })} />
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

function ReceiveDialog({ w, onClose, onDone }: { w: WorkOrder; onClose: () => void; onDone: (text: string) => void }) {
  const whs = useWarehouses();
  const left = Math.max(0, Number(w.qty) - Number(w.producedQty));
  const [f, setF] = useState({
    goodQty: left ? String(left) : "",
    rejectQty: "",
    rejectWarehouseId: "",
    batchNo: "",
  });
  const byps = w.materials.filter((m) => m.kind !== "component");
  const [byp, setByp] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const e = await api<{ number: string; outputValue: string }>(`${W}/${w.id}/receive`, {
        body: {
          goodQty: f.goodQty || "0",
          rejectQty: f.rejectQty || "0",
          rejectWarehouseId: f.rejectWarehouseId || null,
          batchNo: f.batchNo || null,
          byproducts: byps.filter((m) => Number(byp[m.id]) > 0).map((m) => ({ materialId: m.id, qty: byp[m.id] })),
        },
      });
      onDone(`${e.number}: output received into ${w.target.code} at ${formatMoney(e.outputValue)}.`);
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Receive output"
      description={w.backflush ? "Materials are backflushed at standard quantities. Time booked so far is absorbed." : "Time and job work booked so far are absorbed into the cost."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={go} loading={busy}>
            Receive
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Good (${w.item.uom})`}>{(p) => <Input {...p} inputMode="decimal" value={f.goodQty} onChange={(e) => setF({ ...f, goodQty: e.target.value })} />}</Field>
        <Field label="Rejected at final inspection">{(p) => <Input {...p} inputMode="decimal" value={f.rejectQty} onChange={(e) => setF({ ...f, rejectQty: e.target.value })} />}</Field>
        {Number(f.rejectQty) > 0 && (
          <Field label="Rejects go to" hint="Blank = scrapped; their cost becomes a variance" className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={f.rejectWarehouseId} onChange={(e) => setF({ ...f, rejectWarehouseId: e.target.value })}>
                <option value="">Scrapped</option>
                {whs.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Batch number" hint="For batch-tracked items">
          {(p) => <Input {...p} value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />}
        </Field>
        {byps.map((m) => (
          <Field key={m.id} label={`${m.kind === "byproduct" ? "By-product" : "Scrap"}: ${m.code} (${m.uom})`} hint={`Expected ${formatQty(m.requiredQty)}`}>
            {(p) => <Input {...p} inputMode="decimal" value={byp[m.id] ?? ""} onChange={(e) => setByp({ ...byp, [m.id]: e.target.value })} />}
          </Field>
        ))}
      </div>
    </Dialog>
  );
}

function BookDialog({ op, onClose, onDone }: { op: WoOperation; onClose: () => void; onDone: (text: string) => void }) {
  const [f, setF] = useState({
    goodQty: "",
    rejectQty: "",
    minutes: "",
    rejectReason: "",
    operatorName: "",
  });
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api(`${MFG}/job-cards`, {
        body: {
          operationId: op.id,
          goodQty: f.goodQty || "0",
          rejectQty: f.rejectQty || "0",
          minutes: op.isSubcontract ? null : f.minutes || null,
          rejectReason: f.rejectReason || null,
          operatorName: f.operatorName || null,
          readings: Object.entries(readings).filter(([, v]) => v.trim()).map(([name, value]) => ({ name, value })),
        },
      });
      onDone(`Booked against ${op.seq} ${op.name}.`);
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Book ${op.seq} ${op.name}`}
      description={op.isSubcontract ? `Goods back from ${op.vendor}; charged at ₹${Number(op.subcontractRate)} a piece.` : `${op.workCenterName}: time is costed at the work centre's hourly rates.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={go} loading={busy}>
            Book
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Good">{(p) => <Input {...p} inputMode="decimal" value={f.goodQty} onChange={(e) => setF({ ...f, goodQty: e.target.value })} />}</Field>
        <Field label="Rejected">{(p) => <Input {...p} inputMode="decimal" value={f.rejectQty} onChange={(e) => setF({ ...f, rejectQty: e.target.value })} />}</Field>
        {Number(f.rejectQty) > 0 && (
          <Field label="Why rejected" className="sm:col-span-2">
            {(p) => <Input {...p} value={f.rejectReason} onChange={(e) => setF({ ...f, rejectReason: e.target.value })} />}
          </Field>
        )}
        {!op.isSubcontract && <Field label="Minutes">{(p) => <Input {...p} inputMode="decimal" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />}</Field>}
        <Field label="Operator" hint="Blank = you">
          {(p) => <Input {...p} value={f.operatorName} onChange={(e) => setF({ ...f, operatorName: e.target.value })} />}
        </Field>
        {op.parameters?.map((pa) => (
          <Field key={pa.name} label={`${pa.name}${pa.unit ? ` (${pa.unit})` : ""}`} hint={`Limits ${pa.min ?? "…"} – ${pa.max ?? "…"}`}>
            {(p) => <Input {...p} inputMode="decimal" value={readings[pa.name] ?? ""} onChange={(e) => setReadings({ ...readings, [pa.name]: e.target.value })} />}
          </Field>
        ))}
      </div>
    </Dialog>
  );
}

function CloseDialog({ w, wip, onClose, onDone }: { w: WorkOrder; wip: string; onClose: () => void; onDone: (text: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const e = await api<{ number: string; varianceValue: string }>(`${W}/${w.id}/close`, { body: {} });
      onDone(`${e.number}: closed with a variance of ${signed(e.varianceValue)}.`);
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }
  const under = Number(w.producedQty) < Number(w.qty);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Close work order"
      description="Time not yet absorbed is absorbed, and what is left in WIP is written off to production variances. Nothing more can be booked."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep open
          </Button>
          <Button onClick={go} loading={busy}>
            Close order
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {under && (
        <Alert tone="warning">
          Only {formatQty(w.producedQty)} of {formatQty(w.qty)} have been made. Unissued materials are released.
        </Alert>
      )}
      <p className="text-sm">
        Work in progress now: <span className="font-medium tabular-nums">{signed(wip)}</span>
      </p>
    </Dialog>
  );
}

/** Lots and serials that went into the order and came out of it. */
function AsBuilt({ id }: { id: string }) {
  const q = useQuery({ queryKey: [W, id, "as-built"], queryFn: () => api<{ consumed: TraceNode[]; made: TraceNode[] }>(`/quality/as-built/${id}`) });
  if (!q.data || (!q.data.consumed.length && !q.data.made.length)) return null;
  const lot = (n: TraceNode) => n.batchNo ? `Batch ${n.batchNo}` : n.serialNo ? `Serial ${n.serialNo}` : "—";
  const list = (title: string, ns: TraceNode[]) => (
    <div>
      <p className="px-5 pt-3 text-xs uppercase tracking-wide text-muted">{title}</p>
      <ul className="divide-y divide-border text-sm">
        {ns.map((n, i) => (
          <li key={`${n.item.id}-${n.batchNo ?? n.serialNo ?? i}`} className="flex justify-between gap-3 px-5 py-1.5">
            <span><span className="font-mono text-xs text-muted">{n.item.code}</span> {n.item.name} <span className="text-muted">· {lot(n)}</span></span>
            <span className="tabular-nums">{formatQty(n.qty)} {n.item.uom}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <Card>
      <CardHeader title="As built" description="Lots and serials used and made, from the stock movements. Trace any of them under Quality → Traceability." />
      <div className="grid border-t border-border md:grid-cols-2">
        {list("Went in", q.data.consumed)}
        {list("Came out", q.data.made)}
      </div>
    </Card>
  );
}
