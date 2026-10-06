"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { apiDownload } from "@/lib/api";
import { todayIST } from "@/lib/documents";

export interface Period {
  from: string;
  to: string;
}

/** The current month so far. */
export function thisMonth(): Period {
  const t = todayIST();
  return { from: `${t.slice(0, 8)}01`, to: t };
}

function presets(): { label: string; p: Period }[] {
  const t = todayIST();
  const [y, m] = t.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1, 0));
  const lm = { from: `${last.toISOString().slice(0, 8)}01`, to: last.toISOString().slice(0, 10) };
  const fy = m >= 4 ? y : y - 1;
  const half = m >= 4 && m <= 9 ? { from: `${fy}-04-01`, to: `${fy}-09-30` } : { from: `${fy}-10-01`, to: `${fy + 1}-03-31` };
  return [
    { label: "This month", p: thisMonth() },
    { label: "Last month", p: lm },
    { label: "This half-year (ITC-04)", p: half },
    { label: `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`, p: { from: `${fy}-04-01`, to: `${fy + 1}-03-31` } },
  ];
}

/** Period picker with presets and a CSV download for the report. */
export function PeriodBar({ value, onChange, csvPath, csvName }: { value: Period; onChange: (p: Period) => void; csvPath?: string; csvName?: string }) {
  const [busy, setBusy] = useState(false);
  const opts = presets();
  return (
    <div className="flex flex-wrap items-end gap-4 border-b border-border px-5 py-4">
      <Field label="Period">
        {(f) => (
          <Select {...f} value={opts.findIndex((o) => o.p.from === value.from && o.p.to === value.to)} onChange={(e) => Number(e.target.value) >= 0 && onChange(opts[Number(e.target.value)].p)}>
            <option value={-1}>Custom</option>
            {opts.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
          </Select>
        )}
      </Field>
      <Field label="From">{(f) => <Input {...f} type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />}</Field>
      <Field label="To">{(f) => <Input {...f} type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />}</Field>
      {csvPath && (
        <Button
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await apiDownload(`${csvPath}?from=${value.from}&to=${value.to}&format=csv`, csvName ?? "report.csv");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download className="size-4" aria-hidden /> CSV
        </Button>
      )}
    </div>
  );
}
