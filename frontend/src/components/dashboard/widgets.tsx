"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { formatMoney, formatQty } from "@/lib/documents";

export type Unit = "money" | "number" | "percent" | "qty";
export type WidgetData =
  | { kind: "kpi"; value: string; unit: Unit; sub?: string; tone?: "good" | "bad" | "neutral" }
  | { kind: "series"; unit: Unit; points: { label: string; value: string }[] }
  | { kind: "list"; unit: Unit; rows: { label: string; value: string; sub?: string; href?: string }[] };

export interface Widget { key: string; title: string; description: string; area: string; size: 1 | 2 | 3; href: string; data: WidgetData | null; error?: string }
export interface DashboardView { id: string | null; name: string; preset: string | null; refreshSeconds: number; mine: boolean; shared: boolean; isDefault: boolean; asOf: string; widgets: Widget[] }

export function fmt(v: string, unit: Unit, compact = false) {
  const n = Number(v);
  if (unit === "percent") return `${n.toFixed(n >= 10 ? 1 : 2)}%`;
  if (unit === "money") {
    if (compact && Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
    if (compact && Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
    return formatMoney(String(Math.round(n)));
  }
  if (unit === "qty") return formatQty(v);
  return n.toLocaleString("en-IN");
}

const SPAN = { 1: "", 2: "sm:col-span-2", 3: "sm:col-span-2 xl:col-span-4" } as const;
const TONE = { good: "text-success", bad: "text-danger", neutral: "text-muted" } as const;

/** One widget tile; `big` is the TV-mode type scale. */
export function WidgetTile({ w, big = false }: { w: Widget; big?: boolean }) {
  return (
    <Card className={`flex flex-col p-4 ${SPAN[w.size]} ${big ? "p-6" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <Link href={w.href} className={`font-medium hover:text-primary ${big ? "text-2xl" : "text-sm"}`} title={w.description}>{w.title}</Link>
      </div>
      {w.error || !w.data ? (
        <p className="mt-3 text-sm text-muted">{w.error ?? "No data"}</p>
      ) : w.data.kind === "kpi" ? (
        <div className="mt-2">
          <p className={`font-semibold tabular-nums ${big ? "text-6xl" : "text-3xl"}`}>{fmt(w.data.value, w.data.unit, true)}</p>
          {w.data.sub && <p className={`mt-1 ${big ? "text-xl" : "text-xs"} ${TONE[w.data.tone ?? "neutral"]}`}>{w.data.sub}</p>}
        </div>
      ) : w.data.kind === "series" ? (
        <Series data={w.data} big={big} />
      ) : (
        <ul className={`mt-3 divide-y divide-border ${big ? "text-xl" : "text-sm"}`}>
          {w.data.rows.map((r, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0">
                {r.href ? <Link href={r.href} className="hover:text-primary">{r.label}</Link> : r.label}
                {r.sub && <span className={`block text-muted ${big ? "text-base" : "text-xs"}`}>{r.sub}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{fmt(r.value, (w.data as { unit: Unit }).unit, true)}</span>
            </li>
          ))}
          {!w.data.rows.length && <li className="py-2 text-muted">Nothing here.</li>}
        </ul>
      )}
    </Card>
  );
}

function Series({ data, big }: { data: Extract<WidgetData, { kind: "series" }>; big: boolean }) {
  const max = Math.max(1, ...data.points.map((p) => Number(p.value)));
  const last = data.points.at(-1);
  return (
    <div className="mt-3 flex flex-1 flex-col">
      {last && <p className={`tabular-nums ${big ? "text-2xl" : "text-sm"}`}>Latest: <span className="font-semibold">{fmt(last.value, data.unit, true)}</span></p>}
      <div className={`mt-2 flex items-end gap-1 ${big ? "h-48" : "h-28"}`} role="img" aria-label={data.points.map((p) => `${p.label}: ${fmt(p.value, data.unit)}`).join(", ")}>
        {data.points.map((p) => (
          <div key={p.label} className="flex h-full flex-1 flex-col justify-end" title={`${p.label}: ${fmt(p.value, data.unit)}`}>
            <div className="rounded-t bg-primary/80" style={{ height: `${Math.max(2, (Number(p.value) / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className={`mt-1 flex justify-between text-muted ${big ? "text-base" : "text-[10px]"}`}>
        <span>{data.points[0]?.label}</span>
        <span>{last?.label}</span>
      </div>
    </div>
  );
}

export function WidgetGrid({ widgets, big = false }: { widgets: Widget[]; big?: boolean }) {
  return (
    <div className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-4 ${big ? "gap-6" : ""}`}>
      {widgets.map((w) => <WidgetTile key={w.key} w={w} big={big} />)}
    </div>
  );
}
