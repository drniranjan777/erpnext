"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError, apiUpload } from "@/lib/api";
import { ACC, VOUCHER_LABEL, VOUCHER_PATH, type AccountRow, type MoneyAccount } from "@/lib/accounting";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";
import { DataTable } from "@/components/ui/data-table";

interface Line { id: string; txnDate: string; description: string; reference: string | null; withdrawal: string; deposit: string; balance: string | null; status: "unmatched" | "matched" | "ignored"; matchedBy: string | null; entries: { entryId: string; voucherId: string; voucherType: string; voucherNumber: string | null }[] }
interface Entry { id: string; postingDate: string; amount: string; voucherId: string; voucherType: string; voucherNumber: string | null; narration: string | null; party: string | null }
interface Lines { lines: Line[]; openEntries: Entry[]; totalLines: number; matchedLines: number; matchRate: number | null }
interface Brs { balanceAsPerBooks: string; depositsNotCredited: { total: string }; paymentsNotPresented: { total: string }; expectedBankBalance: string; statementBalance: string | null; statementDate: string | null; difference: string | null; unrecordedInBooks: { deposits: string; withdrawals: string; lines: number } }

export default function BankReconciliationPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const banks = useQuery({ queryKey: [ACC, "money-accounts"], queryFn: () => api<MoneyAccount[]>(`${ACC}/money-accounts`) });
  const bankList = (banks.data ?? []).filter((b) => b.accountType === "bank");
  const [chosen, setChosen] = useState("");
  const id = chosen || bankList[0]?.id || "";
  const [status, setStatus] = useState<"" | "unmatched" | "matched" | "ignored">("unmatched");
  const [asOf, setAsOf] = useState(todayIST());
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [matching, setMatching] = useState<Line | null>(null);
  const [recording, setRecording] = useState<Line | null>(null);
  const lines = useQuery({ queryKey: [ACC, "bank", id, status], queryFn: () => api<Lines>(`${ACC}/bank/${id}/lines`, { query: { status: status || undefined } }), enabled: !!id });
  const brs = useQuery({ queryKey: [ACC, "brs", id, asOf], queryFn: () => api<Brs>(`${ACC}/bank/${id}/brs`, { query: { asOf } }), enabled: !!id });
  const refresh = () => qc.invalidateQueries({ queryKey: [ACC] });
  const reconcile = can("accounting.bank.reconcile");

  async function upload(f: File) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiUpload<{ imported: number; duplicates: number; matched: number; matchRate: number | null }>(`${ACC}/bank/${id}/statement`, f);
      setMsg({ tone: "success", text: `${r.imported} line(s) imported${r.duplicates ? `, ${r.duplicates} already there` : ""}; ${r.matched} matched automatically. Match rate ${r.matchRate ?? 0}%.` });
      refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  async function act(path: string, text: string) {
    setMsg(null);
    try {
      await api(path, { method: "POST" });
      setMsg({ tone: "success", text });
      refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }
  const b = brs.data;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Bank reconciliation"
        description="Import the bank statement (CSV, Excel or MT940); lines are matched to your receipts and payments by reference, amount and date."
        actions={
          reconcile && id ? (
            <>
              <input ref={file} type="file" className="hidden" accept=".csv,.xlsx,.txt,.sta,.mt940" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button variant="secondary" onClick={() => act(`${ACC}/bank/${id}/auto-match`, "Matching run finished.")}><Wand2 className="size-4" aria-hidden /> Match again</Button>
              <Button loading={busy} onClick={() => file.current?.click()}><Upload className="size-4" aria-hidden /> Import statement</Button>
            </>
          ) : undefined
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {banks.data && !bankList.length && <Alert tone="warning">Add a bank account under Accounting → Chart of accounts → Bank accounts first.</Alert>}
      <Card>
        <div className="flex flex-wrap items-end gap-4 px-5 py-4">
          <Field label="Bank account">
            {(f) => (
              <Select {...f} value={id} onChange={(e) => setChosen(e.target.value)}>
                {bankList.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="As of">{(f) => <Input {...f} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />}</Field>
          {lines.data && <p className="pb-2 text-sm text-muted">{lines.data.matchedLines} of {lines.data.totalLines} statement lines matched{lines.data.matchRate !== null && ` (${lines.data.matchRate}%)`}</p>}
        </div>
        {b && (
          <dl className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div><dt className="text-xs text-muted">Balance as per books</dt><dd className="tabular-nums">{formatMoney(b.balanceAsPerBooks)}</dd></div>
            <div><dt className="text-xs text-muted">Less: deposits not yet credited</dt><dd className="tabular-nums">{formatMoney(b.depositsNotCredited.total)}</dd></div>
            <div><dt className="text-xs text-muted">Add: payments not yet presented</dt><dd className="tabular-nums">{formatMoney(b.paymentsNotPresented.total)}</dd></div>
            <div><dt className="text-xs text-muted">Expected bank balance</dt><dd className="font-medium tabular-nums">{formatMoney(b.expectedBankBalance)}</dd></div>
            <div><dt className="text-xs text-muted">Statement balance{b.statementDate && ` (${formatDate(b.statementDate)})`}</dt><dd className="tabular-nums">{b.statementBalance === null ? "—" : formatMoney(b.statementBalance)}</dd></div>
            <div><dt className="text-xs text-muted">Difference</dt><dd>{b.difference === null ? "—" : Number(b.difference) === 0 ? <Badge tone="success">Reconciled</Badge> : <span className="tabular-nums text-danger">{formatMoney(b.difference)}</span>}</dd></div>
          </dl>
        )}
        {b && b.unrecordedInBooks.lines > 0 && <p className="border-t border-border px-5 py-2 text-sm text-warning">{b.unrecordedInBooks.lines} statement line(s) are not in the books yet (charges, interest, direct credits): record them below.</p>}
      </Card>
      <Card>
        <CardHeader
          title="Statement lines"
          action={
            <Select className="h-9 w-40" aria-label="Filter lines" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="unmatched">Unmatched</option>
              <option value="matched">Matched</option>
              <option value="ignored">Ignored</option>
              <option value="">All</option>
            </Select>
          }
        />
        {lines.isLoading && <LoadingBlock />}
        {lines.error && <div className="p-5"><ErrorBlock error={lines.error} /></div>}
        {lines.data && !lines.data.lines.length && <EmptyState title="No lines" description={status === "unmatched" ? "Everything imported is matched." : "Import a statement to start."} />}
        {!!lines.data?.lines.length && (
          <DataTable
            rows={lines.data.lines}
            rowKey={(l) => String(l.id)}
            exportName="accounting-bank"
            storageKey="accounting-bank-0"
            columns={[
              { key: "date", label: "Date", locked: true, className: "text-muted", render: (l) => <>{formatDate(l.txnDate)}</> },
              { key: "narration", label: "Narration", className: "max-w-md whitespace-normal", render: (l) => <>{l.description}{l.reference && <span className="block font-mono text-xs text-muted">{l.reference}</span>}</> },
              { key: "withdrawal", label: "Withdrawal", align: "right", render: (l) => <>{Number(l.withdrawal) ? formatMoney(l.withdrawal) : ""}</> },
              { key: "deposit", label: "Deposit", align: "right", render: (l) => <>{Number(l.deposit) ? formatMoney(l.deposit) : ""}</> },
              { key: "matched-to", label: "Matched to", className: "whitespace-normal", render: (l) => <>{l.entries.map((e) => <Link key={e.entryId} href={`${VOUCHER_PATH[e.voucherType] ?? ""}/${e.voucherId}`} className="mr-2 font-mono text-primary hover:underline">{e.voucherNumber}</Link>)}
                                {l.status === "matched" && <Badge className="ml-1">{l.matchedBy}</Badge>}
                                {l.status === "ignored" && <Badge>Ignored</Badge>}</> },
              { key: "col5", label: "", align: "right", noSort: true, render: (l) => <>{reconcile && l.status === "unmatched" && (
                                  <>
                                    <Button size="sm" variant="ghost" onClick={() => setMatching(l)}>Match</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setRecording(l)}>Record</Button>
                                    <Button size="sm" variant="ghost" onClick={() => act(`${ACC}/bank/lines/${l.id}/ignore`, "Line ignored.")}>Ignore</Button>
                                  </>
                                )}
                                {reconcile && l.status !== "unmatched" && <Button size="sm" variant="ghost" onClick={() => act(`${ACC}/bank/lines/${l.id}/unmatch`, "Line reopened.")}>Undo</Button>}</> },
            ]}
          />
        )}
      </Card>
      {matching && lines.data && <MatchDialog line={matching} entries={lines.data.openEntries} onClose={() => setMatching(null)} onDone={refresh} />}
      {recording && <RecordDialog line={recording} onClose={() => setRecording(null)} onDone={refresh} />}
    </div>
  );
}

function MatchDialog({ line, entries, onClose, onDone }: { line: Line; entries: Entry[]; onClose: () => void; onDone: () => void }) {
  const want = Number(line.deposit) - Number(line.withdrawal);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const sameSide = entries.filter((e) => Math.sign(Number(e.amount)) === Math.sign(want));
  const sum = sameSide.filter((e) => picked.has(e.id)).reduce((s, e) => s + Number(e.amount), 0);
  async function go() {
    setError(null);
    try {
      await api(`${ACC}/bank/match`, { body: { lineId: line.id, entryIds: [...picked] } });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title="Match statement line"
      description={`${formatDate(line.txnDate)} · ${line.description} · ${formatMoney(Math.abs(want))} ${want > 0 ? "in" : "out"}`}
      footer={
        <>
          <span className={`mr-auto text-sm ${Math.abs(sum - want) < 0.005 ? "text-success" : "text-muted"}`}>Selected {formatMoney(Math.abs(sum))}</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={Math.abs(sum - want) >= 0.005} onClick={go}>Match</Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <ul className="max-h-96 divide-y divide-border overflow-y-auto text-sm">
        {sameSide.map((e) => (
          <li key={e.id} className="flex items-center gap-3 py-2">
            <input type="checkbox" aria-label={`Select ${e.voucherNumber}`} checked={picked.has(e.id)} onChange={(ev) => setPicked((p) => { const n = new Set(p); if (ev.target.checked) n.add(e.id); else n.delete(e.id); return n; })} />
            <span className="w-24 text-muted">{formatDate(e.postingDate)}</span>
            <span className="min-w-0 flex-1">{VOUCHER_LABEL[e.voucherType] ?? e.voucherType} <span className="font-mono">{e.voucherNumber}</span>{e.party && <span className="text-muted"> · {e.party}</span>}</span>
            <span className="tabular-nums">{formatMoney(Math.abs(Number(e.amount)))}</span>
          </li>
        ))}
        {!sameSide.length && <li className="py-3 text-muted">No open entries on this side of the account.</li>}
      </ul>
    </Dialog>
  );
}

function RecordDialog({ line, onClose, onDone }: { line: Line; onClose: () => void; onDone: () => void }) {
  const accounts = useQuery({ queryKey: [ACC, "accounts"], queryFn: () => api<AccountRow[]>(`${ACC}/accounts`) });
  const deposit = Number(line.deposit) > 0;
  const [counter, setCounter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const choices = (accounts.data ?? []).filter((a) => !a.isGroup && (deposit ? a.nature === "income" || a.nature === "liability" : a.nature === "expense" || a.nature === "asset") && !["receivable", "payable", "stock", "grni"].includes(a.systemKey ?? ""));
  async function go() {
    setError(null);
    try {
      await api(`${ACC}/bank/lines/${line.id}/record`, { body: { counterAccountId: counter } });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={deposit ? "Record a receipt for this line" : "Record a payment for this line"}
      description={`${formatDate(line.txnDate)} · ${line.description} · ${formatMoney(deposit ? line.deposit : line.withdrawal)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!counter} onClick={go}>Record and match</Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <Field label={deposit ? "Income / other account" : "Expense / other account"}>
        {(f) => (
          <Select {...f} value={counter} onChange={(e) => setCounter(e.target.value)}>
            <option value="">Choose…</option>
            {choices.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </Select>
        )}
      </Field>
    </Dialog>
  );
}
