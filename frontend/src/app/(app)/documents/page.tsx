"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ESignDialog } from "@/components/esign-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError, apiDownload, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Folder { id: string; name: string; parentId: string | null; retentionYears: number | null; files: number }
interface Hit { id: string; title: string; docNo: string | null; tags: string[]; currentVersion: number; legalHold: boolean; retentionUntil: string | null; folder: string; snippet: string | null }
interface Sig { id: string; provider: string; signerName: string; reason: string | null; signedAt: string }
interface FileView { id: string; title: string; docNo: string | null; tags: string[]; folder: string; currentVersion: number; legalHold: boolean; retentionUntil: string | null; status: string; hasText: boolean; disposal: string | null; versions: { id: string; version: number; fileName: string; sizeBytes: number; note: string | null; textExtracted: boolean; uploadedBy: string | null; createdAt: string; available: boolean; signatures: Sig[] }[] }

/** Document store: folders, search, versions, signatures, retention. */
export default function DmsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("docs.files.manage");
  const folders = useQuery({ queryKey: ["/doc-store/folders"], queryFn: () => api<Folder[]>("/doc-store/folders") });
  const [folderId, setFolderId] = useState("");
  const [q, setQ] = useState("");
  const hits = useQuery({ queryKey: ["/doc-store/files", folderId, q], queryFn: () => api<Hit[]>("/doc-store/files", { query: { ...(folderId ? { folderId } : {}), ...(q ? { q } : {}) } }) });
  const [open, setOpen] = useState<string | null>(null);
  const file = useQuery({ queryKey: ["/doc-store/files", "one", open], queryFn: () => api<FileView>(`/doc-store/files/${open}`), enabled: !!open });
  const due = useQuery({ queryKey: ["/doc-store/disposal-due"], queryFn: () => api<{ id: string; title: string; folder: string; retentionUntil: string }[]>("/doc-store/disposal-due"), enabled: manage });
  const [nf, setNf] = useState({ name: "", retentionYears: "" });
  const [nfile, setNfile] = useState({ title: "", docNo: "", tags: "" });
  const [upload, setUpload] = useState<File | null>(null);
  const [signing, setSigning] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run<T>(fn: () => Promise<T>, done: string) {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/doc-store"] });
      return r;
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const f = file.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Documents" description="Company documents in folders, with versions and full-text search (text files and PDFs; scanned images need an OCR service), retention by folder, legal hold, and digital signatures." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {manage && due.data && due.data.length > 0 && <Alert tone="warning">{due.data.length} file(s) are past their retention period and can be disposed of.</Alert>}
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr_1.1fr]">
        <Card>
          <CardHeader title="Folders" />
          <ul className="border-t border-border text-sm">
            <li><button type="button" className={`w-full px-4 py-1.5 text-left hover:bg-surface-muted ${!folderId ? "font-medium" : ""}`} onClick={() => setFolderId("")}>All folders</button></li>
            {folders.data?.map((x) => <li key={x.id}><button type="button" className={`w-full px-4 py-1.5 text-left hover:bg-surface-muted ${folderId === x.id ? "font-medium" : ""}`} onClick={() => setFolderId(x.id)}>{x.name} <span className="text-xs text-muted">{x.files}{x.retentionYears !== null ? ` · ${x.retentionYears} y` : ""}</span></button></li>)}
          </ul>
          {manage && (
            <div className="space-y-1 border-t border-border p-3 text-sm">
              <Input className="h-8" aria-label="Folder" placeholder="New folder" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} />
              <Input className="h-8" type="number" min={0} aria-label="Retention years" placeholder="Keep for years (blank: for ever)" value={nf.retentionYears} onChange={(e) => setNf({ ...nf, retentionYears: e.target.value })} />
              <Button size="sm" disabled={!nf.name} onClick={() => run(() => api("/doc-store/folders", { body: { name: nf.name, retentionYears: nf.retentionYears === "" ? null : Number(nf.retentionYears) } }), "Folder added.").then(() => setNf({ name: "", retentionYears: "" }))}>Add folder</Button>
            </div>
          )}
        </Card>
        <Card>
          <div className="p-3"><Input aria-label="Search" placeholder="Search words in titles, tags and file text" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <ul className="divide-y divide-border border-t border-border text-sm">
            {hits.data?.map((h) => (
              <li key={h.id}>
                <button type="button" className={`w-full px-4 py-2 text-left hover:bg-surface-muted ${open === h.id ? "bg-surface-muted" : ""}`} onClick={() => setOpen(h.id)}>
                  <p className="font-medium">{h.title} {h.docNo && <span className="text-xs text-muted">{h.docNo}</span>} {h.legalHold && <Badge tone="danger">hold</Badge>}</p>
                  <p className="text-xs text-muted">{h.folder} · v{h.currentVersion}{h.tags.length ? ` · ${h.tags.join(", ")}` : ""}</p>
                  {h.snippet && <p className="text-xs">{h.snippet}</p>}
                </button>
              </li>
            ))}
            {hits.data && !hits.data.length && <li className="px-4 py-6 text-center text-muted">Nothing found.</li>}
          </ul>
          {manage && folderId && (
            <div className="space-y-1 border-t border-border p-3 text-sm">
              <Input className="h-8" aria-label="Title" placeholder="New file title" value={nfile.title} onChange={(e) => setNfile({ ...nfile, title: e.target.value })} />
              <div className="flex gap-1"><Input className="h-8" aria-label="Document number" placeholder="Doc no." value={nfile.docNo} onChange={(e) => setNfile({ ...nfile, docNo: e.target.value })} /><Input className="h-8" aria-label="Tags" placeholder="Tags, comma separated" value={nfile.tags} onChange={(e) => setNfile({ ...nfile, tags: e.target.value })} /></div>
              <Button size="sm" disabled={nfile.title.length < 2} onClick={() => run(() => api<{ id: string }>("/doc-store/files", { body: { folderId, title: nfile.title, docNo: nfile.docNo || null, tags: nfile.tags.split(",").map((t) => t.trim()).filter(Boolean) } }), "File added: upload its first version.").then((r) => { if (r) setOpen(r.id); setNfile({ title: "", docNo: "", tags: "" }); })}>Add file</Button>
            </div>
          )}
        </Card>
        {f && (
          <Card>
            <CardHeader title={f.title} description={`${f.folder} · ${f.status}${f.retentionUntil ? ` · keep until ${f.retentionUntil}` : " · kept for ever"}${f.hasText ? " · searchable" : ""}`} action={manage && f.status === "active" && <span className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => run(() => api(`/doc-store/files/${f.id}/hold`, { body: { legalHold: !f.legalHold } }), f.legalHold ? "Hold lifted." : "Legal hold placed.")}>{f.legalHold ? "Lift hold" : "Legal hold"}</Button>{!f.disposal && <Button size="sm" variant="secondary" onClick={() => window.confirm("Dispose of the file? Its content is deleted; the record stays.") && run(() => api(`/doc-store/files/${f.id}/dispose`, { body: {} }), "Disposed of.")}>Dispose</Button>}</span>} />
            {manage && f.status === "active" && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border p-3 text-sm">
                <input type="file" aria-label="File" onChange={(e) => setUpload(e.target.files?.[0] ?? null)} />
                <Button size="sm" disabled={!upload} onClick={() => run(() => apiUpload(`/doc-store/files/${f.id}/versions`, upload!), "New version added.").then(() => setUpload(null))}>Upload version</Button>
              </div>
            )}
            <ul className="divide-y divide-border border-t border-border text-sm">
              {f.versions.map((v) => (
                <li key={v.id} className="space-y-1 px-4 py-2">
                  <p className="flex flex-wrap items-center gap-2"><Badge>v{v.version}</Badge>{v.fileName}<span className="text-xs text-muted">{Math.round(Number(v.sizeBytes) / 1024)} KB · {v.uploadedBy} · {formatDateTime(v.createdAt)}{v.textExtracted ? "" : " · no text"}</span>
                    <span className="ml-auto flex gap-1">
                      {v.available && <Button size="sm" variant="secondary" onClick={() => apiDownload(`/doc-store/versions/${v.id}/download`, v.fileName)}>Download</Button>}
                      {can("docs.files.sign") && v.version === f.currentVersion && f.status === "active" && <Button size="sm" variant="secondary" onClick={() => setSigning(v.id)}>Sign</Button>}
                    </span>
                  </p>
                  {v.signatures.map((s) => <p key={s.id} className="text-xs">✍ {s.signerName} · {s.provider} · {formatDateTime(s.signedAt)}{s.reason ? ` · ${s.reason}` : ""}</p>)}
                  {v.signatures.length > 0 && (verified[v.id] === undefined ? <button type="button" className="text-xs text-primary hover:underline" onClick={() => api<{ valid: boolean }[]>(`/doc-store/versions/${v.id}/verify`).then((r) => setVerified({ ...verified, [v.id]: r.every((x) => x.valid) }))}>Verify signatures</button> : <Badge tone={verified[v.id] ? "success" : "danger"}>{verified[v.id] ? "signatures valid" : "signature check failed"}</Badge>)}
                </li>
              ))}
              {!f.versions.length && <li className="px-4 py-4 text-center text-muted">No version uploaded yet.</li>}
            </ul>
          </Card>
        )}
      </div>
      {signing && <SignDialog versionId={signing} onClose={() => setSigning(null)} onDone={() => qc.invalidateQueries({ queryKey: ["/doc-store"] })} />}
    </div>
  );
}

function SignDialog({ versionId, onClose, onDone }: { versionId: string; onClose: () => void; onDone: () => void }) {
  const [provider, setProvider] = useState("sandbox");
  return (
    <>
      <div className="fixed inset-x-0 top-4 z-[60] mx-auto w-80 rounded-lg border border-border bg-surface p-2 text-sm shadow">
        <Select aria-label="Signing service" value={provider} onChange={(e) => setProvider(e.target.value)}><option value="sandbox">Sandbox signer (testing)</option><option value="aadhaar_esign">Aadhaar eSign</option><option value="dsc">DSC token</option></Select>
      </div>
      <ESignDialog meaning="Document signed" reasonRequired={false} reasonLabel="Reason" onClose={onClose} onSign={async (password, reason) => { await api(`/doc-store/versions/${versionId}/sign`, { body: { provider, password, reason: reason || null } }); onDone(); }} />
    </>
  );
}
