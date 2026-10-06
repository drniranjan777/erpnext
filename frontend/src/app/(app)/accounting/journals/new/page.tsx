"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { ACC, type AccountRow, type CostCenter, type Journal } from "@/lib/accounting";
import { formatMoney, todayIST } from "@/lib/documents";

interface Line { key: string; accountId: string; party: PickedParty | null; costCenterId: string; debit: string; credit: string; narration: string }
let n = 0;
const blank = (): Line => ({ key: `j${++n}`, accountId: "", party: null, costCenterId: "", debit: "", credit: "", narration: "" });

export default function NewJournalPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: [ACC, "accounts"], queryFn: () => api<AccountRow[]>(`${ACC}/accounts`) });
  const ccs = useQuery({ queryKey: [ACC, "cost-centers"], queryFn: () => api<CostCenter[]>(`${ACC}/cost-centers`) });
  const [h, setH] = useState({ docDate: todayIST(), kind: "journal", narration: "", reverseOn: "", recurrence: "", recurUntil: "" });
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const postable = (accounts.data ?? []).filter((a) => !a.isGroup);
  const control = new Set(postable.filter((a) => a.systemKey === "receivable" || a.systemKey === "payable").map((a) => a.id));
  const upd = (k: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const diff = Math.round((dr - cr) * 100) / 100;

  async function save(andSubmit: boolean) {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const j = await api<Journal>(`${ACC}/journals`, {
        body: {
          docDate: h.docDate,
          kind: h.kind,
          narration: h.narration || null,
          reverseOn: h.kind === "reversing" ? h.reverseOn || null : null,
          recurrence: h.recurrence || null,
          recurUntil: h.recurrence ? h.recurUntil || null : null,
          lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, partyId: l.party?.id ?? null, costCenterId: l.costCenterId || null, debit: l.debit || null, credit: l.credit || null, narration: l.narration || null })),
        },
      });
      if (andSubmit) await api(`${ACC}/journals/${j.id}/submit`, { body: { version: j.version } });
      qc.invalidateQueries({ queryKey: [`${ACC}/journals`] });
      router.push(`${ACC}/journals/${j.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="New journal voucher" description="Debits must equal credits. Receivable and payable lines need the customer or vendor." />
      {error && <Alert>{error}</Alert>}
      <Card>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date">{(f) => <Input {...f} type="date" value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} />}</Field>
          <Field label="Kind">
            {(f) => (
              <Select {...f} value={h.kind} onChange={(e) => setH({ ...h, kind: e.target.value })}>
                <option value="journal">Journal</option>
                <option value="opening">Opening balances</option>
                <option value="reversing">Reversing (accrual)</option>
              </Select>
            )}
          </Field>
          {h.kind === "reversing" && <Field label="Reverses on" required error={errors.reverseOn}>{(f) => <Input {...f} type="date" value={h.reverseOn} onChange={(e) => setH({ ...h, reverseOn: e.target.value })} />}</Field>}
          <Field label="Repeat">
            {(f) => (
              <Select {...f} value={h.recurrence} onChange={(e) => setH({ ...h, recurrence: e.target.value })}>
                <option value="">Once</option>
                <option value="monthly">Every month</option>
                <option value="quarterly">Every quarter</option>
                <option value="yearly">Every year</option>
              </Select>
            )}
          </Field>
          {h.recurrence && <Field label="Repeat until">{(f) => <Input {...f} type="date" value={h.recurUntil} onChange={(e) => setH({ ...h, recurUntil: e.target.value })} />}</Field>}
          <Field label="Narration" className="sm:col-span-2 lg:col-span-4">{(f) => <Input {...f} value={h.narration} onChange={(e) => setH({ ...h, narration: e.target.value })} />}</Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Entries" action={<Button size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="size-4" aria-hidden /> Line</Button>} />
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="w-56 px-2 py-2 font-medium">Party</th>
                <th className="w-36 px-2 py-2 font-medium">Cost centre</th>
                <th className="w-32 px-2 py-2 text-right font-medium">Debit</th>
                <th className="w-32 px-2 py-2 text-right font-medium">Credit</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border align-top">
              {lines.map((l, i) => {
                const err = (f: string) => errors[`lines.${i}.${f}`];
                return (
                  <tr key={l.key}>
                    <td className="px-3 py-2">
                      <Select className="h-9" aria-label={`Line ${i + 1} account`} value={l.accountId} onChange={(e) => upd(l.key, { accountId: e.target.value })}>
                        <option value="">Choose…</option>
                        {postable.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                      </Select>
                      <Input className="mt-1 h-8 text-xs" aria-label={`Line ${i + 1} narration`} placeholder="Line narration" value={l.narration} onChange={(e) => upd(l.key, { narration: e.target.value })} />
                      {err("accountId") && <p className="text-xs text-danger">{err("accountId")}</p>}
                    </td>
                    <td className="px-2 py-2">
                      {control.has(l.accountId) || l.party ? <PartyPicker role="customer" value={l.party} onChange={(p) => upd(l.key, { party: p })} /> : <span className="text-xs text-muted">—</span>}
                      {err("partyId") && <p className="text-xs text-danger">{err("partyId")}</p>}
                    </td>
                    <td className="px-2 py-2">
                      <Select className="h-9" aria-label={`Line ${i + 1} cost centre`} value={l.costCenterId} onChange={(e) => upd(l.key, { costCenterId: e.target.value })}>
                        <option value="">—</option>
                        {(ccs.data ?? []).filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
                      </Select>
                    </td>
                    <td className="px-2 py-2"><Input className="h-9 text-right" inputMode="decimal" aria-label={`Line ${i + 1} debit`} value={l.debit} onChange={(e) => upd(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />{err("debit") && <p className="text-xs text-danger">{err("debit")}</p>}</td>
                    <td className="px-2 py-2"><Input className="h-9 text-right" inputMode="decimal" aria-label={`Line ${i + 1} credit`} value={l.credit} onChange={(e) => upd(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
                    <td className="px-2 py-2">{lines.length > 2 && <Button variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4 text-danger" /></Button>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-border font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={3}>{diff !== 0 ? <span className="text-danger">Difference {formatMoney(Math.abs(diff))} {diff > 0 ? "Dr" : "Cr"}</span> : "Balanced"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(dr)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(cr)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {errors.lines && <p className="px-5 py-2 text-sm text-danger">{errors.lines}</p>}
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button variant="secondary" loading={busy} onClick={() => save(false)}>Save draft</Button>
        <Button loading={busy} disabled={diff !== 0 || dr === 0} onClick={() => save(true)}>Save & post</Button>
      </div>
    </div>
  );
}
