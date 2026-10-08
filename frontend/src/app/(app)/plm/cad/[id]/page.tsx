"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ESignDialog } from "@/components/esign-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError, apiDownload, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Ref { id: string; number: string; title: string; revision: string; status: string }
interface Cad { id: string; number: string; title: string; format: string; revision: string; status: string; metadata: Record<string, string>; checkedOutBy: string | null; checkedOutByName: string | null; versions: { id: string; version: number; revision: string; fileName: string; sizeBytes: number; sha256: string; note: string | null; uploadedBy: string | null; createdAt: string }[]; uses: Ref[]; usedIn: Ref[] }

/** One vault file. */
export default function CadPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can, me } = useAuth();
  const q = useQuery({ queryKey: ["/plm/cad", id], queryFn: () => api<Cad>(`/plm/cad/${id}`) });
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [signing, setSigning] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/plm/cad"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const c = q.data;
  if (!c) return null;
  const manage = can("plm.cad.manage");
  const mine = !!c.checkedOutBy && c.checkedOutBy === me?.user.id;
  const refs = (title: string, list: Ref[]) => list.length > 0 && <p className="text-sm">{title}: {list.map((r) => <Link key={r.id} className="mr-2 text-primary hover:underline" href={`/plm/cad/${r.id}`}>{r.number} rev {r.revision} ({r.status.replace("_", " ")})</Link>)}</p>;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title={`${c.number} · ${c.title}`}
        description={`${c.format.toUpperCase()} · revision ${c.revision} · ${c.status.replace("_", " ")}${c.checkedOutByName ? ` · checked out by ${c.checkedOutByName}` : ""}`}
        actions={manage && <span className="flex gap-2">{!c.checkedOutBy && c.status !== "obsolete" && <Button variant="secondary" onClick={() => run(() => api(`/plm/cad/${c.id}/check-out`, { body: {} }), "Checked out to you.")}>Check out</Button>}{mine && <Button variant="secondary" onClick={() => run(() => api(`/plm/cad/${c.id}/undo-check-out`, { body: {} }), "Check-out undone.")}>Undo check-out</Button>}{c.status === "in_work" && !c.checkedOutBy && c.versions.length > 0 && <Button onClick={() => setSigning(true)}>Release</Button>}</span>}
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {mine && (
        <Card>
          <CardHeader title="Check in a new version" />
          <div className="flex flex-wrap items-center gap-2 border-t border-border p-4 text-sm">
            <input type="file" aria-label="File" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Input className="h-9 flex-1" aria-label="Note" placeholder="What changed" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button disabled={!file} onClick={() => run(() => apiUpload(`/plm/cad/${c.id}/check-in${note ? `?note=${encodeURIComponent(note)}` : ""}`, file!), "Checked in.").then(() => { setFile(null); setNote(""); })}>Check in</Button>
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="Metadata" />
        <dl className="grid gap-x-6 gap-y-1 border-t border-border p-4 text-sm sm:grid-cols-2">{Object.entries(c.metadata).map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}{!Object.keys(c.metadata).length && <p className="text-muted">None.</p>}</dl>
        <div className="space-y-1 border-t border-border p-4">{refs("Uses", c.uses)}{refs("Used in", c.usedIn)}</div>
      </Card>
      <Card>
        <CardHeader title="Versions" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {c.versions.map((v) => <li key={v.id} className="flex flex-wrap items-center gap-2 px-4 py-2"><Badge>v{v.version} rev {v.revision}</Badge><span>{v.fileName}</span><span className="text-xs text-muted">{Math.round(Number(v.sizeBytes) / 1024)} KB · {v.uploadedBy} · {formatDateTime(v.createdAt)}{v.note ? ` · ${v.note}` : ""} · SHA-256 {v.sha256.slice(0, 12)}…</span><Button size="sm" variant="secondary" className="ml-auto" onClick={() => apiDownload(`/plm/cad/versions/${v.id}/download`, v.fileName)}>Download</Button></li>)}
          {!c.versions.length && <li className="px-4 py-4 text-center text-muted">No version checked in yet.</li>}
        </ul>
      </Card>
      {signing && <ESignDialog meaning={`${c.number} revision ${c.revision} released`} reasonRequired={false} reasonLabel="Comment" onClose={() => setSigning(false)} onSign={async (password, reason) => { await api(`/plm/cad/${c.id}/release`, { body: { password, reason: reason || null } }); qc.invalidateQueries({ queryKey: ["/plm/cad"] }); }} />}
    </div>
  );
}
