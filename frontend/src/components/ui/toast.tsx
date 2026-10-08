"use client";

import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type Tone = "success" | "danger" | "info";
interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

let push: ((t: Toast) => void) | null = null;
let nextId = 0;

/** Shows a short message in the corner for a few seconds. */
export function toast(text: string, tone: Tone = "success") {
  push?.({ id: ++nextId, tone, text });
}

const ICON = { success: CheckCircle2, danger: TriangleAlert, info: Info };
const TONE = { success: "text-success", danger: "text-danger", info: "text-primary" };

/** Mounted once; renders the queue of toasts. */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    push = (t) => {
      setToasts((all) => [...all.slice(-3), t]);
      setTimeout(() => setToasts((all) => all.filter((x) => x.id !== t.id)), t.tone === "danger" ? 8000 : 4500);
    };
    return () => {
      push = null;
    };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div key={t.id} role={t.tone === "danger" ? "alert" : "status"} className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-lg">
            <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[t.tone])} aria-hidden />
            <p className="flex-1">{t.text}</p>
            <button onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} className="-mr-1 rounded p-0.5 text-muted hover:text-foreground" aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
