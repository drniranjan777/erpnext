"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Rendered {
  html: string;
  formatId?: string | null;
  title: string;
  formats?: { id: string | null; name: string; isDefault: boolean }[];
}

/**
 * Prints server-rendered HTML (documents with the tenant's print formats, or
 * subscription invoices) in a script-less sandboxed iframe.
 * `endpoint` returns { html, title, formats? }, e.g. /documents/:id/print.
 */
export function DocumentPrintView({ endpoint }: { endpoint: string }) {
  const { status } = useAuth();
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const [formatId, setFormatId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  const doc = useQuery({
    queryKey: ["print", endpoint, formatId ?? "default"],
    queryFn: () => api<Rendered>(endpoint, { query: { formatId: formatId ?? undefined } }),
    enabled: status === "authenticated",
  });

  useEffect(() => {
    if (doc.data) document.title = doc.data.title;
  }, [doc.data]);

  return (
    <div className="min-h-screen bg-surface-muted">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <p className="font-medium">{doc.data?.title ?? "Print"}</p>
        <div className="flex items-center gap-2">
          {!!doc.data?.formats && doc.data.formats.length > 1 && (
            <select
              aria-label="Print format"
              className="h-10 rounded-lg border border-border bg-surface px-3 text-sm"
              value={formatId === undefined ? (doc.data.formatId ?? "") : (formatId ?? "")}
              onChange={(e) => setFormatId(e.target.value || null)}
            >
              {doc.data.formats.map((f) => (
                <option key={f.id ?? "builtin"} value={f.id ?? ""}>
                  {f.name}
                  {f.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          )}
          <button
            disabled={!doc.data}
            onClick={() => frame.current?.contentWindow?.print()}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Printer className="size-4" aria-hidden /> Print / Save PDF
          </button>
        </div>
      </div>
      {doc.error && <p className="p-8 text-center text-danger">{(doc.error as Error).message}</p>}
      {!doc.data && !doc.error && (
        <div className="flex justify-center p-16 text-muted">
          <Loader2 className="size-6 animate-spin" aria-label="Loading" />
        </div>
      )}
      {doc.data && (
        <div className="flex justify-center p-4 sm:p-8">
          <iframe
            ref={frame}
            title="Print preview"
            srcDoc={doc.data.html}
            // No scripts: templates are tenant-authored. allow-modals is needed for print().
            sandbox="allow-same-origin allow-modals"
            onLoad={(e) => {
              const body = e.currentTarget.contentDocument?.documentElement;
              if (body) e.currentTarget.style.height = `${Math.max(body.scrollHeight + 40, 1123)}px`;
            }}
            className="w-full max-w-[210mm] rounded bg-white p-[14mm] shadow-lg"
            style={{ height: "297mm" }}
          />
        </div>
      )}
    </div>
  );
}
