"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";

interface Company { id: string; name: string; partyId: string | null; party: string | null }
interface Txn { id: string; number: string; txnDate: string; kind: string; amount: number; description: string; from: string; to: string; fromJournal: string | null; toJournal: string | null }
interface Rec { a: string; b: string; aSaysB: number; bSaysA: number; difference: number; matched: boolean }
interface Account { id: string; code: string; name: string; accountType: string | null; isGroup: boolean }

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Inter-company transactions mirrored in both companies' books, and the reconciliation. */
export default function IntercompanyPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("finance.group.manage");
  const companies = useQuery({ queryKey: ["/finance/companies"], queryFn: () => api<Company[]>("/finance/companies") });
  const txns = useQuery({ queryKey: ["/finance/intercompany"], queryFn: () => api<Txn[]>("/finance/intercompany") });
  const rec = useQuery({ queryKey: ["/finance/intercompany/reconciliation"], queryFn: () => api<Rec[]>("/finance/intercompany/reconciliation") });
  const [f, setF] = useState(() => ({ txnDate: new Date().toISOString().slice(0, 10), fromCompanyId: "", toCompanyId: "", kind: "charge", amount: "", description: "", fromAccountId: "", toAccountId: "" }));
  const cash = f.kind === "loan" || f.kind === "repayment";
  const banks = (companyId: string) => ({ queryKey: ["/accounting/accounts", companyId], queryFn: () => api<Account[]>("/accounting/accounts", { query: { companyId } }), enabled: cash && !!companyId });
  const fromAcc = useQuery(banks(f.fromCompanyId));
  const toAcc = useQuery(banks(f.toCompanyId));
  const [linking, setLinking] = useState<Record<string, PickedParty | null>>({});
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/finance"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const bankList = (l?: Account[]) => l?.filter((x) => !x.isGroup && x.accountType === "bank") ?? [];
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Inter-company" description="Charges, sales, loans and repayments between group companies, posted in the sender's books and mirrored in the receiver's at once; each company sees the other through the party linked to it." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Companies and their parties" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {companies.data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className="w-64 font-medium">{c.name}</span>
              {c.party ? <Badge tone="success">{c.party}</Badge> : <Badge tone="warning">not linked</Badge>}
              {manage && (
                <span className="flex flex-1 items-center gap-2">
                  <span className="flex-1"><PartyPicker role="customer" value={linking[c.id] ?? null} onChange={(p) => setLinking({ ...linking, [c.id]: p })} /></span>
                  <Button size="sm" variant="secondary" disabled={!linking[c.id]} onClick={() => run(() => api("/finance/intercompany/links", { body: { companyId: c.id, partyId: linking[c.id]!.id } }), "Linked.")}>Link</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Reconciliation" description="What each company shows against the other; the two should cancel out." />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {rec.data?.map((r, i) => <li key={i} className="flex flex-wrap items-center gap-3 px-4 py-2"><Badge tone={r.matched ? "success" : "danger"}>{r.matched ? "matched" : `difference ${inr(r.difference)}`}</Badge><span>{r.a} shows {inr(r.aSaysB)} with {r.b}</span><span>{r.b} shows {inr(r.bSaysA)} with {r.a}</span></li>)}
          {rec.data && !rec.data.length && <li className="px-4 py-4 text-center text-muted">No inter-company balances.</li>}
        </ul>
      </Card>
      {manage && (
        <Card>
          <CardHeader title="New inter-company transaction" />
          <div className="grid gap-2 border-t border-border p-4 text-sm sm:grid-cols-4">
            <Select aria-label="From" value={f.fromCompanyId} onChange={(e) => setF({ ...f, fromCompanyId: e.target.value, fromAccountId: "" })}><option value="">From company…</option>{companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Select aria-label="To" value={f.toCompanyId} onChange={(e) => setF({ ...f, toCompanyId: e.target.value, toAccountId: "" })}><option value="">To company…</option>{companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Select aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="charge">Charge (fee, cost recharge)</option><option value="sale">Sale</option><option value="loan">Loan</option><option value="repayment">Repayment (from repays to)</option><option value="other">Other</option></Select>
            <Input aria-label="Date" type="date" value={f.txnDate} onChange={(e) => setF({ ...f, txnDate: e.target.value })} />
            <Input aria-label="Amount" type="number" min={0} step="0.01" placeholder="Amount ₹" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <Input className="sm:col-span-3" aria-label="Description" placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            {cash && <Select aria-label="From bank" value={f.fromAccountId} onChange={(e) => setF({ ...f, fromAccountId: e.target.value })}><option value="">Sender’s bank…</option>{bankList(fromAcc.data).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</Select>}
            {cash && <Select aria-label="To bank" value={f.toAccountId} onChange={(e) => setF({ ...f, toAccountId: e.target.value })}><option value="">Receiver’s bank…</option>{bankList(toAcc.data).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</Select>}
            <Button disabled={!f.fromCompanyId || !f.toCompanyId || !Number(f.amount) || f.description.length < 3} onClick={() => run(() => api("/finance/intercompany", { body: { txnDate: f.txnDate, fromCompanyId: f.fromCompanyId, toCompanyId: f.toCompanyId, kind: f.kind, amount: Number(f.amount), description: f.description, fromAccountId: f.fromAccountId || null, toAccountId: f.toAccountId || null } }), "Posted in both companies.").then(() => setF({ ...f, amount: "", description: "" }))}>Post</Button>
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="Transactions" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {txns.data?.map((t) => <li key={t.id} className="flex flex-wrap gap-3 px-4 py-1.5"><span className="font-medium">{t.number}</span><span>{formatDate(t.txnDate)}</span><Badge>{t.kind}</Badge><span>{t.from} → {t.to}</span><span className="tabular-nums">{inr(t.amount)}</span><span className="text-xs text-muted">{t.description} · journals {t.fromJournal} / {t.toJournal}</span></li>)}
          {txns.data && !txns.data.length && <li className="px-4 py-4 text-center text-muted">None yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
