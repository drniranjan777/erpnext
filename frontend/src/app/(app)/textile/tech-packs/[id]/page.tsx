"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";

interface Point { code: string; description: string; tolerance: number; sizes: Record<string, number> }
interface Material { component: string; description: string; consumption: number; unit: string; supplier?: string | null }
interface Sample { id: string; type: string; round: number; colour: string | null; size: string | null; sentOn: string | null; status: string; buyerComments: string | null; decidedOn: string | null; check: { outOfTolerance: number; checked: number; rows: { code: string; deviation: number; ok: boolean }[] } | null }
interface Pack { id: string; styleNo: string; buyerId: string | null; buyer: string | null; season: string | null; description: string; version: number; status: string; sizes: string[]; colours: string[]; materials: Material[]; measurements: Point[]; construction: string | null; requiredCertificates: string[]; samples: Sample[]; orders: { id: string; poNo: string; buyer: string; exFactory: string; status: string }[] }

const SAMPLE_TYPES: Record<string, string> = { lab_dip: "Lab dip", proto: "Proto", fit: "Fit", size_set: "Size set", pp: "Pre-production", top: "Top of production", shipment: "Shipment" };
const CERTS = ["gots", "oekotex", "organic", "iso14001", "other"];
const STONE: Record<string, "warning" | "success" | "danger" | "primary"> = { pending: "primary", approved: "success", approved_with_comments: "warning", rejected: "danger" };

/** One style's tech pack and its samples. */
export default function TechPackPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["/textile/tech-packs", id], queryFn: () => api<Pack>(`/textile/tech-packs/${id}`) });
  if (!q.data) return null;
  return <PackEditor key={q.dataUpdatedAt} pack={q.data} />;
}

