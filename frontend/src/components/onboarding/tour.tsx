"use client";

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const STEPS = [
  { target: "nav", title: "Everything is in the menu", body: "Sales, purchase, stores, production, quality, accounts and GST, each with the screens your role can use." },
  { target: "search", title: "Jump anywhere with Ctrl+K", body: "Type a document number, an item or a screen name to go straight to it." },
  { target: "dashboard", title: "Make the dashboard yours", body: "Pick the widgets you care about, save your own layout, or put one on a TV on the shop floor." },
  { target: "copilot", title: "Ask the copilot (Ctrl+J)", body: "“Sales this month”, “why is this order stuck?”, “draft a PO for 100 bolts”: in English or Hindi." },
] as const;

/**
 * A short guided tour. Each step points at an element marked with data-tour; steps whose
 * element is not on screen (e.g. the sidebar on a phone) are skipped.
 */
export function Tour({ onClose }: { onClose: () => void }) {
  const steps = STEPS.filter((s) => typeof document !== "undefined" && document.querySelector(`[data-tour="${s.target}"]`)?.getClientRects().length);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];

  useLayoutEffect(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    const update = () => setRect(el?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!step || !rect) return null;
  // Card beside the target, kept inside the viewport.
  const w = 320;
  const left = Math.min(window.innerWidth - w - 16, Math.max(16, rect.right + 16 > window.innerWidth - w ? rect.left - w - 16 : rect.right + 16));
  const top = Math.min(window.innerHeight - 200, Math.max(16, rect.top));
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal aria-label={`Tour step ${i + 1} of ${steps.length}: ${step.title}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="pointer-events-none absolute rounded-xl ring-4 ring-primary ring-offset-2" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />
      <div className="absolute rounded-xl border border-border bg-surface p-4 shadow-2xl" style={{ left, top, width: w }}>
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold">{step.title}</p>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-muted" aria-label="End the tour"><X className="size-4" aria-hidden /></button>
        </div>
        <p className="mt-1 text-sm text-muted">{step.body}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-muted">{i + 1} of {steps.length}</span>
          <div className="flex gap-2">
            {i > 0 && <Button size="sm" variant="secondary" onClick={() => setI(i - 1)}>Back</Button>}
            <Button size="sm" autoFocus onClick={() => (i + 1 < steps.length ? setI(i + 1) : onClose())}>{i + 1 < steps.length ? "Next" : "Done"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
