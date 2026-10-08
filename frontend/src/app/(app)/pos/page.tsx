"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Trash2, WifiOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { clientRef, sendOrQueue, useOfflineQueue } from "@/lib/offline-queue";

interface Terminal { id: string; code: string; name: string; warehouse: string; status: string; openSessionId: string | null }
interface Item { id: string; code: string; name: string; uom: string; gstRate: number; price: number; stock: number }
interface CartLine { itemId: string; code: string; name: string; price: number; gstRate: number; qty: number; discountPct: number }
interface Sale { id: string; number: string; total: number; change: number; kind: string; lines: { itemId: string; code: string; name: string; qty: number }[] }

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lineTotal = (l: CartLine) => Math.round(l.qty * l.price * (1 - l.discountPct / 100) * 100) / 100;

/** The till: scan or search, adjust the cart, take payment, print the receipt. Works through short outages. */
export default function PosPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const terminals = useQuery({ queryKey: ["/pos/terminals"], queryFn: () => api<Terminal[]>("/pos/terminals") });
  const [tid, setTid] = useState("");
  const till = terminals.data?.find((t) => t.id === (tid || terminals.data?.[0]?.id));
  const [opening, setOpening] = useState("2000");
  const [q, setQ] = useState("");
  const found = useQuery({ queryKey: ["/pos/items", till?.id, q], queryFn: () => api<Item[]>(`/pos/terminals/${till!.id}/items`, { query: { q } }), enabled: !!till && q.trim().length >= 2 });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [buyer, setBuyer] = useState({ name: "", mobile: "" });
  const [paying, setPaying] = useState(false);
  const [last, setLast] = useState<Sale | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const queue = useOfflineQueue();
  const add = (i: Item) => {
    setCart((c) => {
      const hit = c.find((x) => x.itemId === i.id);
      return hit ? c.map((x) => (x.itemId === i.id ? { ...x, qty: x.qty + 1 } : x)) : [...c, { itemId: i.id, code: i.code, name: i.name, price: i.price, gstRate: i.gstRate, qty: 1, discountPct: 0 }];
    });
    setQ("");
  };
  const gross = cart.reduce((a, l) => a + lineTotal(l), 0);
  const total = Math.round(gross);
  async function openShift() {
    setMsg(null);
    try {
      await api("/pos/sessions", { body: { terminalId: till!.id, openingCash: Number(opening || 0) } });
      qc.invalidateQueries({ queryKey: ["/pos/terminals"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  if (terminals.data && !terminals.data.length)
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <PageHeader title="Point of sale" />
        <Alert tone="warning">No till is set up yet.{can("pos.terminals.manage") ? " Add one under Shifts and tills." : " Ask your administrator to add one."}</Alert>
        {can("pos.terminals.manage") && <Link className="text-sm text-primary hover:underline" href="/pos/shifts">Shifts and tills</Link>}
      </div>
    );
  if (!till) return null;
  if (!till.openSessionId)
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <PageHeader title="Point of sale" description="Open a shift with the cash in the drawer." actions={<Link className="text-sm text-primary hover:underline" href="/pos/shifts">Shifts</Link>} />
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Card className="space-y-3 p-4 text-sm">
          <Select aria-label="Till" value={till.id} onChange={(e) => setTid(e.target.value)}>{terminals.data?.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name} ({t.warehouse})</option>)}</Select>
          <label className="block space-y-1"><span className="text-xs text-muted">Opening cash</span><Input type="number" min={0} value={opening} onChange={(e) => setOpening(e.target.value)} /></label>
          <Button onClick={openShift}>Open shift</Button>
        </Card>
      </div>
    );
  return (
    <div className="space-y-3">
      <PageHeader title={`${till.code} · ${till.name}`} description={till.warehouse} actions={<span className="flex items-center gap-2">{queue.count > 0 && <Button size="sm" variant="secondary" onClick={queue.flush}><WifiOff className="size-4" aria-hidden /> {queue.count} sale(s) waiting to send</Button>}<Link className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-surface-muted" href={`/pos/shifts?session=${till.openSessionId}`}>Shift & close</Link></span>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {queue.failed.length > 0 && <Alert>{queue.failed.join("; ")}</Alert>}
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="p-3">
            <Input autoFocus aria-label="Scan or search" placeholder="Scan a barcode or type a code / name" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && found.data?.[0]) add(found.data[0]); }} />
          </div>
          <ul className="divide-y divide-border border-t border-border text-sm">
            {found.data?.map((i) => <li key={i.id}><button type="button" className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-muted" onClick={() => add(i)}><span className="font-medium">{i.code}</span><span className="flex-1">{i.name}</span><span className="text-xs text-muted">{i.stock} {i.uom} · GST {i.gstRate} %</span><span className="tabular-nums">{inr(i.price)}</span></button></li>)}
            {q.trim().length >= 2 && found.data && !found.data.length && <li className="px-4 py-3 text-center text-muted">Nothing found.</li>}
          </ul>
        </Card>
        <Card className="flex flex-col">
          <CardHeader title="Bill" description={cart.length ? `${cart.reduce((a, l) => a + l.qty, 0)} item(s)` : "Empty"} />
          <ul className="flex-1 divide-y divide-border border-t border-border text-sm">
            {cart.map((l) => (
              <li key={l.itemId} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="flex-1">{l.name}<span className="block text-xs text-muted">{inr(l.price)}{l.discountPct ? ` − ${l.discountPct} %` : ""}</span></span>
                <button type="button" aria-label="Less" className="rounded border border-border p-1" onClick={() => setCart(cart.map((x) => (x.itemId === l.itemId ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}><Minus className="size-3" aria-hidden /></button>
                <span className="w-6 text-center tabular-nums">{l.qty}</span>
                <button type="button" aria-label="More" className="rounded border border-border p-1" onClick={() => setCart(cart.map((x) => (x.itemId === l.itemId ? { ...x, qty: x.qty + 1 } : x)))}><Plus className="size-3" aria-hidden /></button>
                <Input className="h-7 w-14 px-1" type="number" min={0} max={100} aria-label="Discount %" value={l.discountPct || ""} placeholder="%" onChange={(e) => setCart(cart.map((x) => (x.itemId === l.itemId ? { ...x, discountPct: Math.min(100, Number(e.target.value) || 0) } : x)))} />
                <span className="w-24 text-right tabular-nums">{inr(lineTotal(l))}</span>
                <button type="button" aria-label="Remove" onClick={() => setCart(cart.filter((x) => x.itemId !== l.itemId))}><Trash2 className="size-4 text-muted" aria-hidden /></button>
              </li>
            ))}
          </ul>
          <div className="space-y-2 border-t border-border p-4 text-sm">
            <div className="grid grid-cols-2 gap-2"><Input aria-label="Customer name" placeholder="Customer name (optional)" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /><Input aria-label="Mobile" placeholder="Mobile (optional)" value={buyer.mobile} onChange={(e) => setBuyer({ ...buyer, mobile: e.target.value })} /></div>
            {gross !== total && <p className="flex justify-between text-xs text-muted"><span>Round off</span><span>{inr(total - gross)}</span></p>}
            <p className="flex justify-between text-xl font-semibold"><span>Total</span><span className="tabular-nums">{inr(total)}</span></p>
            <Button className="w-full" size="lg" disabled={!cart.length} onClick={() => setPaying(true)}>Take payment</Button>
          </div>
        </Card>
      </div>
      {last && <Card className="flex flex-wrap items-center gap-3 p-3 text-sm"><Badge tone="success">{last.kind === "return" ? "Refunded" : "Paid"}</Badge><span>{last.number} · {inr(last.total)}{last.change ? ` · change ${inr(last.change)}` : ""}</span><Link className="ml-auto text-primary hover:underline" href={`/print/pos-receipt/${last.id}`} target="_blank">Print receipt</Link></Card>}
      {paying && (
        <Payment
          total={total}
          onClose={() => setPaying(false)}
          onPay={async (tenders) => {
            const body = { clientRef: clientRef(), buyerName: buyer.name || null, buyerMobile: buyer.mobile || null, lines: cart.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, discountPct: l.discountPct })), tenders };
            const r = await sendOrQueue<Sale>(`/pos/sessions/${till.openSessionId}/sales`, body, `Sale ${inr(total)}`);
            if (r.queued) setMsg({ tone: "warning", text: "No connection: the sale is kept on this till and will be sent when the connection is back. Give a handwritten receipt if needed." });
            else {
              setLast(r.result);
              setMsg(null);
            }
            setCart([]);
            setBuyer({ name: "", mobile: "" });
            setPaying(false);
          }}
        />
      )}
    </div>
  );
}

