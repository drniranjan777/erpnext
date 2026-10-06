"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/field";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

export interface PickedItem {
  id: string;
  code: string;
  name: string;
  type: string;
  hsnCode: string | null;
  gstRate: string | null;
  baseUomId: string;
  baseUom: string;
  purchaseUomId: string | null;
  lastPurchaseRate: string | null;
  standardCost: string | null;
  sellingRate: string | null;
}

/**
 * Type-ahead item search (name, code, barcode). A barcode scanner types the code
 * and presses Enter: an exact single match is picked straight away.
 */
export function ItemPicker({ onPick, placeholder = "Search items…", stockOnly }: { onPick: (item: PickedItem) => void; placeholder?: string; stockOnly?: boolean }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ["masters", "items", "lookup", debounced, !!stockOnly],
    queryFn: () => api<PickedItem[]>("/masters/items/lookup", { query: { q: debounced, stockOnly: stockOnly ? "true" : undefined } }),
    enabled: open,
  });

  useEffect(() => {
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (item: PickedItem | undefined) => {
    if (!item) return;
    onPick(item);
    setQ("");
    setActive(0);
  };
  const list = results.data ?? [];

  return (
    <div className="relative" ref={box}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <Input
        className="pl-9"
        placeholder={placeholder}
        value={q}
        aria-label={placeholder}
        aria-expanded={open}
        role="combobox"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={async (e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, list.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            // Scanner path: query immediately rather than waiting for the debounce.
            if (q.trim() && q.trim() !== debounced) {
              const hits = await api<PickedItem[]>("/masters/items/lookup", { query: { q: q.trim() } });
              if (hits.length === 1) return pick(hits[0]);
            }
            pick(list[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {results.isLoading && <li className="px-3 py-2 text-sm text-muted">Searching…</li>}
          {!results.isLoading && !list.length && <li className="px-3 py-2 text-sm text-muted">No items found</li>}
          {list.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(it)}
                className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm", i === active && "bg-primary-soft")}
              >
                <span className="font-mono text-xs text-muted">{it.code}</span>
                <span className="min-w-0 flex-1 truncate">{it.name}</span>
                <span className="text-xs text-muted">{it.baseUom}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
