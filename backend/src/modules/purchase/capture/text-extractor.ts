import { gstinError } from '@nextgen/database';

/** Fields read off a supplier's bill (by the text parser or an AI model). */
export interface ExtractedBill {
  supplierName: string | null;
  supplierGstin: string | null;
  buyerGstin: string | null;
  invoiceNo: string | null;
  /** YYYY-MM-DD */
  invoiceDate: string | null;
  lines: ExtractedLine[];
  taxableTotal: string | null;
  cgst: string | null;
  sgst: string | null;
  igst: string | null;
  cess: string | null;
  grandTotal: string | null;
  reverseCharge: boolean;
}

export interface ExtractedLine {
  description: string;
  hsnCode: string | null;
  qty: string | null;
  unit: string | null;
  rate: string | null;
  discountPct: string | null;
  taxableValue: string | null;
  gstRate: string | null;
}

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const UNITS = new Set(['NOS', 'NO', 'PCS', 'PC', 'KG', 'KGS', 'MT', 'TON', 'LTR', 'LTRS', 'L', 'MTR', 'MTRS', 'M', 'BOX', 'BOXES', 'SET', 'SETS', 'PAIR', 'BAG', 'BAGS', 'ROLL', 'ROLLS', 'SQM', 'SQFT', 'CTN', 'DOZ', 'GMS', 'G', 'UNIT', 'UNITS', 'EA']);

/** "1,23,456.50" → "123456.50"; null when not a number. */
export function money(v: string | undefined | null): string | null {
  if (!v) return null;
  const s = v.replace(/[₹,\s]/g, '').replace(/^Rs\.?/i, '');
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

/** Indian dates: 05/08/2026, 5-8-26, 05.08.2026, 5 Aug 2026, 05-Aug-2026. */
export function parseDate(v: string): string | null {
  const t = v.trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(y, Number(m[2]), Number(m[1]));
  }
  m = t.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return mon ? iso(y, mon, Number(m[1])) : null;
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? iso(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

function iso(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** Last amount on a line that matches the label (totals are usually right-aligned). */
function amountAfter(lines: string[], label: RegExp): string | null {
  for (const l of lines) {
    if (!label.test(l)) continue;
    const nums = l.match(/\d[\d,]*\.\d{2}\b|\d[\d,]{2,}\b/g);
    if (nums?.length) return money(nums[nums.length - 1]);
  }
  return null;
}

/**
 * Reads a text bill (a text-layer PDF's text, an e-mailed bill, a .txt export). Finds GSTINs
 * (check digit verified), number, date, totals and item rows (description, HSN, qty, unit,
 * rate, amount). `ownGstins` tells our GSTIN apart from the supplier's.
 */
export function extractFromText(text: string, ownGstins: string[] = []): ExtractedBill {
  const raw = text.replace(/\r/g, '');
  const lines = raw.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const upper = raw.toUpperCase();
  const gstins = [...new Set(upper.match(GSTIN_RE) ?? [])].filter((g) => !gstinError(g));
  const own = new Set(ownGstins.map((g) => g.toUpperCase()));
  const supplierGstin = gstins.find((g) => !own.has(g)) ?? null;
  const buyerGstin = gstins.find((g) => own.has(g)) ?? gstins.find((g) => g !== supplierGstin) ?? null;

  const invoiceNo = raw.match(/(?:invoice|inv|bill)\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{0,15})/i)?.[1] ?? null;
  const dateText =
    raw.match(/(?:invoice\s*date|inv\.?\s*date|bill\s*date|dated|date)\s*[:\-]?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[\s-]+[A-Za-z]{3,9}[\s,-]+\d{2,4}|\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;

  // Supplier name: first meaningful line that is not a heading.
  const supplierName = lines.find((l) => !/invoice|bill of supply|original|duplicate|triplicate|gstin|^page/i.test(l) && /[A-Za-z]{3}/.test(l) && l.length <= 80) ?? null;

  const items: ExtractedLine[] = [];
  for (const l of lines) {
    if (/total|gstin|invoice|cgst|sgst|igst|amount in words|bank|ifsc/i.test(l)) continue;
    const hsnM = l.match(/(?:^|\s)(\d{4}|\d{6}|\d{8})(?=\s)/);
    if (!hsnM) continue;
    const before = l.slice(0, hsnM.index! + hsnM[0].indexOf(hsnM[1])).replace(/^\d{1,3}[.)]?\s+/, '').trim();
    const after = l.slice(hsnM.index! + hsnM[0].length).trim();
    const tokens = after.split(' ');
    const nums: string[] = [];
    let unit: string | null = null;
    let gstRate: string | null = null;
    let discountPct: string | null = null;
    for (const t of tokens) {
      const pct = t.match(/^(\d{1,2}(?:\.\d{1,2})?)%$/);
      if (pct) {
        // A percentage before the amount is the discount when it is not a GST slab.
        if (['0', '0.1', '0.25', '1.5', '3', '5', '12', '18', '28', '40'].includes(String(Number(pct[1]))) && !gstRate) gstRate = String(Number(pct[1]));
        else discountPct = String(Number(pct[1]));
        continue;
      }
      if (UNITS.has(t.toUpperCase().replace(/\.$/, ''))) {
        unit = t.toUpperCase().replace(/\.$/, '');
        continue;
      }
      const n = money(t);
      if (n) nums.push(n);
    }
    if (nums.length < 2 || before.length < 2) continue;
    const amount = nums[nums.length - 1];
    const qty = nums[0];
    const rate = nums.length >= 3 ? nums[1] : (Number(qty) ? (Number(amount) / Number(qty)).toFixed(2) : null);
    items.push({ description: before, hsnCode: hsnM[1], qty, unit, rate, discountPct, taxableValue: amount, gstRate });
  }

  return {
    supplierName,
    supplierGstin,
    buyerGstin,
    invoiceNo,
    invoiceDate: dateText ? parseDate(dateText) : null,
    lines: items,
    taxableTotal: amountAfter(lines, /taxable\s*(value|amount)|sub\s*-?\s*total/i),
    cgst: amountAfter(lines, /\bcgst\b/i),
    sgst: amountAfter(lines, /\b(sgst|utgst)\b/i),
    igst: amountAfter(lines, /\bigst\b/i),
    cess: amountAfter(lines, /\bcess\b/i),
    grandTotal: amountAfter(lines, /grand\s*total|invoice\s*(total|value)|total\s*amount|amount\s*payable|net\s*payable/i),
    reverseCharge: /reverse\s*charge\s*[:\-]?\s*(yes|y\b|applicable)/i.test(raw),
  };
}
