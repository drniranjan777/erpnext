"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ACC, MODES, MONEY, VOUCHER_PATH, type MoneyKind, type MoneyVoucher, type OpenBill } from "@/lib/accounting";
import { formatDate, formatMoney } from "@/lib/documents";

export function MoneyDetail({ kind }: { kind: MoneyKind }) {
  const { id } = useParams<{ id: string }>();
  const m = MONEY[kind];
  const qc = useQueryClient();
  const key = [m.api, id];
  const q = useQuery({ queryKey: key, queryFn: () => api<MoneyVoucher>(`${m.api}/${id}`) });
  const [adjusting, setAdjusting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  async function cheque(status: "cleared" | "bounced") {
    setMsg(null);
    try {
      await api(`${m.api}/${d.id}/cheque`, { body: { status } });
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: m.route, label: m.title }}
        badges={<>{d.mode === "write_off" && <Badge tone="danger">Write-off</Badge>}{d.chequeStatus && <Badge tone={d.chequeStatus === "bounced" ? "danger" : d.chequeStatus === "pending" ? "warning" : "success"}>Cheque {d.chequeStatus}</Badge>}</>}
        subtitle={`${d.party?.name ?? d.counterAccount?.name ?? ""} · ${formatMoney(d.amount)}`}
        actions={
          <>
            {d.canCheque && (
              <>
                <Button variant="secondary" onClick={() => cheque("cleared")}>Cheque cleared</Button>
                <Button variant="ghost" onClick={() => cheque("bounced")}>Bounced</Button>
              </>
            )}
            {d.canAdjust && <Button variant="secondary" onClick={() => setAdjusting(true)}>Adjust advance</Button>}
            <DocumentActions doc={d} apiBase={m.api} routeBase={m.route} queryKey={key} hideEdit />
          </>
        }
      />
      {msg && <Alert>{msg}</Alert>}
      <DocStatusAlerts doc={d} approvedNote="Posted to the ledger." />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label={kind === "receipt" ? "From" : kind === "payment" ? "To" : "To account"} value={d.party ? <Link href={`${ACC}/statement/${d.party.id}`} className="text-primary hover:underline">{d.party.name}</Link> : d.counterAccount?.name} />
          <Info label={kind === "receipt" ? "Into" : "From"} value={d.account ? `${d.account.code} ${d.account.name}` : null} />
          <Info label="Mode" value={`${MODES[d.mode] ?? d.mode}${d.instrumentNo ? ` ${d.instrumentNo}` : ""}${d.instrumentDate ? ` dated ${formatDate(d.instrumentDate)}` : ""}`} />
          <Info label="Reference" value={d.reference} />
          <Info label="Amount" value={formatMoney(d.amount)} />
          {Number(d.bankCharges) > 0 && <Info label="Bank charges" value={formatMoney(d.bankCharges)} />}
          {Number(d.tdsDeducted) > 0 && <Info label="TDS deducted" value={formatMoney(d.tdsDeducted)} />}
          {d.party && <Info label="Settled" value={formatMoney(d.settledAmount)} />}
          {d.party && <Info label="On account" value={Number(d.onAccount) ? formatMoney(d.onAccount) : "—"} />}
        </dl>
        {d.narration && <p className="border-t border-border px-5 py-3 text-sm">{d.narration}</p>}
      </Card>
      {d.allocations.length > 0 && (
        <Card>
          <CardHeader title="Bills settled" />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {d.allocations.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2">
                <Link href={`${VOUCHER_PATH[a.docType] ?? ""}/${a.againstDocId}`} className="font-mono text-primary hover:underline">{a.number}</Link>
                <span className="text-muted">{formatDate(a.docDate)}{a.adjustmentId && " · adjusted later"}</span>
                <span className="tabular-nums">{formatMoney(a.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4"><ActivityFeed documentId={d.id} /></div>
      </Card>
      {adjusting && <AdjustDialog voucher={d} onClose={() => setAdjusting(false)} onDone={() => qc.invalidateQueries({ queryKey: key })} />}
    </div>
  );
}

function AdjustDialog({ voucher, onClose, onDone }: { voucher: MoneyVoucher; onClose: () => void; onDone: () => void }) {
  const side = voucher.kind === "receipt" ? "receivable" : "payable";
  const bills = useQuery({ queryKey: [ACC, "open-bills", voucher.party!.id, side], queryFn: () => api<{ bills: OpenBill[] }>(`${ACC}/open-bills`, { query: { partyId: voucher.party!.id, side } }) });
  const [billId, setBill] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api(`${MONEY[voucher.kind].api}/${voucher.id}/adjust`, { body: { againstDocId: billId, amount } });
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
      open
      onClose={onClose}
      title="Adjust the advance against a bill"
      description={`₹${Number(voucher.onAccount).toFixed(2)} of ${voucher.displayNumber} is on account. A journal moves it onto the bill.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!billId || !Number(amount)} onClick={go}>Adjust</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Bill">
          {(f) => (
            <Select {...f} value={billId} onChange={(e) => { setBill(e.target.value); const b = bills.data?.bills.find((x) => x.id === e.target.value); if (b) setAmount(String(Math.min(Number(b.outstanding), Number(voucher.onAccount)))); }}>
              <option value="">Choose…</option>
              {(bills.data?.bills ?? []).map((b) => <option key={b.id} value={b.id}>{b.number} · {formatMoney(b.outstanding)} open</option>)}
            </Select>
          )}
        </Field>
        <Field label="Amount">{(f) => <Input {...f} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
