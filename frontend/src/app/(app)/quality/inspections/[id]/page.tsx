"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileWarning, Printer, Save } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, Info } from "@/components/documents/doc-page";
import { StatusBadge } from "@/components/documents/document-parts";
import { ActivityFeed } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatQty, type DocumentStatus } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";
import { LOT_STATUS, QA, RESULT, STAGE, type Inspection, type Ncr, type Parameter } from "@/lib/quality";

const P = `${QA}/inspections`;
/** Rows shown in the grid; very large samples are recorded as defectives only. */
const GRID_MAX = 200;

const SOURCE_PATH: Record<string, string> = { goods_receipt: "/purchase/receipts", production_entry: "/manufacturing/production-entries" };

function limits(p: Parameter) {
  if (p.kind === "attribute") return "Pass / fail";
  const lo = p.lowerLimit !== null ? Number(p.lowerLimit) : null;
  const hi = p.upperLimit !== null ? Number(p.upperLimit) : null;
  return `${lo ?? "…"} – ${hi ?? "…"}${p.unit ? ` ${p.unit}` : ""}`;
}
function fails(p: Parameter, v: string) {
  if (v === "") return false;
  if (p.kind === "attribute") return v === "fail";
  const n = Number(v);
  return (p.lowerLimit !== null && n < Number(p.lowerLimit)) || (p.upperLimit !== null && n > Number(p.upperLimit));
}

