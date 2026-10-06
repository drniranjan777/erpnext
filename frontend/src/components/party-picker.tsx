"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/field";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

export interface PickedParty {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  stateCode: string | null;
  creditDays: number | null;
}

/** Search customers or vendors by name, code or GSTIN. Shows the chosen party with a clear button. */
export function PartyPicker({
  role,
  value,
  onChange,
  disabled,
  invalid,
  id,
}: {
  role: "customer" | "vendor";
  value: PickedParty | null;
  onChange: (p: PickedParty | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const results = useQuery({
    queryKey: ["masters", "parties", "lookup", role, debounced],
    queryFn: () => api<PickedParty[]>("/masters/parties/lookup", { query: { role, q: debounced } }),
    enabled: open && !value,
  });
  const list = results.data ?? [];
  const pick = (p: PickedParty | undefined) => {
    if (!p) return;
    onChange(p);
    setQ("");
    setOpen(false);
  };

  if (value) {
    return (
      <div className={cn("flex h-10 items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-sm", disabled && "opacity-60")}>
        <span className="min-w-0 truncate">
          <span className="font-medium">{value.name}</span> <span className="font-mono text-xs text-muted">{value.gstin ?? value.code}</span>
        </span>
        {!disabled && (
          <button type="button" aria-label={`Change ${role}`} onClick={() => onChange(null)} className="text-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={box}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <Input
        id={id}
        className="pl-9"
        placeholder={`Search ${role}s by name, code or GSTIN`}
        value={q}
        disabled={disabled}
        aria-invalid={invalid}
        role="combobox"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, list.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(list[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {results.isLoading && <li className="px-3 py-2 text-sm text-muted">Searching…</li>}
          {!results.isLoading && !list.length && <li className="px-3 py-2 text-sm text-muted">No {role}s found</li>}
          {list.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(p)}
                className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm", i === active && "bg-primary-soft")}
              >
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="font-mono text-xs text-muted">{p.gstin ?? p.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
