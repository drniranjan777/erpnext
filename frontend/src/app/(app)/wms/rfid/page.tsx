"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { WMS } from "@/lib/wms";

interface Tag { id: string; epc: string; itemCode: string; serialNo: string | null }
interface Gate { ok: boolean; lines: { itemId: string; code: string; expected: number; read: number; missingSerials: string[]; ok: boolean }[]; unexpected: string[] }

/** Pilot: gate readers post EPCs; GS1 SGTIN-96 tags decode to the item's GTIN, other tags are registered here. */
export default function RfidPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: [WMS, "rfid-tags"], queryFn: () => api<Tag[]>(`${WMS}/rfid/tags`) });
  const dns = useQuery({ queryKey: ["/sales/deliveries", "recent"], queryFn: () => api<{ items: { id: string; number: string | null; title: string | null; status: string }[] }>("/sales/deliveries", { query: { limit: 50 } }) });
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [t, setT] = useState({ epc: "", serialNo: "" });
  const [dn, setDn] = useState("");
  const [reads, setReads] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const gate = useQuery({ queryKey: [WMS, "rfid-gate", dn], queryFn: () => api<Gate>(`${WMS}/rfid/deliveries/${dn}`), enabled: !!dn, retry: false });
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
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="RFID gate check (pilot)" description="Readers at the dock post tag reads (API key with floor permission). A delivery is checked against what was read: every unit and serial present, nothing extra." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Check a delivery" />
        <div className="space-y-3 border-t border-border p-4">
          <Field label="Delivery note">{(p) => <Select {...p} className="w-80" value={dn} onChange={(e) => setDn(e.target.value)}><option value="">Choose…</option>{dns.data?.items.map((d) => <option key={d.id} value={d.id}>{d.number ?? "draft"} · {d.title}</option>)}</Select>}</Field>
          {dn && can("wms.tasks.execute") && (
            <div className="flex items-end gap-2">
              <Field label="Reads (paste EPCs, one per line)">{(p) => <textarea {...p} rows={3} className="w-96 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" value={reads} onChange={(e) => setReads(e.target.value)} />}</Field>
              <Button variant="secondary" disabled={!reads.trim()} onClick={() => run(() => api(`${WMS}/rfid/reads`, { body: { gate: "MANUAL", deliveryId: dn, epcs: reads.split(/\s+/).filter(Boolean) } }), "Reads recorded.").then(() => setReads(""))}>Record reads</Button>
            </div>
          )}
          {gate.data && (
            <>
              <p className={`flex items-center gap-2 font-medium ${gate.data.ok ? "text-success" : "text-danger"}`}>{gate.data.ok ? <CheckCircle2 className="size-5" aria-hidden /> : <XCircle className="size-5" aria-hidden />}{gate.data.ok ? "Everything read, nothing extra." : "Does not match."}</p>
              <ul className="divide-y divide-border text-sm">
                {gate.data.lines.map((l) => <li key={l.itemId} className="flex gap-3 py-1.5"><span className="font-mono text-xs">{l.code}</span><span>{l.read} of {l.expected} read</span>{l.missingSerials.length > 0 && <span className="text-xs text-danger">missing {l.missingSerials.join(", ")}</span>}</li>)}
              </ul>
              {gate.data.unexpected.length > 0 && <p className="text-xs text-danger">Not on this delivery: {gate.data.unexpected.join(", ")}</p>}
            </>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Registered tags" description="Only needed for tags that are not GS1 SGTIN-96, or to tie a tag to a serial number." />
        <ul className="max-h-64 divide-y divide-border overflow-auto border-t border-border text-sm">
          {tags.data?.map((x) => <li key={x.id} className="flex gap-3 px-5 py-1.5"><span className="font-mono text-xs">{x.epc}</span><span>{x.itemCode}</span><span className="text-xs text-muted">{x.serialNo}</span></li>)}
        </ul>
        {can("wms.setup.manage") && (
          <div className="space-y-2 border-t border-border p-4">
            {item ? <p className="text-sm">{item.label} <button type="button" className="text-primary" onClick={() => setItem(null)}>change</button></p> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} />}
            <div className="flex flex-wrap items-end gap-3">
              <Field label="EPC (hex)">{(p) => <Input {...p} className="w-72 font-mono" value={t.epc} onChange={(e) => setT({ ...t, epc: e.target.value })} />}</Field>
              <Field label="Serial">{(p) => <Input {...p} className="w-36" value={t.serialNo} onChange={(e) => setT({ ...t, serialNo: e.target.value })} />}</Field>
              <Button variant="secondary" disabled={!item || t.epc.length < 8} onClick={() => run(() => api(`${WMS}/rfid/tags`, { body: { epc: t.epc, itemId: item!.id, serialNo: t.serialNo || null } }), "Tag registered.").then(() => setT({ epc: "", serialNo: "" }))}>Register</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
