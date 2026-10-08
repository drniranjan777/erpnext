"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download } from "lucide-react";
import { isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  label: string;
  align?: "right";
  render: (row: T) => React.ReactNode;
  /** Value for sorting and export when the rendered text is not enough. */
  value?: (row: T) => string | number | null;
  /** Never hidden by the column chooser (the link column). */
  locked?: boolean;
  /** Not sortable (actions, badges with no order). */
  noSort?: boolean;
  className?: string;
}

/** Plain text of rendered cell content, for sorting and CSV. */
export function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ").replace(/\s+/g, " ").trim();
  if (isValidElement(node)) return nodeText((node.props as { children?: React.ReactNode }).children);
  return "";
}

const DATE = /^\d{1,2} [A-Z][a-z]{2} \d{4}/;
function sortable(v: string | number | null): string | number {
  if (v == null) return "";
  if (typeof v === "number") return v;
  const t = v.trim();
  const num = t.replace(/[₹,%\s]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(num)) return Number(num);
  if (DATE.test(t)) return Date.parse(t.match(DATE)![0]);
  return t.toLowerCase();
}
const compare = (a: string | number, b: string | number) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "en-IN", { numeric: true }));

function readHidden(key?: string): string[] {
  if (!key) return [];
  try {
    return JSON.parse(localStorage.getItem(`cols:${key}`) ?? "[]");
  } catch {
    return [];
  }
}

/** Downloads rows as a CSV file. */
export function downloadCsv(name: string, header: string[], rows: string[][]) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface DataTableProps<T> {
  rows: T[];
  rowKey: (row: T) => string;
  columns: Column<T>[];
  /** Remembers hidden columns under this key. */
  storageKey?: string;
  /** File name stem for CSV export. */
  exportName: string;
  /** Left side of the toolbar (tabs, filters). */
  toolbar?: React.ReactNode;
  /** Shown above the table when rows are selected; omit to disable selection. */
  bulkActions?: (selected: T[], clear: () => void) => React.ReactNode;
  /** More rows exist on the server. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Rendered instead of the table when there are no rows. */
  empty?: React.ReactNode;
}

/**
 * The standard list table: sortable headers, column chooser, CSV export, row selection with
 * bulk actions, a sticky header and paging over rows (fetching more from the server as needed).
 */
