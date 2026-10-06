"use client";

import { useQuery } from "@tanstack/react-query";
import { ScanText } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { api, ApiError, apiUpload } from "@/lib/api";
import type { CapturedBill } from "../pi-form";

/** Upload a supplier's bill; its fields fill the form below for review. */
export function BillCapture({ onRead }: { onRead: (c: CapturedBill) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const status = useQuery({ queryKey: ["purchase", "capture-status"], queryFn: () => api<{ ai: boolean; accepts: string[] }>("/purchase/invoices/capture/status"), staleTime: Infinity });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CapturedBill | null>(null);
  async function read(file: File) {
    setBusy(true);
    setError(null);
    try {
      const r = await apiUpload<CapturedBill>("/purchase/invoices/capture", file);
      setResult(r);
      onRead(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  const ai = status.data?.ai;
  const matched = result ? result.lines.filter((l) => l.item).length : 0;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <ScanText className="size-8 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Read the bill for me</p>
          <p className="text-sm text-muted">{ai ? "Upload the PDF, a photo or a scan: the vendor, number, date and rows are filled in and matched to your goods receipts." : "Upload the bill as text (AI reading of PDFs and scans needs to be switched on by your administrator)."}</p>
        </div>
        <input ref={input} type="file" className="hidden" accept={(status.data?.accepts ?? ["text/plain"]).join(",")} onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}>Upload bill</Button>
      </div>
      {error && <div className="px-5 pb-4"><Alert>{error}</Alert></div>}
      {result && (
        <div className="space-y-2 border-t border-border px-5 py-3 text-sm">
          <p>
            Read <strong>{result.fileName}</strong> ({result.extractor === "ai" ? "AI" : "text"}) ·{" "}
            <Badge tone={result.confidence >= 0.8 ? "success" : result.confidence >= 0.5 ? "warning" : "danger"}>{Math.round(result.confidence * 100)}% confident</Badge> · {matched} of {result.lines.length} rows matched
            {result.vendor ? ` · vendor ${result.vendor.name}` : ""}
          </p>
          {result.warnings.length > 0 && (
            <Alert tone="warning">
              <ul className="list-disc pl-4">
                {result.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </Alert>
          )}
          <p className="text-muted">Check every field below before saving.</p>
        </div>
      )}
    </Card>
  );
}
