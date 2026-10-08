"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ESignDialog } from "@/components/esign-dialog";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface State { itemId: string; code: string; name: string; type: string; stage: string; updatedAt: string; releasedEbom: boolean; releasedCad: boolean; history: { from: string | null; to: string; at: string; by: string; note: string | null }[] }
interface Ebom { id: string; itemId: string; code: string; name: string; revision: string; status: string; lines: number; mbomId: string | null }

const STAGES = ["concept", "design", "prototype", "released", "phase_out", "obsolete"];
const TONE: Record<string, "neutral" | "primary" | "warning" | "success" | "danger"> = { concept: "neutral", design: "primary", prototype: "warning", released: "success", phase_out: "warning", obsolete: "danger" };
const label = (s: string) => s.replace("_", "-");

/** Item lifecycle and engineering BOMs. */
export default function PlmPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { can } = useAuth();
  const manage = can("plm.items.manage");
  const states = useQuery({ queryKey: ["/plm/items"], queryFn: () => api<State[]>("/plm/items") });
  const eboms = useQuery({ queryKey: ["/plm/eboms"], queryFn: () => api<Ebom[]>("/plm/eboms") });
  const [pick, setPick] = useState<{ id: string; label: string } | null>(null);
  const [move, setMove] = useState<{ itemId: string; to: string } | null>(null);
  const [newRev, setNewRev] = useState("A");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/plm"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const go = (itemId: string, to: string) => (to === "released" ? setMove({ itemId, to }) : run(() => api("/plm/items/move", { body: { itemId, to } }), `Moved to ${label(to)}.`));
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Product lifecycle" description="Items move from concept through design and prototype to release (signed, with a released engineering BOM and CAD), then phase-out (no new purchases) and obsolete (no orders at all). Items never put on a lifecycle count as released." actions={<Link className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-surface-muted" href="/plm/cad">CAD vault</Link>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {states.data?.map((s) => (
            <li key={s.itemId} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <Badge tone={TONE[s.stage]}>{label(s.stage)}</Badge>
              <span className="font-medium">{s.code} · {s.name}</span>
              <span className="text-xs text-muted">EBOM {s.releasedEbom ? "released" : "–"} · CAD {s.releasedCad ? "released" : "–"} · {timeAgo(s.updatedAt)}{s.history.at(-1)?.by ? ` by ${s.history.at(-1)!.by}` : ""}</span>
              {manage && <Select className="ml-auto h-8 w-40" aria-label="Move to" value="" onChange={(e) => e.target.value && go(s.itemId, e.target.value)}><option value="">Move to…</option>{STAGES.filter((x) => x !== s.stage).map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>}
            </li>
          ))}
          {states.data && !states.data.length && <li className="px-4 py-6 text-center text-muted">No items on a lifecycle yet.</li>}
        </ul>
        {manage && <div className="flex items-center gap-2 border-t border-border p-3 text-sm">{pick ? <><span>{pick.label}</span><Button size="sm" onClick={() => run(() => api("/plm/items/move", { body: { itemId: pick.id, to: "concept" } }), "Item put on the lifecycle.").then(() => setPick(null))}>Start in concept</Button><Button size="sm" variant="secondary" onClick={() => run(() => api("/plm/items/move", { body: { itemId: pick.id, to: "design" } }), "Item put on the lifecycle.").then(() => setPick(null))}>Start in design</Button></> : <ItemPicker placeholder="Put an item on the lifecycle…" onPick={(i) => setPick({ id: i.id, label: `${i.code} · ${i.name}` })} />}</div>}
      </Card>
      <Card>
        <CardHeader title="Engineering BOMs" description="The design team's parts list by revision; released under signature and turned into a draft manufacturing BOM, with differences shown." />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {eboms.data?.map((e) => <li key={e.id}><Link href={`/plm/eboms/${e.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2 hover:bg-surface-muted"><Badge tone={e.status === "released" ? "success" : e.status === "draft" ? "warning" : "neutral"}>rev {e.revision} {e.status}</Badge><span className="font-medium">{e.code} · {e.name}</span><span className="text-xs text-muted">{e.lines} parts{e.mbomId ? " · manufacturing BOM drafted" : ""}</span></Link></li>)}
          {eboms.data && !eboms.data.length && <li className="px-4 py-4 text-center text-muted">No engineering BOMs.</li>}
        </ul>
        {manage && <NewEbom rev={newRev} setRev={setNewRev} onDone={(id) => router.push(`/plm/eboms/${id}`)} />}
      </Card>
      {move && <ESignDialog meaning="Item released for production and sale" reasonRequired={false} reasonLabel="Comment" onClose={() => setMove(null)} onSign={async (password, reason) => { await api("/plm/items/move", { body: { itemId: move.itemId, to: move.to, password, note: reason || null } }); qc.invalidateQueries({ queryKey: ["/plm"] }); }} />}
    </div>
  );
}

function NewEbom({ rev, setRev, onDone }: { rev: string; setRev: (v: string) => void; onDone: (id: string) => void }) {
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [part, setPart] = useState<{ id: string; label: string } | null>(null);
  const [lines, setLines] = useState<{ itemId: string; label: string; qty: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      const r = await api<{ id: string }>("/plm/eboms", { body: { itemId: item!.id, revision: rev, lines: lines.map((l, i) => ({ findNo: (i + 1) * 10, itemId: l.itemId, qty: Number(l.qty) })) } });
      onDone(r.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="space-y-2 border-t border-border p-4 text-sm">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {item ? <span className="font-medium">{item.label}</span> : <span className="flex-1"><ItemPicker placeholder="Product for a new engineering BOM…" onPick={(i) => setItem({ id: i.id, label: `${i.code} · ${i.name}` })} /></span>}
        <Input className="h-9 w-20" aria-label="Revision" value={rev} onChange={(e) => setRev(e.target.value.toUpperCase())} />
      </div>
      {item && (
        <>
          {lines.map((l, i) => <p key={i} className="flex items-center gap-2"><span className="w-10 text-muted">{(i + 1) * 10}</span><span className="flex-1">{l.label}</span><Input className="h-8 w-24" type="number" step="any" aria-label="Quantity" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></p>)}
          {part ? <p className="flex gap-2"><span className="flex-1">{part.label}</span><Button size="sm" variant="secondary" onClick={() => { setLines([...lines, { itemId: part.id, label: part.label, qty: "1" }]); setPart(null); }}>Add part</Button></p> : <ItemPicker placeholder="Add a part…" onPick={(i) => setPart({ id: i.id, label: `${i.code} · ${i.name}` })} />}
          <Button disabled={!lines.length || lines.some((l) => !Number(l.qty))} onClick={save}>Save draft</Button>
        </>
      )}
    </div>
  );
}
