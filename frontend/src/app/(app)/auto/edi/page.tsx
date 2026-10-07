"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Partner { id: string; party: string; partyId: string; ourId: string; theirId: string; partMap: Record<string, string> }
interface Msg { id: string; direction: string; type: string; reference: string | null; status: string; error: string | null; createdAt: string; party: string | null; lines: number }
interface Csr { id: string; customer: string; reference: string | null; clause: string | null; requirement: string; howMet: string | null; status: string }

/** EDI with OEMs (EDIFACT) and the customer-specific requirements register. */
export default function EdiPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("auto.edi.manage");
  const partners = useQuery({ queryKey: ["/auto/edi/partners"], queryFn: () => api<Partner[]>("/auto/edi/partners") });
  const messages = useQuery({ queryKey: ["/auto/edi/messages"], queryFn: () => api<Msg[]>("/auto/edi/messages") });
  const csr = useQuery({ queryKey: ["/auto/csr"], queryFn: () => api<Csr[]>("/auto/csr") });
  const [raw, setRaw] = useState("");
  const [send, setSend] = useState({ kind: "desadv", id: "" });
  const [out, setOut] = useState<string | null>(null);
  const [party, setParty] = useState<PickedParty | null>(null);
  const [p, setP] = useState({ ourId: "", theirId: "", map: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  async function run<T>(fn: () => Promise<T>, done: (r: T) => string, tone: (r: T) => "success" | "warning" = () => "success") {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: tone(r), text: done(r) });
      qc.invalidateQueries({ queryKey: ["/auto"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="EDI and customer requirements" description="Delivery schedules (DELFOR) and JIT calls (DELJIT) from OEMs load into the customer's delivery schedules; dispatch advices (DESADV) and invoices (INVOIC) go back. Customer part numbers are mapped to items per partner." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {manage && (
        <Card>
          <CardHeader title="Receive a schedule" />
          <div className="space-y-2 border-t border-border p-4">
            <textarea aria-label="EDIFACT message" rows={5} className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" placeholder="UNB+UNOC:3+… DELFOR or DELJIT" value={raw} onChange={(e) => setRaw(e.target.value)} />
            <Button disabled={raw.length < 10} onClick={() => run(() => api<{ status: string; error: string | null; schedules: number; lines: unknown[] }>("/auto/edi/receive", { body: { raw } }), (r) => (r.error ? r.error : `${r.lines.length} line(s) read; ${r.schedules} schedule(s) updated.`), (r) => (r.error ? "warning" : "success"))}>Read</Button>
          </div>
        </Card>
      )}
      {manage && (
        <Card>
          <CardHeader title="Send" />
          <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
            <Select className="h-9 w-48" aria-label="Message" value={send.kind} onChange={(e) => setSend({ ...send, kind: e.target.value })}><option value="desadv">DESADV for a delivery</option><option value="invoic">INVOIC for an invoice</option></Select>
            <Input className="h-9 flex-1 font-mono" aria-label="Document id" placeholder="Delivery or invoice id (from its page address)" value={send.id} onChange={(e) => setSend({ ...send, id: e.target.value })} />
            <Button disabled={!/^[0-9a-f-]{36}$/i.test(send.id.trim())} onClick={() => run(() => api<{ raw: string }>(`/auto/edi/${send.kind}/${send.id.trim()}`, { body: {} }), (r) => { setOut(r.raw); return "Message created."; })}>Create</Button>
          </div>
          {out && <pre className="max-h-48 overflow-auto border-t border-border p-4 text-xs">{out}</pre>}
        </Card>
      )}
      <Card>
        <CardHeader title="Messages" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {messages.data?.map((m) => <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-1.5"><Badge tone={m.status === "error" ? "danger" : m.direction === "in" ? "neutral" : "success"}>{m.direction} · {m.type}</Badge><span>{m.party ?? "–"}</span><span className="text-xs text-muted">{m.reference ?? ""}{m.lines ? ` · ${m.lines} line(s)` : ""}</span>{m.error && <span className="text-xs text-danger">{m.error}</span>}<span className="ml-auto text-xs text-muted">{formatDateTime(m.createdAt)}</span></li>)}
          {messages.data && !messages.data.length && <li className="px-4 py-4 text-center text-muted">No messages.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Partners" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {partners.data?.map((x) => <li key={x.id} className="px-4 py-1.5">{x.party}: we are <code>{x.ourId}</code>, they are <code>{x.theirId}</code> · {Object.keys(x.partMap).length} part number(s) mapped</li>)}
        </ul>
        {manage && (
          <div className="space-y-2 border-t border-border p-4 text-sm">
            <PartyPicker role="customer" value={party} onChange={setParty} />
            <div className="flex flex-wrap gap-2">
              <Input className="h-9 w-40" aria-label="Our id" placeholder="Our EDI id" value={p.ourId} onChange={(e) => setP({ ...p, ourId: e.target.value })} />
              <Input className="h-9 w-40" aria-label="Their id" placeholder="Their EDI id" value={p.theirId} onChange={(e) => setP({ ...p, theirId: e.target.value })} />
            </div>
            <textarea aria-label="Part map" rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" placeholder={'One per line: customer part number = item id'} value={p.map} onChange={(e) => setP({ ...p, map: e.target.value })} />
            <Button size="sm" disabled={!party || !p.ourId || !p.theirId} onClick={() => run(() => api("/auto/edi/partners", { body: { partyId: party!.id, ourId: p.ourId, theirId: p.theirId, partMap: Object.fromEntries(p.map.split("\n").map((l) => l.split("=").map((x) => x.trim())).filter((x) => x.length === 2 && x[0] && x[1])) } }), () => "Partner saved.")}>Save partner</Button>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Customer-specific requirements" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {csr.data?.map((r) => <li key={r.id} className="space-y-0.5 px-4 py-2"><p className="flex flex-wrap items-center gap-2"><Badge tone={r.status === "met" ? "success" : r.status === "open" ? "warning" : "neutral"}>{r.status.replace("_", " ")}</Badge><span className="font-medium">{r.customer}</span><span className="text-xs text-muted">{r.reference ?? ""}{r.clause ? ` · IATF ${r.clause}` : ""}</span></p><p>{r.requirement}</p>{r.howMet && <p className="text-xs text-muted">Met by: {r.howMet}</p>}</li>)}
          {csr.data && !csr.data.length && <li className="px-4 py-4 text-center text-muted">No customer-specific requirements recorded.</li>}
        </ul>
      </Card>
    </div>
  );
}
