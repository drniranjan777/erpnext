"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { ACC } from "@/lib/accounting";
import { useAuth } from "@/lib/auth";
import { formatMoney, todayIST } from "@/lib/documents";

interface Checklist { items: { key: string; label: string; status: "ok" | "warn" | "todo"; detail: string; link?: string }[]; ready: boolean }

const ICON = { ok: <CheckCircle2 className="size-5 text-success" aria-label="Done" />, warn: <CircleAlert className="size-5 text-warning" aria-label="Check" />, todo: <Circle className="size-5 text-muted" aria-label="To do" /> };

export default function ClosePage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [period, setPeriod] = useState(todayIST().slice(0, 7));
  const q = useQuery({ queryKey: [ACC, "checklist", period], queryFn: () => api<Checklist>(`${ACC}/close-checklist`, { query: { period } }) });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: React.ReactNode } | null>(null);
  const [fx, setFx] = useState({ date: todayIST(), currency: "USD", rate: "" });
  const [ye, setYe] = useState({ fy: Number(todayIST().slice(0, 4)) - (Number(todayIST().slice(5, 7)) >= 4 ? 1 : 2), lock: true });
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<React.ReactNode>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ tone: "success", text: await fn() });
      qc.invalidateQueries({ queryKey: [ACC] });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Period close" description="Month-end checklist, revaluation of foreign-currency bills, and the year-end closing." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Month-end checklist" action={<Input type="month" aria-label="Month" className="h-9 w-40" value={period} onChange={(e) => setPeriod(e.target.value)} />} />
        {q.isLoading && <LoadingBlock />}
        {q.error && <div className="p-5"><ErrorBlock error={q.error} /></div>}
        <ul className="divide-y divide-border border-t border-border">
          {q.data?.items.map((i) => (
            <li key={i.key} className="flex items-start gap-3 px-5 py-3 text-sm">
              {ICON[i.status]}
              <div className="min-w-0 flex-1"><p className="font-medium">{i.label}</p><p className="text-muted">{i.detail}</p></div>
              {i.link && i.status !== "ok" && <Link href={i.link} className="text-primary hover:underline">Open</Link>}
            </li>
          ))}
        </ul>
      </Card>
      {can("accounting.close.manage") && (
        <>
          <Card>
            <CardHeader title="Revalue foreign-currency bills" description="Open import bills restated at the closing rate; the difference goes to exchange gain / loss and reverses the next day." />
            <div className="flex flex-wrap items-end gap-4 px-5 pb-5">
              <Field label="As of">{(p) => <Input {...p} type="date" value={fx.date} onChange={(e) => setFx({ ...fx, date: e.target.value })} />}</Field>
              <Field label="Currency">{(p) => <Input {...p} className="w-24 uppercase" maxLength={3} value={fx.currency} onChange={(e) => setFx({ ...fx, currency: e.target.value.toUpperCase() })} />}</Field>
              <Field label="Closing rate (₹)">{(p) => <Input {...p} className="w-32" inputMode="decimal" value={fx.rate} onChange={(e) => setFx({ ...fx, rate: e.target.value })} />}</Field>
              <Button variant="secondary" loading={busy} disabled={!Number(fx.rate)} onClick={() => run(async () => { const r = await api<{ journalId: string | null; number: string | null; bills: number; net: string }>(`${ACC}/revalue`, { body: { date: fx.date, rates: [{ currency: fx.currency, rate: fx.rate }] } }); return r.journalId ? <>{r.bills} bill(s) revalued: {Number(r.net) > 0 ? "loss" : "gain"} of {formatMoney(Math.abs(Number(r.net)))} in <Link href={`${ACC}/journals/${r.journalId}`} className="underline">{r.number}</Link>.</> : "No open bills in that currency."; })}>Revalue</Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Year-end closing" description="Moves the year's income and expense balances into retained earnings, dated the last day of the year. Cancel the journal to reopen the year." />
            <div className="flex flex-wrap items-end gap-4 px-5 pb-5">
              <Field label="Financial year starting">{(p) => <Input {...p} type="number" className="w-28" value={ye.fy} onChange={(e) => setYe({ ...ye, fy: Number(e.target.value) })} />}</Field>
              <div className="pb-2"><Checkbox label="Lock the year after closing" checked={ye.lock} onChange={(e) => setYe({ ...ye, lock: e.target.checked })} /></div>
              <Button loading={busy} onClick={() => run(async () => { const r = await api<{ journalId: string; number: string; profit: string }>(`${ACC}/year-end`, { body: ye }); return <>Year closed in <Link href={`${ACC}/journals/${r.journalId}`} className="underline">{r.number}</Link>: {Number(r.profit) >= 0 ? "profit" : "loss"} of {formatMoney(Math.abs(Number(r.profit)))} moved to retained earnings.</>; })}>Close the year</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
