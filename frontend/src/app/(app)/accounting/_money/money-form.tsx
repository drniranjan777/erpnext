"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { ACC, MODES, MONEY, type AccountRow, type MoneyAccount, type MoneyKind, type MoneyVoucher, type OpenBill } from "@/lib/accounting";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";

export function MoneyForm({ kind, prefillParty }: { kind: MoneyKind; prefillParty?: PickedParty | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const m = MONEY[kind];
  const moneyAccounts = useQuery({ queryKey: [ACC, "money-accounts"], queryFn: () => api<MoneyAccount[]>(`${ACC}/money-accounts`) });
  const accounts = useQuery({ queryKey: [ACC, "accounts"], queryFn: () => api<AccountRow[]>(`${ACC}/accounts`), enabled: kind !== "contra" });
  const [withParty, setWithParty] = useState(kind !== "contra");
  const [party, setParty] = useState<PickedParty | null>(prefillParty ?? null);
  const [h, setH] = useState({ docDate: todayIST(), accountId: "", counterAccountId: "", mode: kind === "contra" ? "cash" : "neft", instrumentNo: "", instrumentDate: "", amount: "", bankCharges: "", tdsDeducted: "", reference: "", narration: "", autoAllocate: true });
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const side = kind === "receipt" ? "receivable" : "payable";
  const bills = useQuery({
    queryKey: [ACC, "open-bills", party?.id, side],
    queryFn: () => api<{ bills: OpenBill[]; advances: { id: string; number: string | null; onAccount: string }[] }>(`${ACC}/open-bills`, { query: { partyId: party!.id, side } }),
    enabled: !!party && withParty && kind !== "contra",
  });
  const accId = h.accountId || moneyAccounts.data?.[0]?.id || "";
  const settled = Number(h.amount || 0) + (kind === "receipt" ? Number(h.bankCharges || 0) + Number(h.tdsDeducted || 0) : 0);
  const allocated = Object.values(alloc).reduce((s, v) => s + Number(v || 0), 0);
  const counterChoices = (accounts.data ?? []).filter((a) => !a.isGroup && a.systemKey !== "receivable" && a.systemKey !== "payable" && a.systemKey !== "stock" && a.systemKey !== "grni");

  function fillOldestFirst() {
    let left = settled;
    const next: Record<string, string> = {};
    for (const b of bills.data?.bills ?? []) {
      if (left <= 0) break;
      const take = Math.min(left, Number(b.outstanding));
      next[b.id] = take.toFixed(2);
      left = Math.round((left - take) * 100) / 100;
    }
    setAlloc(next);
  }

  async function save(andSubmit: boolean) {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const v = await api<MoneyVoucher>(`${ACC}/money`, {
        body: {
          kind,
          docDate: h.docDate,
          accountId: accId,
          partyId: withParty ? (party?.id ?? null) : null,
          counterAccountId: withParty ? null : h.counterAccountId || null,
          mode: h.mode,
          instrumentNo: h.instrumentNo || null,
          instrumentDate: h.instrumentDate || null,
          amount: h.amount,
          bankCharges: h.bankCharges || null,
          tdsDeducted: kind === "receipt" ? h.tdsDeducted || null : null,
          allocations: Object.entries(alloc).filter(([, a]) => Number(a) > 0).map(([againstDocId, amount]) => ({ againstDocId, amount })),
          autoAllocate: withParty && h.autoAllocate,
          reference: h.reference || null,
          narration: h.narration || null,
        },
      });
      if (andSubmit) await api(`${m.api}/${v.id}/submit`, { body: { version: v.version } });
      qc.invalidateQueries({ queryKey: [m.api] });
      router.push(`${m.route}/${v.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={kind === "receipt" ? "Record receipt" : kind === "payment" ? "Record payment" : "Contra entry"} description={kind === "contra" ? "Cash deposited, withdrawn, or moved between bank accounts." : "Settle bills now, or keep the money on account and adjust it later."} />
      {error && <Alert>{error}</Alert>}
      <Card>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          {kind !== "contra" && (
            <div className="flex items-end gap-4 pb-2 sm:col-span-2 lg:col-span-4">
              <Checkbox label={kind === "receipt" ? "From a customer" : "To a vendor"} checked={withParty} onChange={(e) => setWithParty(e.target.checked)} />
            </div>
          )}
          {kind !== "contra" &&
            (withParty ? (
              <Field label={kind === "receipt" ? "Customer" : "Vendor"} required error={errors.partyId} className="sm:col-span-2">
                {(f) => <PartyPicker id={f.id} role={m.party!} value={party} onChange={(p) => { setParty(p); setAlloc({}); }} />}
              </Field>
            ) : (
              <Field label={kind === "receipt" ? "Income / other account" : "Expense / other account"} required error={errors.counterAccountId} className="sm:col-span-2">
                {(f) => (
                  <Select {...f} value={h.counterAccountId} onChange={(e) => setH({ ...h, counterAccountId: e.target.value })}>
                    <option value="">Choose…</option>
                    {counterChoices.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                  </Select>
                )}
              </Field>
            ))}
          <Field label={kind === "receipt" ? "Received into" : kind === "payment" ? "Paid from" : "From"} required error={errors.accountId}>
            {(f) => (
              <Select {...f} value={accId} onChange={(e) => setH({ ...h, accountId: e.target.value })}>
                {(moneyAccounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name} ({formatMoney(a.balance)})</option>)}
              </Select>
            )}
          </Field>
          {kind === "contra" && (
            <Field label="To" required error={errors.counterAccountId}>
              {(f) => (
                <Select {...f} value={h.counterAccountId} onChange={(e) => setH({ ...h, counterAccountId: e.target.value })}>
                  <option value="">Choose…</option>
                  {(moneyAccounts.data ?? []).filter((a) => a.id !== accId).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Date">{(f) => <Input {...f} type="date" value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} />}</Field>
          <Field label="Amount (₹)" required error={errors.amount}>{(f) => <Input {...f} inputMode="decimal" value={h.amount} onChange={(e) => setH({ ...h, amount: e.target.value })} />}</Field>
          <Field label="Mode">
            {(f) => (
              <Select {...f} value={h.mode} onChange={(e) => setH({ ...h, mode: e.target.value })}>
                {Object.entries(MODES).filter(([k]) => k !== "write_off").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            )}
          </Field>
          {h.mode === "cheque" && (
            <>
              <Field label="Cheque no." required error={errors.instrumentNo}>{(f) => <Input {...f} value={h.instrumentNo} onChange={(e) => setH({ ...h, instrumentNo: e.target.value })} />}</Field>
              <Field label="Cheque date" hint="A later date makes it post-dated">{(f) => <Input {...f} type="date" value={h.instrumentDate} onChange={(e) => setH({ ...h, instrumentDate: e.target.value })} />}</Field>
            </>
          )}
          {["neft", "rtgs", "imps", "upi"].includes(h.mode) && <Field label="UTR / reference">{(f) => <Input {...f} value={h.reference} onChange={(e) => setH({ ...h, reference: e.target.value })} />}</Field>}
          {kind !== "contra" && <Field label="Bank charges" hint={kind === "receipt" ? "Deducted by the bank" : "Paid on top"}>{(f) => <Input {...f} inputMode="decimal" value={h.bankCharges} onChange={(e) => setH({ ...h, bankCharges: e.target.value })} />}</Field>}
          {kind === "receipt" && withParty && <Field label="TDS deducted by customer">{(f) => <Input {...f} inputMode="decimal" value={h.tdsDeducted} onChange={(e) => setH({ ...h, tdsDeducted: e.target.value })} />}</Field>}
          <Field label="Narration" className="sm:col-span-2 lg:col-span-4">{(f) => <Input {...f} value={h.narration} onChange={(e) => setH({ ...h, narration: e.target.value })} />}</Field>
        </div>
      </Card>
      {withParty && party && kind !== "contra" && (
        <Card>
          <CardHeader
            title="Bills settled"
            description={`Settles ₹${settled.toFixed(2)}${kind === "receipt" ? " (amount + TDS + bank charges)" : ""}. Allocated ₹${allocated.toFixed(2)}; the rest stays on account.`}
            action={<Button size="sm" variant="secondary" onClick={fillOldestFirst} disabled={!settled}>Oldest first</Button>}
          />
          {errors.allocations && <p className="px-5 pb-2 text-sm text-danger">{errors.allocations}</p>}
          <table className="w-full border-t border-border text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-2 font-medium">Bill</th><th className="px-4 py-2 font-medium">Due</th><th className="px-4 py-2 text-right font-medium">Outstanding</th><th className="w-40 px-4 py-2 text-right font-medium">Settle</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(bills.data?.bills ?? []).map((b, i) => (
                <tr key={b.id}>
                  <td className="px-4 py-2"><span className="font-mono">{b.number}</span>{b.reference && <span className="ml-2 text-xs text-muted">{b.reference}</span>}<span className="block text-xs text-muted">{formatDate(b.docDate)}</span></td>
                  <td className={`px-4 py-2 ${b.daysOverdue ? "text-danger" : ""}`}>{formatDate(b.dueDate)}{b.daysOverdue > 0 && <span className="block text-xs">{b.daysOverdue} days overdue</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(b.outstanding)}</td>
                  <td className="px-4 py-2"><Input className="h-9 text-right" inputMode="decimal" aria-label={`Settle ${b.number}`} value={alloc[b.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [b.id]: e.target.value })} />{errors[`allocations.${i}.amount`] && <p className="text-xs text-danger">{errors[`allocations.${i}.amount`]}</p>}</td>
                </tr>
              ))}
              {bills.data && !bills.data.bills.length && <tr><td colSpan={4} className="px-4 py-3 text-muted">No open bills: the whole amount stays on account.</td></tr>}
            </tbody>
          </table>
          <div className="border-t border-border px-5 py-3"><Checkbox label="Settle anything left over against the oldest bills" checked={h.autoAllocate} onChange={(e) => setH({ ...h, autoAllocate: e.target.checked })} /></div>
        </Card>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button variant="secondary" loading={busy} disabled={!h.amount} onClick={() => save(false)}>Save draft</Button>
        <Button loading={busy} disabled={!h.amount} onClick={() => save(true)}>Save & post</Button>
      </div>
    </div>
  );
}
