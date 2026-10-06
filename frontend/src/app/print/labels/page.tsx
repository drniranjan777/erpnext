"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { toSVG } from "bwip-js/browser";
import { Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { PrintShell } from "@/components/print-shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/documents";
import type { StockEntry } from "@/lib/inventory";
import type { GoodsReceipt } from "@/lib/purchase";
import type { Item } from "@/lib/masters";

/** Label stock sizes in mm. Roll labels print one per page; sheets are laid out in a grid. */
const LAYOUTS = {
  "roll-50x25": {
    name: "Roll 50 × 25 mm (thermal)",
    w: 50,
    h: 25,
    cols: 1,
    roll: true,
  },
  "roll-38x25": {
    name: "Roll 38 × 25 mm (thermal)",
    w: 38,
    h: 25,
    cols: 1,
    roll: true,
  },
  "roll-75x50": {
    name: "Roll 75 × 50 mm (thermal)",
    w: 75,
    h: 50,
    cols: 1,
    roll: true,
  },
  "a4-24": {
    name: "A4 sheet, 24 per page (70 × 37 mm)",
    w: 70,
    h: 37,
    cols: 3,
    roll: false,
  },
  "a4-65": {
    name: "A4 sheet, 65 per page (38 × 21 mm)",
    w: 38.1,
    h: 21.2,
    cols: 5,
    roll: false,
  },
} as const;
type LayoutKey = keyof typeof LAYOUTS;

interface Row {
  key: string;
  itemId: string;
  batchNo: string | null;
  expiryDate: string | null;
  copies: number;
}

let seq = 0;

export default function LabelsPage() {
  return (
    <Suspense>
      <Labels />
    </Suspense>
  );
}

function Labels() {
  const params = useSearchParams();
  const { status } = useAuth();
  const entryId = params.get("entry");
  const [rows, setRows] = useState<Row[]>(() =>
    (params.get("items") ?? "")
      .split(",")
      .filter(Boolean)
      .map((itemId) => ({
        key: `r${++seq}`,
        itemId,
        batchNo: null,
        expiryDate: null,
        copies: 1,
      })),
  );
  const [layout, setLayout] = useState<LayoutKey>("roll-50x25");
  const [symbol, setSymbol] = useState<"barcode" | "qr">("barcode");
  const [show, setShow] = useState({
    name: true,
    code: true,
    mrp: true,
    batch: true,
  });

  // Labels for the items received on a stock entry (one label per unit, capped).
  const entry = useQuery({
    queryKey: ["labels", "entry", entryId],
    queryFn: () => api<StockEntry>(`/inventory/stock-entries/${entryId}`),
    enabled: !!entryId && status === "authenticated",
  });
  // …or accepted on a goods receipt.
  const grnId = params.get("grn");
  const grn = useQuery({
    queryKey: ["labels", "grn", grnId],
    queryFn: () => api<GoodsReceipt>(`/purchase/receipts/${grnId}`),
    enabled: !!grnId && status === "authenticated",
  });
  const source = entry.data
    ? { id: entry.data.id, lines: entry.data.lines.map((l) => ({ itemId: l.itemId, batchNo: l.batchNo, expiryDate: l.expiryDate, baseQty: l.baseQty })) }
    : grn.data
      ? { id: grn.data.id, lines: grn.data.lines.filter((l) => Number(l.acceptedBaseQty) > 0).map((l) => ({ itemId: l.itemId, batchNo: l.batchNo, expiryDate: l.expiryDate, baseQty: l.acceptedBaseQty })) }
      : null;
  const [seeded, setSeeded] = useState<string | null>(null);
  if (source && seeded !== source.id) {
    setSeeded(source.id);
    setRows(
      source.lines.map((l) => {
        const units = Number(l.baseQty);
        return {
          key: `r${++seq}`,
          itemId: l.itemId,
          batchNo: l.batchNo,
          expiryDate: l.expiryDate,
          copies:
            Number.isInteger(units) && units > 0 && units <= 100 ? units : 1,
        };
      }),
    );
  }

  const ids = [...new Set(rows.map((r) => r.itemId))];
  const itemQueries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["masters", "items", id],
      queryFn: () => api<Item>(`/masters/items/${id}`),
      enabled: status === "authenticated",
      staleTime: 60_000,
    })),
  });
  const items = new Map(
    itemQueries.flatMap((q) => (q.data ? [[q.data.id, q.data] as const] : [])),
  );
  const L = LAYOUTS[layout];
  const labels = rows.flatMap((r) =>
    items.has(r.itemId)
      ? Array.from(
          { length: Math.max(0, Math.min(r.copies, 500)) },
          (_, i) => ({ ...r, n: i }),
        )
      : [],
  );

  return (
    <PrintShell title="Labels" ready={labels.length > 0}>
      <style>
        {L.roll
          ? `@page { size: ${L.w}mm ${L.h}mm; margin: 0; } .label { page-break-after: always; }`
          : `@page { size: A4; margin: 10mm 7mm; }`}
      </style>
      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="w-full shrink-0 space-y-4 rounded-xl border border-border bg-surface p-4 lg:w-96 print:hidden">
          <div>
            <p className="mb-1.5 text-sm font-medium">Add items</p>
            <ItemPicker
              onPick={(it) =>
                setRows((rs) => [
                  ...rs,
                  {
                    key: `r${++seq}`,
                    itemId: it.id,
                    batchNo: null,
                    expiryDate: null,
                    copies: 1,
                  },
                ])
              }
              placeholder="Search or scan an item"
            />
          </div>
          {rows.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {rows.map((r) => {
                const it = items.get(r.itemId);
                return (
                  <li key={r.key} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{it ? it.name : "Loading…"}</p>
                      <input
                        className="mt-1 h-7 w-full rounded border border-border px-2 font-mono text-xs uppercase"
                        placeholder="Batch (optional)"
                        aria-label="Batch number"
                        value={r.batchNo ?? ""}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((x) =>
                              x.key === r.key
                                ? {
                                    ...x,
                                    batchNo:
                                      e.target.value.toUpperCase() || null,
                                  }
                                : x,
                            ),
                          )
                        }
                      />
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      aria-label="Copies"
                      className="h-8 w-16 rounded border border-border px-2 text-right"
                      value={r.copies}
                      onChange={(e) =>
                        setRows((rs) =>
                          rs.map((x) =>
                            x.key === r.key
                              ? {
                                  ...x,
                                  copies: Math.max(
                                    1,
                                    Math.min(500, Number(e.target.value) || 1),
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() =>
                        setRows((rs) => rs.filter((x) => x.key !== r.key))
                      }
                    >
                      <Trash2 className="size-4 text-danger" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Label stock</span>
            <select
              className="h-10 w-full rounded-lg border border-border bg-surface px-3"
              value={layout}
              onChange={(e) => setLayout(e.target.value as LayoutKey)}
            >
              {Object.entries(LAYOUTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <span className="mb-1.5 block font-medium">Code</span>
            <div className="flex gap-4">
              {(["barcode", "qr"] as const).map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="symbol"
                    checked={symbol === s}
                    onChange={() => setSymbol(s)}
                  />{" "}
                  {s === "barcode" ? "Barcode" : "QR code"}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">
              Barcodes use the item&apos;s primary barcode (EAN-13 when it is
              one), else its code.
            </p>
          </div>
          <div className="text-sm">
            <span className="mb-1.5 block font-medium">Show</span>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(show) as (keyof typeof show)[]).map((k) => (
                <label key={k} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={show[k]}
                    onChange={(e) =>
                      setShow({ ...show, [k]: e.target.checked })
                    }
                  />
                  {k === "mrp" ? "MRP" : k[0].toUpperCase() + k.slice(1)}
                </label>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted">
            {labels.length} label{labels.length === 1 ? "" : "s"}. In the print
            dialog, set margins to “None” and scale to 100%.
          </p>
        </aside>

        <div className="min-w-0 flex-1 overflow-auto print:overflow-visible">
          {labels.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted print:hidden">
              Add items to print labels.
            </p>
          ) : (
            <div
              className={
                L.roll
                  ? "flex flex-wrap gap-3 print:block"
                  : "grid bg-white print:gap-0"
              }
              style={
                L.roll
                  ? undefined
                  : {
                      gridTemplateColumns: `repeat(${L.cols}, ${L.w}mm)`,
                      width: `${L.cols * L.w}mm`,
                    }
              }
            >
              {labels.map((l) => (
                <Label
                  key={`${l.key}-${l.n}`}
                  item={items.get(l.itemId)!}
                  batchNo={l.batchNo}
                  expiryDate={l.expiryDate}
                  w={L.w}
                  h={L.h}
                  symbol={symbol}
                  show={show}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </PrintShell>
  );
}

function Label({
  item,
  batchNo,
  expiryDate,
  w,
  h,
  symbol,
  show,
}: {
  item: Item;
  batchNo: string | null;
  expiryDate: string | null;
  w: number;
  h: number;
  symbol: "barcode" | "qr";
  show: Record<"name" | "code" | "mrp" | "batch", boolean>;
}) {
  const primary =
    item.barcodes.find((b) => b.isPrimary)?.barcode ??
    item.barcodes[0]?.barcode;
  const value = primary ?? item.code;
  const svg = useMemo(() => {
    try {
      if (symbol === "qr") {
        // QR carries code, batch and expiry so a phone scan identifies the exact lot.
        const text = [item.code, batchNo, expiryDate].filter(Boolean).join("|");
        return toSVG({
          bcid: "qrcode",
          text,
          scale: 2,
          eclevel: "M",
        } as Parameters<typeof toSVG>[0]);
      }
      const ean = /^\d{13}$/.test(value);
      return toSVG({
        bcid: ean ? "ean13" : "code128",
        text: value,
        scale: 2,
        height: Math.max(6, h * 0.35),
        includetext: true,
        textxalign: "center",
        textsize: 8,
      });
    } catch {
      return null;
    }
  }, [symbol, value, item.code, batchNo, expiryDate, h]);
  const small = h < 30;

  return (
    <div
      className="label flex overflow-hidden border border-dashed border-gray-300 bg-white p-[1.5mm] text-black print:border-0"
      style={{
        width: `${w}mm`,
        height: `${h}mm`,
        flexDirection: symbol === "qr" ? "row" : "column",
        gap: "1mm",
      }}
    >
      {symbol === "qr" && svg && (
        <div
          className="h-full shrink-0 [&>svg]:h-full [&>svg]:w-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      <div
        className={symbol === "qr" ? "min-w-0 flex-1" : "min-w-0"}
        style={{ fontSize: small ? "6.5pt" : "8pt", lineHeight: 1.15 }}
      >
        {show.name && <p className="line-clamp-2 font-semibold">{item.name}</p>}
        <p className="flex justify-between gap-1">
          {show.code && <span className="font-mono">{item.code}</span>}
          {show.mrp && item.mrp && (
            <span className="font-semibold">MRP {formatMoney(item.mrp)}</span>
          )}
        </p>
        {show.batch && batchNo && (
          <p className="font-mono">
            B: {batchNo}
            {expiryDate && ` · EXP ${formatDate(expiryDate)}`}
          </p>
        )}
      </div>
      {symbol === "barcode" && svg && (
        <div
          className="flex min-h-0 flex-1 items-end justify-center [&>svg]:h-full [&>svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}
