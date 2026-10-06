"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QrCode, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { IRN_CANCEL_REASONS, type EInvoiceStatus } from "@/lib/gst";

const TONE = { generated: "success", pending: "warning", failed: "danger", cancelled: "neutral" } as const;

/** IRN state of an approved invoice / credit note, with generate and cancel. */
export function EInvoicePanel({ documentId, onChange }: { documentId: string; onChange?: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const key = ["gst", "einvoice", documentId];
  const s = useQuery({
    queryKey: key,
    queryFn: () => api<EInvoiceStatus>(`/gst/einvoice/${documentId}`),
    refetchInterval: (q) => (q.state.data?.irnStatus === "pending" ? 2000 : false),
  });
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    onChange?.();
  };
  const generate = useMutation({
    mutationFn: () => api<EInvoiceStatus>(`/gst/einvoice/${documentId}/generate`, { method: "POST" }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      refresh();
    },
  });
  const d = s.data;
  if (!d || (!d.enabled && !d.irn)) return null;
  const manage = can("gst.einvoice.manage");
  return (
    <Card>
      <CardHeader
        title="e-Invoice (IRN)"
        description={d.applicable ? "Registered on the Invoice Registration Portal through the GSP." : (d.reason ?? undefined)}
        action={d.irnStatus ? <Badge tone={TONE[d.irnStatus]}>{d.irnStatus === "generated" ? "Registered" : d.irnStatus === "pending" ? "Queued" : d.irnStatus === "failed" ? "Failed" : "Cancelled"}</Badge> : undefined}
      />
      <div className="space-y-3 px-5 pb-5">
        {error && <Alert>{error}</Alert>}
        {d.irnStatus === "failed" && d.irnError && !error && <Alert>{d.irnError}</Alert>}
        {d.irn ? (
          <div className="flex flex-wrap items-start gap-5">
            {d.qrDataUri && d.irnStatus === "generated" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.qrDataUri} alt="Signed e-invoice QR code" className="size-32 rounded border border-border bg-white p-1" />
            )}
            <dl className="min-w-0 flex-1 space-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted">IRN</dt>
                <dd className="break-all font-mono text-xs">{d.irn}</dd>
              </div>
              <div className="flex flex-wrap gap-6">
                <div>
                  <dt className="text-xs text-muted">Ack no.</dt>
                  <dd className="font-mono">{d.ackNo}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Ack date</dt>
                  <dd>{formatDateTime(d.ackDate)}</dd>
                </div>
                {d.irnCancelledAt && (
                  <div>
                    <dt className="text-xs text-muted">Cancelled</dt>
                    <dd>{formatDateTime(d.irnCancelledAt)}</dd>
                  </div>
                )}
              </div>
              {d.cancellableUntil && manage && (
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Button size="sm" variant="secondary" onClick={() => setCancelling(true)}>
                    <XCircle className="size-4" aria-hidden /> Cancel IRN
                  </Button>
                  <span className="text-xs text-muted">Possible until {formatDateTime(d.cancellableUntil)}; after that, issue a credit note.</span>
                </div>
              )}
            </dl>
          </div>
        ) : d.applicable && manage ? (
          <Button loading={generate.isPending || d.irnStatus === "pending"} onClick={() => generate.mutate()}>
            {d.irnStatus === "failed" ? <RefreshCw className="size-4" aria-hidden /> : <QrCode className="size-4" aria-hidden />}
            {d.irnStatus === "failed" ? "Retry IRN" : "Generate IRN"}
          </Button>
        ) : null}
        {d.log.length > 0 && (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Portal log ({d.log.length})</summary>
            <ul className="mt-2 space-y-1">
              {d.log.map((l) => (
                <li key={l.id}>
                  {formatDateTime(l.createdAt)} · {l.action.replace("_", " ")} · {l.ok ? "OK" : <span className="text-danger">{l.errorCode}: {l.errorMessage}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <CancelIrnDialog open={cancelling} documentId={documentId} onClose={() => setCancelling(false)} onDone={refresh} />
    </Card>
  );
}

function CancelIrnDialog({ open, documentId, onClose, onDone }: { open: boolean; documentId: string; onClose: () => void; onDone: () => void }) {
  const [reasonCode, setReason] = useState<keyof typeof IRN_CANCEL_REASONS>("2");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api(`/gst/einvoice/${documentId}/cancel`, { body: { reasonCode, remark } });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cancel the e-invoice"
      description="The IRN is cancelled on the portal. The invoice number cannot be registered again; cancel the invoice afterwards and issue a new one."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Keep it</Button>
          <Button variant="danger" loading={busy} disabled={remark.trim().length < 3} onClick={go}>Cancel IRN</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Reason">
          {(f) => (
            <Select {...f} value={reasonCode} onChange={(e) => setReason(e.target.value as keyof typeof IRN_CANCEL_REASONS)}>
              {Object.entries(IRN_CANCEL_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Remark" required>{(f) => <Input {...f} maxLength={100} value={remark} onChange={(e) => setRemark(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
