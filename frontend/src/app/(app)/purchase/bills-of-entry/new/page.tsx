"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatMoney, todayIST } from "@/lib/documents";

const BOE = "/purchase/bills-of-entry";

interface Line { key: string; item: PickedItem; qty: string; foreignValue: string; assessableValue: string; bcdRate: string; swsRate: string; igstRate: string }
interface Preview { header: { assessableTotal: string; bcdTotal: string; swsTotal: string; igstTotal: string; cessTotal: string; dutyTotal: string }; lines: { assessableValue: string; bcdAmount: string; swsAmount: string; igstAmount: string }[] }

let n = 0;

export default function NewBoePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [vendor, setVendor] = useState<PickedParty | null>(null);
  const [h, setH] = useState({ boeNo: "", boeDate: todayIST(), portCode: "", boeType: "home", goodsReceiptId: "", currency: "USD", exchangeRate: "" });
  const [lines, setLines] = useState<Line[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const grns = useQuery({ queryKey: ["purchase", "receipts", "vendor", vendor?.id], queryFn: () => api<{ items: { id: string; number: string | null; docDate: string; status: string }[] }>("/purchase/receipts", { query: { vendorId: vendor!.id, status: "approved" } }), enabled: !!vendor });

  const body = vendor
    ? {
        vendorId: vendor.id,
        boeNo: h.boeNo,
        boeDate: h.boeDate,
        portCode: h.portCode,
        boeType: h.boeType,
        goodsReceiptId: h.goodsReceiptId || null,
        currency: h.currency,
        exchangeRate: h.exchangeRate,
        lines: lines.map((l) => ({ itemId: l.item.id, qty: l.qty, foreignValue: l.foreignValue || null, assessableValue: l.assessableValue || null, bcdRate: l.bcdRate || null, swsRate: l.swsRate || null, igstRate: l.igstRate || null })),
      }
    : null;
  const ready = body && h.boeNo && h.portCode && Number(h.exchangeRate) > 0 && lines.length > 0 && lines.every((l) => Number(l.qty) > 0 && (Number(l.foreignValue) > 0 || Number(l.assessableValue) > 0));
  const payload = ready ? JSON.stringify(body) : null;
  const [debounced, setDebounced] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(payload), 400);
    return () => clearTimeout(t);
  }, [payload]);
  const preview = useQuery({ queryKey: ["boe", "preview", debounced], queryFn: () => api<Preview>(`${BOE}/preview`, { body: JSON.parse(debounced!) }), enabled: !!debounced, retry: false, placeholderData: (p) => p });
  const upd = (k: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));

  async function save(andSubmit: boolean) {
    setError(null);
    setErrors({});
    if (!body) return setErrors({ vendorId: "Choose the overseas supplier" });
    setBusy(true);
    try {
      const doc = await api<{ id: string; version: number }>(BOE, { body });
      if (andSubmit) await api(`${BOE}/${doc.id}/submit`, { body: { version: doc.version } });
      qc.invalidateQueries({ queryKey: [BOE] });
      router.push(`${BOE}/${doc.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
    }
  }

  const p = preview.data;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Record Bill of Entry" description="Duty is computed like customs does it: BCD on the assessable value, SWS on BCD, IGST on the duty-paid value, each rounded to the rupee." />
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title="Bill of Entry" />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Overseas supplier" required error={errors.vendorId} className="sm:col-span-2">{(f) => <PartyPicker id={f.id} role="vendor" value={vendor} onChange={setVendor} />}</Field>
          <Field label="BE number" required error={errors.boeNo}>{(f) => <Input {...f} inputMode="numeric" value={h.boeNo} onChange={(e) => setH({ ...h, boeNo: e.target.value.replace(/\D/g, "") })} />}</Field>
          <Field label="BE date" required>{(f) => <Input {...f} type="date" value={h.boeDate} onChange={(e) => setH({ ...h, boeDate: e.target.value })} />}</Field>
          <Field label="Port code" required error={errors.portCode} hint="e.g. INNSA1 (Nhava Sheva), INMAA1">{(f) => <Input {...f} className="uppercase" maxLength={6} value={h.portCode} onChange={(e) => setH({ ...h, portCode: e.target.value.toUpperCase() })} />}</Field>
          <Field label="Type">
            {(f) => (
              <Select {...f} value={h.boeType} onChange={(e) => setH({ ...h, boeType: e.target.value })}>
                <option value="home">Home consumption</option>
                <option value="warehouse">Into bonded warehouse</option>
                <option value="ex_bond">Ex-bond</option>
              </Select>
            )}
          </Field>
          <Field label="Currency">{(f) => <Input {...f} className="uppercase" maxLength={3} value={h.currency} onChange={(e) => setH({ ...h, currency: e.target.value.toUpperCase() })} />}</Field>
          <Field label="Customs exchange rate (₹)" required error={errors.exchangeRate}>{(f) => <Input {...f} inputMode="decimal" value={h.exchangeRate} onChange={(e) => setH({ ...h, exchangeRate: e.target.value })} />}</Field>
          <Field label="Goods receipt" hint="Duty is added to the cost of these goods" error={errors.goodsReceiptId} className="sm:col-span-2">
            {(f) => (
              <Select {...f} value={h.goodsReceiptId} onChange={(e) => setH({ ...h, goodsReceiptId: e.target.value })} disabled={!vendor}>
                <option value="">Not received yet / none</option>
                {(grns.data?.items ?? []).map((g) => <option key={g.id} value={g.id}>{g.number} · {g.docDate}</option>)}
              </Select>
            )}
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Items" description="Give the invoice value in the foreign currency, or the assessable value in ₹ as assessed. IGST defaults to the item's GST rate." />
        <div className="px-5 pb-3"><ItemPicker onPick={(item) => setLines((ls) => [...ls, { key: `b${++n}`, item, qty: "", foreignValue: "", assessableValue: "", bcdRate: "", swsRate: "10", igstRate: "" }])} /></div>
        {lines.length > 0 && (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="w-24 px-2 py-2 text-right font-medium">Qty</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Value ({h.currency})</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Assessable ₹</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">BCD %</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">SWS %</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">IGST %</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Duty</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {lines.map((l, i) => {
                  const pl = p?.lines[i];
                  return (
                    <tr key={l.key}>
                      <td className="px-4 py-2.5">{l.item.name}<p className="font-mono text-xs text-muted">{l.item.code} · HSN {l.item.hsnCode ?? "—"}</p>{errors[`lines.${i}.itemId`] && <p className="text-xs text-danger">{errors[`lines.${i}.itemId`]}</p>}</td>
                      {(["qty", "foreignValue", "assessableValue", "bcdRate", "swsRate", "igstRate"] as const).map((k) => (
                        <td key={k} className="px-2 py-2">
                          <Input className="h-9 text-right" inputMode="decimal" aria-label={`Line ${i + 1} ${k}`} placeholder={k === "assessableValue" ? (pl ? Number(pl.assessableValue).toFixed(2) : "auto") : k === "igstRate" ? (l.item.gstRate ? String(Number(l.item.gstRate)) : "") : ""} value={l[k]} onChange={(e) => upd(l.key, { [k]: e.target.value })} />
                        </td>
                      ))}
                      <td className="px-2 py-2.5 text-right tabular-nums">{pl ? formatMoney(Number(pl.bcdAmount) + Number(pl.swsAmount) + Number(pl.igstAmount)) : "—"}</td>
                      <td className="px-2 py-2"><Button variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4 text-danger" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {p && (
          <dl className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-5">
            <div><dt className="text-xs text-muted">Assessable value</dt><dd className="tabular-nums">{formatMoney(p.header.assessableTotal)}</dd></div>
            <div><dt className="text-xs text-muted">Basic customs duty</dt><dd className="tabular-nums">{formatMoney(p.header.bcdTotal)}</dd></div>
            <div><dt className="text-xs text-muted">Social welfare surcharge</dt><dd className="tabular-nums">{formatMoney(p.header.swsTotal)}</dd></div>
            <div><dt className="text-xs text-muted">IGST + cess (ITC)</dt><dd className="tabular-nums">{formatMoney(Number(p.header.igstTotal) + Number(p.header.cessTotal))}</dd></div>
            <div><dt className="text-xs text-muted">Total duty payable</dt><dd className="font-semibold tabular-nums">{formatMoney(p.header.dutyTotal)}</dd></div>
          </dl>
        )}
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button variant="secondary" loading={busy} disabled={!lines.length} onClick={() => save(false)}>Save draft</Button>
        <Button loading={busy} disabled={!lines.length} onClick={() => save(true)}>Save & post</Button>
      </div>
    </div>
  );
}
