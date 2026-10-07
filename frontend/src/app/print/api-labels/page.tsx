"use client";

import { useQuery } from "@tanstack/react-query";
import { toSVG } from "bwip-js/browser";
import { useMemo, useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Labels { labels: { container: number; fields: Record<string, string | null>; qr: string }[]; missing: string[] }

/** API container labels with the QR code the Drugs Rules require (100 × 70 mm). */
export default function ApiLabelsPage() {
  const { status } = useAuth();
  const [f, setF] = useState({ itemId: "", itemLabel: "", batchNo: "", batchSize: "", storage: "", retestDate: "", containers: "1" });
  const [go, setGo] = useState(0);
  const q = useQuery({
    queryKey: ["/pharma/api-labels", f.itemId, f.batchNo, go],
    queryFn: () => api<Labels>("/pharma/api-labels", { query: { itemId: f.itemId, batchNo: f.batchNo, batchSize: f.batchSize || undefined, storage: f.storage || undefined, retestDate: f.retestDate || undefined, containers: f.containers } }),
    enabled: status === "authenticated" && go > 0 && !!f.itemId && !!f.batchNo,
  });
  const svgs = useMemo(() => (q.data?.labels ?? []).map((l) => toSVG({ bcid: "qrcode", text: l.qr, scale: 2, eclevel: "M" } as Parameters<typeof toSVG>[0])), [q.data]);
  return (
    <PrintShell
      title={`API labels${q.data ? ` (${q.data.labels.length})` : ""}`}
      ready={!!q.data}
      toolbar={
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-56">{f.itemLabel ? f.itemLabel : <ItemPicker placeholder="API" onPick={(i) => setF({ ...f, itemId: i.id, itemLabel: `${i.code} · ${i.name}` })} />}</span>
          <input className="h-8 w-28 rounded border border-border px-2" aria-label="Batch" placeholder="Batch" value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />
          <input className="h-8 w-24 rounded border border-border px-2" aria-label="Batch size" placeholder="Batch size" value={f.batchSize} onChange={(e) => setF({ ...f, batchSize: e.target.value })} />
          <input className="h-8 w-40 rounded border border-border px-2" aria-label="Storage" placeholder="Storage" value={f.storage} onChange={(e) => setF({ ...f, storage: e.target.value })} />
          <input className="h-8 w-16 rounded border border-border px-2" type="number" min={1} aria-label="Containers" value={f.containers} onChange={(e) => setF({ ...f, containers: e.target.value })} />
          <button className="h-8 rounded bg-primary px-3 text-primary-foreground" onClick={() => setGo(go + 1)}>Make labels</button>
        </span>
      }
    >
      {q.data?.missing.length ? <p className="mx-auto max-w-[210mm] p-2 text-sm text-danger print:hidden">Missing: {q.data.missing.join(", ")}</p> : null}
      <div className="mx-auto flex max-w-[210mm] flex-wrap gap-2 bg-white p-2">
        {q.data?.labels.map((l, i) => (
          <div key={l.container} className="flex h-[70mm] w-[100mm] gap-2 border border-black p-2 text-[9px] leading-tight text-black" style={{ breakInside: "avoid" }}>
            <div className="w-[34mm] shrink-0" dangerouslySetInnerHTML={{ __html: svgs[i] }} />
            <div className="space-y-0.5">
              <p className="text-[12px] font-bold">{l.fields.apiName}</p>
              {l.fields.brandName && <p>Brand: {l.fields.brandName}</p>}
              <p>Batch: <strong>{l.fields.batchNo}</strong>{l.fields.batchSize ? ` · size ${l.fields.batchSize}` : ""}</p>
              <p>Mfg: {l.fields.mfgDate ?? "–"} · Exp: {l.fields.expiryDate ?? "–"}{l.fields.retestDate ? ` · Retest: ${l.fields.retestDate}` : ""}</p>
              {l.fields.sscc && <p>SSCC: {l.fields.sscc}</p>}
              <p>{l.fields.manufacturer}, {l.fields.address}</p>
              <p>Mfg Lic: {l.fields.licenceNo ?? "–"}</p>
              {l.fields.storage && <p>Storage: {l.fields.storage}</p>}
              <p>Container {l.container} of {q.data.labels.length}</p>
            </div>
          </div>
        ))}
      </div>
    </PrintShell>
  );
}
