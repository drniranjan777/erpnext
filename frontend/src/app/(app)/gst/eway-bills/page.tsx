"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/documents";
import { SUB_SUPPLY, type EwayBill } from "@/lib/gst";

const PATHS: Record<string, string> = { sales_invoice: "/sales/invoices", delivery_note: "/sales/deliveries", job_work_challan: "/job-work/challans" };

export default function EwayBillsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("active");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [consolidating, setConsolidating] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["gst", "ewbs", status], queryFn: () => api<{ items: EwayBill[] }>("/gst/eway-bills", { query: { status: status || undefined } }) });
  const rows = q.data?.items ?? [];
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="e-Way bills"
        description="Bills for goods on the move, with validity, vehicles and consolidation. Generate them from an invoice, delivery note or job-work challan."
        actions={can("gst.einvoice.manage") && picked.size > 1 ? <Button onClick={() => setConsolidating(true)}>Consolidate {picked.size}</Button> : undefined}
      />
      {done && <Alert tone="success">{done}</Alert>}
      <Card>
        <div className="grid gap-4 border-b border-border px-5 py-4 sm:grid-cols-4">
          <Field label="Show">
            {(f) => (
              <Select {...f} value={status} onChange={(e) => { setStatus(e.target.value); setPicked(new Set()); }}>
                <option value="active">Active</option>
                <option value="expiring">Expiring within 8 hours</option>
                <option value="cancelled">Cancelled</option>
                <option value="">All</option>
              </Select>
            )}
          </Field>
        </div>
        {q.isLoading && <LoadingBlock />}
        {q.error && <div className="p-5"><ErrorBlock error={q.error} /></div>}
        {q.data && !rows.length && <EmptyState title="No e-way bills" description="Generate one from a posted invoice, delivery note or job-work challan." />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-10 px-4 py-2.5" />
                  <th className="px-4 py-2.5 font-medium">EWB no.</th>
                  <th className="px-4 py-2.5 font-medium">Document</th>
                  <th className="px-4 py-2.5 font-medium">To</th>
                  <th className="px-4 py-2.5 font-medium">Vehicle</th>
                  <th className="px-4 py-2.5 font-medium">Valid until</th>
                  <th className="px-4 py-2.5 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">
                      {r.status === "active" && <input type="checkbox" aria-label={`Select ${r.ewbNo}`} checked={picked.has(r.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono">{r.ewbNo}</span>
                      <p className="text-xs text-muted">{formatDateTime(r.ewbDate)} · {SUB_SUPPLY[r.subSupplyType] ?? r.subSupplyType}</p>
                      {r.consolidatedNo && <Badge className="mt-1">CEWB {r.consolidatedNo}</Badge>}
                    </td>
                    <td className="px-4 py-3">{r.document && PATHS[r.document.docType] ? <Link href={`${PATHS[r.document.docType]}/${r.document.id}`} className="text-primary hover:underline">{r.document.number}</Link> : r.docNo}</td>
                    <td className="px-4 py-3"><span className="font-mono text-xs">{r.toGstin}</span><p className="text-xs text-muted">{r.toPincode} · {r.distanceKm} km</p></td>
                    <td className="px-4 py-3 font-mono text-xs">{r.vehicleNo ?? <span className="font-sans text-warning">Part-B pending</span>}</td>
                    <td className="px-4 py-3">
                      {r.status === "cancelled" ? <Badge>Cancelled</Badge> : r.expired ? <Badge tone="danger">Expired</Badge> : r.validUntil ? formatDateTime(r.validUntil) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(r.totalValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {consolidating && (
        <ConsolidateDialog
          ids={[...picked]}
          onClose={() => setConsolidating(false)}
          onDone={(no) => {
            setDone(`Consolidated e-way bill ${no} created for ${picked.size} consignments.`);
            setPicked(new Set());
            qc.invalidateQueries({ queryKey: ["gst", "ewbs"] });
          }}
        />
      )}
    </div>
  );
}

function ConsolidateDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (no: string) => void }) {
  const [vehicleNo, setVehicle] = useState("");
  const [fromPlace, setPlace] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ consolidatedNo: string }>("/gst/eway-bills/consolidate", { body: { ids, vehicleNo, fromPlace } });
      onDone(r.consolidatedNo);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Consolidated e-way bill"
      description={`${ids.length} consignments travelling together on one vehicle.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button loading={busy} disabled={!vehicleNo || !fromPlace} onClick={go}>Consolidate</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Vehicle no." required>{(f) => <Input {...f} className="uppercase" value={vehicleNo} onChange={(e) => setVehicle(e.target.value)} />}</Field>
        <Field label="Starting from" required>{(f) => <Input {...f} value={fromPlace} onChange={(e) => setPlace(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
