"use client";

import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";

export interface Progress { industry: string | null; steps: { key: string; label: string; hint: string; done: boolean; optional: boolean; href: string }[]; done: number; total: number; complete: boolean }

/** The setup checklist: everything, or the next few open steps. */
export function SetupSteps({ p, compact = false }: { p: Progress; compact?: boolean }) {
  const steps = compact ? p.steps.filter((s) => !s.done).slice(0, 4) : p.steps;
  return (
    <ul className="divide-y divide-border">
      {steps.map((s) => (
        <li key={s.key} className="flex items-start gap-3 px-5 py-3">
          {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-label="Done" /> : <Circle className="mt-0.5 size-5 shrink-0 text-border" aria-label="Not done" />}
          <div className="flex-1">
            <p className={`text-sm ${s.done ? "text-muted line-through" : ""}`}>{s.label}{s.optional && <span className="ml-2 text-xs text-muted">optional</span>}</p>
            {!s.done && <p className="text-xs text-muted">{s.hint}</p>}
          </div>
          {!s.done && <Link href={s.href} className="text-sm font-medium text-primary hover:underline">Set up</Link>}
        </li>
      ))}
    </ul>
  );
}
