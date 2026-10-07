"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FilePlus2, Loader2, Send, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatCell, type ColumnType } from "@/lib/reports";

type Block =
  | { kind: "table"; title: string; columns: { key: string; label: string; type: ColumnType }[]; rows: Record<string, string | number | null>[]; totals?: Record<string, string>; more?: number; href?: string }
  | { kind: "facts"; title: string; items: { label: string; value: string; tone?: "good" | "bad" | "neutral" }[]; href?: string };
type Action =
  | { kind: "navigate"; label: string; href: string }
  | { kind: "draft"; label: string; docType: string; endpoint: string; body: Record<string, unknown>; summary: string[]; openPath: string };
interface Message { role: "user" | "assistant"; content: string; blocks?: Block[]; actions?: Action[] }

const STORE = "ngerp.copilot";
const load = (): Message[] => {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as Message[];
  } catch {
    return [];
  }
};
const SUGGESTIONS = { en: ["Sales this month", "Overdue invoices", "Late work orders", "Rejects by reason"], hi: ["इस महीने की बिक्री", "बकाया बिल", "स्टॉक कितना है"] };
const TONE = { good: "text-success", bad: "text-danger", neutral: "text-muted" } as const;

/** Copilot panel on every screen: ask about your data, jump to screens, prepare drafts. */
export function Copilot() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => (typeof window === "undefined" ? [] : load()));
  const [text, setText] = useState("");
  const [lang, setLang] = useState<"auto" | "en" | "hi">("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const status = useQuery({ queryKey: ["copilot", "status"], queryFn: () => api<{ mode: "ai" | "basic" }>("/copilot/status"), enabled: open, staleTime: 300_000 });

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-30)));
    } catch {
      // Storage unavailable: the conversation lasts until the page reloads.
    }
    end.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send(content: string) {
    const q = content.trim();
    if (!q || busy) return;
    const next: Message[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ reply: string; blocks: Block[]; actions: Action[] }>("/copilot/chat", { body: { messages: next.slice(-12).map((m) => ({ role: m.role, content: m.content })), language: lang, page: pathname } });
      setMessages((m) => [...m, { role: "assistant", content: r.reply, blocks: r.blocks, actions: r.actions }]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function createDraft(a: Extract<Action, { kind: "draft" }>) {
    setError(null);
    try {
      const doc = await api<{ id: string }>(a.endpoint, { body: a.body });
      setMessages((m) => [...m, { role: "assistant", content: lang === "hi" ? "ड्राफ्ट बन गया। जाँच कर सबमिट करें।" : "Draft created. Check it and submit when ready.", actions: [{ kind: "navigate", label: "Open the draft", href: `${a.openPath}/${doc.id}` }] }]);
      router.push(`${a.openPath}/${doc.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the draft.");
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="fixed right-5 bottom-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg hover:opacity-90" title="Ask the copilot (Ctrl+J)">
        <Sparkles className="size-4" aria-hidden /> Ask
      </button>
    );
  }

  const hindi = lang === "hi";
  return (
    <section className="fixed right-0 bottom-0 z-40 flex h-[min(40rem,85vh)] w-full flex-col border border-border bg-surface shadow-2xl sm:right-5 sm:bottom-5 sm:w-[27rem] sm:rounded-2xl" aria-label="Copilot">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 className="flex-1 text-sm font-semibold">Copilot{status.data?.mode === "basic" && <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-normal text-muted" title="Without an AI key the copilot answers common questions only">Basic</span>}</h2>
        <select aria-label="Language" className="h-8 rounded-md border border-border bg-surface px-1 text-xs" value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
          <option value="auto">Auto</option>
          <option value="en">English</option>
          <option value="hi">हिंदी</option>
        </select>
        <button className="rounded p-1.5 text-muted hover:bg-surface-muted" aria-label="Clear the conversation" onClick={() => setMessages([])}><Trash2 className="size-4" aria-hidden /></button>
        <button className="rounded p-1.5 text-muted hover:bg-surface-muted" aria-label="Close" onClick={() => setOpen(false)}><X className="size-4" aria-hidden /></button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
        {!messages.length && (
          <div className="space-y-3 text-muted">
            <p>{hindi ? "अपने कारोबार के बारे में पूछें: बिक्री, बकाया, स्टॉक, उत्पादन, कोई दस्तावेज़ क्यों रुका है…" : "Ask about your business: sales, dues, stock, production, why a document is stuck… or ask me to draft an order."}</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS[hindi ? "hi" : "en"].map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "space-y-2"}>
            {m.role === "user" ? (
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 whitespace-pre-wrap text-primary-foreground">{m.content}</p>
            ) : (
              <>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.blocks?.map((b, j) => <BlockView key={j} b={b} />)}
                {m.actions?.map((a, j) =>
                  a.kind === "navigate" ? (
                    <Link key={j} href={a.href} className="mr-2 inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:border-primary hover:text-primary">
                      {a.label} <ArrowUpRight className="size-3" aria-hidden />
                    </Link>
                  ) : (
                    <div key={j} className="rounded-xl border border-primary/40 bg-primary-soft/40 p-3">
                      <ul className="mb-2 space-y-0.5 text-xs">{a.summary.map((s) => <li key={s}>{s}</li>)}</ul>
                      <button onClick={() => createDraft(a)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                        <FilePlus2 className="size-3.5" aria-hidden /> {a.label}
                      </button>
                      <p className="mt-1.5 text-[11px] text-muted">{hindi ? "दबाने पर ही ड्राफ्ट बनेगा; आप उसे बदल सकते हैं।" : "Only created when you press this, as a draft you can edit."}</p>
                    </div>
                  ),
                )}
              </>
            )}
          </div>
        ))}
        {busy && <p className="flex items-center gap-2 text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> {hindi ? "देख रहा हूँ…" : "Looking…"}</p>}
        {error && <p className="text-danger">{error}</p>}
        <div ref={end} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <textarea
          aria-label="Your question"
          rows={1}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          placeholder={hindi ? "कुछ भी पूछें…" : "Ask anything…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <button type="submit" disabled={busy || !text.trim()} className="rounded-lg bg-primary p-2.5 text-primary-foreground disabled:opacity-40" aria-label="Send"><Send className="size-4" aria-hidden /></button>
      </form>
    </section>
  );
}

function BlockView({ b }: { b: Block }) {
  if (b.kind === "facts") {
    return (
      <div className="rounded-xl border border-border p-3">
        <p className="mb-1.5 text-xs font-semibold">{b.title}</p>
        <dl className="space-y-1 text-xs">
          {b.items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted">{it.label}</dt>
              <dd className={TONE[it.tone ?? "neutral"] === "text-muted" ? "" : TONE[it.tone ?? "neutral"]}>{it.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  const cols = b.columns.slice(0, 4);
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <p className="flex items-center justify-between bg-surface-muted px-3 py-1.5 text-xs font-semibold">
        {b.title}
        {b.href && <Link href={b.href} className="font-normal text-primary hover:underline">Full report</Link>}
      </p>
      <table className="w-full text-xs">
        <tbody className="divide-y divide-border">
          {b.rows.slice(0, 10).map((r, i) => (
            <tr key={i}>
              {cols.map((c) => <td key={c.key} className={`px-2 py-1 ${["number", "qty", "money", "percent"].includes(c.type) ? "text-right tabular-nums" : "truncate"}`}>{formatCell(c, r[c.key])}</td>)}
            </tr>
          ))}
          {!b.rows.length && <tr><td className="px-2 py-2 text-muted">No rows.</td></tr>}
        </tbody>
      </table>
      {(b.more ?? 0) + Math.max(0, b.rows.length - 10) > 0 && <p className="px-3 py-1 text-[11px] text-muted">and {(b.more ?? 0) + Math.max(0, b.rows.length - 10)} more</p>}
    </div>
  );
}
