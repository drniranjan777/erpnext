"use client";

import { Banknote, Boxes, ChevronRight, Factory, LayoutGrid, ShieldCheck, ShoppingBag, ShoppingCart, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
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

/** Short axis labels: ₹11 L rather than ₹11.00 L. */
const axis = (v: number, unit: Unit) => fmt(String(v), unit, true).replace(/\.00(?= |$)/, "").replace(/(\.\d)0(?= |$)/, "$1");

const SPAN = { 1: "", 2: "@xl:col-span-2", 3: "col-span-full" } as const;
const TONE = { good: "text-success", bad: "text-danger", neutral: "text-muted" } as const;
const AREA: Record<string, { icon: LucideIcon; tint: string }> = {
  sales: { icon: ShoppingCart, tint: "bg-primary-soft text-primary" },
  purchase: { icon: ShoppingBag, tint: "bg-primary-soft text-primary" },
  finance: { icon: Banknote, tint: "bg-success-soft text-success" },
  stores: { icon: Boxes, tint: "bg-warning-soft text-warning" },
  production: { icon: Factory, tint: "bg-primary-soft text-primary" },
  quality: { icon: ShieldCheck, tint: "bg-success-soft text-success" },
};
const area = (a: string) => AREA[a] ?? { icon: LayoutGrid, tint: "bg-surface-muted text-muted" };

/** One widget tile; `big` is the TV-mode type scale. */
function WidgetTile({ w, big = false }: { w: Widget; big?: boolean }) {
  const { icon: Icon, tint } = area(w.area);
  const kpi = w.data?.kind === "kpi";
  return (
    <Card className={cn("flex flex-col", SPAN[w.size], big ? "p-6" : "p-4")}>
      <div className="flex items-start gap-3">
        {kpi && (
          <span className={cn("flex shrink-0 items-center justify-center rounded-lg", tint, big ? "size-14" : "size-10")}>
            <Icon className={big ? "size-7" : "size-5"} aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Link href={w.href} className={cn("truncate font-medium text-muted hover:text-primary", big ? "text-2xl" : "text-sm")} title={w.description}>
              {w.title}
            </Link>
            {!kpi && !big && (
              <Link href={w.href} className="flex shrink-0 items-center text-xs text-primary hover:underline">
                View <ChevronRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
          {kpi && w.data?.kind === "kpi" && (
            <>
              <p className={cn("mt-1 font-semibold tracking-tight tabular-nums", big ? "text-6xl" : "text-2xl")}>{fmt(w.data.value, w.data.unit, true)}</p>
              {w.data.sub && <p className={cn("mt-1 truncate", big ? "text-xl" : "text-xs", TONE[w.data.tone ?? "neutral"])} title={w.data.sub}>{w.data.sub}</p>}
            </>
          )}
        </div>
      </div>
      {w.error || !w.data ? (
        <p className="mt-3 text-sm text-muted">{w.error ?? "No data"}</p>
      ) : w.data.kind === "kpi" ? null : w.data.kind === "series" ? (
        <Series data={w.data} big={big} />
      ) : (
        <ul className={cn("mt-3 divide-y divide-border", big ? "text-xl" : "text-sm")}>
          {w.data.rows.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-surface-muted font-medium text-muted tabular-nums", big ? "size-9 text-base" : "size-6 text-[11px]")}>{i + 1}</span>
                <span className="min-w-0">
                  {r.href ? (
                    <Link href={r.href} className="block truncate hover:text-primary">
                      {r.label}
                    </Link>
                  ) : (
                    <span className="block truncate">{r.label}</span>
                  )}
                  {r.sub && <span className={cn("block truncate text-muted", big ? "text-base" : "text-xs")}>{r.sub}</span>}
                </span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">{fmt(r.value, (w.data as { unit: Unit }).unit, true)}</span>
            </li>
          ))}
          {!w.data.rows.length && <li className="py-6 text-center text-muted">Nothing here yet.</li>}
        </ul>
      )}
    </Card>
  );
}

/** Area chart with a light grid; every point has a tooltip. */
function Series({ data, big }: { data: Extract<WidgetData, { kind: "series" }>; big: boolean }) {
  const values = data.points.map((p) => Number(p.value));
  const max = Math.max(1, ...values);
  const last = data.points.at(-1);
  const n = data.points.length;
  const W = 100;
  const H = 40;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 2) - 1;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const fill = n ? `${line} L${x(n - 1).toFixed(2)},${H} L${x(0).toFixed(2)},${H} Z` : "";
  return (
    <div className="mt-3 flex flex-1 flex-col">
      {last && (
        <p className={cn("text-muted", big ? "text-2xl" : "text-xs")}>
          Latest <span className={cn("font-semibold text-foreground tabular-nums", big ? "text-3xl" : "text-lg")}>{fmt(last.value, data.unit, true)}</span>
        </p>
      )}
      <div className={cn("relative mt-2 flex", big ? "h-48" : "h-32")}>
        <div className={cn("flex w-14 shrink-0 flex-col justify-between pr-2 text-right whitespace-nowrap text-muted tabular-nums", big ? "text-sm" : "text-[10px]")} aria-hidden>
          <span>{axis(max, data.unit)}</span>
          <span>{axis(max / 2, data.unit)}</span>
          <span>0</span>
        </div>
        <div className="relative flex-1">
          <div className="absolute inset-0 flex flex-col justify-between" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="border-t border-dashed border-border" />
            ))}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={data.points.map((p) => `${p.label}: ${fmt(p.value, data.unit)}`).join(", ")}>
            <defs>
              <linearGradient id="series-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {n > 0 && <path d={fill} fill="url(#series-fill)" />}
            {n > 0 && <path d={line} fill="none" stroke="var(--primary)" strokeWidth={big ? 2.5 : 2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
          </svg>
          <div className="absolute inset-0 flex">
            {data.points.map((p) => (
              <div key={p.label} className="flex-1 hover:bg-primary/5" title={`${p.label}: ${fmt(p.value, data.unit)}`} />
            ))}
          </div>
        </div>
      </div>
      <div className={cn("mt-1 flex justify-between pl-14 text-muted", big ? "text-base" : "text-[10px]")}>
        <span>{data.points[0]?.label}</span>
        {n > 2 && <span>{data.points[Math.floor((n - 1) / 2)]?.label}</span>}
        <span>{last?.label}</span>
      </div>
    </div>
  );
}

export function WidgetGrid({ widgets, big = false }: { widgets: Widget[]; big?: boolean }) {
  return (
    <div className="@container">
      <div className={cn("grid @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4", big ? "gap-6" : "gap-4")}>
        {widgets.map((w) => (
          <WidgetTile key={w.key} w={w} big={big} />
        ))}
      </div>
    </div>
  );
}
