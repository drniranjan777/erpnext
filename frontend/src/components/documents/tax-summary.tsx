import { formatMoney } from "@/lib/documents";
import type { TaxTotals } from "@/lib/purchase";

const STATE_NAMES: Record<string, string> = { "96": "Outside India" };

/** Taxable value → CGST/SGST or IGST → cess → round off → total, with GST notes. */
export function TaxSummary({ tax, stateTaxLabel = "SGST", totalLabel = "Total" }: { tax: TaxTotals; stateTaxLabel?: string; totalLabel?: string }) {
  const n = (v: string) => Number(v) !== 0;
  return (
    <div className="space-y-3">
      <dl className="ml-auto max-w-sm space-y-1 text-sm">
        <Row label="Taxable value" value={tax.taxableTotal} />
        {n(tax.cgstTotal) && <Row label="CGST" value={tax.cgstTotal} />}
        {n(tax.sgstTotal) && <Row label={stateTaxLabel} value={tax.sgstTotal} />}
        {n(tax.igstTotal) && <Row label="IGST" value={tax.igstTotal} />}
        {n(tax.cessTotal) && <Row label="Cess" value={tax.cessTotal} />}
        {tax.reverseCharge && <Row label="GST we pay (reverse charge)" value={tax.reverseChargeTax} muted />}
        {n(tax.roundOff) && <Row label="Round off" value={tax.roundOff} muted />}
        <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
          <dt>{totalLabel}</dt>
          <dd className="tabular-nums">{formatMoney(tax.grandTotal)}</dd>
        </div>
      </dl>
      <p className="text-right text-xs text-muted">
        {tax.interState ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"}
        {tax.placeOfSupply && ` · place of supply ${STATE_NAMES[tax.placeOfSupply] ?? tax.placeOfSupply}`}
      </p>
      {tax.taxNotes.map((note) => (
        <p key={note} className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted">
          {note}
        </p>
      ))}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-muted" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatMoney(value)}</dd>
    </div>
  );
}