function Payment({ total, onClose, onPay }: { total: number; onClose: () => void; onPay: (t: { mode: string; amount: number; ref?: string | null }[]) => Promise<void> }) {
  const [t, setT] = useState({ cash: String(total), card: "", upi: "", ref: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paid = Number(t.cash || 0) + Number(t.card || 0) + Number(t.upi || 0);
  const change = Math.round((paid - total) * 100) / 100;
  async function pay() {
    setError(null);
    setBusy(true);
    try {
      await onPay([
        ...(Number(t.cash) ? [{ mode: "cash", amount: Number(t.cash) }] : []),
        ...(Number(t.card) ? [{ mode: "card", amount: Number(t.card), ref: t.ref || null }] : []),
        ...(Number(t.upi) ? [{ mode: "upi", amount: Number(t.upi), ref: t.ref || null }] : []),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Payment · ${inr(total)}`} footer={<Button size="lg" loading={busy} disabled={paid < total} onClick={pay}>{change > 0 ? `Done · change ${inr(change)}` : "Done"}</Button>}>
      <div className="space-y-2 text-sm">
        {error && <Alert>{error}</Alert>}
        {(["cash", "card", "upi"] as const).map((m) => (
          <label key={m} className="flex items-center justify-between gap-3"><span className="w-16 font-medium uppercase">{m}</span><Input type="number" min={0} step="0.01" value={t[m]} onChange={(e) => setT({ ...t, [m]: e.target.value })} /><button type="button" className="text-xs text-primary hover:underline" onClick={() => setT({ cash: "", card: "", upi: "", ref: t.ref, [m]: String(total) })}>Full</button></label>
        ))}
        <Input aria-label="Card / UPI reference" placeholder="Card last 4 digits / UPI reference" value={t.ref} onChange={(e) => setT({ ...t, ref: e.target.value })} />
        <p className={`text-right ${paid < total ? "text-danger" : "text-muted"}`}>{paid < total ? `${inr(total - paid)} still to pay` : `Paid ${inr(paid)}`}</p>
      </div>
    </Dialog>
  );
}
