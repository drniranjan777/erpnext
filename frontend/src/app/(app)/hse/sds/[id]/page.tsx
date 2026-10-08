"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Sds { id: string; itemId: string; item: { code: string; name: string } | null; version: number; language: string; status: string; sections: Record<string, string>; ghs: { pictograms: string[]; signalWord: string | null; hazardStatements: string[]; precautionaryStatements: string[] }; unNumber: string | null; hazardClass: string | null; packingGroup: string | null; flashPointC: number | null; petroleum: string | null; problems: string[]; history: { id: string; version: number; status: string }[]; sent: { id: string; party: string; via: string; sentAt: string }[]; needsCurrent: { partyId: string; party: string; lastSent: number | null }[] }
interface Catalogue { sections: string[]; pictograms: Record<string, string>; hazardStatements: Record<string, string> }

const codes = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

/** Edit, issue and send one SDS. */
export default function SdsPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["/hse/sds", id], queryFn: () => api<Sds>(`/hse/sds/${id}`) });
  const cat = useQuery({ queryKey: ["/hse/catalogue"], queryFn: () => api<Catalogue>("/hse/catalogue"), staleTime: Infinity });
  if (!q.data || !cat.data) return null;
  return <Editor key={q.dataUpdatedAt} sds={q.data} cat={cat.data} />;
}

function Editor({ sds, cat }: { sds: Sds; cat: Catalogue }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { can } = useAuth();
  const manage = can("hse.sds.manage");
  const [f, setF] = useState({ sections: sds.sections, h: sds.ghs.hazardStatements.join(", "), p: sds.ghs.precautionaryStatements.join(", "), unNumber: sds.unNumber ?? "", hazardClass: sds.hazardClass ?? "", packingGroup: sds.packingGroup ?? "", flashPointC: sds.flashPointC?.toString() ?? "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run<T>(fn: () => Promise<T>, done: string) {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/hse/sds"] });
      return r;
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  async function save() {
    const r = await run(() => api<Sds>("/hse/sds", { body: { itemId: sds.itemId, language: sds.language, sections: f.sections, hazardStatements: codes(f.h), precautionaryStatements: codes(f.p), unNumber: f.unNumber || null, hazardClass: f.hazardClass || null, packingGroup: f.packingGroup || null, flashPointC: f.flashPointC === "" ? null : Number(f.flashPointC) } }), "Saved.");
    if (r && r.id !== sds.id) router.replace(`/hse/sds/${r.id}`);
  }
  const editable = manage && sds.status !== "superseded";
  return (
    <div className="space-y-4">
      <PageHeader
        title={`SDS · ${sds.item?.code} · ${sds.item?.name}`}
        description={`Version ${sds.version} · ${sds.language} · ${sds.status}${sds.status === "issued" ? " (saving starts a new version)" : ""}`}
        actions={
          <span className="flex gap-2">
            {sds.status === "issued" && <Link className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-surface-muted" href={`/print/ghs-label/${sds.itemId}`}>Print GHS label</Link>}
            {editable && <Button variant="secondary" onClick={save}>Save</Button>}
            {manage && sds.status === "draft" && <Button disabled={sds.problems.length > 0} onClick={() => run(() => api(`/hse/sds/${sds.id}/issue`, { body: {} }), "Issued.")}>Issue</Button>}
          </span>
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {sds.problems.length > 0 && <Alert tone="warning">Before issue: {sds.problems.join("; ")}</Alert>}
      <Card>
        <CardHeader title="Classification and transport" description={`${sds.ghs.signalWord ?? "No signal word"} · ${sds.ghs.pictograms.map((p) => `${p} ${cat.pictograms[p]}`).join(", ") || "no pictograms"}${sds.petroleum ? ` · petroleum class ${sds.petroleum}` : ""}`} />
        <div className="grid gap-2 border-t border-border p-4 text-sm sm:grid-cols-2">
          <label className="space-y-1"><span className="text-xs text-muted">Hazard statements (H codes)</span><Input value={f.h} disabled={!editable} onChange={(e) => setF({ ...f, h: e.target.value })} placeholder="H225, H319" /></label>
          <label className="space-y-1"><span className="text-xs text-muted">Precautionary statements (P codes)</span><Input value={f.p} disabled={!editable} onChange={(e) => setF({ ...f, p: e.target.value })} placeholder="P210, P280, P305+P351+P338" /></label>
          <p className="text-xs text-muted sm:col-span-2">{codes(f.h).map((h) => `${h}: ${cat.hazardStatements[h] ?? "unknown code"}`).join(" · ")}</p>
          <div className="grid grid-cols-4 gap-2 sm:col-span-2">
            <Input aria-label="UN number" placeholder="UN1993" value={f.unNumber} disabled={!editable} onChange={(e) => setF({ ...f, unNumber: e.target.value.toUpperCase() })} />
            <Input aria-label="UN class" placeholder="Class (3, 5.1, 8)" value={f.hazardClass} disabled={!editable} onChange={(e) => setF({ ...f, hazardClass: e.target.value })} />
            <Select aria-label="Packing group" value={f.packingGroup} disabled={!editable} onChange={(e) => setF({ ...f, packingGroup: e.target.value })}><option value="">Packing group</option><option>I</option><option>II</option><option>III</option></Select>
            <Input aria-label="Flash point" type="number" placeholder="Flash point °C" value={f.flashPointC} disabled={!editable} onChange={(e) => setF({ ...f, flashPointC: e.target.value })} />
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Sections" />
        <div className="space-y-3 border-t border-border p-4 text-sm">
          {cat.sections.map((title, i) => (
            <label key={title} className="block space-y-1">
              <span className="font-medium">{i + 1}. {title}</span>
              <textarea rows={2} disabled={!editable} className="w-full rounded-lg border border-border bg-surface px-3 py-2" value={f.sections[String(i + 1)] ?? ""} onChange={(e) => setF({ ...f, sections: { ...f.sections, [String(i + 1)]: e.target.value } })} />
            </label>
          ))}
        </div>
      </Card>
      {sds.status === "issued" && (
        <Card>
          <CardHeader title="Distribution" description="Customers who received the product and have not been sent this version." />
          <div className="space-y-2 border-t border-border p-4 text-sm">
            {sds.needsCurrent.map((n) => <p key={n.partyId}>{n.party} <span className="text-xs text-muted">{n.lastSent ? `has version ${n.lastSent}` : "never sent"}</span></p>)}
            {manage && sds.needsCurrent.length > 0 && <Button size="sm" onClick={() => run(() => api(`/hse/sds/${sds.id}/send`, { body: { partyIds: sds.needsCurrent.map((n) => n.partyId) } }), "Recorded as sent.")}>Mark sent to all {sds.needsCurrent.length}</Button>}
            {!sds.needsCurrent.length && <Badge tone="success">Every customer has this version</Badge>}
            {sds.sent.map((s) => <p key={s.id} className="text-xs text-muted">{s.party} · {s.via} · {formatDateTime(s.sentAt)}</p>)}
          </div>
        </Card>
      )}
      <p className="text-xs text-muted">Versions: {sds.history.map((h) => <Link key={h.id} className="mr-2 text-primary hover:underline" href={`/hse/sds/${h.id}`}>v{h.version} ({h.status})</Link>)}</p>
    </div>
  );
}
