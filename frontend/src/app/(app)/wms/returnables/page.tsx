"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";
import { WMS } from "@/lib/wms";

interface Type { id: string; code: string; name: string; depositAmount: string | null; isActive: boolean }
interface Balance { partyId: string; party: string; typeId: string; code: string; name: string; balance: number; depositValue: string; firstOut: string | null; lastMove: string }

export default function ReturnablesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const types = useQuery({ queryKey: [WMS, "returnable-types"], queryFn: () => api<Type[]>(`${WMS}/returnables/types`) });
  const balances = useQuery({ queryKey: [WMS, "returnable-balances"], queryFn: () => api<Balance[]>(`${WMS}/returnables/balances`) });
  const parties = useQuery({ queryKey: ["/masters/parties", "all"], queryFn: () => api<{ items: { id: string; name: string }[] }>("/masters/parties", { query: { limit: 200 } }) });
  const [mv, setMv] = useState({ typeId: "", partyId: "", direction: "out", qty: "", date: todayIST(), reference: "" });
  const [nt, setNt] = useState({ code: "", name: "", depositAmount: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: [WMS] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const today = todayIST();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Returnable packaging" description="Drums, pallets, crates and bins sent with goods: what each customer or vendor still holds, and its deposit value." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {can("wms.tasks.execute") && (
        <Card>
          <CardHeader title="Record a movement" />
          <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
            <Field label="Type">{(p) => <Select {...p} value={mv.typeId} onChange={(e) => setMv({ ...mv, typeId: e.target.value })}><option value="">Choose…</option>{types.data?.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</Select>}</Field>
            <Field label="Party">{(p) => <Select {...p} className="w-56" value={mv.partyId} onChange={(e) => setMv({ ...mv, partyId: e.target.value })}><option value="">Choose…</option>{parties.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
            <Field label="">{(p) => <Select {...p} value={mv.direction} onChange={(e) => setMv({ ...mv, direction: e.target.value })}><option value="out">Sent to them</option><option value="back">Returned by them</option></Select>}</Field>
            <Field label="Qty">{(p) => <Input {...p} className="w-20" type="number" value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} />}</Field>
            <Field label="Date">{(p) => <Input {...p} type="date" value={mv.date} onChange={(e) => setMv({ ...mv, date: e.target.value })} />}</Field>
            <Field label="Reference">{(p) => <Input {...p} className="w-36" value={mv.reference} onChange={(e) => setMv({ ...mv, reference: e.target.value })} />}</Field>
            <Button disabled={!mv.typeId || !mv.partyId || !(Number(mv.qty) > 0)} onClick={() => run(() => api(`${WMS}/returnables/moves`, { body: { ...mv, qty: Number(mv.qty), reference: mv.reference || null } }), "Recorded.")}>Record</Button>
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="With parties now" />
        <table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Party</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 text-right font-medium">Holding</th><th className="px-4 py-2 text-right font-medium">Deposit value</th><th className="px-4 py-2 font-medium">Out since</th></tr></thead>
          <tbody className="divide-y divide-border">
            {balances.data?.map((b) => {
              const days = b.firstOut ? Math.round((Date.parse(today) - Date.parse(b.firstOut)) / 86_400_000) : 0;
              return (
                <tr key={`${b.partyId}-${b.typeId}`}>
                  <td className="px-4 py-2">{b.party}</td>
                  <td className="px-4 py-2">{b.code} · {b.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{b.balance}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(b.depositValue)}</td>
                  <td className={`px-4 py-2 ${days > 90 ? "text-danger" : ""}`}>{b.firstOut ? `${formatDate(b.firstOut)} (${days} days)` : "–"}</td>
                </tr>
              );
            })}
            {balances.data && !balances.data.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">Nothing is out.</td></tr>}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader title="Types" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {types.data?.map((t) => <li key={t.id} className="flex gap-3 px-5 py-2"><span className="font-mono text-xs">{t.code}</span><span>{t.name}</span><span className="ml-auto text-muted">{t.depositAmount ? `deposit ${formatMoney(t.depositAmount)}` : "no deposit"}</span></li>)}
        </ul>
        {can("wms.setup.manage") && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
            <Field label="Code">{(p) => <Input {...p} className="w-28" value={nt.code} onChange={(e) => setNt({ ...nt, code: e.target.value })} />}</Field>
            <Field label="Name">{(p) => <Input {...p} className="w-56" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} />}</Field>
            <Field label="Deposit (₹)">{(p) => <Input {...p} className="w-28" inputMode="decimal" value={nt.depositAmount} onChange={(e) => setNt({ ...nt, depositAmount: e.target.value })} />}</Field>
            <Button variant="secondary" disabled={!nt.code || nt.name.length < 2} onClick={() => run(() => api(`${WMS}/returnables/types`, { body: { code: nt.code, name: nt.name, depositAmount: nt.depositAmount ? Number(nt.depositAmount) : null } }), "Type added.").then(() => setNt({ code: "", name: "", depositAmount: "" }))}>Add type</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