export default function InspectionPage() {
  const { id } = useParams<{ id: string }>();
  const key = [P, id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Inspection>(`${P}/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  // Keyed so the grid and decision start from the saved state after every change.
  return <InspectionView key={`${q.data!.id}-${q.data!.version}`} d={q.data!} queryKey={key} />;
}

function InspectionView({ d, queryKey }: { d: Inspection; queryKey: unknown[] }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { can } = useAuth();
  const [coa, setCoa] = useState({ ref: d.vendorCoaRef ?? "", verified: d.coaVerified });
  const whs = useWarehouses();
  const draft = d.can.edit || d.can.submit;
  const rows = Math.min(d.sampleSize, GRID_MAX);
  const [grid, setGrid] = useState<Record<string, string>>(() => Object.fromEntries(d.readings.map((r) => [`${r.sampleNo}|${r.parameterId}`, r.value !== null ? String(Number(r.value)) : r.passed === null ? "" : r.passed ? "pass" : "fail"])));
  const [dec, setDec] = useState({
    acceptedQty: d.result === "pending" ? (d.suggestion === "reject" ? "" : String(Number(d.lotQty))) : String(Number(d.acceptedQty)),
    rejectedQty: d.result === "pending" ? (d.suggestion === "reject" ? String(Number(d.lotQty)) : "") : String(Number(d.rejectedQty)),
    reworkQty: d.result === "pending" ? "" : String(Number(d.reworkQty)),
    releaseWarehouseId: d.releaseWarehouse?.id ?? "",
    rejectWarehouseId: d.rejectWarehouse?.id ?? "",
    remarks: d.remarks ?? "",
  });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "decide" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey });

  async function saveReadings() {
    setBusy("save");
    setMsg(null);
    const readings = Object.entries(grid)
      .filter(([, v]) => v !== "")
      .map(([k, v]) => {
        const [sampleNo, parameterId] = k.split("|");
        const p = d.parameters.find((x) => x.id === parameterId)!;
        return p.kind === "attribute" ? { sampleNo: Number(sampleNo), parameterId, passed: v === "pass" } : { sampleNo: Number(sampleNo), parameterId, value: v };
      });
    try {
      await api(`${P}/${d.id}/readings`, { method: "PUT", body: { readings } });
      refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
      setBusy(null);
    }
  }

  async function decide() {
    setBusy("decide");
    setMsg(null);
    setErrors({});
    try {
      await api(`${P}/${d.id}/submit`, { body: { version: d.version, acceptedQty: dec.acceptedQty || "0", rejectedQty: dec.rejectedQty || "0", reworkQty: dec.reworkQty || "0", releaseWarehouseId: dec.releaseWarehouseId || null, rejectWarehouseId: dec.rejectWarehouseId || null, remarks: dec.remarks || null } });
      refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setMsg({ tone: "danger", text: e.message });
      } else setMsg({ tone: "danger", text: "Could not reach the server." });
      setBusy(null);
    }
  }

  async function saveCoa() {
    setMsg(null);
    try {
      await api(`${P}/${d.id}/coa`, { method: "PUT", body: { vendorCoaRef: coa.ref || null, coaVerified: coa.verified } });
      refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }

  async function raiseNcr() {
    setMsg(null);
    try {
      const n = await api<Ncr>(`${QA}/ncrs/from-inspection/${d.id}`, { method: "POST" });
      router.push(`${QA}/ncrs/${n.id}`);
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }
  const canNcr = can("quality.ncr.manage") && (Number(d.rejectedQty) + Number(d.reworkQty) > 0 || d.suggestion === "reject");

  const failedSamples = new Set(
    Object.entries(grid)
      .filter(([k, v]) => {
        const p = d.parameters.find((x) => x.id === k.split("|")[1]);
        return p && fails(p, v);
      })
      .map(([k]) => k.split("|")[0]),
  );
  const out = (Number(dec.rejectedQty) || 0) + (Number(dec.reworkQty) || 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: P, label: "Inspections" }}
        badges={<><Badge>{STAGE[d.stage]}</Badge>{d.result !== "pending" && <Badge tone={RESULT[d.result].tone}>{RESULT[d.result].label}</Badge>}</>}
        subtitle={`${d.item.code} ${d.item.name} · lot ${formatQty(d.lotQty)} ${d.item.uom}${d.batchNo ? ` · batch ${d.batchNo}` : ""}`}
        actions={
          <>
            {d.status === "approved" && d.result !== "rejected" && d.stage !== "in_process" && <Link href={`/print/coa/${d.id}`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"><Printer className="size-4" aria-hidden /> Certificate of analysis</Link>}
            {canNcr && <Button variant="secondary" onClick={raiseNcr}><FileWarning className="size-4" aria-hidden /> Raise NCR</Button>}
            <DocumentActions doc={{ ...d, can: { ...d.can, submit: false, edit: false } }} apiBase={P} routeBase={P} queryKey={queryKey} />
          </>
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Plan" value={d.plan ? `${d.plan.code} ${d.plan.name}` : "No plan: whole lot"} />
          <Info label="Sampling" value={d.plan?.sampling === "aql" ? `AQL ${d.plan.aql}, level ${d.plan.inspectionLevel}, letter ${d.codeLetter}` : d.plan?.sampling === "fixed" ? "Fixed sample" : "100%"} />
          <Info label="Sample / accept / reject" value={`${d.sampleSize} / Ac ${d.acceptNo} / Re ${d.rejectNo}`} />
          <Info label="Defectives found" value={<>{d.defectives}{d.suggestion && <Badge tone={d.suggestion === "accept" ? "success" : "danger"} className="ml-2">Readings say {d.suggestion}</Badge>}</>} />
          <Info label="Source" value={d.source ? (SOURCE_PATH[d.source.docType] ? <Link className="text-primary hover:underline" href={`${SOURCE_PATH[d.source.docType]}/${d.source.id}`}>{d.source.number}</Link> : d.source.number) : null} />
          {d.vendor && <Info label="Vendor" value={d.vendor} />}
          {d.workOrder && <Info label="Work order" value={<Link className="text-primary hover:underline" href={`/manufacturing/work-orders/${d.workOrder.id}`}>{d.workOrder.number}</Link>} />}
          {d.operation && <Info label="After operation" value={`${d.operation.seq} ${d.operation.name}`} />}
          <Info label="Lot is in" value={d.warehouse ? `${d.warehouse.code} ${d.warehouse.name}` : "On the line"} />
          {d.lot && <Info label="Lot status" value={<Badge tone={LOT_STATUS[d.lot.qcStatus].tone}>{LOT_STATUS[d.lot.qcStatus].label}</Badge>} />}
          {d.party && <Info label="Specification for" value={d.party.name} />}
          {d.ncrs.length > 0 && <Info label="Non-conformance" value={d.ncrs.map((n) => <Link key={n.id} className="mr-2 inline-flex items-center gap-1 text-primary hover:underline" href={`${QA}/ncrs/${n.id}`}>{n.number ?? "Draft NCR"} <StatusBadge status={n.status as DocumentStatus} /></Link>)} />}
          {d.reworkOrder && <Info label="Rework order" value={<Link className="text-primary hover:underline" href={`/manufacturing/work-orders/${d.reworkOrder.id}`}>{d.reworkOrder.number ?? "Draft"}</Link>} />}
        </dl>
        {d.plan?.instructions && <p className="border-t border-border px-5 py-3 text-sm text-muted">{d.plan.instructions}</p>}
        {d.stage === "incoming" && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border px-5 py-3 text-sm">
            {draft ? (
              <>
                <Field label="Vendor certificate of analysis">{(p) => <Input {...p} className="w-56" placeholder="CoA number" value={coa.ref} onChange={(e) => setCoa({ ...coa, ref: e.target.value })} />}</Field>
                <Checkbox label="Checked against our specification" checked={coa.verified} onChange={(e) => setCoa({ ...coa, verified: e.target.checked })} />
                <Button size="sm" variant="secondary" onClick={saveCoa}>Save</Button>
              </>
            ) : (
              <span className="text-muted">Vendor CoA: {d.vendorCoaRef ?? "none recorded"}{d.vendorCoaRef && (d.coaVerified ? " · checked against our specification" : " · not checked")}</span>
            )}
          </div>
        )}
      </Card>

      {d.parameters.length > 0 && (
        <Card>
          <CardHeader
            title="Readings"
            description={d.sampleSize > GRID_MAX ? `Showing the first ${GRID_MAX} of ${d.sampleSize} samples.` : "Out-of-limit readings are highlighted; a sample with any failure counts as one defective."}
            action={draft ? <Button size="sm" variant="secondary" loading={busy === "save"} onClick={saveReadings}><Save className="size-4" aria-hidden /> Save readings</Button> : undefined}
          />
          <div className="max-h-[32rem] overflow-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Sample</th>
                  {d.parameters.map((p) => (
                    <th key={p.id} className="px-3 py-2 font-medium">
                      {p.name}{p.isCritical && <span className="text-danger"> *</span>}
                      <span className="block font-normal normal-case">{limits(p)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Array.from({ length: rows }, (_, i) => i + 1).map((n) => (
                  <tr key={n} className={failedSamples.has(String(n)) ? "bg-danger-soft" : undefined}>
                    <td className="px-3 py-1 tabular-nums text-muted">{n}</td>
                    {d.parameters.map((p) => {
                      const k = `${n}|${p.id}`;
                      const v = grid[k] ?? "";
                      const bad = fails(p, v);
                      return (
                        <td key={p.id} className="px-3 py-1">
                          {!draft ? (
                            <span className={bad ? "font-medium text-danger" : undefined}>{v === "" ? "—" : v === "pass" ? "Pass" : v === "fail" ? "Fail" : v}</span>
                          ) : p.kind === "attribute" ? (
                            <Select className="h-8 w-24" aria-label={`${p.name}, sample ${n}`} value={v} onChange={(e) => setGrid({ ...grid, [k]: e.target.value })}>
                              <option value="">—</option>
                              <option value="pass">Pass</option>
                              <option value="fail">Fail</option>
                            </Select>
                          ) : (
                            <Input className={`h-8 w-24 ${bad ? "border-danger text-danger" : ""}`} inputMode="decimal" aria-label={`${p.name}, sample ${n}`} value={v} onChange={(e) => setGrid({ ...grid, [k]: e.target.value })} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Decision" description={draft ? "Split the lot into accepted, rejected and rework. Recording the decision moves the stock." : undefined} />
        {draft ? (
          <div className="grid gap-4 border-t border-border px-5 py-4 sm:grid-cols-3">
            <Field label={`Accepted (${d.item.uom})`} error={errors.acceptedQty}>{(p) => <Input {...p} inputMode="decimal" value={dec.acceptedQty} onChange={(e) => setDec({ ...dec, acceptedQty: e.target.value })} />}</Field>
            <Field label="Rejected" error={errors.rejectedQty}>{(p) => <Input {...p} inputMode="decimal" value={dec.rejectedQty} onChange={(e) => setDec({ ...dec, rejectedQty: e.target.value })} />}</Field>
            <Field label="Rework" error={errors.reworkQty} hint={d.stage === "final" ? "A draft rework order is created" : undefined}>{(p) => <Input {...p} inputMode="decimal" value={dec.reworkQty} onChange={(e) => setDec({ ...dec, reworkQty: e.target.value })} />}</Field>
            {d.warehouse && (
              <>
                <Field label="Accepted goods to" error={errors.releaseWarehouseId} hint="Blank = stay where they are">
                  {(p) => (
                    <Select {...p} value={dec.releaseWarehouseId} onChange={(e) => setDec({ ...dec, releaseWarehouseId: e.target.value })}>
                      <option value="">Stay in {d.warehouse!.code}</option>
                      {whs.data?.filter((w) => w.id !== d.warehouse!.id).map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}
                    </Select>
                  )}
                </Field>
                {out > 0 && (
                  <Field label="Rejected and rework to" error={errors.rejectWarehouseId}>
                    {(p) => (
                      <Select {...p} value={dec.rejectWarehouseId} onChange={(e) => setDec({ ...dec, rejectWarehouseId: e.target.value })}>
                        <option value="">Choose…</option>
                        {whs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}
                      </Select>
                    )}
                  </Field>
                )}
              </>
            )}
            <Field label="Remarks" className="sm:col-span-3">{(p) => <Input {...p} value={dec.remarks} onChange={(e) => setDec({ ...dec, remarks: e.target.value })} />}</Field>
            <div className="flex justify-end sm:col-span-3">
              <Button loading={busy === "decide"} onClick={decide}>Record decision</Button>
            </div>
          </div>
        ) : (
          <dl className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-4">
            <Info label="Accepted" value={`${formatQty(d.acceptedQty)}${d.releaseWarehouse ? ` → ${d.releaseWarehouse.code}` : ""}`} />
            <Info label="Rejected" value={`${formatQty(d.rejectedQty)}${Number(d.rejectedQty) && d.rejectWarehouse ? ` → ${d.rejectWarehouse.code}` : ""}`} />
            <Info label="Rework" value={formatQty(d.reworkQty)} />
            <Info label="Remarks" value={d.remarks} />
          </dl>
        )}
      </Card>

      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4"><ActivityFeed documentId={d.id} /></div>
      </Card>
    </div>
  );
}
