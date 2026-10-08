"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { DataTable } from "@/components/ui/data-table";

interface Row { id: string; poNo: string; buyer: string; styleNo: string; exFactory: string; status: string; qty: number; value: number; currency: string; late: number; next: { label: string; due: string; state: string } | null; missingCertificates: string[] }
interface Pack { id: string; styleNo: string; description: string; status: string }
interface PackFull { sizes: string[]; colours: string[] }

/** Buyer orders with their time-and-action status. */
export default function BuyerOrdersPage() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["/textile/orders"], queryFn: () => api<Row[]>("/textile/orders") });
  const [creating, setCreating] = useState(false);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Buyer orders" description="Export orders by style with the size × colour breakdown, the time-and-action calendar worked back from ex-factory, and the certificates the buyer requires." actions={can("textile.orders.manage") && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New order</Button>} />
      <Card className="overflow-x-auto">
        <DataTable
          rows={list.data ?? []}
          rowKey={(r) => String(r.id)}
          exportName="textile-orders"
          storageKey="textile-orders-0"
          columns={[
            { key: "po", label: "PO", locked: true, className: "whitespace-normal", render: (r) => <><Link className="font-medium text-primary hover:underline" href={`/textile/orders/${r.id}`}>{r.poNo}</Link></> },
            { key: "buyer", label: "Buyer", className: "whitespace-normal", render: (r) => <>{r.buyer}</> },
            { key: "style", label: "Style", className: "whitespace-normal", render: (r) => <>{r.styleNo}</> },
            { key: "qty", label: "Qty", align: "right", render: (r) => <>{r.qty.toLocaleString("en-IN")}</> },
            { key: "value", label: "Value", align: "right", render: (r) => <>{r.currency} {r.value.toLocaleString("en-IN")}</> },
            { key: "ex-factory", label: "Ex-factory", className: "whitespace-normal", render: (r) => <>{formatDate(r.exFactory)}</> },
            { key: "next", label: "Next", className: "text-xs whitespace-normal", render: (r) => <>{r.status === "shipped" ? "Shipped" : r.next ? `${r.next.label} by ${formatDate(r.next.due)}` : ""}</> },
            { key: "col7", label: "", noSort: true, className: "whitespace-normal", render: (r) => <>{r.late > 0 && <Badge tone="danger">{r.late} late</Badge>} {r.missingCertificates.length > 0 && <Badge tone="warning">needs {r.missingCertificates.join(", ").toUpperCase()}</Badge>}</> },
          ]}
        />
        {list.data && !list.data.length && <p className="p-8 text-center text-muted">No buyer orders.</p>}
      </Card>
      {creating && <NewOrder onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewOrder({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const packs = useQuery({ queryKey: ["/textile/tech-packs"], queryFn: () => api<Pack[]>("/textile/tech-packs") });
  const [buyer, setBuyer] = useState<PickedParty | null>(null);
  const [f, setF] = useState({ poNo: "", techPackId: "", price: "", currency: "USD", poDate: new Date().toISOString().slice(0, 10), exFactory: "", incoterm: "FOB" });
  const pack = useQuery({ queryKey: ["/textile/tech-packs", f.techPackId], queryFn: () => api<PackFull>(`/textile/tech-packs/${f.techPackId}`), enabled: !!f.techPackId });
  const [qty, setQty] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      const breakdown = Object.fromEntries(Object.entries(qty).map(([c, s]) => [c, Object.fromEntries(Object.entries(s).filter(([, v]) => Number(v) > 0).map(([z, v]) => [z, Number(v)]))]).filter(([, s]) => Object.keys(s).length));
      const r = await api<{ id: string }>("/textile/orders", { body: { buyerId: buyer?.id, poNo: f.poNo, techPackId: f.techPackId, breakdown, price: Number(f.price), currency: f.currency, poDate: f.poDate, exFactory: f.exFactory, incoterm: f.incoterm || null } });
      router.push(`/textile/orders/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const colours = pack.data?.colours.length ? pack.data.colours : ["Default"];
  return (
    <Dialog open onClose={onClose} title="New buyer order" footer={<Button disabled={!buyer || !f.poNo || !f.techPackId || !f.exFactory} onClick={save}>Create</Button>}>
      <div className="space-y-2 text-sm">
        {error && <Alert>{error}</Alert>}
        <PartyPicker role="customer" value={buyer} onChange={setBuyer} />
        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label="PO" placeholder="Buyer PO number" value={f.poNo} onChange={(e) => setF({ ...f, poNo: e.target.value })} />
          <Select className="sm:col-span-2" aria-label="Style" value={f.techPackId} onChange={(e) => setF({ ...f, techPackId: e.target.value })}><option value="">Style…</option>{packs.data?.map((p) => <option key={p.id} value={p.id}>{p.styleNo} · {p.description}</option>)}</Select>
          <Input aria-label="Price" type="number" step="any" placeholder="Price per piece" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          <Input aria-label="Currency" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
          <Input aria-label="Incoterm" value={f.incoterm} onChange={(e) => setF({ ...f, incoterm: e.target.value.toUpperCase() })} />
          <label className="text-xs text-muted">PO date<Input type="date" value={f.poDate} onChange={(e) => setF({ ...f, poDate: e.target.value })} /></label>
          <label className="text-xs text-muted">Ex-factory<Input type="date" value={f.exFactory} onChange={(e) => setF({ ...f, exFactory: e.target.value })} /></label>
        </div>
        {pack.data && (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr><th className="text-left">Colour</th>{pack.data.sizes.map((z) => <th key={z}>{z}</th>)}</tr></thead>
            <tbody>{colours.map((c) => <tr key={c}><td>{c}</td>{pack.data!.sizes.map((z) => <td key={z} className="p-0.5"><Input className="h-8 w-16" type="number" min={0} aria-label={`${c} ${z}`} value={qty[c]?.[z] ?? ""} onChange={(e) => setQty({ ...qty, [c]: { ...qty[c], [z]: e.target.value } })} /></td>)}</tr>)}</tbody>
          </table></div>
        )}
      </div>
    </Dialog>
  );
}