function PackEditor({ pack }: { pack: Pack }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("textile.orders.manage");
  const [materials, setMaterials] = useState(pack.materials);
  const [points, setPoints] = useState(pack.measurements);
  const [construction, setConstruction] = useState(pack.construction ?? "");
  const [certs, setCerts] = useState(pack.requiredCertificates);
  const [s, setS] = useState({ type: "fit", colour: "", size: "", measured: {} as Record<string, string> });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/textile/tech-packs"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const save = () => run(() => api("/textile/tech-packs", { body: { styleNo: pack.styleNo, buyerId: pack.buyerId, season: pack.season, description: pack.description, sizes: pack.sizes, colours: pack.colours, materials, measurements: points, construction: construction || null, requiredCertificates: certs } }), pack.status === "approved" ? "Saved as a new draft version." : "Saved.");
  const setP = (i: number, p: Partial<Point>) => setPoints(points.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setM = (i: number, p: Partial<Material>) => setMaterials(materials.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const decide = (id: string, status: string) => {
    const c = window.prompt(status === "approved" ? "Buyer comments (optional)" : "Buyer comments");
    if (c === null) return;
    run(() => api(`/textile/samples/${id}/decision`, { body: { status, buyerComments: c || null } }), "Decision recorded.");
  };
  return (
    <div className="space-y-4">
      <PageHeader title={`${pack.styleNo} · ${pack.description}`} description={`${pack.buyer ?? "No buyer"}${pack.season ? ` · ${pack.season}` : ""} · version ${pack.version} · ${pack.status} · sizes ${pack.sizes.join(", ")} · colours ${pack.colours.join(", ") || "–"}`} actions={manage && <span className="flex gap-2"><Button variant="secondary" onClick={save}>Save</Button>{pack.status !== "approved" && <Button onClick={() => run(() => api(`/textile/tech-packs/${pack.id}/approve`, { body: {} }), "Approved.")}>Approve</Button>}</span>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Materials" />
        <div className="space-y-2 border-t border-border p-4 text-sm">
          {materials.map((m, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_6rem_5rem_1fr]">
              <Input aria-label="Component" value={m.component} onChange={(e) => setM(i, { component: e.target.value })} placeholder="Component" />
              <Input aria-label="Description" value={m.description} onChange={(e) => setM(i, { description: e.target.value })} placeholder="Fabric / trim" />
              <Input aria-label="Consumption" type="number" step="any" value={m.consumption} onChange={(e) => setM(i, { consumption: Number(e.target.value) })} />
              <Input aria-label="Unit" value={m.unit} onChange={(e) => setM(i, { unit: e.target.value })} />
              <Input aria-label="Supplier" value={m.supplier ?? ""} onChange={(e) => setM(i, { supplier: e.target.value || null })} placeholder="Supplier" />
            </div>
          ))}
          {manage && <Button size="sm" variant="secondary" onClick={() => setMaterials([...materials, { component: "", description: "", consumption: 0, unit: "m" }])}>Add material</Button>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Measurement chart (cm)" />
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs text-muted"><tr><th className="p-1">Point</th><th className="p-1">Description</th><th className="p-1">± tol</th>{pack.sizes.map((z) => <th key={z} className="p-1">{z}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {points.map((p, i) => (
                <tr key={i}>
                  <td className="p-1"><Input className="h-8 w-14" aria-label="Code" value={p.code} onChange={(e) => setP(i, { code: e.target.value })} /></td>
                  <td className="p-1"><Input className="h-8" aria-label="Point description" value={p.description} onChange={(e) => setP(i, { description: e.target.value })} /></td>
                  <td className="p-1"><Input className="h-8 w-16" type="number" step="any" aria-label="Tolerance" value={p.tolerance} onChange={(e) => setP(i, { tolerance: Number(e.target.value) })} /></td>
                  {pack.sizes.map((z) => <td key={z} className="p-1"><Input className="h-8 w-16" type="number" step="any" aria-label={`Size ${z}`} value={p.sizes[z] ?? ""} onChange={(e) => setP(i, { sizes: { ...p.sizes, [z]: Number(e.target.value) } })} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {manage && <div className="border-t border-border p-3"><Button size="sm" variant="secondary" onClick={() => setPoints([...points, { code: String.fromCharCode(65 + points.length), description: "", tolerance: 1, sizes: {} }])}>Add point</Button></div>}
      </Card>
      <Card>
        <CardHeader title="Construction and certificates" />
        <div className="space-y-2 border-t border-border p-4 text-sm">
          <textarea aria-label="Construction" rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2" value={construction} onChange={(e) => setConstruction(e.target.value)} placeholder="Stitching, seams, labels, washing, packing" />
          <div className="flex flex-wrap gap-3">{CERTS.map((c) => <label key={c} className="flex items-center gap-1"><input type="checkbox" checked={certs.includes(c)} onChange={(e) => setCerts(e.target.checked ? [...certs, c] : certs.filter((x) => x !== c))} /> {c === "oekotex" ? "OEKO-TEX" : c.toUpperCase()}</label>)}</div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Samples" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {pack.samples.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <Badge tone={STONE[x.status]}>{x.status.replaceAll("_", " ")}</Badge>
              <span className="font-medium">{SAMPLE_TYPES[x.type]} round {x.round}</span>
              <span className="text-xs text-muted">{[x.colour, x.size].filter(Boolean).join(" · ")}{x.sentOn ? ` · sent ${formatDate(x.sentOn)}` : ""}{x.decidedOn ? ` · decided ${formatDate(x.decidedOn)}` : ""}</span>
              {x.check && x.check.checked > 0 && <Badge tone={x.check.outOfTolerance ? "danger" : "success"}>{x.check.outOfTolerance ? `${x.check.outOfTolerance} point(s) out of tolerance: ${x.check.rows.filter((r) => !r.ok).map((r) => `${r.code} ${r.deviation > 0 ? "+" : ""}${r.deviation}`).join(", ")}` : "measurements in tolerance"}</Badge>}
              {x.buyerComments && <span className="w-full text-xs">Buyer: {x.buyerComments}</span>}
              {manage && x.status === "pending" && <span className="ml-auto flex gap-1"><Button size="sm" variant="secondary" onClick={() => decide(x.id, "approved")}>Approved</Button><Button size="sm" variant="secondary" onClick={() => decide(x.id, "approved_with_comments")}>With comments</Button><Button size="sm" variant="secondary" onClick={() => decide(x.id, "rejected")}>Rejected</Button></span>}
            </li>
          ))}
        </ul>
        {manage && (
          <div className="space-y-2 border-t border-border p-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Select className="h-9 w-44" aria-label="Sample type" value={s.type} onChange={(e) => setS({ ...s, type: e.target.value })}>{Object.entries(SAMPLE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              <Select className="h-9 w-32" aria-label="Colour" value={s.colour} onChange={(e) => setS({ ...s, colour: e.target.value })}><option value="">Colour</option>{pack.colours.map((c) => <option key={c}>{c}</option>)}</Select>
              <Select className="h-9 w-24" aria-label="Size" value={s.size} onChange={(e) => setS({ ...s, size: e.target.value })}><option value="">Size</option>{pack.sizes.map((c) => <option key={c}>{c}</option>)}</Select>
              <Button onClick={() => run(() => api("/textile/samples", { body: { techPackId: pack.id, type: s.type, colour: s.colour || null, size: s.size || null, sentOn: new Date().toISOString().slice(0, 10), measured: Object.fromEntries(Object.entries(s.measured).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])) } }), "Sample sent.").then(() => setS({ ...s, measured: {} }))}>Send sample</Button>
            </div>
            {s.size && <div className="flex flex-wrap gap-2">{pack.measurements.map((p) => <label key={p.code} className="flex items-center gap-1 text-xs">{p.code} ({p.sizes[s.size] ?? "–"})<Input className="h-8 w-20" type="number" step="any" value={s.measured[p.code] ?? ""} onChange={(e) => setS({ ...s, measured: { ...s.measured, [p.code]: e.target.value } })} /></label>)}</div>}
          </div>
        )}
      </Card>
      {pack.orders.length > 0 && <p className="text-sm">Orders: {pack.orders.map((o) => <Link key={o.id} className="mr-3 text-primary hover:underline" href={`/textile/orders/${o.id}`}>{o.poNo} ({o.buyer}, ex-factory {formatDate(o.exFactory)})</Link>)}</p>}
    </div>
  );
}
