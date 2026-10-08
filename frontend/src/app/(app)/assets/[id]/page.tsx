"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toSVG } from "bwip-js/browser";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Info } from "@/components/documents/doc-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { ACC, VOUCHER_PATH, type MoneyAccount } from "@/lib/accounting";
import type { Asset } from "@/lib/assets";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";

export default function AssetPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["assets", id], queryFn: () => api<Asset>(`/assets/${id}`) });
  const [dialog, setDialog] = useState<"dispose" | "transfer" | null>(null);
  const tag = useMemo(() => {
    if (!q.data) return "";
    try {
      return toSVG({ bcid: "qrcode", text: `${q.data.code}|${q.data.name}`, scale: 3, eclevel: "M" } as Parameters<typeof toSVG>[0]);
    } catch {
      return "";
    }
  }, [q.data]);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const a = q.data!;
  const refresh = () => qc.invalidateQueries({ queryKey: ["assets"] });
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/assets" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Fixed assets</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{a.name}</h1>
            <p className="mt-1 text-sm text-muted"><span className="font-mono">{a.code}</span> · {typeof a.category === "string" ? a.category : a.category.name} {a.status === "disposed" && <Badge className="ml-1">Disposed</Badge>}</p>
          </div>
          {a.status === "active" && can("assets.register.manage") && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDialog("transfer")}>Transfer</Button>
              <Button variant="secondary" onClick={() => setDialog("dispose")}>Dispose / sell</Button>
            </div>
          )}
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <Card>
          <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
            <Info label="Cost" value={formatMoney(a.cost)} />
            <Info label="Accumulated depreciation" value={formatMoney(a.accumulatedDepreciation)} />
            <Info label="Book value" value={formatMoney(a.netBookValue)} />
            <Info label="Method" value={`${a.method.toUpperCase()} over ${Number(a.usefulLifeYears)} years · residual ${formatMoney(a.residualValue)}`} />
            <Info label="Purchased / in use" value={`${formatDate(a.purchaseDate)} / ${formatDate(a.capitalisedOn)}`} />
            <Info label="Depreciated up to" value={formatDate(a.depreciatedUntil)} />
            <Info label="Location" value={a.location} />
            <Info label="Custodian" value={a.custodian} />
            <Info label="Serial no." value={a.serialNo} mono />
            {a.status === "disposed" && <Info label="Disposed" value={`${formatDate(a.disposedOn)} for ${formatMoney(a.disposalAmount)}`} />}
            <Info label="IT block" value={`${Number(a.itRatePct)}%`} />
          </dl>
        </Card>
        {tag && (
          <Card className="flex flex-col items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/svg+xml;utf8,${encodeURIComponent(tag)}`} alt={`Tag for ${a.code}`} className="size-32" />
            <p className="mt-1 font-mono text-xs">{a.code}</p>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => window.print()}>Print tag</Button>
          </Card>
        )}
      </div>
      <Card>
        <CardHeader title="Depreciation charged" />
        <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
          <tbody className="divide-y divide-border">
            {(a.history ?? []).map((h) => (
              <tr key={h.id}><td className="px-4 py-2">{formatDate(h.fromDate)} – {formatDate(h.toDate)}</td><td className="px-4 py-2 text-muted">{h.days} days</td><td className="px-4 py-2"><Link href={`/accounting/journals/${h.journalId}`} className="font-mono text-primary hover:underline">{h.journalNumber}</Link></td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(h.amount)}</td></tr>
            ))}
            {!a.history?.length && <tr><td className="px-4 py-3 text-muted">Not depreciated yet</td></tr>}
          </tbody>
        </table></div>
      </Card>
      {!!a.references?.length && (
        <Card>
          <CardHeader title="Documents" />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {a.references.map((r) => <li key={r.id} className="px-5 py-2"><Link href={`${VOUCHER_PATH[r.docType] ?? ""}/${r.id}`} className="font-mono text-primary hover:underline">{r.number}</Link></li>)}
          </ul>
        </Card>
      )}
      {dialog === "dispose" && <DisposeDialog asset={a} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "transfer" && <TransferDialog asset={a} onClose={() => setDialog(null)} onDone={refresh} />}
    </div>
  );
}

function DisposeDialog({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: () => void }) {
  const banks = useQuery({ queryKey: [ACC, "money-accounts"], queryFn: () => api<MoneyAccount[]>(`${ACC}/money-accounts`) });
  const [f, setF] = useState({ date: todayIST(), amount: "", accountId: "", reason: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api(`/assets/${asset.id}/dispose`, { body: { date: f.date, amount: f.amount || null, accountId: Number(f.amount) ? f.accountId || banks.data?.[0]?.id : null, reason: f.reason } });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Dispose of ${asset.code}`} description="Depreciation is charged up to the date first; the profit or loss on sale is posted." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={f.reason.length < 3} onClick={go}>Dispose</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date">{(p) => <Input {...p} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="Sale amount (blank if scrapped)">{(p) => <Input {...p} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        </div>
        {Number(f.amount) > 0 && <Field label="Money received into">{(p) => <Select {...p} value={f.accountId || banks.data?.[0]?.id || ""} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{(banks.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</Select>}</Field>}
        <Field label="Reason" required>{(p) => <Input {...p} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function TransferDialog({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: () => void }) {
  const warehouses = useWarehouses();
  const [locationId, setLocation] = useState(asset.locationId ?? "");
  const [custodian, setCustodian] = useState(asset.custodian ?? "");
  const [error, setError] = useState<string | null>(null);
  async function go() {
    try {
      await api(`/assets/${asset.id}/transfer`, { body: { locationId: locationId || null, custodian: custodian || null } });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Transfer ${asset.code}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={go}>Save</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Location">{(p) => <Select {...p} value={locationId} onChange={(e) => setLocation(e.target.value)}><option value="">—</option>{(warehouses.data ?? []).filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</Select>}</Field>
        <Field label="Custodian">{(p) => <Input {...p} value={custodian} onChange={(e) => setCustodian(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
