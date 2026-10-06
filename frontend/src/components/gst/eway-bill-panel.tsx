"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/documents";
import { EWB_CANCEL_REASONS, EXTEND_REASONS, PART_B_REASONS, SUB_SUPPLY, type EwayBill, type EwbDraft } from "@/lib/gst";

type Mode = { kind: "new" } | { kind: "partB" | "extend" | "cancel"; bill: EwayBill } | null;

/** E-way bills of a goods document: generate, change vehicle, extend, cancel. */
export function EwayBillPanel({ documentId, onChange }: { documentId: string; onChange?: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const key = ["gst", "ewb", documentId];
  const manage = can("gst.einvoice.manage");
  const q = useQuery({ queryKey: key, queryFn: () => api<EwbDraft>(`/gst/eway-bills/for/${documentId}`), enabled: manage, retry: false });
  const [mode, setMode] = useState<Mode>(null);
  if (!manage || !q.data) return null;
  const d = q.data;
  const active = d.bills.find((b) => b.status === "active");
  const done = () => {
    qc.invalidateQueries({ queryKey: key });
    onChange?.();
  };
  if (!d.request.items.length && !d.bills.length) return null;
  return (
    <Card>
      <CardHeader
        title="e-Way bill"
        description={`${SUB_SUPPLY[d.request.subSupplyType] ?? ""} · ${d.request.docType} · consignment value ${formatMoney(d.request.totalValue)}${d.required ? "" : ` (below ₹${d.threshold.toLocaleString("en-IN")}: optional)`}`}
        action={!active ? <Button size="sm" onClick={() => setMode({ kind: "new" })}><Truck className="size-4" aria-hidden /> Generate</Button> : undefined}
      />
      {d.required && !active && <div className="px-5 pb-3"><Alert tone="warning">Goods worth more than ₹{d.threshold.toLocaleString("en-IN")} need an e-way bill before they move.</Alert></div>}
      {d.bills.length > 0 && (
        <ul className="divide-y divide-border border-t border-border text-sm">
          {d.bills.map((b) => (
            <li key={b.id} className="flex flex-wrap items-start gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono font-medium">
                  {b.ewbNo} <Badge tone={b.status === "cancelled" ? "neutral" : b.expired ? "danger" : "success"} className="ml-1">{b.status === "cancelled" ? "Cancelled" : b.expired ? "Expired" : "Active"}</Badge>
                  {b.consolidatedNo && <Badge className="ml-1">CEWB {b.consolidatedNo}</Badge>}
                </p>
                <p className="text-xs text-muted">
                  {formatDateTime(b.ewbDate)} · {b.distanceKm} km by {b.transportMode} · {b.vehicleNo ?? "vehicle pending (Part-A)"}
                  {b.validUntil ? ` · valid until ${formatDateTime(b.validUntil)}` : ""}
                  {b.extensions ? ` · extended ${b.extensions}×` : ""}
                </p>
                {b.cancelReason && <p className="text-xs text-muted">Cancelled: {b.cancelReason}</p>}
                {b.vehicleHistory.length > 1 && <p className="text-xs text-muted">Vehicles: {b.vehicleHistory.map((v) => v.vehicleNo).join(" → ")}</p>}
              </div>
              {b.status === "active" && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setMode({ kind: "partB", bill: b })}>{b.vehicleNo ? "Change vehicle" : "Add vehicle"}</Button>
                  {b.canExtend && <Button size="sm" variant="secondary" onClick={() => setMode({ kind: "extend", bill: b })}>Extend</Button>}
                  {b.canCancel && <Button size="sm" variant="ghost" onClick={() => setMode({ kind: "cancel", bill: b })}>Cancel</Button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {mode?.kind === "new" && <GenerateDialog documentId={documentId} draft={d} onClose={() => setMode(null)} onDone={done} />}
      {mode && mode.kind !== "new" && <ActionDialog mode={mode} onClose={() => setMode(null)} onDone={done} />}
    </Card>
  );
}

function useSubmit(onDone: () => void, onClose: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function run(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await api(path, { body });
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setErrors(e.fieldErrors);
      } else setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return { error, errors, busy, run };
}

function GenerateDialog({ documentId, draft, onClose, onDone }: { documentId: string; draft: EwbDraft; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    distanceKm: draft.defaults.distanceKm ? String(draft.defaults.distanceKm) : "",
    transportMode: "road",
    vehicleType: "R",
    vehicleNo: draft.defaults.vehicleNo ?? "",
    transporterId: draft.defaults.transporterId ?? "",
    transporterName: draft.defaults.transporterName ?? "",
    transDocNo: draft.defaults.transDocNo ?? "",
    transDocDate: draft.defaults.transDocDate ?? "",
  });
  const s = useSubmit(onDone, onClose);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title="Generate e-way bill"
      description={`From ${draft.request.fromPincode ?? "?"} to ${draft.request.toPincode ?? "?"} · ${draft.request.items.length} HSN line(s). Validity: 1 day per 200 km.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button
            loading={s.busy}
            disabled={!f.distanceKm}
            onClick={() =>
              s.run("/gst/eway-bills", {
                documentId,
                distanceKm: Number(f.distanceKm),
                transportMode: f.transportMode,
                vehicleType: f.vehicleType,
                vehicleNo: f.vehicleNo || null,
                transporterId: f.transporterId || null,
                transporterName: f.transporterName || null,
                transDocNo: f.transDocNo || null,
                transDocDate: f.transDocDate || null,
              })
            }
          >
            Generate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {s.error && <Alert>{s.error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Distance (km)" required error={s.errors.distanceKm}>{(p) => <Input {...p} inputMode="numeric" value={f.distanceKm} onChange={(e) => setF({ ...f, distanceKm: e.target.value.replace(/\D/g, "") })} />}</Field>
          <Field label="Mode">
            {(p) => (
              <Select {...p} value={f.transportMode} onChange={set("transportMode")}>
                <option value="road">Road</option>
                <option value="rail">Rail</option>
                <option value="air">Air</option>
                <option value="ship">Ship</option>
              </Select>
            )}
          </Field>
          {f.transportMode === "road" ? (
            <>
              <Field label="Vehicle no." error={s.errors.vehicleNo} hint="Or leave blank and give the transporter ID">{(p) => <Input {...p} className="uppercase" value={f.vehicleNo} onChange={set("vehicleNo")} />}</Field>
              <Field label="Vehicle type">
                {(p) => (
                  <Select {...p} value={f.vehicleType} onChange={set("vehicleType")}>
                    <option value="R">Regular</option>
                    <option value="O">Over-dimensional cargo</option>
                  </Select>
                )}
              </Field>
            </>
          ) : (
            <>
              <Field label="Transport doc no." required error={s.errors.transDocNo}>{(p) => <Input {...p} value={f.transDocNo} onChange={set("transDocNo")} />}</Field>
              <Field label="Transport doc date" required>{(p) => <Input {...p} type="date" value={f.transDocDate} onChange={set("transDocDate")} />}</Field>
            </>
          )}
          <Field label="Transporter ID (GSTIN / TRANSIN)" error={s.errors.transporterId}>{(p) => <Input {...p} className="uppercase" maxLength={15} value={f.transporterId} onChange={set("transporterId")} />}</Field>
          <Field label="Transporter name">{(p) => <Input {...p} value={f.transporterName} onChange={set("transporterName")} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}

function ActionDialog({ mode, onClose, onDone }: { mode: { kind: "partB" | "extend" | "cancel"; bill: EwayBill }; onClose: () => void; onDone: () => void }) {
  const s = useSubmit(onDone, onClose);
  const [f, setF] = useState({ vehicleNo: "", fromPlace: "", reasonCode: mode.kind === "partB" ? (mode.bill.vehicleNo ? "1" : "4") : mode.kind === "extend" ? "1" : "3", remark: "", remainingKm: "" });
  const reasons = mode.kind === "partB" ? PART_B_REASONS : mode.kind === "extend" ? EXTEND_REASONS : EWB_CANCEL_REASONS;
  const title = mode.kind === "partB" ? "Update vehicle (Part-B)" : mode.kind === "extend" ? "Extend validity" : "Cancel e-way bill";
  const submit = () => {
    const base = `/gst/eway-bills/${mode.bill.id}`;
    if (mode.kind === "partB") return s.run(`${base}/part-b`, { vehicleNo: f.vehicleNo, fromPlace: f.fromPlace, reasonCode: f.reasonCode, remark: f.remark || null });
    if (mode.kind === "extend") return s.run(`${base}/extend`, { remainingKm: Number(f.remainingKm), fromPlace: f.fromPlace, reasonCode: f.reasonCode, remark: f.remark });
    return s.run(`${base}/cancel`, { reasonCode: f.reasonCode, remark: f.remark });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={`E-way bill ${mode.bill.ewbNo}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant={mode.kind === "cancel" ? "danger" : "primary"} loading={s.busy} onClick={submit}>{mode.kind === "cancel" ? "Cancel e-way bill" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {s.error && <Alert>{s.error}</Alert>}
        {mode.kind === "partB" && <Field label="New vehicle no." required error={s.errors.vehicleNo}>{(p) => <Input {...p} className="uppercase" value={f.vehicleNo} onChange={(e) => setF({ ...f, vehicleNo: e.target.value })} />}</Field>}
        {mode.kind === "extend" && <Field label="Distance still to go (km)" required>{(p) => <Input {...p} inputMode="numeric" value={f.remainingKm} onChange={(e) => setF({ ...f, remainingKm: e.target.value.replace(/\D/g, "") })} />}</Field>}
        {mode.kind !== "cancel" && <Field label="Current place" required>{(p) => <Input {...p} value={f.fromPlace} onChange={(e) => setF({ ...f, fromPlace: e.target.value })} />}</Field>}
        <Field label="Reason">
          {(p) => (
            <Select {...p} value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })}>
              {Object.entries(reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Remark" required={mode.kind !== "partB"}>{(p) => <Input {...p} maxLength={50} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
