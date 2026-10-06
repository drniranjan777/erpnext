"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Mail, Star } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts } from "@/components/documents/doc-page";
import { ActivityFeed } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { PO_ROUTE, RFQ_API, RFQ_ROUTE, rfqKeys, type Comparison, type Rfq } from "@/lib/purchase";

export default function RfqPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const rfq = useQuery({ queryKey: rfqKeys.detail(id), queryFn: () => api<Rfq>(`${RFQ_API}/${id}`) });
  const cmp = useQuery({ queryKey: [...rfqKeys.detail(id), "comparison"], queryFn: () => api<Comparison>(`${RFQ_API}/${id}/comparison`), enabled: !!rfq.data && rfq.data.status !== "draft" });
  const [quoting, setQuoting] = useState<string | null>(null);
  const [award, setAward] = useState<Record<string, string>>({});
  const refresh = () => {
    qc.invalidateQueries({ queryKey: rfqKeys.detail(id) });
  };
  const send = useMutation({ mutationFn: () => api<{ sent: number; withoutEmail: string[] }>(`${RFQ_API}/${id}/send`, { body: {} }), onSuccess: refresh });
  const doAward = useMutation({
    mutationFn: () => api<{ orders: { poId: string }[] }>(`${RFQ_API}/${id}/award`, { body: { lines: Object.entries(award).map(([rfqLineId, vendorId]) => ({ rfqLineId, vendorId })) } }),
    onSuccess: () => {
      setAward({});
      refresh();
      qc.invalidateQueries({ queryKey: [PO_ROUTE] });
    },
  });

  if (rfq.isLoading) return <LoadingBlock />;
  if (rfq.error) return <ErrorBlock error={rfq.error} />;
  const d = rfq.data!;
  const c = cmp.data;
  const vendorName = (vid: string) => d.vendors.find((v) => v.vendorId === vid)?.name ?? "";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: RFQ_ROUTE, label: "Requests for quotation" }}
        subtitle={`Quotes due ${formatDate(d.responseDueDate)}${d.deliveryWarehouse ? ` · deliver to ${d.deliveryWarehouse.code}` : ""}`}
        actions={
          <>
            {d.canQuote && (
              <Button variant="secondary" loading={send.isPending} onClick={() => send.mutate()}>
                <Mail className="size-4" aria-hidden /> Email vendors
              </Button>
            )}
            <DocumentActions doc={d} apiBase={RFQ_API} routeBase={RFQ_ROUTE} queryKey={rfqKeys.detail(id)} hideEdit />
          </>
        }
      />
      <DocStatusAlerts doc={d} approvedNote="Issued. Email it to vendors, record their quotes, then compare and award." />
      {send.data && (
        <Alert tone="success">
          Emailed {send.data.sent} vendor{send.data.sent === 1 ? "" : "s"}.{send.data.withoutEmail.length > 0 && ` No email address for: ${send.data.withoutEmail.join(", ")}.`}
        </Alert>
      )}
      {(send.error || doAward.error) && <Alert>{((send.error ?? doAward.error) as Error).message}</Alert>}
      {doAward.data && (
        <Alert tone="success">
          Draft purchase order{doAward.data.orders.length === 1 ? "" : "s"} created:{" "}
          {doAward.data.orders.map((o, i) => (
            <span key={o.poId}>
              {i > 0 && ", "}
              <Link href={`${PO_ROUTE}/${o.poId}`} className="font-medium underline">
                open order {i + 1}
              </Link>
            </span>
          ))}
          . Review and submit them.
        </Alert>
      )}

      <Card>
        <CardHeader title="Vendors" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {d.vendors.map((v) => (
            <li key={v.vendorId} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1 font-medium">{v.name}</span>
              <span className="text-xs text-muted">{v.email ?? "no email"}</span>
              {v.sentAt && <Badge>Sent {formatDateTime(v.sentAt)}</Badge>}
              {v.respondedAt ? <Badge tone="success">Quoted{v.quoteRef ? ` · ${v.quoteRef}` : ""}</Badge> : <Badge tone="warning">Awaiting quote</Badge>}
              {d.canQuote && (
                <Button size="sm" variant="ghost" onClick={() => setQuoting(v.vendorId)}>
                  {v.respondedAt ? "Edit quote" : "Enter quote"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {c && (
        <Card>
          <CardHeader
            title="Comparison"
            description="Net rate after discount. The suggestion weighs price 70%, the vendor's acceptance rate 20% and on-time delivery 10%."
            action={
              d.canAward && Object.keys(award).length > 0 ? (
                <Button loading={doAward.isPending} onClick={() => doAward.mutate()}>
                  <Award className="size-4" aria-hidden /> Award {Object.keys(award).length} line{Object.keys(award).length === 1 ? "" : "s"}
                </Button>
              ) : undefined
            }
          />
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Item</th>
                  {c.vendors.map((v) => (
                    <th key={v.vendorId} className="px-4 py-2 text-right font-medium">
                      {v.name}
                      {v.performance?.score !== null && v.performance?.score !== undefined && <span className="block font-normal normal-case">score {v.performance.score}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {c.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3 align-top">
                      {l.description}
                      <p className="text-xs text-muted">
                        {formatQty(l.qty)} {l.uom}
                        {l.awardedVendorId && ` · awarded to ${vendorName(l.awardedVendorId)}`}
                      </p>
                    </td>
                    {c.vendors.map((v) => {
                      const o = l.offers.find((x) => x.vendorId === v.vendorId);
                      const chosen = award[l.id] === v.vendorId;
                      return (
                        <td key={v.vendorId} className={`px-4 py-3 text-right align-top ${o?.lowest ? "bg-success-soft/60" : ""}`}>
                          {o ? (
                            <button
                              type="button"
                              disabled={!d.canAward || !!l.awardedVendorId}
                              onClick={() => setAward((a) => ({ ...a, [l.id]: v.vendorId }))}
                              className={`w-full rounded-lg px-2 py-1 text-right tabular-nums disabled:cursor-default ${chosen ? "ring-2 ring-primary" : "hover:bg-surface-muted"}`}
                            >
                              <span className="font-medium">{formatMoney(o.netRate)}</span>
                              {Number(o.discountPct) > 0 && <span className="block text-xs text-muted">{formatMoney(o.rate)} −{Number(o.discountPct)}%</span>}
                              <span className="block text-xs text-muted">
                                {formatMoney(o.amount)}
                                {o.leadTimeDays !== null && ` · ${o.leadTimeDays} days`}
                              </span>
                              {l.recommendedVendorId === v.vendorId && (
                                <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary">
                                  <Star className="size-3" aria-hidden /> suggested
                                </span>
                              )}
                            </button>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border text-xs">
                <tr>
                  <td className="px-4 py-2 font-medium">Total incl. other charges</td>
                  {c.vendors.map((v) => (
                    <td key={v.vendorId} className="px-4 py-2 text-right font-medium tabular-nums">
                      {v.linesQuoted ? formatMoney(v.total) : "—"}
                    </td>
                  ))}
                </tr>
                <tr className="text-muted">
                  <td className="px-4 py-1">Terms</td>
                  {c.vendors.map((v) => (
                    <td key={v.vendorId} className="px-4 py-1 text-right">
                      {[v.creditDays !== null && `${v.creditDays} days credit`, v.paymentTerms, v.deliveryTerms, v.validUntil && `valid to ${formatDate(v.validUntil)}`].filter(Boolean).join(" · ") || "—"}
                    </td>
                  ))}
                </tr>
                <tr className="text-muted">
                  <td className="px-4 py-1">Track record</td>
                  {c.vendors.map((v) => (
                    <td key={v.vendorId} className="px-4 py-1 text-right">
                      {v.performance?.receipts ? `${v.performance.acceptancePct ?? "—"}% accepted · ${v.performance.onTimePct ?? "—"}% on time` : "No receipts yet"}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          {d.canAward && <p className="border-t border-border px-5 py-3 text-xs text-muted">Click a quote to award that line; one draft order is created per vendor.</p>}
        </Card>
      )}

      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4">
          <ActivityFeed documentId={d.id} />
        </div>
      </Card>
      {quoting && <QuoteDialog rfq={d} vendorId={quoting} onClose={() => setQuoting(null)} onSaved={() => { setQuoting(null); refresh(); }} />}
    </div>
  );
}

function QuoteDialog({ rfq, vendorId, onClose, onSaved }: { rfq: Rfq; vendorId: string; onClose: () => void; onSaved: () => void }) {
  const vendor = rfq.vendors.find((v) => v.vendorId === vendorId)!;
  const [h, setH] = useState({ quoteRef: vendor.quoteRef ?? "", validUntil: "", creditDays: "", paymentTerms: "", deliveryTerms: "", otherCharges: "" });
  const [rates, setRates] = useState<Record<string, { rate: string; discountPct: string; leadTimeDays: string }>>(() => Object.fromEntries(rfq.lines.map((l) => [l.id, { rate: "", discountPct: "", leadTimeDays: "" }])));
  const save = useMutation({
    mutationFn: () =>
      api(`${RFQ_API}/${rfq.id}/quotes/${vendorId}`, {
        method: "PUT",
        body: {
          quoteRef: h.quoteRef || null,
          validUntil: h.validUntil || null,
          creditDays: h.creditDays ? Number(h.creditDays) : null,
          paymentTerms: h.paymentTerms || null,
          deliveryTerms: h.deliveryTerms || null,
          otherCharges: h.otherCharges || null,
          lines: rfq.lines.map((l) => ({ rfqLineId: l.id, rate: rates[l.id].rate || null, discountPct: rates[l.id].discountPct || null, leadTimeDays: rates[l.id].leadTimeDays ? Number(rates[l.id].leadTimeDays) : null })),
        },
      }),
    onSuccess: onSaved,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={`Quote from ${vendor.name}`}
      description="Leave a rate blank if the vendor didn't quote that item."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save quote
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : "Could not save."}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Quotation ref.">{(p) => <Input {...p} value={h.quoteRef} onChange={(e) => setH({ ...h, quoteRef: e.target.value })} />}</Field>
          <Field label="Valid until">{(p) => <Input {...p} type="date" value={h.validUntil} onChange={(e) => setH({ ...h, validUntil: e.target.value })} />}</Field>
          <Field label="Credit days">{(p) => <Input {...p} inputMode="numeric" value={h.creditDays} onChange={(e) => setH({ ...h, creditDays: e.target.value.replace(/\D/g, "") })} />}</Field>
          <Field label="Payment terms">{(p) => <Input {...p} value={h.paymentTerms} onChange={(e) => setH({ ...h, paymentTerms: e.target.value })} />}</Field>
          <Field label="Delivery terms">{(p) => <Input {...p} placeholder="Ex-works / delivered" value={h.deliveryTerms} onChange={(e) => setH({ ...h, deliveryTerms: e.target.value })} />}</Field>
          <Field label="Other charges (₹)">{(p) => <Input {...p} inputMode="decimal" placeholder="Freight, packing…" value={h.otherCharges} onChange={(e) => setH({ ...h, otherCharges: e.target.value })} />}</Field>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2 font-medium">Item</th>
              <th className="w-32 py-2 font-medium">Rate (₹)</th>
              <th className="w-24 py-2 font-medium">Disc %</th>
              <th className="w-28 py-2 font-medium">Lead days</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rfq.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-2">
                  {l.description}
                  <span className="block text-xs text-muted">
                    {formatQty(l.qty)} {l.uomCode}
                  </span>
                </td>
                {(["rate", "discountPct", "leadTimeDays"] as const).map((f) => (
                  <td key={f} className="py-2 pr-2">
                    <Input className="h-9 text-right" inputMode="decimal" aria-label={`${l.description} ${f}`} value={rates[l.id][f]} onChange={(e) => setRates({ ...rates, [l.id]: { ...rates[l.id], [f]: e.target.value } })} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
