"use client";

import { Loader2, Mic, MicOff, Send, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";

const LANGS = [
  { code: "en-IN", name: "English" },
  { code: "hi-IN", name: "हिन्दी" },
  { code: "te-IN", name: "తెలుగు" },
  { code: "ta-IN", name: "தமிழ்" },
  { code: "mr-IN", name: "मराठी" },
  { code: "kn-IN", name: "ಕನ್ನಡ" },
  { code: "gu-IN", name: "ગુજરાતી" },
  { code: "bn-IN", name: "বাংলা" },
];

interface VoiceReply {
  logId: string;
  kind: "confirm" | "answer" | "clarify";
  reply: string;
  command?: "work_order" | "requisition" | "stock" | null;
  params?: Record<string, unknown>;
  summary?: { label: string; value: string }[];
  notes?: string[];
}

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; start(): void; stop(): void };

function recogniser(): Recognition | null {
  if (typeof window === "undefined") return null;
  const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const C = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  return C ? new C() : null;
}

function speak(text: string, lang: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    // No speech output on this device.
  }
}

/** Voice commands from any screen: speak (or type) "Line 2 par 5,000 units ka production order banao". */
export function VoiceButton() {
  const [open, setOpen] = useState(false);
  // The panel only renders after a click, so reading storage here cannot cause a hydration mismatch.
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem("voice_lang") ?? "en-IN";
    } catch {
      return "en-IN";
    }
  });
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<VoiceReply | null>(null);
  const [done, setDone] = useState<{ link: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const supported = typeof window !== "undefined" && !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  const send = useCallback(
    async (text: string) => {
      setBusy(true);
      setError(null);
      setDone(null);
      try {
        const r = await api<VoiceReply>("/voice/interpret", { body: { text, lang } });
        setReply(r);
        speak(r.reply, lang);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [lang],
  );

  function listen() {
    const r = recogniser();
    if (!r) return;
    rec.current = r;
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    setHeard("");
    setReply(null);
    let final = "";
    r.onresult = (e) => {
      const parts = Array.from(e.results as ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>);
      final = parts.map((x) => x[0].transcript).join(" ");
      setHeard(final);
    };
    r.onerror = (e) => {
      setListening(false);
      if (e.error !== "no-speech" && e.error !== "aborted") setError(e.error === "not-allowed" ? "Microphone access is blocked for this site." : `Speech recognition: ${e.error}`);
    };
    r.onend = () => {
      setListening(false);
      if (final.trim()) send(final.trim());
    };
    setListening(true);
    r.start();
  }

  async function confirm() {
    if (!reply?.params || !reply.command || reply.command === "stock") return;
    setBusy(true);
    try {
      const r = await api<{ link: string }>("/voice/execute", { body: { logId: reply.logId, command: reply.command, params: reply.params } });
      setDone(r);
      speak(lang.startsWith("hi") ? "बन गया, ड्राफ्ट में है।" : "Done. It is saved as a draft.", lang);
      setReply(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (reply) await api(`/voice/logs/${reply.logId}/cancel`, { body: {} }).catch(() => null);
    setReply(null);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="fixed right-5 bottom-20 z-40 inline-flex size-12 items-center justify-center rounded-full border border-border bg-surface text-primary shadow-lg hover:bg-surface-muted" title="Voice command" aria-label="Voice command">
        <Mic className="size-5" aria-hidden />
      </button>
    );
  }
  return (
    <section className="fixed right-0 bottom-0 z-50 w-full space-y-3 border border-border bg-surface p-4 shadow-2xl sm:right-5 sm:bottom-20 sm:w-96 sm:rounded-2xl" aria-label="Voice command">
      <div className="flex items-center gap-2">
        <p className="flex-1 font-medium">Voice command</p>
        <Select className="h-8 w-28" aria-label="Language" value={lang} onChange={(e) => { setLang(e.target.value); try { localStorage.setItem("voice_lang", e.target.value); } catch {} }}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </Select>
        <button type="button" aria-label="Close" onClick={() => { rec.current?.stop(); setOpen(false); }}><X className="size-4" aria-hidden /></button>
      </div>
      {supported ? (
        <Button className="w-full" size="lg" variant={listening ? "secondary" : "primary"} onClick={() => (listening ? rec.current?.stop() : listen())}>
          {listening ? <><MicOff className="size-5" aria-hidden /> Listening… tap to stop</> : <><Mic className="size-5" aria-hidden /> Tap and speak</>}
        </Button>
      ) : (
        <p className="text-xs text-muted">Speech is not available in this browser; type the command instead.</p>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) send(typed.trim()); setTyped(""); }}>
        <Input className="h-9 flex-1" placeholder="Line 2 par 5,000 units ka production order banao" aria-label="Command" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Button size="sm" variant="secondary" type="submit" aria-label="Send"><Send className="size-4" aria-hidden /></Button>
      </form>
      {heard && <p className="text-sm text-muted">“{heard}”</p>}
      {busy && <Loader2 className="size-5 animate-spin text-muted" aria-hidden />}
      {error && <Alert>{error}</Alert>}
      {reply && (
        <div className="space-y-2 rounded-lg bg-surface-muted p-3 text-sm">
          <p className="font-medium">{reply.reply}</p>
          {reply.summary && <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs">{reply.summary.map((s) => <div key={s.label} className="contents"><dt className="text-muted">{s.label}</dt><dd>{s.value}</dd></div>)}</dl>}
          {reply.notes?.map((n) => <p key={n} className="text-xs text-warning">{n}</p>)}
          {reply.kind === "confirm" && (
            <div className="flex gap-2">
              <Button size="sm" loading={busy} onClick={confirm}>{lang.startsWith("hi") ? "हाँ, बनाओ" : "Yes, create"}</Button>
              <Button size="sm" variant="ghost" onClick={cancel}>{lang.startsWith("hi") ? "रद्द" : "Cancel"}</Button>
            </div>
          )}
        </div>
      )}
      {done && <Alert tone="success">Draft created. <Link className="underline" href={done.link}>Open it</Link></Alert>}
    </section>
  );
}