export function DataTable<T>({ rows, rowKey, columns, storageKey, exportName, toolbar, bulkActions, hasMore, loadingMore, onLoadMore, empty }: DataTableProps<T>) {
  const [hidden, setHidden] = useState<string[]>(() => (typeof window === "undefined" ? [] : readHidden(storageKey)));
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [wantPage, setWantPage] = useState<number | null>(null);

  const cols = columns.filter((c) => c.locked || !hidden.includes(c.key));
  const cellValue = (c: Column<T>, r: T) => (c.value ? c.value(r) : nodeText(c.render(r)));

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const keyed = rows.map((r) => [sortable(col.value ? col.value(r) : nodeText(col.render(r))), r] as const);
    return keyed.sort((a, b) => compare(a[0], b[0]) * sort.dir).map(([, r]) => r);
  }, [rows, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  // After "next" fetched more rows from the server, move onto the requested page.
  if (wantPage !== null && !loadingMore && (wantPage < pages || !hasMore)) {
    setPage(Math.min(wantPage, pages - 1));
    setWantPage(null);
  }
  const current = Math.min(page, pages - 1);
  const shown = sorted.slice(current * pageSize, (current + 1) * pageSize);

  const saveHidden = (next: string[]) => {
    setHidden(next);
    if (!storageKey) return;
    try {
      localStorage.setItem(`cols:${storageKey}`, JSON.stringify(next));
    } catch {
      // Storage unavailable: the choice lasts until the page reloads.
    }
  };
  const toggleSort = (key: string) => setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  const selectedRows = rows.filter((r) => selected.has(rowKey(r)));
  const allShown = shown.length > 0 && shown.every((r) => selected.has(rowKey(r)));
  const clear = () => setSelected(new Set());
  const exportRows = (list: T[]) =>
    downloadCsv(
      exportName,
      cols.map((c) => c.label),
      list.map((r) => cols.map((c) => String(cellValue(c, r) ?? ""))),
    );

  const next = () => {
    if (current + 1 < pages) setPage(current + 1);
    else if (hasMore && onLoadMore) {
      setWantPage(current + 1);
      onLoadMore();
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 px-4 pt-3">
        <div className="min-w-0 flex-1">{toolbar}</div>
        <div className="mb-2 flex items-center gap-2">
          <ColumnChooser columns={columns} hidden={hidden} onChange={saveHidden} />
          <Button variant="secondary" size="sm" onClick={() => exportRows(sorted)} disabled={!rows.length} title="Export the loaded rows as CSV">
            <Download className="size-4" aria-hidden /> Export
          </Button>
        </div>
      </div>

      {bulkActions && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-y border-primary/20 bg-primary-soft px-4 py-2 text-sm">
          <span className="font-medium text-primary">{selectedRows.length} selected</span>
          <span className="mx-1 h-4 w-px bg-primary/20" aria-hidden />
          <Button variant="secondary" size="sm" onClick={() => exportRows(selectedRows)}>
            <Download className="size-4" aria-hidden /> Export selected
          </Button>
          {bulkActions(selectedRows, clear)}
          <button onClick={clear} className="ml-auto text-sm text-primary hover:underline">
            Clear selection
          </button>
        </div>
      )}

      {!rows.length && empty ? (
        empty
      ) : (
        <div className="overflow-auto border-t border-border lg:max-h-[calc(100vh-15rem)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface-muted text-left text-xs text-muted shadow-[inset_0_-1px_0_var(--border)]">
              <tr>
                {bulkActions && (
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      aria-label="Select all rows on this page"
                      checked={allShown}
                      onChange={() => {
                        const s = new Set(selected);
                        shown.forEach((r) => (allShown ? s.delete(rowKey(r)) : s.add(rowKey(r))));
                        setSelected(s);
                      }}
                    />
                  </th>
                )}
                {cols.map((c) => {
                  const dir = sort?.key === c.key ? sort.dir : 0;
                  return (
                    <th key={c.key} className={cn("px-4 py-2.5 font-semibold tracking-wide whitespace-nowrap uppercase", c.align === "right" && "text-right")} aria-sort={dir === 1 ? "ascending" : dir === -1 ? "descending" : undefined}>
                      {c.noSort ? (
                        c.label
                      ) : (
                        <button onClick={() => toggleSort(c.key)} className={cn("group inline-flex items-center gap-1 uppercase hover:text-foreground", c.align === "right" && "flex-row-reverse", dir && "text-foreground")}>
                          {c.label}
                          {dir === 1 ? <ArrowUp className="size-3" aria-hidden /> : dir === -1 ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-0 group-hover:opacity-60" aria-hidden />}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => {
                const id = rowKey(r);
                const on = selected.has(id);
                return (
                  <tr key={id} className={cn("transition-colors", on ? "bg-primary-soft/50" : "hover:bg-surface-muted/60")}>
                    {bulkActions && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--primary)]"
                          aria-label="Select row"
                          checked={on}
                          onChange={() => {
                            const s = new Set(selected);
                            if (on) s.delete(id);
                            else s.add(id);
                            setSelected(s);
                          }}
                        />
                      </td>
                    )}
                    {cols.map((c) => (
                      <td key={c.key} className={cn("px-4 py-3 whitespace-nowrap", c.align === "right" && "text-right tabular-nums", c.className)}>
                        {c.render(r)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-sm text-muted">
          <span>
            {current * pageSize + 1}–{current * pageSize + shown.length} of {sorted.length}
            {hasMore ? "+" : ""}
          </span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="hidden sm:inline">Rows</span>
              <select
                className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                aria-label="Rows per page"
              >
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </Button>
              <span className="tabular-nums">
                {current + 1} / {pages}
                {hasMore ? "+" : ""}
              </span>
              <Button variant="ghost" size="sm" onClick={next} disabled={current + 1 >= pages && !hasMore} loading={loadingMore} aria-label="Next page">
                {!loadingMore && <ChevronRight className="size-4" />}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ColumnChooser<T>({ columns, hidden, onChange }: { columns: Column<T>[]; hidden: string[]; onChange: (h: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const optional = columns.filter((c) => !c.locked);
  if (!optional.length) return null;
  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Columns3 className="size-4" aria-hidden /> Columns
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-border bg-surface p-1 shadow-xl">
          <p className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Show columns</p>
          {optional.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-surface-muted">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!hidden.includes(c.key)} onChange={() => onChange(hidden.includes(c.key) ? hidden.filter((k) => k !== c.key) : [...hidden, c.key])} />
              {c.label}
            </label>
          ))}
          {hidden.length > 0 && (
            <button onClick={() => onChange([])} className="mt-1 w-full rounded-md px-3 py-1.5 text-left text-sm text-primary hover:bg-surface-muted">
              Show all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
